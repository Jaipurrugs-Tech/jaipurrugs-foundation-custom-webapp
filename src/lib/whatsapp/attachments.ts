// Attachment shape stored in whatsapp_messages.attachments, plus the helpers
// that turn it into something staff can read ("PDF · 1.2 MB"). Client-safe.

export type AttachmentKind = "image" | "video" | "audio" | "file" | "sticker" | "other";

export interface MessageAttachment {
  type: AttachmentKind;
  mimeType: string | null;
  /** Display file name (always set; synthesised when WhatsApp didn't send one). */
  name: string;
  size: number | null;
  /** Object path in the private `inbox-media` bucket. Null when the file couldn't be saved. */
  path: string | null;
  /** True for WhatsApp voice notes. */
  voice?: boolean;
  /** Why the file isn't available (e.g. Meta already deleted it). */
  error?: string;
}

export const INBOX_MEDIA_BUCKET = "inbox-media";

/** WhatsApp Cloud API limits, tightened to what a server action can carry (next.config bodySizeLimit 10mb). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** MIME types WhatsApp accepts as documents, images, video and audio. */
export const ACCEPTED_ATTACHMENT_TYPES: Record<string, { kind: Exclude<AttachmentKind, "sticker" | "other">; label: string }> = {
  "image/jpeg": { kind: "image", label: "JPG" },
  "image/png": { kind: "image", label: "PNG" },
  "video/mp4": { kind: "video", label: "MP4" },
  "video/3gpp": { kind: "video", label: "3GP" },
  "audio/aac": { kind: "audio", label: "AAC" },
  "audio/mp4": { kind: "audio", label: "M4A" },
  "audio/mpeg": { kind: "audio", label: "MP3" },
  "audio/amr": { kind: "audio", label: "AMR" },
  "audio/ogg": { kind: "audio", label: "OGG" },
  "application/pdf": { kind: "file", label: "PDF" },
  "application/msword": { kind: "file", label: "DOC" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { kind: "file", label: "DOCX" },
  "application/vnd.ms-excel": { kind: "file", label: "XLS" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { kind: "file", label: "XLSX" },
  "application/vnd.ms-powerpoint": { kind: "file", label: "PPT" },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { kind: "file", label: "PPTX" },
  "text/plain": { kind: "file", label: "TXT" },
};

/** Value for <input accept>. */
export const ATTACHMENT_ACCEPT = Object.keys(ACCEPTED_ATTACHMENT_TYPES).join(",");

/** Labels for formats we receive but don't let staff send. */
const EXTRA_LABELS: Record<string, string> = {
  "image/webp": "WEBP",
  "image/gif": "GIF",
  "audio/opus": "OPUS",
  "audio/x-m4a": "M4A",
  "video/quicktime": "MOV",
  "text/csv": "CSV",
  "application/zip": "ZIP",
  "application/json": "JSON",
  "application/vnd.oasis.opendocument.text": "ODT",
};

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "video/quicktime": "mov",
  "audio/aac": "aac",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/amr": "amr",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/zip": "zip",
};

export function baseMime(mime: string | null | undefined): string {
  return (mime ?? "").split(";")[0].trim().toLowerCase();
}

export function extensionFor(mime: string | null | undefined): string | null {
  return EXTENSION_BY_MIME[baseMime(mime)] ?? null;
}

export function kindFromMime(mime: string | null | undefined): AttachmentKind {
  const base = baseMime(mime);
  if (base === "image/webp") return "image";
  if (base.startsWith("image/")) return "image";
  if (base.startsWith("video/")) return "video";
  if (base.startsWith("audio/")) return "audio";
  return base ? "file" : "other";
}

/** Short upper-case format label for the chip, e.g. "PDF", "JPG", "DOCX". */
export function formatLabel(att: Pick<MessageAttachment, "mimeType" | "name" | "type">): string {
  const base = baseMime(att.mimeType);
  const known = ACCEPTED_ATTACHMENT_TYPES[base]?.label ?? EXTRA_LABELS[base];
  if (known) return known;
  const ext = att.name.includes(".") ? att.name.split(".").pop() : null;
  if (ext && /^[a-z0-9]{1,5}$/i.test(ext)) return ext.toUpperCase();
  if (base.includes("/")) return base.split("/")[1].replace(/^x-/, "").slice(0, 5).toUpperCase();
  return att.type === "other" ? "FILE" : att.type.toUpperCase();
}

export function formatBytes(bytes: number | null | undefined): string | null {
  if (bytes == null || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Defensive parse of the jsonb column (older rows only have type/mimeType). */
export function parseAttachments(value: unknown): MessageAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw, i) => {
    if (typeof raw !== "object" || raw === null) return [];
    const a = raw as Record<string, unknown>;
    const mimeType = typeof a.mimeType === "string" ? a.mimeType : null;
    const type = (["image", "video", "audio", "file", "sticker"] as const).find((t) => t === a.type) ?? kindFromMime(mimeType);
    const ext = extensionFor(mimeType);
    return [
      {
        type,
        mimeType,
        name: typeof a.name === "string" && a.name ? a.name : `${type}-${i + 1}${ext ? `.${ext}` : ""}`,
        size: typeof a.size === "number" ? a.size : null,
        path: typeof a.path === "string" ? a.path : null,
        voice: a.voice === true ? true : undefined,
        error: typeof a.error === "string" ? a.error : undefined,
      },
    ];
  });
}

/** Chat-list preview, e.g. "📎 PDF" or "🖼️ JPG". */
export function attachmentPreview(attachments: MessageAttachment[]): string {
  if (attachments.length === 0) return "📎 Attachment";
  const first = attachments[0];
  const icon = first.voice ? "🎤" : first.type === "image" || first.type === "sticker" ? "🖼️" : first.type === "video" ? "🎥" : first.type === "audio" ? "🎵" : "📎";
  const label = first.voice ? "Voice message" : formatLabel(first);
  return attachments.length > 1 ? `${icon} ${attachments.length} attachments` : `${icon} ${label}`;
}

/** Strip path separators and control characters from a user-supplied file name. */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/]/g, "_").replace(/[^\w.\- ()]+/g, "_").trim();
  return cleaned.slice(-120) || "file";
}
