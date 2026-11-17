import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * OpenAI API key resolution. Precedence:
 *   1. the key marked active in Settings → Configuration (stored encrypted in
 *      Supabase Vault, read through service-role-only functions);
 *   2. the OPENAI_API_KEY environment variable (legacy / bootstrap fallback).
 *
 * Server-only: the secret never reaches a Client Component. The UI only ever
 * sees the label and last four characters (see lib/actions/openai-keys.ts).
 */

export type OpenAIKeySource = "settings" | "env";

export interface ResolvedOpenAIKey {
  key: string;
  source: OpenAIKeySource;
}

export async function resolveOpenAIKey(): Promise<ResolvedOpenAIKey | null> {
  try {
    const { data, error } = await createAdminClient().rpc("get_active_openai_api_key");
    if (error) {
      console.error("[openai] could not read the stored key, falling back to env:", error.message);
    } else if (typeof data === "string" && data.trim()) {
      return { key: data.trim(), source: "settings" };
    }
  } catch (err) {
    console.error("[openai] could not read the stored key, falling back to env:", err);
  }

  const envKey = process.env.OPENAI_API_KEY?.trim();
  return envKey ? { key: envKey, source: "env" } : null;
}

export async function isOpenAIConfigured(): Promise<boolean> {
  return (await resolveOpenAIKey()) !== null;
}

export interface VerifyKeyResult {
  /** The key was accepted by OpenAI. */
  ok: boolean;
  /** OpenAI explicitly rejected the key (401/403) — it will never work. */
  rejected: boolean;
  message: string;
  latencyMs?: number;
}

/** Cheap authenticated call (list models) to check a key without spending tokens. */
export async function verifyOpenAIKey(key: string): Promise<VerifyKeyResult> {
  const started = Date.now();
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const latencyMs = Date.now() - started;
    if (response.ok) return { ok: true, rejected: false, message: "Key accepted by OpenAI.", latencyMs };
    if (response.status === 401 || response.status === 403) {
      return { ok: false, rejected: true, message: "OpenAI rejected this key (invalid, revoked or lacking access).", latencyMs };
    }
    return { ok: false, rejected: false, message: `OpenAI returned HTTP ${response.status}.`, latencyMs };
  } catch {
    return { ok: false, rejected: false, message: "Couldn't reach OpenAI to verify the key." };
  }
}
