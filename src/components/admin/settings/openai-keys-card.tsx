"use client";

import { useState, useTransition } from "react";
import {
  CircleCheck,
  CircleInfo,
  Eye,
  EyeSlash,
  Key,
  Plus,
  ShieldCheck,
  TrashBin,
} from "@gravity-ui/icons";
import { Button, Chip, Input, Spinner } from "@heroui/react";
import {
  addOpenAIKeyAction,
  deleteOpenAIKeyAction,
  getOpenAIKeysAction,
  setActiveOpenAIKeyAction,
  testOpenAIKeyAction,
} from "@/lib/actions/openai-keys";
import type { OpenAIKeyActionResult, OpenAIKeysState } from "@/lib/openai/types";

interface OpenAIKeysCardProps {
  initialState: OpenAIKeysState;
}

type Notice = { ok: boolean; text: string } | null;

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function OpenAIKeysCard({ initialState }: OpenAIKeysCardProps) {
  const [state, setState] = useState<OpenAIKeysState>(initialState);
  const [label, setLabel] = useState("");
  const [keyValue, setKeyValue] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [makeActive, setMakeActive] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isAdding, startAdd] = useTransition();

  const hasStoredKeys = state.keys.length > 0;

  async function reload() {
    setState(await getOpenAIKeysAction());
  }

  async function run(id: string, action: () => Promise<OpenAIKeyActionResult>, refresh: boolean) {
    setBusyId(id);
    setNotice(null);
    try {
      const result = await action();
      const latency = result.latencyMs !== undefined ? ` (${result.latencyMs}ms)` : "";
      setNotice({ ok: result.ok, text: `${result.message}${result.ok ? latency : ""}` });
      if (refresh) await reload();
    } catch {
      setNotice({ ok: false, text: "Something went wrong. Please try again." });
    } finally {
      setBusyId(null);
      setConfirmDeleteId(null);
    }
  }

  function handleAdd() {
    setNotice(null);
    startAdd(async () => {
      try {
        const result = await addOpenAIKeyAction({
          label,
          key: keyValue,
          // The first key should just work; later keys only replace the active one if asked.
          makeActive: hasStoredKeys ? makeActive : true,
        });
        setNotice({ ok: result.ok, text: result.message });
        if (result.ok) {
          setLabel("");
          setKeyValue("");
          setShowKey(false);
          await reload();
        }
      } catch {
        setNotice({ ok: false, text: "Something went wrong. Please try again." });
      }
    });
  }

  const statusChip =
    state.activeSource === "settings" ? (
      <Chip color="success" size="sm" variant="soft">
        Using saved key
      </Chip>
    ) : state.activeSource === "env" ? (
      <Chip color="warning" size="sm" variant="soft">
        Using environment key
      </Chip>
    ) : (
      <Chip color="danger" size="sm" variant="soft">
        Not configured
      </Chip>
    );

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3.5">
          <div className="flex size-11 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
            <Key className="size-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-neutral-900">OpenAI API Keys</h2>
              {statusChip}
            </div>
            <p className="text-xs text-neutral-500">
              Powers the WhatsApp AI agent, inbox auto-replies and the review organiser. Keys are encrypted at rest and
              never shown again after saving.
            </p>
          </div>
        </div>
      </div>

      {notice && (
        <div
          role="status"
          className={`mt-4 flex items-start gap-2 rounded-xl border p-3 text-xs ${
            notice.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-rose-200 bg-rose-50 text-rose-900"
          }`}
        >
          {notice.ok ? (
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          ) : (
            <CircleInfo className="mt-0.5 size-4 shrink-0 text-rose-600" />
          )}
          <span>{notice.text}</span>
        </div>
      )}

      {state.error && <p className="mt-3 text-xs text-rose-700">{state.error}</p>}

      {/* Saved keys */}
      <div className="mt-6 border-t border-neutral-100 pt-5">
        <span className="text-xs font-medium uppercase tracking-wider text-neutral-400">Saved keys</span>

        {!hasStoredKeys && (
          <div className="mt-3 rounded-xl bg-neutral-50 p-4 text-sm text-neutral-600">
            {state.envConfigured ? (
              <>
                No keys saved here yet. The app is currently using the{" "}
                <code className="rounded bg-neutral-200 px-1 py-0.5 text-xs">OPENAI_API_KEY</code> environment
                variable.{" "}
                <button
                  type="button"
                  className="font-medium text-neutral-900 underline underline-offset-2 disabled:opacity-50"
                  disabled={busyId === "env"}
                  onClick={() => run("env", () => testOpenAIKeyAction("env"), false)}
                >
                  {busyId === "env" ? "Testing…" : "Test it"}
                </button>
                . Add a key below to manage it from here instead.
              </>
            ) : (
              <>No OpenAI key is configured. Add one below to enable the AI agent and auto-replies.</>
            )}
          </div>
        )}

        {hasStoredKeys && (
          <ul className="mt-3 divide-y divide-neutral-100 rounded-xl border border-neutral-100">
            {state.keys.map((k) => {
              const busy = busyId === k.id;
              return (
                <li key={k.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-neutral-900">{k.label}</span>
                      {k.isActive && (
                        <Chip color="success" size="sm" variant="soft">
                          Active
                        </Chip>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      <span className="font-mono">sk-••••{k.keyHint}</span> · added {formatDate(k.createdAt)}
                      {k.createdBy ? ` by ${k.createdBy}` : ""}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      isDisabled={busy}
                      onPress={() => run(k.id, () => testOpenAIKeyAction(k.id), false)}
                    >
                      {busy ? <Spinner size="sm" /> : <ShieldCheck className="size-3.5" />}
                      Test
                    </Button>
                    {!k.isActive && (
                      <Button
                        size="sm"
                        variant="outline"
                        isDisabled={busy}
                        onPress={() => run(k.id, () => setActiveOpenAIKeyAction(k.id), true)}
                      >
                        Use this key
                      </Button>
                    )}
                    {confirmDeleteId === k.id ? (
                      <>
                        <Button
                          size="sm"
                          variant="danger"
                          isDisabled={busy}
                          onPress={() => run(k.id, () => deleteOpenAIKeyAction(k.id), true)}
                        >
                          Confirm remove
                        </Button>
                        <Button size="sm" variant="ghost" onPress={() => setConfirmDeleteId(null)}>
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        isDisabled={busy}
                        aria-label={`Remove ${k.label}`}
                        onPress={() => setConfirmDeleteId(k.id)}
                      >
                        <TrashBin className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {hasStoredKeys && !state.keys.some((k) => k.isActive) && (
          <p className="mt-2 text-xs text-amber-700">
            No saved key is active, so the app is {state.envConfigured ? "using the environment key" : "not using any key"}.
          </p>
        )}
      </div>

      {/* Add a key */}
      <form
        className="mt-6 border-t border-neutral-100 pt-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!isAdding && label.trim() && keyValue.trim()) handleAdd();
        }}
      >
        <span className="text-xs font-medium uppercase tracking-wider text-neutral-400">Add a key</span>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[1fr_2fr]">
          <div>
            <label htmlFor="openai-key-label" className="mb-1 block text-xs font-medium text-neutral-700">
              Name
            </label>
            <Input
              id="openai-key-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Production"
              maxLength={60}
              autoComplete="off"
              className="w-full text-sm"
            />
          </div>
          <div>
            <label htmlFor="openai-key-value" className="mb-1 block text-xs font-medium text-neutral-700">
              API key
            </label>
            <div className="flex gap-2">
              <Input
                id="openai-key-value"
                type={showKey ? "text" : "password"}
                value={keyValue}
                onChange={(e) => setKeyValue(e.target.value)}
                placeholder="sk-..."
                autoComplete="off"
                spellCheck={false}
                className="flex-1 font-mono text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                aria-label={showKey ? "Hide key" : "Show key"}
                onPress={() => setShowKey((v) => !v)}
              >
                {showKey ? <EyeSlash className="size-4" /> : <Eye className="size-4" />}
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          {hasStoredKeys ? (
            <label className="flex items-center gap-2 text-xs text-neutral-700">
              <input
                type="checkbox"
                checked={makeActive}
                onChange={(e) => setMakeActive(e.target.checked)}
                className="size-3.5 accent-neutral-900"
              />
              Make this the active key
            </label>
          ) : (
            <span className="text-xs text-neutral-500">The first key you add is used right away.</span>
          )}
          <Button
            type="submit"
            size="sm"
            variant="primary"
            isDisabled={isAdding || !label.trim() || !keyValue.trim()}
          >
            {isAdding ? <Spinner size="sm" /> : <Plus className="size-3.5" />}
            Verify &amp; save
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-neutral-500">
          The key is checked with OpenAI before it&rsquo;s saved. Create keys at platform.openai.com/api-keys. A saved
          key takes priority over the <code className="font-mono">OPENAI_API_KEY</code> environment variable.
        </p>
      </form>
    </div>
  );
}
