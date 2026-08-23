"use client";

/**
 * Image carousel — the one component chat uses to show pictures.
 *
 * Familiars drive it with `<coven:image …>` markers (src/lib/image-blocks.ts);
 * user turns with several image attachments route their pictures through the
 * same deck. A single image renders as one bounded picture with no chrome —
 * the carousel affordances only appear once there is something to browse.
 *
 * Behaviour that is deliberate, not incidental:
 * - Pictures load through `AuthedImage` so the packaged sidecar's `/api/` auth
 *   gate is satisfied (see src/lib/authed-image.ts).
 * - The picture change only animates when the user has not asked for reduced
 *   motion; under `reduce` the change is instant.
 * - Arrow keys move the deck when focus is inside it, and the same keys work
 *   in the lightbox, which traps focus and returns it on dismiss.
 * - Slide changes are announced politely through a local live region rather
 *   than the app announcer, so the card works anywhere it is mounted.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { AuthedImage } from "@/components/ui/authed-image";
import { Icon } from "@/lib/icon";
import { imageLabel, type ImageBlockDescriptor } from "@/lib/image-blocks";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { useFocusTrap } from "@/lib/use-focus-trap";

type Props = {
  images: ImageBlockDescriptor[];
  /** Accessible name for the whole deck, e.g. "Images from Cody". */
  label?: string;
};

function clampIndex(index: number, total: number): number {
  if (total <= 0) return 0;
  return ((index % total) + total) % total;
}

function ImageLightbox({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: ImageBlockDescriptor[];
  index: number;
  onIndex: (next: number) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(true, dialogRef, { onEscape: onClose });
  const image = images[index];
  const total = images.length;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (total < 2) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        onIndex(clampIndex(index + 1, total));
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        onIndex(clampIndex(index - 1, total));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, total, onIndex]);

  if (!image) return null;

  // The transcript establishes containing blocks, so a viewport-sized fixed
  // overlay has to portal to body (same reason as the attachment lightbox).
  // Portalling puts this in the ROOT stacking context, alongside every other
  // portalled overlay, so the z-index competes with them directly. It has to
  // clear the surfaces an image can be expanded from underneath: the message
  // reader backdrop (60), the research-studio backdrops (65-70), the research
  // reader (70), and .rr-kroverlay / the daily-report PR modal (80). At z-50 an
  // image expanded inside the reader rendered BEHIND the reader's scrim
  // (cave-yin71). Kept below the full-surface layers that should still cover a
  // lightbox — inspector-pane (100) and directory-picker-modal (200).
  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-[var(--backdrop-scrim)] backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="relative flex max-h-[90vh] w-[90vw] max-w-screen-2xl flex-col overflow-hidden rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-base)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={imageLabel(image, index, total)}
        tabIndex={-1}
      >
        <div className="flex items-center gap-2 border-b border-[var(--border-hairline)]/60 px-4 py-2.5">
          <Icon name="ph:image-bold" width={13} className="shrink-0 text-[var(--text-muted)]" />
          <span className="flex-1 truncate text-[length:var(--text-sm)] text-[var(--text-secondary)]">
            {image.caption || image.alt || "Image"}
          </span>
          {total > 1 ? (
            <span className="shrink-0 tabular-nums text-[length:var(--text-xs)] text-[var(--text-muted)]">
              {index + 1} / {total}
            </span>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="focus-ring ml-2 flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)]/60 hover:text-[var(--text-primary)]"
            aria-label="Close"
          >
            <Icon name="ph:x-bold" width={11} />
          </button>
        </div>
        <div className="flex flex-1 items-center justify-center overflow-hidden p-4">
          {total > 1 ? (
            <button
              type="button"
              onClick={() => onIndex(clampIndex(index - 1, total))}
              className="focus-ring mr-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border-hairline)] bg-[var(--bg-raised)]/70 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
              aria-label="Previous image"
            >
              <Icon name="ph:caret-left" width={14} />
            </button>
          ) : null}
          <AuthedImage
            src={image.src}
            alt={imageLabel(image, index, total)}
            fallback={
              <span className="flex h-40 w-full items-center justify-center text-[var(--text-muted)]">
                <Icon name="ph:image-bold" width={24} />
              </span>
            }
            className="rounded-lg object-contain block [max-height:75vh]! [max-width:min(85vw,_100%)]! [width:auto]! [height:auto]!"
          />
          {total > 1 ? (
            <button
              type="button"
              onClick={() => onIndex(clampIndex(index + 1, total))}
              className="focus-ring ml-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border-hairline)] bg-[var(--bg-raised)]/70 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
              aria-label="Next image"
            >
              <Icon name="ph:caret-right" width={14} />
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function ImageCarousel({ images, label }: Props) {
  const [index, setIndex] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const slideRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const reducedMotion = usePrefersReducedMotion();
  const trackId = useId();
  const total = images.length;
  const safeIndex = clampIndex(index, total);

  // A shorter deck (a re-render with fewer images) must not strand the view on
  // a slide that no longer exists.
  useEffect(() => {
    setIndex((current) => clampIndex(current, total));
  }, [total]);

  const go = useCallback(
    (next: number) => setIndex(clampIndex(next, total)),
    [total],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (total < 2) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        const nextIndex = clampIndex(safeIndex + 1, total);
        go(nextIndex);
        requestAnimationFrame(() => slideRefs.current[nextIndex]?.focus());
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        const nextIndex = clampIndex(safeIndex - 1, total);
        go(nextIndex);
        requestAnimationFrame(() => slideRefs.current[nextIndex]?.focus());
      }
    },
    [go, safeIndex, total],
  );

  if (total === 0) return null;
  const current = images[safeIndex];
  const multiple = total > 1;

  return (
    <>
      <figure
        className="cave-image-carousel mt-2 mb-0 w-full max-w-2xl overflow-hidden rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40"
        role={multiple ? "group" : undefined}
        aria-roledescription={multiple ? "carousel" : undefined}
        aria-label={multiple ? label || `Image carousel, ${total} images` : undefined}
        onKeyDown={onKeyDown}
      >
        <div className="relative">
          <div className="overflow-hidden">
            <div id={trackId} className="relative w-full">
              {images.map((image, i) => (
                <button
                  key={`${image.src}-${i}`}
                  ref={(element) => {
                    slideRefs.current[i] = element;
                  }}
                  type="button"
                  // Only the visible slide is reachable — Tab must not walk
                  // through pictures nobody can see.
                  tabIndex={i === safeIndex ? 0 : -1}
                  aria-hidden={i === safeIndex ? undefined : true}
                  className={`focus-ring flex aspect-video w-full cursor-zoom-in items-center justify-center overflow-hidden bg-transparent p-0 ${
                    i === safeIndex
                      ? "relative opacity-100"
                      : "pointer-events-none absolute inset-0 opacity-0"
                  }${reducedMotion ? "" : " transition-opacity duration-[var(--duration-base)] ease-[var(--ease-standard)]"}`}
                  title={`View ${imageLabel(image, i, total)}`}
                  onClick={() => {
                    setIndex(i);
                    setZoomed(true);
                  }}
                >
                  <AuthedImage
                    src={image.src}
                    alt={imageLabel(image, i, total)}
                    loading={i === 0 ? undefined : "lazy"}
                    fallback={
                      <span className="flex h-full w-full items-center justify-center text-[var(--text-muted)]">
                        <Icon name="ph:image-bold" width={24} />
                      </span>
                    }
                    className="block h-full w-full object-cover"
                  />
                </button>
              ))}
            </div>
          </div>

          {multiple ? (
            <>
              <button
                type="button"
                onClick={() => go(safeIndex - 1)}
                aria-controls={trackId}
                aria-label="Previous image"
                className="focus-ring absolute top-1/2 left-2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--border-hairline)] bg-[var(--bg-base)]/80 text-[var(--text-secondary)] backdrop-blur-sm transition-colors hover:text-[var(--text-primary)]"
              >
                <Icon name="ph:caret-left" width={12} />
              </button>
              <button
                type="button"
                onClick={() => go(safeIndex + 1)}
                aria-controls={trackId}
                aria-label="Next image"
                className="focus-ring absolute top-1/2 right-2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--border-hairline)] bg-[var(--bg-base)]/80 text-[var(--text-secondary)] backdrop-blur-sm transition-colors hover:text-[var(--text-primary)]"
              >
                <Icon name="ph:caret-right" width={12} />
              </button>
              <span className="absolute top-2 right-2 rounded-full bg-[var(--bg-base)]/80 px-2 py-0.5 tabular-nums text-[length:var(--text-2xs)] text-[var(--text-secondary)] backdrop-blur-sm">
                {safeIndex + 1} / {total}
              </span>
            </>
          ) : null}
        </div>

        {multiple ? (
          <div className="flex items-center justify-center gap-1.5 px-3 py-2">
            {images.map((image, i) => (
              <button
                key={`dot-${image.src}-${i}`}
                type="button"
                onClick={() => go(i)}
                aria-controls={trackId}
                aria-current={i === safeIndex ? "true" : undefined}
                aria-label={`Show image ${i + 1} of ${total}`}
                className={`focus-ring h-1.5 rounded-full ${reducedMotion ? "" : "transition-all duration-[var(--duration-fast)]"} ${
                  i === safeIndex
                    ? "w-4 bg-[var(--accent-presence)]"
                    : "w-1.5 bg-[var(--text-muted)]/40 hover:bg-[var(--text-muted)]/70"
                }`}
              />
            ))}
          </div>
        ) : null}

        {current?.caption ? (
          <figcaption className="border-t border-[var(--border-hairline)]/60 px-3 py-2 text-[length:var(--text-xs)] text-[var(--text-muted)]">
            {current.caption}
          </figcaption>
        ) : null}

        {/* Local live region: the card announces its own slide changes, so it
            works outside a LiveRegionProvider (useAnnouncer throws there). */}
        <span className="sr-only" role="status" aria-live="polite">
          {multiple ? `Image ${safeIndex + 1} of ${total}${current?.caption ? `: ${current.caption}` : ""}` : ""}
        </span>
      </figure>

      {zoomed ? (
        <ImageLightbox images={images} index={safeIndex} onIndex={go} onClose={() => setZoomed(false)} />
      ) : null}
    </>
  );
}
