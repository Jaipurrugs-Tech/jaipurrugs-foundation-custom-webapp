"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRotateLeft, Plus, TrashBin } from "@gravity-ui/icons";
import {
  Alert,
  Autocomplete,
  Button,
  Checkbox,
  Description,
  EmptyState,
  Input,
  Label,
  ListBox,
  SearchField,
  TextArea,
  TextField,
  toast,
  useFilter,
  type Key,
} from "@heroui/react";
import { saveInvoice } from "@/lib/actions/invoices";
import {
  amountInWords,
  formatRupees,
  groupDetailsText,
  invoiceTotals,
  lineAmounts,
  slabRangeLabel,
  suggestPricing,
  type SuggestedPricing,
} from "@/lib/invoices/calc";
import { DEFAULT_GST_RATE, INVOICE_STATUSES, pricingUnitShort } from "@/lib/invoices/constants";
import { invoiceSchema, invoiceTermSnapshotSchema, type InvoiceInput } from "@/lib/invoices/schemas";
import type { InvoiceTermRow, InvoiceVisitOption, InvoiceWithItems, ServiceItem } from "@/lib/invoices/types";
import { OptionSelect } from "./option-select";
import { InvoiceStatusChip } from "./invoice-status-chip";
import { PdfActions } from "./pdf-actions";

// ---------------------------------------------------------------------------
// Line model. Each line has a kind and only stores the values someone typed
// ("overrides"); everything else is worked out live from the chosen service, the
// group size and its slab. So changing the guest count re-prices every line that
// wasn't edited by hand.
// ---------------------------------------------------------------------------

type LineKind = "service" | "guides" | "custom";
type LineField = "description" | "details" | "sacCode" | "rate" | "quantity" | "discountLabel" | "discountRate" | "gstRate";
type LineValues = Record<LineField, string>;
type LineDraft = { key: string; kind: LineKind; serviceId: string; overrides: Partial<LineValues> };

type GroupContext = {
  guests: number;
  guides: number;
  freeGuides: number;
  primary: ServiceItem | null;
  /** Key of the first service line: the group details ("Guests: 12 | Guide: 3 …") print under it. */
  firstServiceKey: string | null;
};

const num = (value: string) => {
  const n = Number(value);
  return value.trim() !== "" && Number.isFinite(n) ? n : 0;
};
const str = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

function autoValues(line: LineDraft, service: ServiceItem | null, ctx: GroupContext): LineValues & { pricing: SuggestedPricing | null } {
  if (line.kind === "service" && service) {
    const rate = line.overrides.rate !== undefined ? num(line.overrides.rate) : service.base_rate;
    const pricing = suggestPricing(service, ctx.guests, rate);
    return {
      description: service.name,
      details: line.key === ctx.firstServiceKey ? groupDetailsText(ctx.guests, ctx.guides, ctx.freeGuides) : "",
      sacCode: service.sac_code ?? "",
      rate: str(service.base_rate),
      quantity: service.pricing_unit === "per_group" ? "1" : ctx.guests > 0 ? str(ctx.guests) : "",
      discountLabel: pricing.discountLabel,
      discountRate: str(pricing.discountPerUnit),
      gstRate: str(service.gst_rate),
      pricing,
    };
  }
  if (line.kind === "guides") {
    const p = ctx.primary;
    const chargeable = Math.max(ctx.guides - ctx.freeGuides, 0);
    return {
      description: "Additional guides",
      details: "",
      sacCode: p?.sac_code ?? "",
      rate: str(p ? (p.extra_guide_rate ?? p.base_rate) : null),
      quantity: chargeable > 0 ? str(chargeable) : "",
      discountLabel: "",
      discountRate: "0",
      gstRate: str(p?.gst_rate ?? DEFAULT_GST_RATE),
      pricing: null,
    };
  }
  return {
    description: "",
    details: "",
    sacCode: "",
    rate: "",
    quantity: "1",
    discountLabel: "",
    discountRate: "0",
    gstRate: str(DEFAULT_GST_RATE),
    pricing: null,
  };
}

const FIELDS: LineField[] = ["description", "details", "sacCode", "rate", "quantity", "discountLabel", "discountRate", "gstRate"];
const NUMERIC: LineField[] = ["rate", "quantity", "discountRate", "gstRate"];

function sameValue(field: LineField, a: string, b: string) {
  return NUMERIC.includes(field) ? num(a) === num(b) && (a.trim() === "") === (b.trim() === "") : a.trim() === b.trim();
}

/** Whether a service is offered for a trip's program, visitor type and locations (an empty list means any). */
function fitsVisit(service: ServiceItem, visit: InvoiceVisitOption | null) {
  if (!visit) return true;
  return (
    (service.program_categories.length === 0 || service.program_categories.some((p) => visit.programCategories.includes(p))) &&
    (service.visitor_categories.length === 0 ||
      (visit.visitorCategory !== null && service.visitor_categories.includes(visit.visitorCategory))) &&
    (service.villageIds.length === 0 ||
      visit.villageIds.length === 0 ||
      service.villageIds.some((id) => visit.villageIds.includes(id)))
  );
}

function primaryOf(lines: LineDraft[], services: Map<string, ServiceItem>) {
  const first = lines.find((l) => l.kind === "service" && services.has(l.serviceId));
  return { primary: first ? (services.get(first.serviceId) ?? null) : null, firstServiceKey: first?.key ?? null };
}

function freeGuideSuggestion(primary: ServiceItem | null, guests: number, guides: number) {
  if (!primary) return null;
  const pricing = suggestPricing(primary, guests);
  return { ...pricing, freeGuides: Math.min(pricing.freeGuides, guides) };
}

/** Rebuilds an existing PI's lines, keeping as overrides only what differs from today's automatic values. */
function initialState(invoice: InvoiceWithItems, services: Map<string, ServiceItem>) {
  const lines: LineDraft[] = invoice.items
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((item) => ({
      key: item.id,
      kind: item.service_id && services.has(item.service_id) ? "service" : "custom",
      serviceId: item.service_id && services.has(item.service_id) ? item.service_id : "",
      overrides: {},
    }));
  const { primary, firstServiceKey } = primaryOf(lines, services);
  const suggestion = freeGuideSuggestion(primary, invoice.guests, invoice.guides);
  const freeOverride = suggestion && suggestion.freeGuides === invoice.free_guides && !suggestion.isLargeGroup ? null : str(invoice.free_guides);
  const ctx: GroupContext = {
    guests: invoice.guests,
    guides: invoice.guides,
    freeGuides: invoice.free_guides,
    primary,
    firstServiceKey,
  };
  const sorted = invoice.items.slice().sort((a, b) => a.position - b.position);
  lines.forEach((line, i) => {
    const item = sorted[i];
    const saved: LineValues = {
      description: item.description,
      details: item.details ?? "",
      sacCode: item.sac_code ?? "",
      rate: str(item.rate),
      quantity: str(item.quantity),
      discountLabel: item.discount_label ?? "",
      discountRate: str(item.discount_rate),
      gstRate: str(item.gst_rate),
    };
    const service = services.get(line.serviceId) ?? null;
    // Rate first: the automatic discount depends on it.
    const autoRate = autoValues(line, service, ctx).rate;
    if (line.kind !== "service" || !sameValue("rate", saved.rate, autoRate)) line.overrides.rate = saved.rate;
    const auto = autoValues(line, service, ctx);
    const keepAll = line.kind !== "service" || auto.pricing?.isLargeGroup;
    for (const field of FIELDS) {
      if (field === "rate") continue;
      // Large-group discounts were a manager's decision: keep them as typed.
      const decided = keepAll && (field === "discountRate" || field === "discountLabel");
      if (line.kind !== "service" || decided || !sameValue(field, saved[field], auto[field])) line.overrides[field] = saved[field];
    }
  });
  return { lines, freeOverride };
}

type TermChoice = { key: string; title: string; body: string; checked: boolean; fromLibrary: boolean };

function initialTerms(library: InvoiceTermRow[], invoice: InvoiceWithItems | null): TermChoice[] {
  const active = library.filter((t) => t.is_active);
  if (!invoice) {
    return active.map((t) => ({ key: t.id, title: t.title, body: t.body, checked: t.is_default, fromLibrary: true }));
  }
  const saved = (Array.isArray(invoice.terms) ? invoice.terms : []).flatMap((t) => {
    const parsed = invoiceTermSnapshotSchema.safeParse(t);
    return parsed.success ? [parsed.data] : [];
  });
  const matches = (t: { title: string; body: string }) => saved.some((s) => s.title === t.title.trim() && s.body === t.body.trim());
  const fromLibrary = active.map((t) => ({ key: t.id, title: t.title, body: t.body, checked: matches(t), fromLibrary: true }));
  // Terms saved on the PI that no longer exist in the library (or were edited there) stay as they were.
  const orphans = saved
    .filter((s) => !active.some((t) => t.title.trim() === s.title && t.body.trim() === s.body))
    .map((s, i) => ({ key: `saved-${i}`, title: s.title, body: s.body, checked: true, fromLibrary: false }));
  return [...orphans, ...fromLibrary];
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function Card({ title, hint, action, children }: { title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {hint ? <p className="text-xs text-muted">{hint}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function VisitPicker({
  visits,
  value,
  onChange,
}: {
  visits: InvoiceVisitOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  const { contains } = useFilter({ sensitivity: "base" });
  return (
    <Autocomplete
      fullWidth
      placeholder="Not linked to a trip"
      selectionMode="single"
      value={value || null}
      onChange={(key: Key | Key[] | null) => onChange(key && !Array.isArray(key) ? String(key) : "")}
    >
      <Label>Trip</Label>
      <Autocomplete.Trigger>
        <Autocomplete.Value />
        <Autocomplete.ClearButton />
        <Autocomplete.Indicator />
      </Autocomplete.Trigger>
      <Autocomplete.Popover>
        <Autocomplete.Filter filter={contains}>
          <SearchField autoFocus aria-label="Search trips" name="pi-trip-search" variant="secondary">
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Search by date, program, institute…" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <ListBox renderEmptyState={() => <EmptyState>No matching trip.</EmptyState>}>
            {visits.map((visit) => (
              <ListBox.Item key={visit.id} id={visit.id} textValue={visit.label}>
                {visit.label}
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Autocomplete.Filter>
      </Autocomplete.Popover>
    </Autocomplete>
  );
}

function SmallField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  isAuto,
  onReset,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: "text" | "number";
  placeholder?: string;
  /** True while the value is worked out automatically (not typed). */
  isAuto?: boolean;
  onReset?: () => void;
  className?: string;
}) {
  return (
    <TextField className={className} value={value} onChange={onChange}>
      <Label className="flex items-center gap-1 text-xs">
        {label}
        {!isAuto && onReset ? (
          <button
            aria-label={`Reset ${label} to the service's value`}
            className="text-muted hover:text-foreground"
            title="Reset to automatic"
            type="button"
            onClick={onReset}
          >
            <ArrowRotateLeft className="size-3" />
          </button>
        ) : null}
      </Label>
      <Input
        className={isAuto ? "text-muted" : undefined}
        min={type === "number" ? 0 : undefined}
        placeholder={placeholder}
        step={type === "number" ? "0.01" : undefined}
        type={type}
      />
    </TextField>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

const UNSAVED_MESSAGE = "You have unsaved changes to this proforma invoice. Leave without saving?";

/**
 * Warns before the page is closed or reloaded, and before an in-app link is followed,
 * while there are unsaved changes. (The browser's Back button within the app isn't
 * intercepted.) Returns a function that lets a deliberate navigation, such as the
 * redirect after a save, skip the prompt.
 */
function useUnsavedChangesWarning(active: boolean): () => void {
  const activeRef = useRef(active);
  const allowedRef = useRef(false);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    const shouldWarn = () => activeRef.current && !allowedRef.current;

    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!shouldWarn()) return;
      event.preventDefault();
      // Older browsers need returnValue set to show the prompt.
      event.returnValue = "";
    }

    // Capture phase on the document runs before Next's <Link> handler; preventing the
    // default there stops the client-side navigation.
    function onClick(event: MouseEvent) {
      if (!shouldWarn() || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (window.confirm(UNSAVED_MESSAGE)) {
        allowedRef.current = true;
      } else {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  return () => {
    allowedRef.current = true;
  };
}

export function InvoiceEditor({
  invoice,
  services,
  visits,
  termsLibrary,
  defaults,
  initialVisitId,
}: {
  invoice: InvoiceWithItems | null;
  services: ServiceItem[];
  visits: InvoiceVisitOption[];
  termsLibrary: InvoiceTermRow[];
  defaults: { today: string; paymentTerms: string; numberPrefix: string };
  initialVisitId: string | null;
}) {
  const router = useRouter();
  const serviceMap = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);
  const initialVisit = visits.find((v) => v.id === (invoice?.visit_id ?? initialVisitId)) ?? null;

  const [initial] = useState(() => (invoice ? initialState(invoice, serviceMap) : null));
  const [piNumber, setPiNumber] = useState(invoice?.pi_number ?? "");
  const [piDate, setPiDate] = useState(invoice?.pi_date ?? defaults.today);
  const [status, setStatus] = useState<string>(invoice?.status ?? "draft");
  const [visitId, setVisitId] = useState(initialVisit?.id ?? "");
  const [billingName, setBillingName] = useState(
    invoice?.billing_name ?? initialVisit?.source ?? initialVisit?.primaryGuestName ?? "",
  );
  const [billingAddress, setBillingAddress] = useState(invoice?.billing_address ?? "");
  const [billingGstin, setBillingGstin] = useState(invoice?.billing_gstin ?? "");
  const [paymentTerms, setPaymentTerms] = useState(invoice?.payment_terms ?? defaults.paymentTerms);
  const [guests, setGuests] = useState(str(invoice?.guests ?? initialVisit?.headcount ?? null));
  const [guides, setGuides] = useState(str(invoice?.guides ?? 0));
  const [freeOverride, setFreeOverride] = useState<string | null>(initial?.freeOverride ?? null);
  const [lines, setLines] = useState<LineDraft[]>(() => {
    if (initial) return initial.lines;
    // A new PI starts with the first active service offered for the trip.
    const first =
      services.find((s) => s.is_active && fitsVisit(s, initialVisit)) ?? services.find((s) => s.is_active);
    return first ? [{ key: crypto.randomUUID(), kind: "service", serviceId: first.id, overrides: {} }] : [];
  });
  const [terms, setTerms] = useState<TermChoice[]>(() => initialTerms(termsLibrary, invoice));
  const [notes, setNotes] = useState(invoice?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);

  const visit = visits.find((v) => v.id === visitId) ?? null;
  const guestsN = Math.max(0, Math.floor(num(guests)));
  const guidesN = Math.max(0, Math.floor(num(guides)));
  const { primary, firstServiceKey } = primaryOf(lines, serviceMap);
  const suggestion = freeGuideSuggestion(primary, guestsN, guidesN);
  const freeGuidesValue = freeOverride ?? str(suggestion?.freeGuides ?? 0);
  const freeN = Math.min(Math.max(0, Math.floor(num(freeGuidesValue))), guidesN);
  const ctx: GroupContext = { guests: guestsN, guides: guidesN, freeGuides: freeN, primary, firstServiceKey };

  const computed = lines.map((line) => {
    const service = serviceMap.get(line.serviceId) ?? null;
    const auto = autoValues(line, service, ctx);
    const values = Object.fromEntries(FIELDS.map((f) => [f, line.overrides[f] ?? auto[f]])) as LineValues;
    return { line, service, auto, values };
  });

  const largeGroupLines = computed.filter((c) => c.line.kind === "service" && c.auto.pricing?.isLargeGroup);
  const isLargeGroup = largeGroupLines.length > 0 || Boolean(suggestion?.isLargeGroup);
  const needsDecision =
    isLargeGroup &&
    (freeOverride === null ||
      largeGroupLines.some((c) => c.line.overrides.discountRate === undefined));

  const totals = invoiceTotals(
    computed.map(({ values }) => ({
      rate: num(values.rate),
      quantity: num(values.quantity),
      discountRate: num(values.discountRate),
      gstRate: num(values.gstRate),
    })),
  );
  const chargeableGuides = Math.max(guidesN - freeN, 0);
  const hasGuideLine = lines.some((l) => l.kind === "guides");

  // Services that fit the linked trip first; others are still offered.
  const serviceOptions = useMemo(() => {
    return services
      .filter((s) => s.is_active || lines.some((l) => l.serviceId === s.id))
      .map((s) => ({ service: s, fits: fitsVisit(s, visit) }))
      .sort((a, b) => Number(b.fits) - Number(a.fits) || a.service.name.localeCompare(b.service.name))
      .map(({ service, fits }) => ({
        id: service.id,
        label: service.name,
        muted: [
          `${formatRupees(service.base_rate)} / ${pricingUnitShort(service.pricing_unit)}`,
          !service.is_active ? "inactive" : null,
          visit && !fits ? "not listed for this trip" : null,
        ]
          .filter(Boolean)
          .join(" · "),
      }));
  }, [services, visit, lines]);

  function buildInput(): InvoiceInput {
    return {
      piNumber,
      piDate,
      status: status as InvoiceInput["status"],
      visitId,
      billingName,
      billingAddress,
      billingGstin,
      paymentTerms,
      guests: str(guestsN),
      guides: str(guidesN),
      freeGuides: str(freeN),
      terms: terms.filter((t) => t.checked).map((t) => ({ title: t.title.trim(), body: t.body.trim() })),
      notes,
      items: computed.map(({ line, values }) => ({
        serviceId: line.kind === "service" ? line.serviceId : "",
        description: values.description,
        details: values.details,
        sacCode: values.sacCode,
        rate: values.rate,
        quantity: values.quantity,
        discountLabel: values.discountLabel,
        discountRate: values.discountRate,
        gstRate: values.gstRate,
      })),
    };
  }

  const snapshot = JSON.stringify(buildInput());
  const isDirty = invoice ? snapshot !== (savedSnapshot ?? initialSnapshotOf(invoice)) : true;
  // A new invoice only counts as changed once something differs from how the editor opened.
  const [pristineSnapshot] = useState(snapshot);
  const hasUnsavedChanges = invoice ? isDirty : snapshot !== pristineSnapshot;
  const allowNavigation = useUnsavedChangesWarning(hasUnsavedChanges);

  function updateLine(key: string, change: (line: LineDraft) => LineDraft) {
    setLines((prev) => prev.map((l) => (l.key === key ? change(l) : l)));
  }

  function setField(key: string, field: LineField, value: string) {
    updateLine(key, (l) => ({ ...l, overrides: { ...l.overrides, [field]: value } }));
  }

  function resetField(key: string, fields: LineField[]) {
    updateLine(key, (l) => {
      const overrides = { ...l.overrides };
      for (const f of fields) delete overrides[f];
      return { ...l, overrides };
    });
  }

  function addLine(kind: LineKind) {
    const firstActive = services.find((s) => s.is_active && fitsVisit(s, visit)) ?? services.find((s) => s.is_active);
    setLines((prev) => [
      ...prev,
      { key: crypto.randomUUID(), kind, serviceId: kind === "service" ? (firstActive?.id ?? "") : "", overrides: {} },
    ]);
  }

  function handleVisitChange(id: string) {
    setVisitId(id);
    const next = visits.find((v) => v.id === id);
    if (!next) return;
    // Fill only what's still empty, so nothing typed is lost.
    if (!billingName.trim()) setBillingName(next.source ?? next.primaryGuestName ?? "");
    if (!guests.trim() || guestsN === 0) setGuests(str(next.headcount));
  }

  /** Large groups: turn the suggested discount and free guides into deliberate values. */
  function confirmLargeGroup() {
    if (freeOverride === null) setFreeOverride(str(suggestion?.freeGuides ?? 0));
    setLines((prev) =>
      prev.map((line) => {
        const c = computed.find((x) => x.line.key === line.key);
        if (!c || line.kind !== "service" || !c.auto.pricing?.isLargeGroup || line.overrides.discountRate !== undefined) return line;
        return {
          ...line,
          overrides: {
            ...line.overrides,
            discountRate: c.values.discountRate,
            discountLabel: c.values.discountLabel || "Group discount",
          },
        };
      }),
    );
  }

  async function handleSave() {
    if (needsDecision) {
      setError(
        `The group is larger than the slabs cover. Set the discount and free guides yourself, or press “Use these values” to confirm the suggestion.`,
      );
      return;
    }
    const input = buildInput();
    const parsed = invoiceSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form.");
      return;
    }
    setIsSaving(true);
    setError(null);
    const result = await saveInvoice(invoice?.id ?? null, input);
    setIsSaving(false);
    if (result.error || !result.id) {
      setError(result.error ?? "Could not save.");
      return;
    }
    if (!invoice) {
      allowNavigation();
      // Opened from a trip ("/invoices/new?visit=…"): go back to that trip once the PI exists.
      const tripId = initialVisitId ? visitId || initialVisitId : null;
      if (tripId) {
        toast.success("Proforma invoice created. Back to the trip.");
        router.push(`/trips?visit=${tripId}`);
      } else {
        toast.success("Proforma invoice created.");
        router.replace(`/invoices/${result.id}`);
      }
      return;
    }
    toast.success("Proforma invoice saved.");
    setSavedSnapshot(JSON.stringify(input));
    router.refresh();
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-5">
        <Card title="Proforma invoice">
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField value={piNumber} onChange={setPiNumber}>
              <Label>PI number</Label>
              <Input placeholder={`Next ${defaults.numberPrefix}/… number`} />
              <Description>{invoice ? "Change only if needed." : "Leave blank to number it automatically."}</Description>
            </TextField>
            <TextField isRequired value={piDate} onChange={setPiDate}>
              <Label>Date</Label>
              <Input type="date" />
            </TextField>
            <OptionSelect isRequired label="Status" options={INVOICE_STATUSES} value={status} onChange={(v) => setStatus(v || "draft")} />
            <div className="sm:col-span-2">
              <VisitPicker value={visitId} visits={visits} onChange={handleVisitChange} />
              {visit ? (
                <Link className="mt-1 inline-block text-xs text-accent hover:underline" href={`/trips?visit=${visit.id}`}>
                  Open trip
                </Link>
              ) : null}
            </div>
            <TextField value={paymentTerms} onChange={setPaymentTerms}>
              <Label>Payment terms</Label>
              <Input placeholder="e.g. 100% Advance" />
            </TextField>
          </div>
        </Card>

        <Card hint="Printed under “Billing Details”." title="Billing details">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField isRequired value={billingName} onChange={setBillingName}>
              <Label>Billed to</Label>
              <Input placeholder="Name or organisation" />
            </TextField>
            <TextField value={billingGstin} onChange={setBillingGstin}>
              <Label>GSTIN</Label>
              <Input placeholder="If registered" />
            </TextField>
            <TextField className="sm:col-span-2" value={billingAddress} onChange={setBillingAddress}>
              <Label>Address</Label>
              <TextArea rows={2} />
            </TextField>
          </div>
        </Card>

        <Card
          hint="The slab for this group size sets each line's discount and how many guides go free."
          title="Group"
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField isRequired value={guests} onChange={setGuests}>
              <Label>Guests (head count)</Label>
              <Input min={0} type="number" />
            </TextField>
            <TextField value={guides} onChange={setGuides}>
              <Label>Guides</Label>
              <Input min={0} type="number" />
            </TextField>
            <SmallField
              className="[&_label]:text-sm"
              isAuto={freeOverride === null}
              label="Free guides"
              type="number"
              value={freeGuidesValue}
              onChange={setFreeOverride}
              onReset={() => setFreeOverride(null)}
            />
          </div>
          {suggestion?.slab && !suggestion.isLargeGroup ? (
            <p className="text-xs text-muted">
              Slab {slabRangeLabel(suggestion.slab)} guests on {primary?.name}: {suggestion.slab.free_guides} free guide
              {suggestion.slab.free_guides === 1 ? "" : "s"}.
            </p>
          ) : null}
          {isLargeGroup ? (
            <Alert status="warning">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>Large group: discount and free guides are your call</Alert.Title>
                <Alert.Description>
                  {guestsN} guests is above the {primary?.custom_pricing_above ?? 50} the slabs cover. The values below
                  start from the highest slab — change them, then confirm.
                </Alert.Description>
              </Alert.Content>
              {needsDecision ? (
                <Button size="sm" variant="secondary" onPress={confirmLargeGroup}>
                  Use these values
                </Button>
              ) : null}
            </Alert>
          ) : null}
          {chargeableGuides > 0 && primary && !hasGuideLine ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-neutral-50 px-3 py-2 text-sm">
              <span>
                {chargeableGuides} guide{chargeableGuides === 1 ? "" : "s"} beyond the free allowance.
              </span>
              <Button size="sm" variant="secondary" onPress={() => addLine("guides")}>
                <Plus className="size-4" />
                Charge them
              </Button>
            </div>
          ) : null}
        </Card>

        <Card
          action={
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onPress={() => addLine("service")}>
                <Plus className="size-4" />
                Service
              </Button>
              <Button size="sm" variant="tertiary" onPress={() => addLine("custom")}>
                <Plus className="size-4" />
                Custom line
              </Button>
            </div>
          }
          hint="Values in grey come from the service and slab and follow the group size; type over any of them to fix it. ↺ puts it back."
          title="Particulars"
        >
          {lines.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted">
              {services.length === 0 ? (
                <>
                  No services yet.{" "}
                  <Link className="text-accent hover:underline" href="/services">
                    Add them on Services
                  </Link>{" "}
                  or add a custom line.
                </>
              ) : (
                "Add a service to price this PI."
              )}
            </div>
          ) : null}
          {computed.map(({ line, service, auto, values }, index) => {
            const amounts = lineAmounts({
              rate: num(values.rate),
              quantity: num(values.quantity),
              discountRate: num(values.discountRate),
              gstRate: num(values.gstRate),
            });
            const isAuto = (f: LineField) => line.overrides[f] === undefined && line.kind !== "custom";
            const reset = (...f: LineField[]) => resetField(line.key, f);
            return (
              <div key={line.key} className="flex flex-col gap-3 rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-end gap-3">
                  <span className="pb-2 text-sm font-semibold text-muted">{index + 1}.</span>
                  {line.kind === "service" ? (
                    <OptionSelect
                      className="min-w-64 flex-1"
                      label="Service"
                      options={serviceOptions}
                      placeholder="Choose a service"
                      value={line.serviceId}
                      onChange={(id) => updateLine(line.key, () => ({ ...line, serviceId: id, overrides: {} }))}
                    />
                  ) : (
                    <p className="flex-1 pb-2 text-sm font-medium">
                      {line.kind === "guides" ? "Additional guides" : "Custom line"}
                    </p>
                  )}
                  <span className="pb-2 text-sm tabular-nums">
                    {formatRupees(amounts.taxable)}
                    <span className="text-muted"> + GST</span>
                  </span>
                  <Button
                    isIconOnly
                    aria-label="Remove line"
                    variant="ghost"
                    onPress={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                  >
                    <TrashBin className="size-4 text-danger" />
                  </Button>
                </div>
                {line.kind === "service" && !service ? null : (
                  <>
                    <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
                      <SmallField isAuto={isAuto("description")} label="Description" value={values.description} onChange={(v) => setField(line.key, "description", v)} onReset={() => reset("description")} />
                      <SmallField isAuto={isAuto("sacCode")} label="SAC" value={values.sacCode} onChange={(v) => setField(line.key, "sacCode", v)} onReset={() => reset("sacCode")} />
                    </div>
                    <SmallField
                      isAuto={isAuto("details")}
                      label="Second line"
                      placeholder="e.g. Guests: 12 | Guide: 3 (free of charge)"
                      value={values.details}
                      onChange={(v) => setField(line.key, "details", v)}
                      onReset={() => reset("details")}
                    />
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_1fr_1.6fr_1fr]">
                      <SmallField isAuto={isAuto("rate")} label="Rate (₹)" type="number" value={values.rate} onChange={(v) => setField(line.key, "rate", v)} onReset={() => reset("rate")} />
                      <SmallField isAuto={isAuto("quantity")} label="Quantity" type="number" value={values.quantity} onChange={(v) => setField(line.key, "quantity", v)} onReset={() => reset("quantity")} />
                      <SmallField
                        isAuto={isAuto("discountRate")}
                        label="Discount / unit (₹)"
                        type="number"
                        value={values.discountRate}
                        onChange={(v) => setField(line.key, "discountRate", v)}
                        onReset={() => reset("discountRate", "discountLabel")}
                      />
                      <SmallField
                        isAuto={isAuto("discountLabel")}
                        label="Discount label"
                        placeholder="e.g. Goodwill Discount"
                        value={values.discountLabel}
                        onChange={(v) => setField(line.key, "discountLabel", v)}
                        onReset={() => reset("discountLabel")}
                      />
                      <SmallField isAuto={isAuto("gstRate")} label="GST %" type="number" value={values.gstRate} onChange={(v) => setField(line.key, "gstRate", v)} onReset={() => reset("gstRate")} />
                    </div>
                    {auto.pricing ? (
                      <p className="text-xs text-muted">
                        {auto.pricing.slab
                          ? `${auto.pricing.isLargeGroup ? "Suggested from the highest slab" : "Slab"} ${slabRangeLabel(auto.pricing.slab)}: ${
                              auto.pricing.discountPerUnit ? `${formatRupees(auto.pricing.discountPerUnit)} off per unit` : "no discount"
                            }.`
                          : "No slab for this group size: no automatic discount."}
                        {amounts.discount > 0 ? ` Line discount ${formatRupees(amounts.discount)}.` : ""}
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            );
          })}
        </Card>

        <Card hint="Manage the list on the Terms & conditions tab." title="Terms & conditions">
          {terms.length === 0 ? (
            <p className="text-sm text-muted">
              No terms set up.{" "}
              <Link className="text-accent hover:underline" href="/invoices?tab=terms">
                Add some
              </Link>{" "}
              to print them on PIs.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {terms.map((term) => (
                <Checkbox
                  key={term.key}
                  isSelected={term.checked}
                  onChange={(checked) => setTerms((prev) => prev.map((t) => (t.key === term.key ? { ...t, checked } : t)))}
                >
                  <Checkbox.Content>
                    <Checkbox.Control>
                      <Checkbox.Indicator />
                    </Checkbox.Control>
                    <span className="text-sm">
                      <span className="font-medium">{term.title}</span>
                      {!term.fromLibrary ? <span className="text-muted"> (as saved on this PI)</span> : null}
                      <span className="block text-muted">{term.body}</span>
                    </span>
                  </Checkbox.Content>
                </Checkbox>
              ))}
            </div>
          )}
        </Card>

        <Card title="Internal notes">
          <TextField aria-label="Internal notes" value={notes} onChange={setNotes}>
            <TextArea placeholder="Not printed on the PI." rows={3} />
          </TextField>
        </Card>
      </div>

      <aside className="xl:sticky xl:top-0 xl:self-start">
        <Card
          action={invoice ? <InvoiceStatusChip status={invoice.status} /> : null}
          title={invoice ? invoice.pi_number : "New proforma invoice"}
        >
          <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-sm tabular-nums">
            <dt className="text-muted">Gross</dt>
            <dd className="text-right">{formatRupees(totals.subtotal)}</dd>
            {totals.discountTotal > 0 ? (
              <>
                <dt className="text-muted">Discounts</dt>
                <dd className="text-right">−{formatRupees(totals.discountTotal)}</dd>
              </>
            ) : null}
            <dt className="font-medium">Total amount</dt>
            <dd className="text-right font-medium">{formatRupees(totals.taxableTotal)}</dd>
            {totals.gstByRate
              .filter((g) => g.rate > 0)
              .map((g) => (
                <div key={g.rate} className="contents">
                  <dt className="text-muted">GST @ {g.rate}%</dt>
                  <dd className="text-right">{formatRupees(g.gst)}</dd>
                </div>
              ))}
            <dt className="border-t border-border pt-2 font-semibold">Net total payable</dt>
            <dd className="border-t border-border pt-2 text-right font-semibold">{formatRupees(totals.grandTotal)}</dd>
          </dl>
          <p className="text-xs text-muted">{amountInWords(totals.grandTotal)}</p>
          {visit ? (
            <p className="text-xs text-muted">
              {status === "issued" || status === "paid"
                ? `Counts as ${formatRupees(totals.taxableTotal)} Rural Experience revenue on the trip.`
                : "Counts toward the trip's revenue once Issued or Paid."}
            </p>
          ) : null}

          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <Button fullWidth isPending={isSaving} onPress={handleSave}>
            {invoice ? "Save changes" : "Create proforma invoice"}
          </Button>
          {invoice ? (
            <>
              <PdfActions invoiceId={invoice.id} isDisabled={isDirty} />
              {isDirty ? <p className="text-xs text-muted">Save your changes to download the updated PDF.</p> : null}
            </>
          ) : (
            <p className="text-xs text-muted">Create the PI to preview and download it as a PDF.</p>
          )}
        </Card>
      </aside>
    </div>
  );
}

/**
 * What buildInput() returns for the PI exactly as saved, so the editor can tell whether
 * anything changed. Rebuilt the same way the editor builds its input.
 */
function initialSnapshotOf(invoice: InvoiceWithItems): string {
  const items = invoice.items.slice().sort((a, b) => a.position - b.position);
  const terms = (Array.isArray(invoice.terms) ? invoice.terms : []).flatMap((t) => {
    const parsed = invoiceTermSnapshotSchema.safeParse(t);
    return parsed.success ? [{ title: parsed.data.title.trim(), body: parsed.data.body.trim() }] : [];
  });
  return JSON.stringify({
    piNumber: invoice.pi_number,
    piDate: invoice.pi_date,
    status: invoice.status,
    visitId: invoice.visit_id ?? "",
    billingName: invoice.billing_name,
    billingAddress: invoice.billing_address ?? "",
    billingGstin: invoice.billing_gstin ?? "",
    paymentTerms: invoice.payment_terms ?? "",
    guests: str(invoice.guests),
    guides: str(invoice.guides),
    freeGuides: str(invoice.free_guides),
    terms,
    notes: invoice.notes ?? "",
    items: items.map((item) => ({
      serviceId: item.service_id ?? "",
      description: item.description,
      details: item.details ?? "",
      sacCode: item.sac_code ?? "",
      rate: str(item.rate),
      quantity: str(item.quantity),
      discountLabel: item.discount_label ?? "",
      discountRate: str(item.discount_rate),
      gstRate: str(item.gst_rate),
    })),
  });
}
