"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, CircleExclamation, FileText, Paperclip, PaperPlane, Xmark } from "@gravity-ui/icons";
import { Button, Chip, Disclosure, Switch, TextArea, TextField, toast } from "@heroui/react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  getAttachmentUrls,
  getComposerTemplates,
  getThreadMessages,
  resolveHandoff,
  sendStaffAttachment,
  sendStaffMessage,
  setConversationAi,
  type InboxConversation,
  type InboxMessage,
  type InboxThread,
} from "@/lib/actions/inbox";
import { formatPhone } from "@/lib/mastra/phone";
import type { AgentTraceEntry } from "@/lib/mastra/types";
import {
  ACCEPTED_ATTACHMENT_TYPES,
  ATTACHMENT_ACCEPT,
  baseMime,
  formatBytes,
  MAX_IMAGE_BYTES,
  MAX_UPLOAD_BYTES,
  parseAttachments,
} from "@/lib/whatsapp/attachments";
import { formatRemaining, serviceWindow } from "@/lib/whatsapp/window";
import { traceFailed, traceSummary } from "../agent/tool-trace";
import { contactLabel } from "./inbox-view";
import { MessageAttachments, type AttachmentUrls } from "./message-attachments";
import { TemplateComposerModal, type ComposerTemplates } from "./template-composer-modal";

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function mergeMessages(current: InboxMessage[], incoming: InboxMessage[]) {
  if (incoming.length === 0) return current;
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.sent_at.localeCompare(b.sent_at) || a.id.localeCompare(b.id));
}

function dayLabel(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function StatusTicks({ message }: { message: InboxMessage }) {
  if (message.direction === "inbound") return null;
  if (message.status === "failed") return <span className="text-danger">failed</span>;
  if (message.status === "read") return <span className="text-[#53bdeb]">✓✓</span>;
  if (message.status === "delivered") return <span>✓✓</span>;
  if (message.status === "pending") return <span>🕓</span>;
  return <span>✓</span>;
}

function senderLabel(message: InboxMessage) {
  switch (message.sender_type) {
    case "agent":
      return "AI agent";
    case "staff":
      return message.sent_by ?? "Team";
    case "external":
      return "Sent outside the app";
    default:
      return null;
  }
}

function MessageBubble({ message, attachmentUrls }: { message: InboxMessage; attachmentUrls: AttachmentUrls }) {
  const outbound = message.direction === "outbound";
  const trace = Array.isArray(message.tool_trace) ? (message.tool_trace as unknown as AgentTraceEntry[]) : [];
  const label = senderLabel(message);
  const hasAttachments = parseAttachments(message.attachments).length > 0;

  return (
    <div className={`flex flex-col gap-0.5 ${outbound ? "items-end" : "items-start"}`}>
      {label ? <span className="px-1 text-[10px] text-neutral-500">{label}</span> : null}
      <div
        className={`max-w-[75%] rounded-xl px-3 py-2 text-sm shadow-sm ${
          outbound ? (message.sender_type === "agent" ? "bg-[#e7f6ff]" : "bg-[#d9fdd3]") : "bg-white"
        }`}
      >
        {message.kind === "template" ? (
          <div className="mb-1 flex items-center gap-1 text-[11px] text-neutral-500">
            <FileText className="size-3" /> Template{message.template_name ? ` · ${message.template_name}` : ""}
          </div>
        ) : null}
        {hasAttachments ? (
          <MessageAttachments attachments={message.attachments} urls={attachmentUrls} />
        ) : message.kind === "media" && !message.body ? (
          <span className="italic text-neutral-500">📎 Attachment</span>
        ) : null}
        {message.body ? <p className="whitespace-pre-wrap">{message.body}</p> : null}
        <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-neutral-500">
          {new Date(message.sent_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
          <StatusTicks message={message} />
        </div>
        {message.status === "failed" && message.error ? (
          <p className="mt-1 text-[11px] text-danger">{message.error}</p>
        ) : null}
      </div>
      {trace.length > 0 ? (
        <Disclosure className="max-w-[75%]">
          <Disclosure.Heading>
            <Disclosure.Trigger className="flex items-center gap-1 px-1 text-[11px] text-neutral-500">
              {trace.length} tool call{trace.length === 1 ? "" : "s"}
              <Disclosure.Indicator />
            </Disclosure.Trigger>
          </Disclosure.Heading>
          <Disclosure.Content>
            <Disclosure.Body className="flex flex-col gap-1 rounded-lg bg-white/80 p-2">
              {trace.map((t) => (
                <div key={t.toolCallId} className="flex items-center gap-2 text-[11px]">
                  <span className="font-mono">{t.toolName}</span>
                  <span className={traceFailed(t) ? "text-danger" : "text-neutral-500"}>{traceSummary(t)}</span>
                </div>
              ))}
            </Disclosure.Body>
          </Disclosure.Content>
        </Disclosure>
      ) : null}
    </div>
  );
}

export function ThreadPanel({
  thread,
  conversation,
  autoReplyEnabled,
  onBack,
}: {
  thread: InboxThread;
  /** The live row from the inbox list (falls back to the server-rendered one). */
  conversation: InboxConversation;
  autoReplyEnabled: boolean;
  /** Phones only: back from the open thread to the conversation list. */
  onBack?: () => void;
}) {
  const router = useRouter();
  const now = useNow(30_000);
  const win = serviceWindow(conversation.last_inbound_at, now);
  const [messages, setMessages] = useState(thread.messages);
  const [attachmentUrls, setAttachmentUrls] = useState(thread.attachmentUrls);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isTemplateOpen, setIsTemplateOpen] = useState(false);
  const [templates, setTemplates] = useState<ComposerTemplates>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const urlsRef = useRef(attachmentUrls);
  useEffect(() => {
    urlsRef.current = attachmentUrls;
  }, [attachmentUrls]);
  const conversationId = conversation.id;

  // A fresh server render (e.g. after a memory change) can only add to what we already show.
  const [seenThread, setSeenThread] = useState(thread);
  if (seenThread !== thread) {
    setSeenThread(thread);
    setMessages((prev) => mergeMessages(prev, thread.messages));
    setAttachmentUrls((prev) => ({ ...thread.attachmentUrls, ...prev }));
  }

  /** Pull the latest messages from the server and fold them in — no page reload. */
  const sync = useCallback(async () => {
    const result = await getThreadMessages(conversationId, Object.keys(urlsRef.current));
    if (!result) return;
    setMessages((prev) => mergeMessages(prev, result.messages));
    setAttachmentUrls((prev) => ({ ...prev, ...result.attachmentUrls }));
  }, [conversationId]);

  // Live messages: INSERT/UPDATE for this conversation (new texts, status ticks, finished uploads).
  // Falls back to polling while the socket is down, and re-syncs on reconnect / tab focus.
  useEffect(() => {
    const supabase = createClient();
    let subscribed = false;
    let cancelled = false;

    const channel = supabase
      .channel(`whatsapp-thread-${conversationId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const id = (payload.old as { id?: string }).id;
            if (id) setMessages((prev) => prev.filter((m) => m.id !== id));
            return;
          }
          const row = payload.new as InboxMessage;
          setMessages((prev) => mergeMessages(prev, [row]));
          const missing = parseAttachments(row.attachments).some((a) => a.path && !urlsRef.current[a.path]);
          if (missing) {
            void getAttachmentUrls(conversationId, [row.id], Object.keys(urlsRef.current)).then((urls) => {
              if (!cancelled) setAttachmentUrls((prev) => ({ ...prev, ...urls }));
            });
          }
        },
      )
      .subscribe((status) => {
        const was = subscribed;
        subscribed = status === "SUBSCRIBED";
        if (subscribed && !was) void sync();
      });

    const poll = setInterval(() => {
      if (!subscribed && document.visibilityState === "visible") void sync();
    }, 4000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);

    return () => {
      cancelled = true;
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      supabase.removeChannel(channel);
    };
  }, [conversationId, sync]);

  // Keep the newest message in view, unless the reader has scrolled up through history.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTo({ top: el.scrollHeight });
  }, [messages]);

  function handlePickFile(file: File | undefined) {
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;
    const accepted = ACCEPTED_ATTACHMENT_TYPES[baseMime(file.type)];
    if (!accepted) {
      toast.danger(`${file.name}: WhatsApp can't send this format. Use PDF, Word, Excel, PowerPoint, TXT, JPG, PNG, MP4, 3GP or an audio file.`);
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES || (accepted.kind === "image" && file.size > MAX_IMAGE_BYTES)) {
      toast.danger(`${file.name} is too large (limit ${accepted.kind === "image" ? "5" : "10"} MB).`);
      return;
    }
    setPendingFile(file);
  }

  async function handleSend() {
    const text = draft.trim();
    if (!text && !pendingFile) return;
    setIsSending(true);

    // The file goes first, then any text as its own message (WhatsApp shows them in that order).
    if (pendingFile) {
      const formData = new FormData();
      formData.set("file", pendingFile);
      const result = await sendStaffAttachment(conversation.id, formData);
      if (result.error) {
        setIsSending(false);
        toast.danger(result.error);
        return;
      }
      setPendingFile(null);
    }
    if (text) {
      const result = await sendStaffMessage(conversation.id, text);
      if (result.error) {
        setIsSending(false);
        toast.danger(result.error);
        return;
      }
      setDraft("");
    }
    setIsSending(false);
    stickToBottom.current = true;
    void sync();
  }

  async function openTemplates() {
    setTemplates(null);
    setIsTemplateOpen(true);
    setTemplates(await getComposerTemplates(conversation.id));
  }

  async function handleAiToggle(enabled: boolean) {
    const result = await setConversationAi(conversation.id, enabled);
    if (result.error) toast.danger(result.error);
    else router.refresh(); // soft re-render of server data; the live list also updates via realtime
  }

  async function handleResolve() {
    const result = await resolveHandoff(conversation.id);
    if (result.error) toast.danger(result.error);
    else router.refresh();
  }

  const aiActive = autoReplyEnabled && conversation.ai_enabled && !conversation.needs_human;

  return (
    <>
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border/60 px-3 py-3 md:px-5">
        {onBack ? (
          <Button isIconOnly aria-label="Back to conversations" className="md:hidden" size="sm" variant="ghost" onPress={onBack}>
            <ArrowLeft className="size-4" />
          </Button>
        ) : null}
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold">{contactLabel(conversation)}</span>
          <span className="text-xs text-muted">
            {conversation.contact_phone ? formatPhone(conversation.contact_phone) : "Username-only WhatsApp user (no number shared)"}
          </span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {win.open ? (
            <Chip color="success" size="sm" variant="soft">
              24h window open · {formatRemaining(win.remainingMs)} left
            </Chip>
          ) : (
            <Chip color="warning" size="sm" variant="soft">
              {conversation.last_inbound_at ? "24h window closed" : "Contact hasn't messaged yet"} · templates only
            </Chip>
          )}
          <Switch
            isDisabled={!conversation.contact_phone}
            isSelected={conversation.ai_enabled}
            onChange={handleAiToggle}
          >
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              AI replies {aiActive ? "on" : conversation.ai_enabled ? "(inactive)" : "paused"}
            </Switch.Content>
          </Switch>
        </div>
      </div>

      {conversation.needs_human ? (
        <div className="flex items-center gap-3 border-b border-danger/20 bg-danger/5 px-5 py-2 text-sm">
          <CircleExclamation className="size-4 shrink-0 text-danger" />
          <span className="min-w-0 flex-1">
            <span className="font-medium">The agent asked for a person:</span> {conversation.handoff_reason ?? "no reason given"}
          </span>
          <Button size="sm" variant="secondary" onPress={handleResolve}>
            Mark handled
          </Button>
        </div>
      ) : null}

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto bg-[#efeae2] px-5 py-4">
        {messages.length === 0 ? <p className="m-auto text-xs text-neutral-600">No messages yet.</p> : null}
        {messages.map((message, i) => {
          const showDay = i === 0 || dayLabel(messages[i - 1].sent_at) !== dayLabel(message.sent_at);
          return (
            <div key={message.id} className="flex flex-col gap-2">
              {showDay ? (
                <span className="self-center rounded-md bg-white/80 px-2 py-0.5 text-[11px] text-neutral-600 shadow-sm">
                  {dayLabel(message.sent_at)}
                </span>
              ) : null}
              <MessageBubble attachmentUrls={attachmentUrls} message={message} />
            </div>
          );
        })}
      </div>

      {/* Composer */}
      <div className="border-t border-border/60 bg-white px-4 py-3">
        {win.open ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
          >
            {pendingFile ? (
              <div className="flex items-center gap-2 self-start rounded-lg bg-default px-3 py-1.5 text-xs">
                <Paperclip className="size-3.5 shrink-0" />
                <span className="max-w-64 truncate font-medium">{pendingFile.name}</span>
                <Chip size="sm" variant="soft" className="h-4 px-1.5 text-[10px] font-semibold">
                  {ACCEPTED_ATTACHMENT_TYPES[baseMime(pendingFile.type)]?.label ?? "FILE"}
                </Chip>
                <span className="text-muted">{formatBytes(pendingFile.size)}</span>
                <button
                  aria-label="Remove attachment"
                  className="text-muted hover:text-foreground"
                  type="button"
                  onClick={() => setPendingFile(null)}
                >
                  <Xmark className="size-3.5" />
                </button>
              </div>
            ) : null}
            <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              accept={ATTACHMENT_ACCEPT}
              className="hidden"
              type="file"
              onChange={(e) => handlePickFile(e.target.files?.[0])}
            />
            <Button
              isIconOnly
              aria-label="Attach a file"
              isDisabled={isSending}
              variant="ghost"
              onPress={() => fileInputRef.current?.click()}
            >
              <Paperclip className="size-4" />
            </Button>
            <TextField aria-label="Reply" className="flex-1" value={draft} onChange={setDraft}>
              <TextArea
                placeholder={aiActive ? "Reply as a team member (pauses the AI for this chat)…" : "Type a reply…"}
                rows={2}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />
            </TextField>
            <Button
              isIconOnly
              aria-label="Send template"
              isDisabled={!conversation.contact_phone}
              variant="ghost"
              onPress={openTemplates}
            >
              <FileText className="size-4" />
            </Button>
            <Button
              isIconOnly
              aria-label="Send"
              isDisabled={!draft.trim() && !pendingFile}
              isPending={isSending}
              type="submit"
            >
              <PaperPlane className="size-4" />
            </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-sm text-muted">
              WhatsApp only allows free-form messages within 24 hours of the contact&apos;s last message. To restart the
              conversation, send an approved template.
            </p>
            <Button isDisabled={!conversation.contact_phone} onPress={openTemplates}>
              <FileText className="size-4" />
              Send a template
            </Button>
          </div>
        )}
      </div>

      <TemplateComposerModal
        conversationId={conversation.id}
        data={templates}
        isOpen={isTemplateOpen}
        onOpenChange={setIsTemplateOpen}
        onSent={() => {
          setIsTemplateOpen(false);
          stickToBottom.current = true;
          void sync();
        }}
      />
    </>
  );
}
