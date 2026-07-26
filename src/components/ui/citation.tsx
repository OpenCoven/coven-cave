"use client";

/**
 * Citation UI — shared across chat responses and research artifacts.
 *
 * `CitationMarker` is an inline superscript chip (¹) that opens a source card in
 * the shared Popover. `CitationSources` is the numbered "Sources" list rendered
 * below a body; its rows are anchor targets (`id="cite-N"`) so inline markers
 * can jump to them. Both take the shared `Citation` shape and lean on Cave's
 * tokens (accent-presence for the citation hue, the type scale for sizing).
 */

import { useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { Popover, PopoverBody } from "@/components/ui/popover";
import type { Citation } from "@/lib/citations";

function CitationCard({ citation }: { citation: Citation }) {
  return (
    <div className="flex max-w-[var(--citation-card-w,320px)] flex-col gap-1.5 p-1">
      <div className="flex items-center gap-1.5">
        <span className="flex h-4 min-w-4 items-center justify-center rounded-[var(--radius-control)] bg-[color-mix(in_oklch,var(--accent-presence)_16%,transparent)] px-1 text-[length:var(--text-2xs)] font-semibold text-[var(--accent-presence)]">
          {citation.n}
        </span>
        {citation.domain ? (
          <span className="truncate text-[length:var(--text-2xs)] uppercase tracking-widest text-[var(--text-muted)]">
            {citation.domain}
          </span>
        ) : null}
      </div>
      {citation.url ? (
        <a
          href={citation.url}
          target="_blank"
          rel="noreferrer"
          className="focus-ring inline-flex items-start gap-1 text-[length:var(--text-sm)] font-medium text-[var(--text-primary)] hover:text-[var(--accent-presence)]"
        >
          <span className="min-w-0">{citation.title}</span>
          <Icon name="ph:arrow-square-out" width={12} height={12} className="mt-0.5 shrink-0" aria-hidden />
        </a>
      ) : (
        <span className="text-[length:var(--text-sm)] font-medium text-[var(--text-primary)]">{citation.title}</span>
      )}
      {citation.snippet ? (
        <p className="line-clamp-4 text-[length:var(--text-xs)] leading-relaxed text-[var(--text-secondary)]">
          {citation.snippet}
        </p>
      ) : null}
    </div>
  );
}

/** Inline superscript citation marker that opens its source card on click. */
export function CitationMarker({ citation }: { citation: Citation }) {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-label={`Source ${citation.n}: ${citation.title}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="focus-ring relative -top-[0.35em] mx-px inline-flex min-w-[1.1em] items-center justify-center rounded-[3px] bg-[color-mix(in_oklch,var(--accent-presence)_12%,transparent)] px-1 align-baseline text-[0.66em] font-semibold text-[var(--accent-presence)] hover:bg-[color-mix(in_oklch,var(--accent-presence)_22%,transparent)]"
      >
        {citation.n}
      </button>
      <Popover
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        placement="top-start"
        ariaLabel={`Source ${citation.n}`}
        minWidth={240}
      >
        <PopoverBody>
          <CitationCard citation={citation} />
        </PopoverBody>
      </Popover>
    </>
  );
}

/** The "Sources" list rendered under a cited body. Anchor targets for markers. */
export function CitationSources({
  citations,
  className = "",
  label = "Sources",
}: {
  citations: readonly Citation[];
  className?: string;
  label?: string;
}) {
  if (citations.length === 0) return null;
  return (
    <section
      className={`mt-3 flex flex-col gap-2 border-t border-[var(--border-hairline)] pt-3 ${className}`}
      aria-label={label}
    >
      <div className="text-[length:var(--text-2xs)] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
        {label}
      </div>
      <ol className="flex flex-col gap-1.5">
        {citations.map((citation) => (
          <li key={citation.id} id={citation.id} className="flex scroll-mt-4 items-start gap-2">
            <span
              aria-hidden
              className="mt-0.5 flex h-4 min-w-4 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[color-mix(in_oklch,var(--accent-presence)_14%,transparent)] px-1 text-[length:var(--text-2xs)] font-semibold text-[var(--accent-presence)]"
            >
              {citation.n}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                {citation.url ? (
                  <a
                    href={citation.url}
                    target="_blank"
                    rel="noreferrer"
                    className="focus-ring inline-flex items-center gap-1 text-[length:var(--text-sm)] font-medium text-[var(--text-primary)] hover:text-[var(--accent-presence)]"
                  >
                    {citation.title}
                    <Icon name="ph:arrow-square-out" width={11} height={11} className="shrink-0" aria-hidden />
                  </a>
                ) : (
                  <span className="text-[length:var(--text-sm)] font-medium text-[var(--text-primary)]">
                    {citation.title}
                  </span>
                )}
                {citation.domain ? (
                  <span className="text-[length:var(--text-2xs)] text-[var(--text-muted)]">{citation.domain}</span>
                ) : null}
              </div>
              {citation.snippet ? (
                <p className="mt-0.5 line-clamp-2 text-[length:var(--text-xs)] leading-relaxed text-[var(--text-muted)]">
                  {citation.snippet}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
