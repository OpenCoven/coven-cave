import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { attachmentIcon, type ChatAttachment } from "@/lib/chat-attachments";
import { Icon } from "@/lib/icon";
import { useFocusTrap } from "@/lib/use-focus-trap";

export function formatAttachmentBytes(size?: number): string {
  if (size == null) return "unknown";
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  for (const unit of units) {
    if (value < 1024 || unit === "GB") return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
    value /= 1024;
  }
  return `${size} B`;
}

function AttachmentLightbox({ attachment, onClose }: { attachment: ChatAttachment; onClose: () => void }) {
  const isImage = (attachment.mimeType ?? attachment.type)?.startsWith("image/");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // This component only mounts while open: trap Tab/Shift+Tab and restore the
  // chip trigger on dismissal, including Escape.
  useFocusTrap(true, dialogRef, { onEscape: onClose });
  // The transcript establishes containing blocks, so the preview must portal
  // to body for a viewport-sized fixed overlay.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="relative max-h-[90vh] w-[90vw] max-w-screen-2xl overflow-hidden rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-base)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Preview ${attachment.name}`}
        tabIndex={-1}
      >
        <div className="flex items-center gap-2 border-b border-[var(--border-hairline)]/60 px-4 py-2.5">
          <Icon name={attachmentIcon(attachment)} width={13} className="shrink-0 text-[var(--text-muted)]" />
          <span className="flex-1 truncate text-[length:var(--text-sm)] text-[var(--text-secondary)]">{attachment.name}</span>
          <span className="shrink-0 text-[length:var(--text-xs)] text-[var(--text-muted)]">{formatAttachmentBytes(attachment.size)}</span>
          {attachment.truncated ? <span className="shrink-0 rounded bg-[color-mix(in_oklch,var(--color-warning)_40%,transparent)] px-1.5 py-0.5 text-[length:var(--text-2xs)] text-[var(--color-warning)]">truncated</span> : null}
          <button
            type="button"
            onClick={onClose}
            className="ml-2 flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)]/60 hover:text-[var(--text-primary)]"
            aria-label="Close"
          >
            <Icon name="ph:x-bold" width={11} />
          </button>
        </div>
        {isImage && attachment.dataUrl ? (
          <div className="flex items-center justify-center overflow-hidden p-4">
            <img src={attachment.dataUrl} alt={attachment.name} className="rounded-lg object-contain block [max-height:75vh]! [max-width:min(85vw,_100%)]! [width:auto]! [height:auto]!" />
          </div>
        ) : attachment.text ? (
          <pre className="max-h-[70vh] overflow-auto p-4 font-mono text-[length:var(--text-sm)] leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap">{attachment.text}</pre>
        ) : (
          <div className="flex flex-col items-center gap-3 px-8 py-10 text-[var(--text-muted)]">
            <Icon name="ph:file-code" width={32} />
            <span className="text-[length:var(--text-base)]">No preview available</span>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function AttachmentList({ attachments }: { attachments: ChatAttachment[] }) {
  const [selected, setSelected] = useState<ChatAttachment | null>(null);
  return (
    <>
      <div className="mt-2 flex flex-wrap justify-end gap-1.5">
        {attachments.map((attachment, index) => (
          <button
            type="button"
            key={`${attachment.name}-${index}`}
            className="inline-flex max-w-72 cursor-pointer items-center gap-1.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-2 py-1 text-[length:var(--text-xs)] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-presence)]/40 hover:bg-[var(--bg-raised)]/70"
            title={`View ${attachment.name}`}
            onClick={() => setSelected(attachment)}
          >
            <Icon name={attachmentIcon(attachment)} width={12} className="shrink-0 text-[var(--text-muted)]" />
            <span className="truncate">{attachment.name}</span>
            <span className="shrink-0 text-[var(--text-muted)]">{formatAttachmentBytes(attachment.size)}</span>
            {attachment.truncated ? <span className="shrink-0 text-[var(--text-muted)]">truncated</span> : null}
          </button>
        ))}
      </div>
      {selected ? <AttachmentLightbox attachment={selected} onClose={() => setSelected(null)} /> : null}
    </>
  );
}
