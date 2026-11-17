"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button, Chip, SearchField, Switch, toast } from "@heroui/react";
import {
  getConversationList,
  markConversationRead,
  registerInboxWebhook,
  setAutoReplyEnabled,
  type InboxConversation,
  type InboxThread,
  type WebhookStatus,
} from "@/lib/actions/inbox";
import { formatPhone } from "@/lib/mastra/phone";
import { createClient } from "@/lib/supabase/client";
import { serviceWindow } from "@/lib/whatsapp/window";
import { ContactProfile } from "./contact-profile";
import { ThreadPanel } from "./thread-panel";

type Filter = "all" | "unread" | "needs_human" | "ai_paused";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "needs_human", label: "Needs a person" },
  { id: "ai_paused", label: "AI paused" },
];

export function contactLabel(c: Pick<InboxConversation, "contact_name" | "contact_phone">) {
  return c.contact_name || (c.contact_phone ? formatPhone(c.contact_phone) : "WhatsApp user");
}

function timeLabel(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function InboxToolbar({
  autoReplyEnabled,
  agentConfigured,
  webhook,
}: {
  autoReplyEnabled: boolean;
  agentConfigured: boolean;
  webhook: WebhookStatus;
}) {
  const router = useRouter();
  const [isRegistering, setIsRegistering] = useState(false);

  async function toggleAutoReply(enabled: boolean) {
    const result = await setAutoReplyEnabled(enabled);
    if (result.error) toast.danger(result.error);
    else router.refresh();
  }

  async function handleRegister() {
    setIsRegistering(true);
    const result = await registerInboxWebhook();
    setIsRegistering(false);
    if (result.error) toast.danger(result.error);
    else {
      toast.success("Webhook registered with Zernio.");
      router.refresh();
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border/60 px-5 py-3">
      <h1 className="text-lg font-semibold">Inbox</h1>
      <div className="ml-auto flex flex-wrap items-center gap-3">
        {webhook.registered ? (
          <Chip color="success" size="sm" variant="soft">
            Receiving WhatsApp messages
          </Chip>
        ) : (
          <div className="flex items-center gap-2">
            <Chip color="warning" size="sm" variant="soft">
              {webhook.error ?? (webhook.secretConfigured ? "Webhook not registered" : "ZERNIO_WEBHOOK_SECRET missing")}
            </Chip>
            {webhook.url && webhook.secretConfigured ? (
              <Button isPending={isRegistering} size="sm" variant="secondary" onPress={handleRegister}>
                Connect webhook
              </Button>
            ) : null}
          </div>
        )}
        <Switch isDisabled={!agentConfigured} isSelected={autoReplyEnabled && agentConfigured} onChange={toggleAutoReply}>
          <Switch.Content>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
            {agentConfigured ? "AI auto-replies" : "AI off (no OpenAI key — add one in Settings)"}
          </Switch.Content>
        </Switch>
      </div>
    </div>
  );
}

function sortConversations(list: InboxConversation[]) {
  return [...list].sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""));
}

export function InboxView({
  conversations: serverConversations,
  thread,
  autoReplyEnabled,
  agentConfigured,
  webhook,
}: {
  conversations: InboxConversation[];
  thread: InboxThread | null;
  autoReplyEnabled: boolean;
  agentConfigured: boolean;
  webhook: WebhookStatus;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [conversations, setConversations] = useState(serverConversations);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeId = thread?.conversation.id ?? null;

  // A server render (navigation, memory change, toggle) is authoritative.
  const [seenServer, setSeenServer] = useState(serverConversations);
  if (seenServer !== serverConversations) {
    setSeenServer(serverConversations);
    setConversations(serverConversations);
  }

  // Live updates without reloading the page: conversation rows are patched in place from the realtime
  // payload (RLS still applies), and the open thread subscribes to its own messages (see ThreadPanel).
  // If realtime isn't connected we poll instead, and we always re-sync when the tab regains focus.
  useEffect(() => {
    const supabase = createClient();
    let subscribed = false;
    let cancelled = false;

    const resync = async () => {
      const list = await getConversationList();
      if (list && !cancelled) setConversations(list);
    };
    // Memory notes only feed the contact panel, so a soft server refresh (state is preserved) is enough.
    const refreshProfile = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => router.refresh(), 500);
    };

    const channel = supabase
      .channel("whatsapp-inbox")
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_conversations" }, (payload) => {
        if (payload.eventType === "DELETE") {
          const id = (payload.old as { id?: string }).id;
          if (id) setConversations((prev) => prev.filter((c) => c.id !== id));
          return;
        }
        const row = payload.new as InboxConversation;
        setConversations((prev) => sortConversations([...prev.filter((c) => c.id !== row.id), row]));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "lead_memories" }, refreshProfile)
      .subscribe((status) => {
        const wasSubscribed = subscribed;
        subscribed = status === "SUBSCRIBED";
        // Catch anything missed while the socket was down.
        if (subscribed && !wasSubscribed) void resync();
      });

    const poll = setInterval(() => {
      if (!subscribed && document.visibilityState === "visible") void resync();
    }, 5000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void resync();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);

    return () => {
      cancelled = true;
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      supabase.removeChannel(channel);
    };
  }, [router]);

  // The chat that is open is being read, so new inbound messages in it never count as unread.
  const activeUnread = conversations.find((c) => c.id === activeId)?.unread_count ?? 0;
  useEffect(() => {
    if (activeId && activeUnread > 0) void markConversationRead(activeId);
  }, [activeId, activeUnread]);

  const liveConversation = conversations.find((c) => c.id === activeId) ?? thread?.conversation ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return conversations.filter((c) => {
      if (filter === "unread" && c.unread_count === 0) return false;
      if (filter === "needs_human" && !c.needs_human) return false;
      if (filter === "ai_paused" && c.ai_enabled) return false;
      if (!q) return true;
      return [c.contact_name ?? "", c.contact_phone ?? "", c.last_message_preview ?? ""].some((v) =>
        v.toLowerCase().includes(q),
      );
    });
  }, [conversations, query, filter]);

  function openConversation(conversation: InboxConversation) {
    if (conversation.unread_count > 0) void markConversationRead(conversation.id);
    router.push(`${pathname}?c=${conversation.id}`);
  }

  return (
    <div className="sticky top-0 flex h-full flex-col">
      <InboxToolbar agentConfigured={agentConfigured} autoReplyEnabled={autoReplyEnabled} webhook={webhook} />

      <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)_320px]">
        {/* Conversation list */}
        <aside className="flex min-h-0 flex-col border-r border-border/60">
          <div className="flex flex-col gap-2 p-3">
            <SearchField aria-label="Search conversations" value={query} onChange={setQuery}>
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input placeholder="Search…" />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
            <div className="flex flex-wrap gap-1">
              {FILTERS.map((f) => (
                <Button
                  key={f.id}
                  size="sm"
                  variant={filter === f.id ? "secondary" : "ghost"}
                  onPress={() => setFilter(f.id)}
                >
                  {f.label}
                </Button>
              ))}
            </div>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-muted">
                {conversations.length === 0
                  ? "No conversations yet. Messages to your WhatsApp number appear here once the webhook is connected."
                  : "No conversations match."}
              </li>
            ) : null}
            {filtered.map((c) => {
              const win = serviceWindow(c.last_inbound_at);
              return (
                <li key={c.id}>
                  <button
                    className={`flex w-full flex-col gap-0.5 border-b border-border/40 px-4 py-3 text-left transition-colors ${
                      c.id === activeId ? "bg-neutral-100" : "hover:bg-neutral-50"
                    }`}
                    onClick={() => openConversation(c)}
                    type="button"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`min-w-0 flex-1 truncate text-sm ${c.unread_count > 0 ? "font-semibold" : "font-medium"}`}>
                        {contactLabel(c)}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted">{timeLabel(c.last_message_at)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-xs text-muted">{c.last_message_preview ?? ""}</span>
                      {c.unread_count > 0 ? (
                        <span className="rounded-full bg-[#25d366] px-1.5 text-[10px] font-semibold text-white">
                          {c.unread_count}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {c.needs_human ? (
                        <Chip color="danger" size="sm" variant="soft">
                          Needs a person
                        </Chip>
                      ) : null}
                      {!c.ai_enabled ? (
                        <Chip size="sm" variant="soft">
                          AI paused
                        </Chip>
                      ) : null}
                      {win.open ? (
                        <Chip color="success" size="sm" variant="soft">
                          24h open
                        </Chip>
                      ) : null}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Thread */}
        <section className="flex min-h-0 flex-col">
          {thread && liveConversation ? (
            <ThreadPanel
              key={thread.conversation.id}
              autoReplyEnabled={autoReplyEnabled && agentConfigured}
              conversation={liveConversation}
              thread={thread}
            />
          ) : (
            <div className="m-auto text-sm text-muted">Select a conversation.</div>
          )}
        </section>

        {/* Contact profile */}
        <aside className="min-h-0 overflow-y-auto border-l border-border/60">
          {thread ? <ContactProfile key={thread.conversation.id} thread={thread} /> : null}
        </aside>
      </div>
    </div>
  );
}
