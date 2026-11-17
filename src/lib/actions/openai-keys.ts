"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActiveTeamMember } from "@/lib/auth/session";
import { resolveOpenAIKey, verifyOpenAIKey } from "@/lib/openai/keys";
import type { OpenAIKeyActionResult, OpenAIKeysState } from "@/lib/openai/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Keys are stored encrypted in Supabase Vault. These actions run as the signed-in
// team member (gated by requireActiveTeamMember) and use the service role only for
// the Vault functions, which no other role can execute. A key value is never
// returned to the client — only its label and last four characters.

export async function getOpenAIKeysAction(): Promise<OpenAIKeysState> {
  await requireActiveTeamMember();

  // Metadata read goes through the user's own session, so RLS applies.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("openai_api_keys")
    .select("id, label, key_hint, is_active, created_by, created_at")
    .order("created_at", { ascending: false });

  const resolved = await resolveOpenAIKey();
  return {
    keys: (data ?? []).map((row) => ({
      id: row.id,
      label: row.label,
      keyHint: row.key_hint,
      isActive: row.is_active,
      createdBy: row.created_by,
      createdAt: row.created_at,
    })),
    envConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
    activeSource: resolved?.source ?? null,
    error: error ? "Couldn't load saved keys." : undefined,
  };
}

const addSchema = z.object({
  label: z.string().trim().min(1, "Give the key a name.").max(60, "Name is too long (60 max)."),
  key: z
    .string()
    .trim()
    .min(20, "That doesn't look like an OpenAI API key.")
    .max(300, "That doesn't look like an OpenAI API key.")
    .regex(/^sk-[A-Za-z0-9_\-]+$/, "OpenAI keys start with “sk-” and contain no spaces."),
  makeActive: z.boolean(),
});

export async function addOpenAIKeyAction(
  input: z.input<typeof addSchema>,
): Promise<OpenAIKeyActionResult> {
  const { email } = await requireActiveTeamMember();
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { label, key, makeActive } = parsed.data;

  // Refuse keys OpenAI itself rejects; if OpenAI is merely unreachable, save anyway and say so.
  const check = await verifyOpenAIKey(key);
  if (check.rejected) return { ok: false, message: check.message };

  const { error } = await createAdminClient().rpc("add_openai_api_key", {
    p_label: label,
    p_key: key,
    p_created_by: email,
    p_make_active: makeActive,
  });
  if (error) {
    console.error("[openai-keys] add failed:", error.message);
    return { ok: false, message: "Couldn't save the key. Please try again." };
  }

  revalidatePath("/settings");
  return {
    ok: true,
    message: check.ok
      ? makeActive
        ? "Key verified and saved. It's now in use."
        : "Key verified and saved."
      : `Key saved, but it couldn't be verified: ${check.message}`,
  };
}

const idSchema = z.string().uuid();

export async function setActiveOpenAIKeyAction(id: string): Promise<OpenAIKeyActionResult> {
  await requireActiveTeamMember();
  if (!idSchema.safeParse(id).success) return { ok: false, message: "Invalid key." };

  const { error } = await createAdminClient().rpc("set_active_openai_api_key", { p_id: id });
  if (error) {
    console.error("[openai-keys] activate failed:", error.message);
    return { ok: false, message: "Couldn't switch the active key." };
  }
  revalidatePath("/settings");
  return { ok: true, message: "Active key updated." };
}

export async function deleteOpenAIKeyAction(id: string): Promise<OpenAIKeyActionResult> {
  await requireActiveTeamMember();
  if (!idSchema.safeParse(id).success) return { ok: false, message: "Invalid key." };

  const { error } = await createAdminClient().rpc("delete_openai_api_key", { p_id: id });
  if (error) {
    console.error("[openai-keys] delete failed:", error.message);
    return { ok: false, message: "Couldn't remove the key." };
  }
  revalidatePath("/settings");
  return { ok: true, message: "Key removed." };
}

/** Test a stored key by id, or the environment key with id "env". */
export async function testOpenAIKeyAction(id: string): Promise<OpenAIKeyActionResult> {
  await requireActiveTeamMember();

  let key: string | null | undefined;
  if (id === "env") {
    key = process.env.OPENAI_API_KEY?.trim();
  } else {
    if (!idSchema.safeParse(id).success) return { ok: false, message: "Invalid key." };
    const { data } = await createAdminClient().rpc("get_openai_api_key", { p_id: id });
    key = typeof data === "string" ? data : null;
  }
  if (!key) return { ok: false, message: "No key found to test." };

  const result = await verifyOpenAIKey(key);
  return { ok: result.ok, message: result.message, latencyMs: result.latencyMs };
}
