"use server";

import { revalidatePath } from "next/cache";
import { requireActiveTeamMember } from "@/lib/auth/session";
import { applyRuleSetToVisit } from "@/lib/actions/messaging";
import { normalizePhone } from "@/lib/mastra/phone";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/types/supabase";
import { VISIT_DETAIL_VIEWS, VISIT_STATUSES, programLabel, programsLabel, type VisitDetailView } from "@/lib/visits/constants";
import { blankToNull, guestSchema, guestStatusSchema, visitSchema, type VisitInput } from "@/lib/visits/schemas";
import { MAX_IMPORT_ROWS, validateGuestRows, type ParsedGuestRow, type RowProblem } from "@/lib/visits/guest-import";
import type { LeadMatch, VisitGuestItem, VisitListItem } from "@/lib/visits/types";

export type VisitActionResult = { error?: string };

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

function revalidateVisits() {
  revalidatePath("/trips");
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
}

// visitor_group is a legacy column (the visitor category replaced it), so it is
// left untouched here rather than cleared on every save.
function visitRow(data: ReturnType<typeof visitSchema.parse>) {
  return {
    // The programs' labels double as the visit type ("A + B"); sequences match any one program.
    visit_type: programsLabel(data.programCategories),
    visit_date: data.visitDate,
    end_date: data.endDate && data.endDate !== data.visitDate ? data.endDate : null,
    start_time: data.startTime,
    end_time: data.endTime,
    status: data.status,
    // poc_name / poc_phone / facilitator (the host) are filled in from the facilitator by a trigger.
    facilitator_id: data.facilitatorId,
    partner_id: data.partnerId,
    headcount: data.headcount,
    source: blankToNull(data.source),
    origin_place: blankToNull(data.originPlace),
    // The first program is kept in program_category for older readers (a trigger also syncs it).
    program_category: data.programCategories[0],
    program_categories: [...new Set(data.programCategories)],
    visitor_category: data.visitorCategory,
    booking_channel: data.bookingChannel,
    // amount_charged (Rural Experience revenue) is maintained from the visit's proforma invoices.
    amount_to_artisans: data.amountToArtisans,
    notes: blankToNull(data.notes),
    feedback_form_id: data.feedbackFormId,
  };
}

/**
 * Makes visit_villages / visit_experiences match the chosen ids. An experience is
 * only kept if its village is also chosen. Returns an error message or null.
 */
async function syncVisitLinks(
  supabase: SupabaseServerClient,
  visitId: string,
  villageIds: string[],
  experienceIds: string[],
): Promise<string | null> {
  const wantedVillages = [...new Set(villageIds)];

  let wantedExperiences = [...new Set(experienceIds)];
  if (wantedExperiences.length > 0) {
    const { data: found } = await supabase.from("experiences").select("id, village_id").in("id", wantedExperiences);
    wantedExperiences = (found ?? []).filter((e) => wantedVillages.includes(e.village_id)).map((e) => e.id);
  }

  const [{ data: haveVillages }, { data: haveExperiences }] = await Promise.all([
    supabase.from("visit_villages").select("village_id").eq("visit_id", visitId),
    supabase.from("visit_experiences").select("experience_id").eq("visit_id", visitId),
  ]);
  const currentVillages = (haveVillages ?? []).map((r) => r.village_id);
  const currentExperiences = (haveExperiences ?? []).map((r) => r.experience_id);

  // Experiences first on the way out, villages first on the way in, so the
  // "an experience needs its village" invariant holds between statements.
  const dropExperiences = currentExperiences.filter((id) => !wantedExperiences.includes(id));
  if (dropExperiences.length > 0) {
    const { error } = await supabase.from("visit_experiences").delete().eq("visit_id", visitId).in("experience_id", dropExperiences);
    if (error) return "Could not update the visit's experiences.";
  }
  const dropVillages = currentVillages.filter((id) => !wantedVillages.includes(id));
  if (dropVillages.length > 0) {
    const { error } = await supabase.from("visit_villages").delete().eq("visit_id", visitId).in("village_id", dropVillages);
    if (error) return "Could not update the visit's villages.";
  }
  const addVillages = wantedVillages.filter((id) => !currentVillages.includes(id));
  if (addVillages.length > 0) {
    const { error } = await supabase
      .from("visit_villages")
      .insert(addVillages.map((village_id) => ({ visit_id: visitId, village_id })));
    if (error) return "Could not update the visit's villages.";
  }
  const addExperiences = wantedExperiences.filter((id) => !currentExperiences.includes(id));
  if (addExperiences.length > 0) {
    const { error } = await supabase
      .from("visit_experiences")
      .insert(addExperiences.map((experience_id) => ({ visit_id: visitId, experience_id })));
    if (error) return "Could not update the visit's experiences.";
  }
  return null;
}

/**
 * Makes visit_sales match the invoices in the form. New invoices go in first, so an invoice that is
 * already attributed to another visit fails before anything is changed or removed.
 */
async function syncVisitSales(
  supabase: SupabaseServerClient,
  visitId: string,
  sales: ReturnType<typeof visitSchema.parse>["sales"],
  createdBy: string,
): Promise<string | null> {
  const { data: existing } = await supabase
    .from("visit_sales")
    .select("id, channel, invoice_id, amount")
    .eq("visit_id", visitId);
  const keyOf = (channel: string, invoiceId: string) => `${channel}|${invoiceId}`;
  const have = new Map((existing ?? []).map((row) => [keyOf(row.channel, row.invoice_id), row]));
  const want = new Map(sales.map((sale) => [keyOf(sale.channel, sale.invoiceId), sale]));

  const toInsert = sales.filter((sale) => !have.has(keyOf(sale.channel, sale.invoiceId)));
  if (toInsert.length > 0) {
    const { error } = await supabase.from("visit_sales").insert(
      toInsert.map((sale) => ({
        visit_id: visitId,
        channel: sale.channel,
        invoice_id: sale.invoiceId,
        amount: sale.amount,
        created_by: createdBy,
      })),
    );
    if (error) {
      return error.code === "23505"
        ? "One of those invoice IDs is already attributed to another visit."
        : "Could not save the sales invoices.";
    }
  }

  for (const [key, row] of have) {
    const sale = want.get(key);
    if (!sale) {
      const { error } = await supabase.from("visit_sales").delete().eq("id", row.id);
      if (error) return "Could not remove a sales invoice.";
    } else if (Number(row.amount) !== sale.amount) {
      const { error } = await supabase.from("visit_sales").update({ amount: sale.amount }).eq("id", row.id);
      if (error) return "Could not update a sales invoice.";
    }
  }
  return null;
}

/** Saves the POC typed in the visit form, if one was given. Clearing the fields leaves the current POC alone. */
function applyPoc(
  supabase: SupabaseServerClient,
  visitId: string,
  data: ReturnType<typeof visitSchema.parse>,
  createdBy: string,
) {
  if (!data.pocGuestPhone || !data.pocGuestName) return Promise.resolve(null);
  return savePrimaryPoc(
    supabase,
    visitId,
    { name: data.pocGuestName, phone: data.pocGuestPhone, email: blankToNull(data.pocGuestEmail) },
    createdBy,
  );
}

/** Returns the created visit so the caller can go straight on to its guest list. */
export async function createVisit(input: VisitInput): Promise<VisitActionResult & { visit?: VisitListItem }> {
  const { email } = await requireActiveTeamMember();
  const parsed = visitSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid visit." };

  const supabase = await createClient();
  const { data: created, error } = await supabase
    .from("visits")
    .insert({
      ...visitRow(parsed.data),
      created_by: email,
      completed_by: parsed.data.status === "completed" ? `staff:${email}` : null,
    })
    .select("*")
    .single();
  if (error || !created) return { error: "Could not create the visit." };

  const linkError = await syncVisitLinks(supabase, created.id, parsed.data.villageIds, parsed.data.experienceIds);
  if (linkError) {
    await supabase.from("visits").delete().eq("id", created.id);
    return { error: linkError };
  }
  const salesError = await syncVisitSales(supabase, created.id, parsed.data.sales, email);
  if (salesError) {
    await supabase.from("visits").delete().eq("id", created.id);
    return { error: salesError };
  }
  const pocError = await applyPoc(supabase, created.id, parsed.data, email);
  if (pocError) {
    await supabase.from("visits").delete().eq("id", created.id);
    return { error: pocError };
  }

  // Sequences set up for this visit's program (e.g. "Rural Experience") are applied automatically.
  // Best-effort: the visit is already saved, and rules can be added from its Messaging dialog.
  const { data: sequences } = await supabase
    .from("message_rule_sets")
    .select("id, visit_type")
    .eq("is_active", true)
    .not("visit_type", "is", null);
  // A sequence applies when it names any one of the visit's programs (or the combined type).
  const typeKeys = new Set(
    [created.visit_type, ...parsed.data.programCategories.map(programLabel)].map((t) => t.trim().toLowerCase()),
  );
  for (const sequence of sequences ?? []) {
    if (sequence.visit_type && typeKeys.has(sequence.visit_type.trim().toLowerCase())) {
      await applyRuleSetToVisit(created.id, sequence.id);
    }
  }

  const [{ data: linkedExperiences }, { data: savedSales }] = await Promise.all([
    supabase.from("visit_experiences").select("experience_id").eq("visit_id", created.id),
    supabase.from("visit_sales").select("id, channel, invoice_id, amount").eq("visit_id", created.id),
  ]);

  revalidateVisits();
  return {
    visit: {
      ...created,
      villageIds: [...new Set(parsed.data.villageIds)],
      experienceIds: (linkedExperiences ?? []).map((r) => r.experience_id),
      guestCount: 0,
      sales: savedSales ?? [],
      invoices: [],
      taxInvoices: [],
      primaryGuest: null,
    },
  };
}

export async function updateVisit(id: string, input: VisitInput): Promise<VisitActionResult> {
  const { email } = await requireActiveTeamMember();
  const parsed = visitSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid visit." };

  const supabase = await createClient();
  const { data: existing } = await supabase.from("visits").select("status").eq("id", id).maybeSingle();
  if (!existing) return { error: "That visit no longer exists." };

  const becomingCompleted = parsed.data.status === "completed" && existing.status !== "completed";
  const { error } = await supabase
    .from("visits")
    .update({ ...visitRow(parsed.data), ...(becomingCompleted ? { completed_by: `staff:${email}` } : {}) })
    .eq("id", id);
  if (error) return { error: "Could not update the visit." };

  const linkError = await syncVisitLinks(supabase, id, parsed.data.villageIds, parsed.data.experienceIds);
  if (linkError) return { error: linkError };
  const salesError = await syncVisitSales(supabase, id, parsed.data.sales, email);
  if (salesError) return { error: salesError };
  const pocError = await applyPoc(supabase, id, parsed.data, email);
  if (pocError) return { error: pocError };
  revalidateVisits();
  return {};
}

/** Quick status change from a list or calendar row. */
export async function setVisitStatus(id: string, status: string): Promise<VisitActionResult> {
  const { email } = await requireActiveTeamMember();
  if (!VISIT_STATUSES.some((s) => s.id === status)) return { error: "Unknown status." };

  const supabase = await createClient();
  const { data: existing } = await supabase.from("visits").select("status").eq("id", id).maybeSingle();
  if (!existing) return { error: "That visit no longer exists." };
  if (existing.status === status) return {};

  const { error } = await supabase
    .from("visits")
    .update({ status, ...(status === "completed" ? { completed_by: `staff:${email}` } : {}) })
    .eq("id", id);
  if (error) return { error: "Could not update the visit." };
  revalidateVisits();
  return {};
}

/** Saves whether this user sees visit details in a sidebar or a pop-up. */
export async function setVisitDetailView(view: VisitDetailView): Promise<VisitActionResult> {
  await requireActiveTeamMember();
  if (!VISIT_DETAIL_VIEWS.includes(view)) return { error: "Unknown view." };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ data: { visit_detail_view: view } });
  if (error) return { error: "Could not save your view preference." };
  return {};
}

// ---------------------------------------------------------------------------
// Guests (leads attached to a visit)
// ---------------------------------------------------------------------------

export async function getVisitGuests(visitId: string): Promise<VisitGuestItem[]> {
  await requireActiveTeamMember();
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("visit_guests")
    .select("id, lead_id, status, is_primary, feedback_token, created_at, leads(id, name, phone, attributes, whatsapp_opt_out)")
    .eq("visit_id", visitId)
    .order("created_at");
  if (!rows || rows.length === 0) return [];

  const leadIds = rows.map((r) => r.lead_id);
  const { data: conversations } = await supabase
    .from("whatsapp_conversations")
    .select("id, lead_id, needs_human, last_message_at")
    .in("lead_id", leadIds)
    .order("last_message_at", { ascending: false, nullsFirst: false });

  const conversationByLead = new Map<string, NonNullable<typeof conversations>[number]>();
  for (const conversation of conversations ?? []) {
    if (conversation.lead_id && !conversationByLead.has(conversation.lead_id)) {
      conversationByLead.set(conversation.lead_id, conversation);
    }
  }

  return rows.map((row) => {
    const lead = row.leads;
    const attributes = (lead?.attributes ?? {}) as Record<string, unknown>;
    const conversation = conversationByLead.get(row.lead_id);
    return {
      id: row.id,
      leadId: row.lead_id,
      status: row.status,
      isPrimary: row.is_primary,
      name: lead?.name ?? null,
      phone: lead?.phone ?? "",
      email: typeof attributes.email === "string" ? attributes.email : null,
      optedOut: lead?.whatsapp_opt_out ?? false,
      feedbackToken: row.feedback_token,
      conversationId: conversation?.id ?? null,
      needsHuman: conversation?.needs_human ?? false,
      lastMessageAt: conversation?.last_message_at ?? null,
    };
  });
}

/**
 * Existing leads whose phone matches what is being typed (country code + number).
 * Leads are keyed on the last 10 digits, so a complete number is an exact match on that key
 * (exactly what saving the guest would reuse), and a partial number is a prefix match on the
 * national digits. Leads saved under a different country code are still returned — saving would
 * merge into them anyway — but flagged so the person sees it.
 */
export async function findLeadsByPhone(visitId: string, code: string, number: string): Promise<LeadMatch[]> {
  await requireActiveTeamMember();
  const codeDigits = code.replace(/\D/g, "");
  let national = number.replace(/\D/g, "").replace(/^0+/, "");
  if (national.length > 10 && codeDigits && national.startsWith(codeDigits)) national = national.slice(codeDigits.length);
  if (national.length < 3) return [];

  const exactKey = `${codeDigits}${national}`.slice(-10);
  const filters = [`phone_normalized.like.${national}*`];
  if (`${codeDigits}${national}`.length >= 10) filters.push(`phone_normalized.eq.${exactKey}`);

  const supabase = await createClient();
  const { data: leads } = await supabase
    .from("leads")
    .select("id, name, phone, attributes, whatsapp_opt_out")
    .or(filters.join(","))
    .order("updated_at", { ascending: false })
    .limit(20);
  if (!leads || leads.length === 0) return [];

  const ids = leads.map((l) => l.id);
  const { data: guestRows } = await supabase.from("visit_guests").select("lead_id, visit_id").in("lead_id", ids);
  const visitCounts = new Map<string, number>();
  const onVisit = new Set<string>();
  for (const row of guestRows ?? []) {
    visitCounts.set(row.lead_id, (visitCounts.get(row.lead_id) ?? 0) + 1);
    if (row.visit_id === visitId) onVisit.add(row.lead_id);
  }

  const matches = leads.map((lead): LeadMatch => {
    const attributes = (lead.attributes ?? {}) as Record<string, unknown>;
    const digits = lead.phone.replace(/\D/g, "");
    // A bare 10-digit number is assumed Indian, as everywhere else in the app.
    const leadCode = digits.length > 10 ? digits.slice(0, digits.length - 10) : "91";
    return {
      id: lead.id,
      name: lead.name,
      phone: lead.phone,
      email: typeof attributes.email === "string" ? attributes.email : null,
      optedOut: lead.whatsapp_opt_out,
      onVisit: onVisit.has(lead.id),
      visitCount: visitCounts.get(lead.id) ?? 0,
      codeMismatch: codeDigits !== "" && leadCode !== codeDigits,
    };
  });
  // Same country code first, then the rest.
  matches.sort((a, b) => Number(a.codeMismatch) - Number(b.codeMismatch));
  return matches.slice(0, 6);
}

/**
 * The lead for a phone number, created when there isn't one (so every guest and POC is a row in Leads).
 * An existing lead keeps its name; a missing name or email is filled in.
 */
async function findOrCreateLead(
  supabase: SupabaseServerClient,
  input: { name: string; phone: string; email: string | null },
): Promise<{ leadId: string } | { error: string }> {
  const normalized = normalizePhone(input.phone);
  if (!normalized) return { error: "Enter a valid phone number (at least 8 digits)." };

  const { data: existing } = await supabase
    .from("leads")
    .select("id, name, attributes")
    .eq("phone_normalized", normalized)
    .maybeSingle();

  if (!existing) {
    const { data: created, error } = await supabase
      .from("leads")
      .insert({
        phone: input.phone,
        name: input.name,
        source: "manual",
        attributes: input.email ? { email: input.email } : {},
      })
      .select("id")
      .single();
    if (error || !created) return { error: "Could not create the contact." };
    return { leadId: created.id };
  }

  const attributes = (existing.attributes ?? {}) as Record<string, Json>;
  const update: { name?: string; attributes?: Record<string, Json> } = {};
  if (!existing.name) update.name = input.name;
  if (input.email && attributes.email !== input.email) update.attributes = { ...attributes, email: input.email };
  if (update.name || update.attributes) await supabase.from("leads").update(update).eq("id", existing.id);
  return { leadId: existing.id };
}

/** Makes the entered person (a lead, found or created by phone) the visit's primary guest. */
async function savePrimaryPoc(
  supabase: SupabaseServerClient,
  visitId: string,
  poc: { name: string; phone: string; email: string | null },
  createdBy: string,
): Promise<string | null> {
  const found = await findOrCreateLead(supabase, poc);
  if ("error" in found) return found.error;

  const { data: current } = await supabase
    .from("visit_guests")
    .select("id, lead_id, is_primary")
    .eq("visit_id", visitId);
  const mine = (current ?? []).find((g) => g.lead_id === found.leadId);
  if (mine?.is_primary) return null;

  // One primary guest per visit (a partial unique index), so demote the current one first.
  const { error: demoteError } = await supabase
    .from("visit_guests")
    .update({ is_primary: false })
    .eq("visit_id", visitId)
    .eq("is_primary", true);
  if (demoteError) return "Could not set the primary POC.";

  const { error } = mine
    ? await supabase.from("visit_guests").update({ is_primary: true }).eq("id", mine.id)
    : await supabase
        .from("visit_guests")
        .insert({ visit_id: visitId, lead_id: found.leadId, created_by: createdBy, is_primary: true });
  return error ? "Could not set the primary POC." : null;
}

/** The first guest added to a visit becomes its primary POC; staff can change it after. */
async function insertGuest(
  supabase: SupabaseServerClient,
  visitId: string,
  leadId: string,
  createdBy: string,
): Promise<VisitActionResult> {
  const { count } = await supabase
    .from("visit_guests")
    .select("id", { count: "exact", head: true })
    .eq("visit_id", visitId)
    .eq("is_primary", true);
  const { error } = await supabase
    .from("visit_guests")
    .insert({ visit_id: visitId, lead_id: leadId, created_by: createdBy, is_primary: count === 0 });
  if (error) {
    return { error: error.code === "23505" ? "That person is already on this visit." : "Could not add the guest." };
  }
  return {};
}

export async function addGuestFromLead(visitId: string, leadId: string): Promise<VisitActionResult> {
  const { email } = await requireActiveTeamMember();
  const supabase = await createClient();
  const result = await insertGuest(supabase, visitId, leadId, email);
  if (result.error) return result;
  revalidateVisits();
  return {};
}

/**
 * Adds a guest by phone: reuses the lead if that number exists, otherwise creates one.
 * An email, when given, is saved to the lead's `email` attribute.
 */
export async function addNewGuest(
  visitId: string,
  input: { name: string; phone: string; email?: string },
): Promise<VisitActionResult> {
  const { email } = await requireActiveTeamMember();
  const parsed = guestSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid guest." };

  const normalized = normalizePhone(parsed.data.phone);
  if (!normalized) return { error: "Enter a valid phone number (at least 8 digits)." };

  const supabase = await createClient();
  const found = await findOrCreateLead(supabase, {
    name: parsed.data.name,
    phone: parsed.data.phone,
    email: blankToNull(parsed.data.email),
  });
  if ("error" in found) return found;
  const lead = { id: found.leadId };

  const result = await insertGuest(supabase, visitId, lead.id, email);
  if (result.error) return result;
  revalidateVisits();
  revalidatePath("/leads");
  return {};
}

export type GuestImportResult = {
  error?: string;
  /** Guests newly attached to the visit. */
  added?: number;
  /** Of those, how many were new rows in Leads (the rest were existing leads reused). */
  newLeads?: number;
  /** Already on this visit, so left as they were. */
  alreadyOnVisit?: number;
  /** Rows that failed validation or the save, with a reason each. */
  problems?: RowProblem[];
};

const IMPORT_CHUNK = 200;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Bulk guest upload. The browser parses the CSV/XML and sends the rows; they are validated
 * again here. Each guest becomes (or reuses) a lead keyed by phone — so they also show up
 * in Leads — and is attached to the visit. Re-uploading the same file is safe: guests
 * already on the visit are counted, not duplicated.
 */
export async function importGuests(visitId: string, rows: ParsedGuestRow[]): Promise<GuestImportResult> {
  const { email: createdBy } = await requireActiveTeamMember();
  if (!Array.isArray(rows) || rows.length === 0) return { error: "The file has no guests in it." };
  if (rows.length > MAX_IMPORT_ROWS) {
    return { error: `Upload at most ${MAX_IMPORT_ROWS} guests at a time — split the file and upload it in parts.` };
  }

  // Never trust the client's own validation.
  const safeRows: ParsedGuestRow[] = rows.map((r, i) => ({
    row: typeof r?.row === "number" ? r.row : i + 1,
    name: String(r?.name ?? ""),
    phone: String(r?.phone ?? ""),
    email: String(r?.email ?? ""),
  }));
  const { valid, problems } = validateGuestRows(safeRows);
  if (valid.length === 0) return { error: "No valid guests to import.", problems };

  const supabase = await createClient();
  const { data: visit } = await supabase.from("visits").select("id").eq("id", visitId).maybeSingle();
  if (!visit) return { error: "That visit no longer exists." };

  const keyOf = (phone: string) => phone.replace(/\D/g, "").slice(-10);
  const failed: RowProblem[] = [...problems];
  const fail = (row: (typeof valid)[number], reason: string) =>
    failed.push({ row: row.row, name: row.name, phone: row.phone, reason });

  // 1. Leads that already exist for these phone numbers.
  const leadByKey = new Map<string, { id: string; name: string | null; attributes: Record<string, Json> }>();
  for (const part of chunk(valid, IMPORT_CHUNK)) {
    const { data, error } = await supabase
      .from("leads")
      .select("id, name, attributes, phone_normalized")
      .in("phone_normalized", part.map((g) => keyOf(g.phone)));
    if (error) return { error: "Could not look up existing contacts.", problems: failed };
    for (const lead of data ?? []) {
      if (lead.phone_normalized) {
        leadByKey.set(lead.phone_normalized, {
          id: lead.id,
          name: lead.name,
          attributes: (lead.attributes ?? {}) as Record<string, Json>,
        });
      }
    }
  }

  // 2. Create the missing ones in Leads.
  const missing = valid.filter((g) => !leadByKey.has(keyOf(g.phone)));
  let newLeads = 0;
  for (const part of chunk(missing, IMPORT_CHUNK)) {
    const { data, error } = await supabase
      .from("leads")
      .insert(
        part.map((g) => ({
          phone: g.phone,
          name: g.name,
          source: "manual" as const,
          attributes: g.email ? { email: g.email } : {},
        })),
      )
      .select("id, name, attributes, phone_normalized");
    if (!error) {
      for (const lead of data ?? []) {
        if (lead.phone_normalized) {
          leadByKey.set(lead.phone_normalized, {
            id: lead.id,
            name: lead.name,
            attributes: (lead.attributes ?? {}) as Record<string, Json>,
          });
          newLeads++;
        }
      }
      continue;
    }
    // The batch is atomic, so one clash (e.g. a lead created a moment ago by someone else)
    // fails it whole. Fall back to one at a time so the rest still go through.
    for (const g of part) {
      const found = await findOrCreateLead(supabase, { name: g.name, phone: g.phone, email: g.email });
      if ("error" in found) {
        fail(g, found.error);
        continue;
      }
      leadByKey.set(keyOf(g.phone), { id: found.leadId, name: g.name, attributes: {} });
      newLeads++;
    }
  }

  // 3. Fill gaps on existing leads (a missing name or email), never overwrite.
  for (const g of valid) {
    const lead = leadByKey.get(keyOf(g.phone));
    if (!lead || missing.includes(g)) continue;
    const update: { name?: string; attributes?: Record<string, Json> } = {};
    if (!lead.name) update.name = g.name;
    if (g.email && !lead.attributes.email) update.attributes = { ...lead.attributes, email: g.email };
    if (update.name || update.attributes) await supabase.from("leads").update(update).eq("id", lead.id);
  }

  // 4. Attach to the visit, skipping anyone already on it.
  const { data: current } = await supabase.from("visit_guests").select("lead_id, is_primary").eq("visit_id", visitId);
  const onVisit = new Set((current ?? []).map((r) => r.lead_id));
  let needsPrimary = !(current ?? []).some((r) => r.is_primary);

  let alreadyOnVisit = 0;
  const toAttach: {
    insert: { visit_id: string; lead_id: string; created_by: string; is_primary: boolean };
    source: (typeof valid)[number];
  }[] = [];
  for (const g of valid) {
    const lead = leadByKey.get(keyOf(g.phone));
    if (!lead) {
      if (!failed.some((p) => p.row === g.row)) fail(g, "Could not create the contact.");
      continue;
    }
    if (onVisit.has(lead.id)) {
      alreadyOnVisit++;
      continue;
    }
    onVisit.add(lead.id);
    toAttach.push({
      insert: { visit_id: visitId, lead_id: lead.id, created_by: createdBy, is_primary: needsPrimary },
      source: g,
    });
    needsPrimary = false;
  }

  let added = 0;
  for (const part of chunk(toAttach, IMPORT_CHUNK)) {
    const { error } = await supabase.from("visit_guests").insert(part.map((item) => item.insert));
    if (!error) {
      added += part.length;
      continue;
    }
    for (const item of part) {
      const { error: rowError } = await supabase.from("visit_guests").insert(item.insert);
      if (!rowError) added++;
      else if (rowError.code === "23505") alreadyOnVisit++;
      else fail(item.source, "Could not add the guest.");
    }
  }

  revalidateVisits();
  revalidatePath("/leads");
  failed.sort((a, b) => a.row - b.row);
  return { added, newLeads, alreadyOnVisit, problems: failed };
}

export async function setGuestStatus(guestId: string, status: string): Promise<VisitActionResult> {
  await requireActiveTeamMember();
  const parsed = guestStatusSchema.safeParse(status);
  if (!parsed.success) return { error: "Unknown guest status." };

  const supabase = await createClient();
  const { error } = await supabase.from("visit_guests").update({ status: parsed.data }).eq("id", guestId);
  if (error) return { error: "Could not update the guest." };
  revalidateVisits();
  return {};
}

/** Makes this guest the visit's primary POC (only one per visit). */
export async function setPrimaryGuest(visitId: string, guestId: string): Promise<VisitActionResult> {
  await requireActiveTeamMember();
  const supabase = await createClient();
  // Clear the current one first: a partial unique index allows one primary guest per visit.
  const { data: cleared, error: clearError } = await supabase
    .from("visit_guests")
    .update({ is_primary: false })
    .eq("visit_id", visitId)
    .eq("is_primary", true)
    .neq("id", guestId)
    .select("id");
  if (clearError) return { error: "Could not change the primary POC." };
  const { data, error } = await supabase
    .from("visit_guests")
    .update({ is_primary: true })
    .eq("id", guestId)
    .eq("visit_id", visitId)
    .select("id");
  if (error || !data?.length) {
    // Don't leave the visit without a primary POC if the swap failed half-way.
    const previousIds = (cleared ?? []).map((r) => r.id);
    if (previousIds.length > 0) {
      await supabase.from("visit_guests").update({ is_primary: true }).in("id", previousIds);
    }
    return { error: "Could not change the primary POC." };
  }
  revalidateVisits();
  return {};
}

export async function removeGuest(guestId: string): Promise<VisitActionResult> {
  await requireActiveTeamMember();
  const supabase = await createClient();
  const { error } = await supabase.from("visit_guests").delete().eq("id", guestId);
  if (error) return { error: "Could not remove the guest." };
  revalidateVisits();
  return {};
}
