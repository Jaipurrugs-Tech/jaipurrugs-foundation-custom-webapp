"use client";

import { FileText } from "@gravity-ui/icons";
import { Chip } from "@heroui/react";
import { formatBytes, formatLabel, parseAttachments, type MessageAttachment } from "@/lib/whatsapp/attachments";

export type AttachmentUrls = Record<string, { view: string; download: string }>;

const KIND_ICON: Record<string, string> = { image: "🖼️", sticker: "🖼️", video: "🎥", audio: "🎵", file: "📄", other: "📎" };

/** "PDF · 1.2 MB" — the format is always shown, even when the file itself isn't available. */
function FormatLine({ att }: { att: MessageAttachment }) {
  const size = formatBytes(att.size);
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-neutral-500">
      <Chip size="sm" variant="soft" className="h-4 px-1.5 text-[10px] font-semibold">
        {formatLabel(att)}
      </Chip>
      {att.voice ? "Voice message" : null}
      {size ? <span>{size}</span> : null}
    </span>
  );
}

function Unavailable({ att }: { att: MessageAttachment }) {
  return (
    <div className="flex min-w-48 items-center gap-2 rounded-lg bg-black/5 px-3 py-2">
      <span className="text-lg">{KIND_ICON[att.type] ?? "📎"}</span>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-xs font-medium">{att.name}</span>
        <FormatLine att={att} />
        <span className="text-[11px] text-neutral-500">{att.error ?? "File is still being saved…"}</span>
      </div>
    </div>
  );
}

function AttachmentItem({ att, urls }: { att: MessageAttachment; urls: AttachmentUrls }) {
  const link = att.path ? urls[att.path] : undefined;
  if (!link) return <Unavailable att={att} />;

  if (att.type === "image" || att.type === "sticker") {
    return (
      <div className="flex flex-col gap-1">
        <a href={link.view} rel="noreferrer" target="_blank">
          {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not optimisable */}
          <img alt={att.name} className="max-h-72 max-w-full rounded-lg object-cover" loading="lazy" src={link.view} />
        </a>
        <div className="flex items-center justify-between gap-2">
          <FormatLine att={att} />
          <a className="text-[11px] text-accent hover:underline" href={link.download}>
            Download
          </a>
        </div>
      </div>
    );
  }

  if (att.type === "video") {
    return (
      <div className="flex flex-col gap-1">
        <video className="max-h-72 max-w-full rounded-lg" controls preload="metadata" src={link.view} />
        <div className="flex items-center justify-between gap-2">
          <FormatLine att={att} />
          <a className="text-[11px] text-accent hover:underline" href={link.download}>
            Download
          </a>
        </div>
      </div>
    );
  }

  if (att.type === "audio") {
    return (
      <div className="flex flex-col gap-1">
        <audio className="h-10 max-w-full" controls preload="metadata" src={link.view} />
        <div className="flex items-center justify-between gap-2">
          <FormatLine att={att} />
          <a className="text-[11px] text-accent hover:underline" href={link.download}>
            Download
          </a>
        </div>
      </div>
    );
  }

  // Documents: a card with the name and format, opens in a new tab (PDFs preview) or downloads.
  return (
    <div className="flex min-w-52 items-center gap-3 rounded-lg bg-black/5 px-3 py-2">
      <FileText className="size-6 shrink-0 text-neutral-500" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <a className="truncate text-xs font-medium hover:underline" href={link.view} rel="noreferrer" target="_blank" title={att.name}>
          {att.name}
        </a>
        <FormatLine att={att} />
      </div>
      <a className="shrink-0 text-[11px] text-accent hover:underline" href={link.download}>
        Download
      </a>
    </div>
  );
}

export function MessageAttachments({ attachments, urls }: { attachments: unknown; urls: AttachmentUrls }) {
  const items = parseAttachments(attachments);
  if (items.length === 0) return null;
  return (
    <div className="mb-1 flex flex-col gap-2">
      {items.map((att, i) => (
        <AttachmentItem key={`${att.path ?? att.name}-${i}`} att={att} urls={urls} />
      ))}
    </div>
  );
}
