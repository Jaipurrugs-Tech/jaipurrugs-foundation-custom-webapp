import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhone } from "@/lib/mastra/phone";
import type { Database, Json, Tables } from "@/lib/types/supabase";
import {
  attachmentPreview,
  baseMime,
  extensionFor,
  INBOX_MEDIA_BUCKET,
  kindFromMime,
  parseAttachments,
  safeFileName,
  type MessageAttachment,
} from "@/lib/whatsapp/attachments";
import { downloadWhatsAppMedia } from "@/lib/zernio/client";

// Turns Zernio inbox webhooks into whatsapp_conversations / whatsapp_messages
// rows. Runs with the service-role client (webhooks carry no user session).
// See https://docs.zernio.com/webhooks/inbox

type Admin = SupabaseClient<Database>;
type Rec = Record<string, unknown>;
type Conversation = Tables<"whatsapp_conversations">;

const PREVIEW_LENGTH = 120;

/** X-Zernio-Signature: lowercase hex HMAC-SHA256 of the raw body. Constant-time compare. */
export function verifyZernioSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(signature.trim().toLowerCase(), "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function rec(value: unknown): Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Rec) : {};
}
function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * The contact's number, if Zernio has one. Prefers the explicit E.164
 * `phoneNumber`; otherwise `sender.id` / `participantId`, which on WhatsApp
 * are the digits without "+" — accepted only if they normalise to a phone.
 */
function contactPhone(sender: Rec, conversation: Rec): string | null {
  const explicit = str(sender.phoneNumber);
  if (explicit && normalizePhone(explicit)) return explicit;
  for (const candidate of [str(sender.id), str(conversation.participantId)]) {
    if (candidate && /^\+?\d{8,15}$/.test(candidate)) return candidate.startsWith("+") ? candidate : `+${candidate}`;
  }
  return null;
}

function messageKind(message: Rec, metadata: Rec): "text" | "media" | "interactive" | "template" | "other" {
  if (rec(message.metaInteractive).template || str(message.templateName)) return "template";
  if (Array.isArray(message.attachments) && message.attachments.length > 0) return "media";
  if (metadata.interactiveType) return "interactive";
  return str(message.text) ? "text" : "other";
}

/** What Zernio told us about each attachment; `url` is used once, to download, and never stored. */
interface InboundAttachment {
  meta: MessageAttachment;
  url: string | null;
}

function inboundAttachments(message: Rec): InboundAttachment[] {
  if (!Array.isArray(message.attachments)) return [];
  return message.attachments.map((a, i) => {
    const att = rec(a);
    const payload = rec(att.payload);
    const mimeType = str(att.mimeType);
    const zernioType = str(att.type);
    const type =
      zernioType === "image" || zernioType === "video" || zernioType === "audio" || zernioType === "file" || zernioType === "sticker"
        ? zernioType
        : kindFromMime(mimeType);
    const name = str(payload.filename) ?? str(att.filename) ?? str(att.name);
    const ext = extensionFor(mimeType);
    const url = str(att.url);
    return {
      url,
      meta: {
        type,
        mimeType,
        name: safeFileName(name ?? `${type}-${i + 1}${ext ? `.${ext}` : ""}`),
        size: null,
        path: null,
        voice: payload.voice === true ? true : undefined,
        ...(url ? {} : { error: "WhatsApp didn't include a download link for this file." }),
      },
    };
  });
}

/** Where a media URL points, without any query string, for logs. */
function describeUrl(url: string) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "(unparseable url)";
  }
}

function previewOf(kind: string, body: string | null, attachments: MessageAttachment[]) {
  if (body) return body.slice(0, PREVIEW_LENGTH);
  return kind === "media" ? attachmentPreview(attachments) : kind === "template" ? "Template message" : "Message";
}

export interface InboundMediaJob {
  messageId: string;
  accountId: string;
  items: { index: number; url: string }[];
}

/**
 * Copy an inbound message's files into the private inbox-media bucket. Runs after
 * the webhook has answered (Zernio's 5 s limit), because Meta deletes the bytes
 * after ~7 days and the Zernio URL needs our API key — so we can't link to it.
 * Failures are recorded on the attachment so the UI can say why it's missing.
 */
export async function saveInboundMedia(admin: Admin, job: InboundMediaJob): Promise<void> {
  const { data: row } = await admin
    .from("whatsapp_messages")
    .select("conversation_id, attachments")
    .eq("id", job.messageId)
    .maybeSingle();
  if (!row) return;

  const attachments = parseAttachments(row.attachments);
  await Promise.all(
    job.items.map(async ({ index, url }) => {
      const att = attachments[index];
      if (!att) return;

      let result = await downloadWhatsAppMedia(url, job.accountId);
      // 502s and timeouts are worth one more try; a 400 is Meta having deleted the file.
      if (!result.success && !result.permanent) result = await downloadWhatsAppMedia(url, job.accountId);

      if (!result.success) {
        console.error(`[inbox media] download failed for message ${job.messageId}: ${result.error} — ${describeUrl(url)}`);
        att.error = result.error;
        return;
      }

      const mimeType = baseMime(result.contentType) || att.mimeType;
      const ext = extensionFor(mimeType);
      // Fix up a synthesised name now that the real content type is known.
      const name = !att.name.includes(".") && ext ? `${att.name}.${ext}` : att.name;
      const path = `${row.conversation_id}/${crypto.randomUUID()}-${name}`;

      const { error } = await admin.storage
        .from(INBOX_MEDIA_BUCKET)
        .upload(path, result.bytes, { contentType: mimeType || "application/octet-stream", upsert: false });
      if (error) {
        console.error(`[inbox media] storage upload failed for message ${job.messageId}: ${error.message}`);
        att.error = "Could not save the file.";
        return;
      }
      att.mimeType = mimeType || att.mimeType;
      att.name = name;
      att.size = result.bytes.byteLength;
      att.path = path;
      delete att.error;
    }),
  );

  await admin
    .from("whatsapp_messages")
    .update({ attachments: attachments as unknown as Json })
    .eq("id", job.messageId);
}

async function findOrCreateConversation(admin: Admin, payload: Rec, message: Rec): Promise<Conversation | null> {
  const conversation = rec(payload.conversation);
  const sender = rec(message.sender);
  const zernioConversationId = str(message.conversationId) ?? str(conversation.id);
  const accountId = str(rec(payload.account).accountId) ?? str(rec(payload.account).id) ?? str(conversation.accountId);
  if (!zernioConversationId || !accountId) return null;

  const isIncoming = message.direction === "incoming";
  const phone = isIncoming ? contactPhone(sender, conversation) : contactPhone({}, conversation);
  const name = (isIncoming ? str(sender.name) : null) ?? str(conversation.participantName);
  const bsuid = (isIncoming ? str(sender.businessScopedUserId) : null) ?? str(conversation.businessScopedUserId);

  const { data: existing } = await admin
    .from("whatsapp_conversations")
    .select("*")
    .eq("zernio_conversation_id", zernioConversationId)
    .maybeSingle();

  if (existing) {
    const patch: Partial<Conversation> = {};
    if (phone && !existing.contact_phone) patch.contact_phone = phone;
    if (name && name !== existing.contact_name) patch.contact_name = name;
    if (bsuid && !existing.contact_bsuid) patch.contact_bsuid = bsuid;
    if (Object.keys(patch).length === 0) return existing;
    const { data } = await admin.from("whatsapp_conversations").update(patch).eq("id", existing.id).select("*").single();
    return data ?? existing;
  }

  const { data: created } = await admin
    .from("whatsapp_conversations")
    .upsert(
      {
        zernio_conversation_id: zernioConversationId,
        zernio_account_id: accountId,
        contact_phone: phone,
        contact_name: name,
        contact_bsuid: bsuid,
      },
      { onConflict: "zernio_conversation_id" },
    )
    .select("*")
    .single();
  return created ?? null;
}

/**
 * The contact's lead, matched by normalised phone — the same deterministic
 * rule (last 10 digits) used everywhere else. Created on first contact.
 */
async function ensureLead(admin: Admin, conversation: Conversation): Promise<string | null> {
  if (conversation.lead_id) return conversation.lead_id;
  if (!conversation.contact_phone_normalized || !conversation.contact_phone) return null;

  const { data: found } = await admin
    .from("leads")
    .select("id")
    .eq("phone_normalized", conversation.contact_phone_normalized)
    .maybeSingle();

  let leadId = found?.id ?? null;
  if (!leadId) {
    const { data: created } = await admin
      .from("leads")
      .upsert(
        { phone: conversation.contact_phone, name: conversation.contact_name, source: "whatsapp_agent" },
        { onConflict: "phone_normalized", ignoreDuplicates: true },
      )
      .select("id")
      .maybeSingle();
    leadId = created?.id ?? null;
    if (!leadId) {
      const { data: raced } = await admin
        .from("leads")
        .select("id")
        .eq("phone_normalized", conversation.contact_phone_normalized)
        .maybeSingle();
      leadId = raced?.id ?? null;
    }
  }

  if (leadId) await admin.from("whatsapp_conversations").update({ lead_id: leadId }).eq("id", conversation.id);
  return leadId;
}

export interface IngestResult {
  /** Set when an inbound message should get an automatic agent reply. */
  replyTo?: { conversationId: string; messageId: string };
  /** Set when an inbound message carries files to copy into storage (run after responding). */
  media?: InboundMediaJob;
}

async function ingestMessage(admin: Admin, payload: Rec): Promise<IngestResult> {
  const message = rec(payload.message);
  if (message.platform !== "whatsapp") return {};

  const conversation = await findOrCreateConversation(admin, payload, message);
  if (!conversation) return {};

  const metadata = rec(payload.metadata ?? message.metadata);
  const isIncoming = message.direction === "incoming";
  const platformMessageId = str(message.platformMessageId);
  const sentAt = str(message.sentAt) ?? new Date().toISOString();
  const kind = messageKind(message, metadata);
  const body = str(message.text);
  const inbound = inboundAttachments(message);
  const attachments = inbound.map((a) => a.meta);

  // Our own sends are inserted when we send them; Zernio's message.sent echo
  // then only confirms the row (matched on the wamid).
  if (!isIncoming && platformMessageId) {
    const { data: ours } = await admin
      .from("whatsapp_messages")
      .select("id, status")
      .eq("platform_message_id", platformMessageId)
      .maybeSingle();
    if (ours) {
      if (ours.status === "pending") {
        await admin.from("whatsapp_messages").update({ status: "sent" }).eq("id", ours.id);
      }
      return {};
    }
  }

  const { data: inserted } = await admin
    .from("whatsapp_messages")
    .upsert(
      {
        conversation_id: conversation.id,
        platform_message_id: platformMessageId,
        zernio_message_id: str(message.id),
        direction: isIncoming ? "inbound" : "outbound",
        sender_type: isIncoming ? "contact" : "external",
        kind,
        body,
        template_name: str(message.templateName),
        attachments: attachments as unknown as Json,
        status: isIncoming ? "received" : "sent",
        sent_at: sentAt,
      },
      { onConflict: "platform_message_id", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();

  // Duplicate delivery of a message we already have: nothing more to do.
  if (!inserted) return {};

  const isNewer = !conversation.last_message_at || sentAt >= conversation.last_message_at;
  await admin
    .from("whatsapp_conversations")
    .update({
      ...(isNewer ? { last_message_at: sentAt, last_message_preview: previewOf(kind, body, attachments) } : {}),
      ...(isIncoming
        ? {
            last_inbound_at:
              !conversation.last_inbound_at || sentAt > conversation.last_inbound_at ? sentAt : conversation.last_inbound_at,
            unread_count: conversation.unread_count + 1,
          }
        : {}),
    })
    .eq("id", conversation.id);

  // Outbound files sent from the WhatsApp Business app / Zernio dashboard are saved too.
  const items = inbound.flatMap((a, index) => (a.url ? [{ index, url: a.url }] : []));
  const media: InboundMediaJob | undefined =
    items.length > 0 ? { messageId: inserted.id, accountId: conversation.zernio_account_id, items } : undefined;

  if (!isIncoming) return { media };

  await ensureLead(admin, conversation);

  // Meta Business Agent is answering this one on Meta's side; replying too
  // would take the conversation away from it.
  if (metadata.standby === true) return { media };

  return { replyTo: { conversationId: conversation.id, messageId: inserted.id }, media };
}

const STATUS_BY_EVENT: Record<string, "delivered" | "read" | "failed"> = {
  "message.delivered": "delivered",
  "message.read": "read",
  "message.failed": "failed",
};
const STATUS_RANK: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3 };

async function ingestStatus(admin: Admin, payload: Rec, status: "delivered" | "read" | "failed") {
  const platformMessageId = str(rec(payload.message).platformMessageId);
  if (!platformMessageId) return;

  const { data: row } = await admin
    .from("whatsapp_messages")
    .select("id, status")
    .eq("platform_message_id", platformMessageId)
    .maybeSingle();
  if (!row) return;

  // Statuses can arrive out of order; never move "read" back to "delivered".
  if (status !== "failed" && (STATUS_RANK[row.status] ?? 0) >= STATUS_RANK[status]) return;

  const error = rec(payload.error);
  await admin
    .from("whatsapp_messages")
    .update({
      status,
      ...(status === "failed" ? { error: str(error.message) ?? str(error.title) ?? "Delivery failed" } : {}),
    })
    .eq("id", row.id);
}

/**
 * Process one webhook delivery exactly once. Returns null for a duplicate
 * (Zernio retries with the same event id until it gets a 2xx).
 */
export async function ingestZernioEvent(admin: Admin, payload: Rec): Promise<IngestResult | null> {
  const eventId = str(payload.id);
  const event = str(payload.event) ?? "unknown";
  if (!eventId) return {};

  const { data: claimed } = await admin
    .from("zernio_webhook_events")
    .upsert({ event_id: eventId, event }, { onConflict: "event_id", ignoreDuplicates: true })
    .select("event_id")
    .maybeSingle();
  if (!claimed) return null;

  try {
    let result: IngestResult = {};
    if (event === "message.received" || event === "message.sent") {
      result = await ingestMessage(admin, payload);
    } else if (STATUS_BY_EVENT[event]) {
      await ingestStatus(admin, payload, STATUS_BY_EVENT[event]);
    }
    await admin.from("zernio_webhook_events").update({ processed_at: new Date().toISOString() }).eq("event_id", eventId);
    return result;
  } catch (err) {
    // Release the claim so Zernio's retry (triggered by our non-2xx) runs it again.
    await admin.from("zernio_webhook_events").delete().eq("event_id", eventId);
    throw err;
  }
}
