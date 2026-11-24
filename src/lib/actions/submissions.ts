"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireActiveTeamMember } from "@/lib/auth/session";
import type { Json } from "@/lib/types/supabase";

export type AnswerInput = {
  field_id: string;
  value: unknown;
  field_snapshot: {
    label: string | null;
    type: string;
    position: number;
  };
};

export async function getPublicFormBySlug(identifier: string) {
  const supabase = await createClient();

  // Try matching slug (case-insensitive) first, then fallback to share_token
  let { data: form, error: formError } = await supabase
    .from("forms")
    .select("id, title, description, slug, share_token, status, settings")
    .ilike("slug", identifier)
    .maybeSingle();

  if (!form) {
    const fallback = await supabase
      .from("forms")
      .select("id, title, description, slug, share_token, status, settings")
      .eq("share_token", identifier)
      .maybeSingle();
    form = fallback.data;
    formError = fallback.error;
  }

  if (formError || !form) {
    return null;
  }

  if (form.status !== "published") {
    return { form, fields: [], isNotPublished: true };
  }

  const { data: fields, error: fieldsError } = await supabase
    .from("form_fields")
    .select("*")
    .eq("form_id", form.id)
    .is("deleted_at", null)
    .order("position", { ascending: true });

  if (fieldsError) {
    throw new Error(fieldsError.message);
  }

  return { form, fields: fields ?? [], isNotPublished: false };
}

export const getPublicFormByShareToken = getPublicFormBySlug;

// ---------------------------------------------------------------------------
// Public (anonymous) submission actions.
//
// Anonymous visitors have no direct database access to submissions or answers
// (no RLS policies for anon on form_submissions / form_answers). These server
// actions are the only way in: they use the service-role client and check,
// every time, that the submission belongs to the caller's submitter token, that
// the form is published, and that each field belongs to that form.
// ---------------------------------------------------------------------------

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

function assertUuid(value: string, what: string) {
  if (!UUID_PATTERN.test(value)) throw new Error(`Invalid ${what}.`);
}

function assertToken(value: string) {
  if (!TOKEN_PATTERN.test(value)) throw new Error("Invalid submission session.");
}

async function isPublishedForm(formId: string) {
  const { data } = await createAdminClient().from("forms").select("status").eq("id", formId).maybeSingle();
  return data?.status === "published";
}

/** The caller's own submission (id + token must match) on a published form, or null. */
async function ownSubmission(submissionId: string, submitterToken: string) {
  assertUuid(submissionId, "submission");
  assertToken(submitterToken);
  const { data } = await createAdminClient()
    .from("form_submissions")
    .select("id, form_id, status")
    .eq("id", submissionId)
    .eq("submitter_token", submitterToken)
    .maybeSingle();
  if (!data || !(await isPublishedForm(data.form_id))) return null;
  return data;
}

export async function getOrCreateSubmission(formId: string, submitterToken: string) {
  assertUuid(formId, "form");
  assertToken(submitterToken);
  if (!(await isPublishedForm(formId))) throw new Error("This form is not accepting responses.");
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("form_submissions")
    .select("id, status, submitter_token, completed_at")
    .eq("form_id", formId)
    .eq("submitter_token", submitterToken)
    .maybeSingle();

  if (existing) {
    const { data: answers } = await admin
      .from("form_answers")
      .select("field_id, value")
      .eq("submission_id", existing.id);

    return {
      submission: existing,
      answers: answers ?? [],
    };
  }

  const { data: created, error } = await admin
    .from("form_submissions")
    .insert({
      form_id: formId,
      submitter_token: submitterToken,
      status: "in_progress",
    })
    .select("id, status, submitter_token, completed_at")
    .single();

  if (error) {
    throw new Error("Could not start the submission.");
  }

  return {
    submission: created,
    answers: [],
  };
}

export async function saveProgressiveAnswers(
  submissionId: string,
  submitterToken: string,
  answers: AnswerInput[],
) {
  if (answers.length === 0) return;

  const submission = await ownSubmission(submissionId, submitterToken);
  if (!submission) {
    throw new Error("Invalid submission session.");
  }

  const validAnswers = answers.filter(
    (ans) => ans.value !== undefined && ans.value !== null && ans.value !== ""
  );

  if (validAnswers.length === 0) return;

  // Only fields of this submission's form can be answered.
  const admin = createAdminClient();
  const { data: fields } = await admin
    .from("form_fields")
    .select("id")
    .eq("form_id", submission.form_id)
    .is("deleted_at", null);
  const allowed = new Set((fields ?? []).map((f) => f.id));
  if (validAnswers.some((ans) => !allowed.has(ans.field_id))) {
    throw new Error("Invalid field.");
  }

  const payload = validAnswers.map((ans) => ({
    submission_id: submissionId,
    field_id: ans.field_id,
    value: ans.value as Json,
    field_snapshot: ans.field_snapshot as unknown as Json,
  }));

  const { error } = await admin.from("form_answers").upsert(payload, {
    onConflict: "submission_id,field_id",
  });

  if (error) {
    throw new Error("Could not save your answers.");
  }
}

export async function completeSubmission(
  submissionId: string,
  submitterToken: string,
  answers: AnswerInput[],
) {
  if (answers.length > 0) {
    await saveProgressiveAnswers(submissionId, submitterToken, answers);
  }
  const submission = await ownSubmission(submissionId, submitterToken);
  if (!submission) throw new Error("Invalid submission session.");

  const { error } = await createAdminClient()
    .from("form_submissions")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", submissionId)
    .eq("submitter_token", submitterToken);

  if (error) {
    throw new Error("Could not submit the form.");
  }
}

// Hard ceiling for any single upload, whatever a field's settings say.
const MAX_UPLOAD_MB = 10;

function matchesAcceptedType(file: File, accepted: string[]) {
  if (accepted.length === 0) return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return accepted.some((raw) => {
    const rule = raw.trim().toLowerCase();
    if (!rule) return false;
    if (rule.startsWith(".")) return name.endsWith(rule);
    if (rule.endsWith("/*")) return type.startsWith(rule.slice(0, -1));
    return type === rule;
  });
}

export async function uploadSubmissionFile(
  formId: string,
  submissionId: string,
  fieldId: string,
  submitterToken: string,
  formData: FormData,
) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("No file uploaded.");
  }
  assertUuid(formId, "form");
  assertUuid(fieldId, "field");

  const submission = await ownSubmission(submissionId, submitterToken);
  if (!submission || submission.form_id !== formId) {
    throw new Error("Invalid submission session.");
  }

  const admin = createAdminClient();
  const { data: field } = await admin
    .from("form_fields")
    .select("id, type, config")
    .eq("id", fieldId)
    .eq("form_id", formId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!field || field.type !== "file_upload") {
    throw new Error("This field doesn't take files.");
  }

  const config = (field.config ?? {}) as { maxSizeMb?: number; acceptedTypes?: string[] };
  const maxMb = Math.min(MAX_UPLOAD_MB, typeof config.maxSizeMb === "number" && config.maxSizeMb > 0 ? config.maxSizeMb : MAX_UPLOAD_MB);
  if (file.size > maxMb * 1024 * 1024) {
    throw new Error(`Keep the file under ${maxMb} MB.`);
  }
  if (!matchesAcceptedType(file, Array.isArray(config.acceptedTypes) ? config.acceptedTypes : [])) {
    throw new Error("That file type isn't accepted here.");
  }

  const rawExt = file.name.includes(".") ? file.name.split(".").pop() ?? "" : "";
  const fileExt = /^[a-z0-9]{1,10}$/i.test(rawExt) ? rawExt.toLowerCase() : "bin";
  const uniqueName = `${Date.now()}-${crypto.randomUUID()}.${fileExt}`;
  const storagePath = `${formId}/${submissionId}/${fieldId}/${uniqueName}`;

  const { error } = await admin.storage
    .from("form-uploads")
    .upload(storagePath, await file.arrayBuffer(), {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (error) {
    throw new Error("Could not upload the file.");
  }

  return {
    name: file.name,
    path: storagePath,
    size: file.size,
    type: file.type,
  };
}

/* ==========================================================================
   Admin Submissions & Metrics Actions (Phase 6)
   ========================================================================== */

export async function getFormSubmissions(
  formId: string,
  options: {
    page?: number;
    limit?: number;
    status?: "all" | "completed" | "in_progress";
    search?: string;
  } = {},
) {
  await requireActiveTeamMember();
  const supabase = await createClient();

  const page = options.page ?? 1;
  const limit = options.limit ?? 25;
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  // Query submissions count
  let countQuery = supabase
    .from("form_submissions")
    .select("id", { count: "exact", head: true })
    .eq("form_id", formId);

  if (options.status && options.status !== "all") {
    countQuery = countQuery.eq("status", options.status);
  }

  if (options.search) {
    countQuery = countQuery.ilike("submitter_token", `%${options.search}%`);
  }

  const { count } = await countQuery;

  // Query paginated submissions
  let query = supabase
    .from("form_submissions")
    .select(`
      id,
      form_id,
      submitter_token,
      status,
      completed_at,
      created_at,
      form_answers (
        id,
        field_id,
        value,
        field_snapshot,
        created_at
      )
    `)
    .eq("form_id", formId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (options.status && options.status !== "all") {
    query = query.eq("status", options.status);
  }

  if (options.search) {
    query = query.ilike("submitter_token", `%${options.search}%`);
  }

  const { data: submissions, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  // Fetch form fields for column mapping
  const { data: fields } = await supabase
    .from("form_fields")
    .select("id, label, type, position")
    .eq("form_id", formId)
    .is("deleted_at", null)
    .order("position", { ascending: true });

  return {
    submissions: (submissions ?? []).map((s) => ({ ...s, started_at: s.created_at })),
    fields: fields ?? [],
    total: count ?? 0,
    page,
    totalPages: Math.ceil((count ?? 0) / limit),
  };
}

export async function getSignedUploadUrl(filePath: string) {
  await requireActiveTeamMember();
  const adminSupabase = createAdminClient();

  const { data, error } = await adminSupabase.storage
    .from("form-uploads")
    .createSignedUrl(filePath, 3600); // 1 hour valid signed URL

  if (error || !data) {
    throw new Error(error?.message || "Failed to generate download URL");
  }

  return data.signedUrl;
}

export async function exportSubmissionsCsv(formId: string) {
  await requireActiveTeamMember();
  const supabase = await createClient();

  const { data: form } = await supabase
    .from("forms")
    .select("title")
    .eq("id", formId)
    .single();

  const { data: fields } = await supabase
    .from("form_fields")
    .select("id, label, type")
    .eq("form_id", formId)
    .is("deleted_at", null)
    .order("position", { ascending: true });

  const activeFields = (fields ?? []).filter((f) => f.type !== "section");

  const { data: submissions } = await supabase
    .from("form_submissions")
    .select(`
      id,
      submitter_token,
      status,
      completed_at,
      created_at,
      form_answers (
        field_id,
        value,
        field_snapshot
      )
    `)
    .eq("form_id", formId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false });

  // Helper to escape CSV fields
  const escapeCsv = (val: string | number | boolean | null | undefined) => {
    if (val === null || val === undefined) return '""';
    const str = String(val);
    if (str.includes('"') || str.includes(",") || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return `"${str}"`;
  };

  // Header row
  const headers = [
    "Submission ID",
    "Submitter Token",
    "Status",
    "Started At",
    "Completed At",
    ...activeFields.map((f) => f.label || "Untitled Field"),
  ];

  const rows = [headers.map(escapeCsv).join(",")];

  // Data rows
  for (const sub of submissions ?? []) {
    const answerMap = new Map<string, unknown>();
    for (const ans of sub.form_answers ?? []) {
      answerMap.set(ans.field_id, ans.value);
    }

    const row = [
      sub.id,
      sub.submitter_token,
      sub.status,
      sub.created_at,
      sub.completed_at ?? "",
      ...activeFields.map((field) => {
        const rawVal = answerMap.get(field.id);
        if (rawVal === undefined || rawVal === null) return "";
        if (typeof rawVal === "object") {
          if (Array.isArray(rawVal)) return rawVal.join("; ");
          return JSON.stringify(rawVal);
        }
        return String(rawVal);
      }),
    ];

    rows.push(row.map(escapeCsv).join(","));
  }

  return {
    filename: `${(form?.title || "form").toLowerCase().replace(/[^a-z0-9]/g, "-")}-submissions.csv`,
    content: rows.join("\n"),
  };
}

export async function getFormMetricsData(formId: string) {
  await requireActiveTeamMember();
  const supabase = await createClient();

  const { data: form } = await supabase
    .from("forms")
    .select("id, title, status, settings")
    .eq("id", formId)
    .single();

  const { data: fields } = await supabase
    .from("form_fields")
    .select("*")
    .eq("form_id", formId)
    .is("deleted_at", null)
    .order("position", { ascending: true });

  const { data: submissions } = await supabase
    .from("form_submissions")
    .select("id, status, created_at, completed_at")
    .eq("form_id", formId);

  const { data: answers } = await supabase
    .from("form_answers")
    .select("id, submission_id, field_id, value, field_snapshot, created_at")
    .in("submission_id", (submissions ?? []).map((s) => s.id));

  const totalSubmissions = submissions?.length ?? 0;
  const completedSubmissions = (submissions ?? []).filter((s) => s.status === "completed");
  const inProgressSubmissions = (submissions ?? []).filter((s) => s.status === "in_progress");
  const completedCount = completedSubmissions.length;
  const completionRate = totalSubmissions > 0 ? Math.round((completedCount / totalSubmissions) * 100) : 0;

  // Average Completion Time (in seconds)
  let totalTimeSeconds = 0;
  let timedCount = 0;

  for (const sub of completedSubmissions) {
    if (sub.created_at && sub.completed_at) {
      const start = new Date(sub.created_at).getTime();
      const end = new Date(sub.completed_at).getTime();
      const duration = (end - start) / 1000;
      if (duration > 0 && duration < 86400) {
        totalTimeSeconds += duration;
        timedCount++;
      }
    }
  }

  const avgCompletionTimeSeconds = timedCount > 0 ? Math.round(totalTimeSeconds / timedCount) : 0;

  return {
    form,
    fields: fields ?? [],
    summary: {
      totalSubmissions,
      completedCount,
      inProgressCount: inProgressSubmissions.length,
      completionRate,
      avgCompletionTimeSeconds,
    },
    submissions: (submissions ?? []).map((s) => ({ ...s, started_at: s.created_at })),
    answers: answers ?? [],
  };
}
