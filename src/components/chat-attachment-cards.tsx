import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ImageCarousel } from "@/components/image-carousel";
import { AuthedImage } from "@/components/ui/authed-image";
import { useAuthedImageState } from "@/lib/authed-image";
import { attachmentIcon, attachmentMediaKind, chatAttachmentSrc, type ChatAttachment } from "@/lib/chat-attachments";
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
  const imageSrc = chatAttachmentSrc(attachment);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // This component only mounts while open: trap Tab/Shift+Tab and restore the
  // chip trigger on dismissal, including Escape.
  useFocusTrap(true, dialogRef, { onEscape: onClose });
  // The transcript establishes containing blocks, so the preview must portal
  // to body for a viewport-sized fixed overlay. That places it in the root
  // stacking context next to the other portalled overlays, so it carries the
  // same z-index as the carousel lightbox and for the same reason — an
  // attachment expanded inside the message reader must not land under the
  // reader's scrim (cave-yin71).
  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-[var(--backdrop-scrim)] backdrop-blur-sm"
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
        {isImage && imageSrc ? (
          <div className="flex items-center justify-center overflow-hidden p-4">
            <AuthedImage src={imageSrc} alt={attachment.name} className="rounded-lg object-contain block [max-height:75vh]! [max-width:min(85vw,_100%)]! [width:auto]! [height:auto]!" />
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

/**
 * True when the attachment is an image we can actually show — either we still
 * hold the payload (the turn you just sent) or the server kept a durable copy
 * (a reopened transcript). An image with neither stays a chip.
 */
export function isInlineImageAttachment(attachment: ChatAttachment): boolean {
  return Boolean(
    (attachment.mimeType ?? attachment.type)?.startsWith("image/") &&
      chatAttachmentSrc(attachment),
  );
}

/**
 * True when the attachment is playable media we can actually mount — an
 * allowlisted audio/video mime with either an in-memory payload (the turn you
 * just sent) or a durable stored copy. Anything else stays a chip.
 */
export function isInlineMediaAttachment(attachment: ChatAttachment): boolean {
  return Boolean(attachmentMediaKind(attachment) && chatAttachmentSrc(attachment));
}

/**
 * One inline player. The stored copy lives behind `/api/chat/attachment`,
 * which the packaged sidecar gates on a header only the patched
 * `window.fetch` carries — a native `<video src="/api/…">` would 401
 * (cave-wgc2). So the bytes come through the shared authed fetch→blob cache;
 * a `blob:` source also gives WebKit free seeking, which the whole-file
 * serving route does not. Native controls only — no autoplay, no motion
 * until the user asks for it.
 */
function InlineMediaPlayer({ attachment }: { attachment: ChatAttachment }) {
  const kind = attachmentMediaKind(attachment);
  const { url, status } = useAuthedImageState(chatAttachmentSrc(attachment));
  if (!kind) return null;
  if (status === "error") return null;
  if (!url) {
    return (
      <div
        className="flex h-12 w-72 max-w-full items-center gap-2 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-3 text-[length:var(--text-xs)] text-[var(--text-muted)]"
        role="status"
        aria-label={`Loading ${attachment.name}`}
      >
        <Icon name={attachmentIcon(attachment)} width={13} className="shrink-0" />
        <span className="truncate">{attachment.name}</span>
      </div>
    );
  }
  if (kind === "audio") {
    return (
      <figure className="max-w-full">
        <figcaption className="mb-1 flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--text-muted)]">
          <Icon name="ph:waveform" width={12} className="shrink-0" />
          <span className="truncate">{attachment.name}</span>
        </figcaption>
        <audio controls preload="metadata" src={url} className="block w-80 max-w-full" aria-label={attachment.name} />
      </figure>
    );
  }
  return (
    <figure className="max-w-full overflow-hidden rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40">
      <video controls preload="metadata" src={url} className="block max-h-80 max-w-full" aria-label={attachment.name} />
      <figcaption className="flex items-center gap-1.5 px-3 py-1.5 text-[length:var(--text-xs)] text-[var(--text-muted)]">
        <Icon name="ph:video" width={12} className="shrink-0" />
        <span className="truncate">{attachment.name}</span>
        <span className="ml-auto shrink-0">{formatAttachmentBytes(attachment.size)}</span>
      </figcaption>
    </figure>
  );
}

/**
 * Full-bleed inline players for audio/video attachments — a familiar's
 * generated teaser mp4, a user's voice memo — mirroring how
 * {@link InlineImageAttachments} mounts pictures. Attachments that fail the
 * media allowlist (or hold no payload) stay in the chip list instead.
 */
export function InlineMediaAttachments({ attachments }: { attachments: ChatAttachment[] }) {
  const media = attachments.filter(isInlineMediaAttachment);
  if (media.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-2">
      {media.map((attachment, index) => (
        <InlineMediaPlayer key={`${attachment.name}-${index}`} attachment={attachment} />
      ))}
    </div>
  );
}

/**
 * Chip-sized preview of a staged attachment: the picture itself for an image
 * we hold pixels for, the mime glyph otherwise. Used by the composer so an
 * attached image is recognizable before it is sent, rather than a filename.
 */
export function AttachmentThumb({ attachment }: { attachment: ChatAttachment }) {
  const glyph = <Icon name={attachmentIcon(attachment)} width={12} className="shrink-0" />;
  if (!isInlineImageAttachment(attachment)) return glyph;
  return (
    <AuthedImage
      src={chatAttachmentSrc(attachment)}
      alt=""
      aria-hidden
      fallback={glyph}
      className="h-5 w-5 shrink-0 rounded-sm border border-[var(--border-hairline)] object-cover"
    />
  );
}

/**
 * Full-bleed inline rendering for image attachments (a familiar's /image
 * generations, a user's pasted screenshots). One picture renders bounded in
 * place; TWO OR MORE route through the shared {@link ImageCarousel} so a batch
 * is browsable instead of a ragged wrap of thumbnails — the same deck
 * `<coven:image>` markers mount.
 */
export function InlineImageAttachments({ attachments }: { attachments: ChatAttachment[] }) {
  const [selected, setSelected] = useState<ChatAttachment | null>(null);
  const images = attachments.filter(isInlineImageAttachment);
  if (images.length === 0) return null;
  if (images.length > 1) {
    return (
      <ImageCarousel
        images={images.map((attachment) => ({
          // isInlineImageAttachment already proved there are pixels here.
          src: chatAttachmentSrc(attachment) as string,
          alt: attachment.name,
        }))}
        label={`${images.length} images`}
      />
    );
  }
  return (
    <>
      <div className="mt-2 flex flex-wrap gap-2">
        {images.map((attachment, index) => (
          <button
            type="button"
            key={`${attachment.name}-${index}`}
            className="block max-w-full cursor-zoom-in overflow-hidden rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 p-0 transition-colors hover:border-[var(--accent-presence)]/40"
            title={`View ${attachment.name}`}
            onClick={() => setSelected(attachment)}
          >
            <AuthedImage
              src={chatAttachmentSrc(attachment)}
              alt={attachment.name}
              loading="lazy"
              className="block max-h-80 max-w-full object-contain"
            />
          </button>
        ))}
      </div>
      {selected ? <AttachmentLightbox attachment={selected} onClose={() => setSelected(null)} /> : null}
    </>
  );
}
