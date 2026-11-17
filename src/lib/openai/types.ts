// Shared (client + server) shapes for the OpenAI key manager. Never contains a key.

export interface OpenAIKeyInfo {
  id: string;
  label: string;
  /** Last four characters, for display as "••••abcd". */
  keyHint: string;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
}

export interface OpenAIKeysState {
  keys: OpenAIKeyInfo[];
  /** OPENAI_API_KEY is set in the server environment (used when no stored key is active). */
  envConfigured: boolean;
  /** Which key the app is actually using right now. */
  activeSource: "settings" | "env" | null;
  error?: string;
}

export interface OpenAIKeyActionResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
}
