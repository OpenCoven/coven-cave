"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import { Icon, type IconName } from "@/lib/icon";
import { Popover, PopoverBody } from "@/components/ui/popover";
import { createCitationPreviewCoordinator } from "@/lib/citation-preview";
import {
  citationSourcePresentation,
  lineRangeLabel,
  type Citation,
  type CitationSourceKind,
} from "@/lib/citations";

const SOURCE_ICONS: Record<CitationSourceKind, IconName> = {
  repo: "ph:file-text",
  github: "ph:github-logo",
  arxiv: "ph:graduation-cap",
  doi: "ph:graduation-cap",
  wikipedia: "ph:book-open",
  video: "ph:video",
  document: "ph:file-text",
  web: "ph:globe",
  reference: "ph:link",
};

function isPlainPrimaryClick(event: ReactMouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

/**
 * A worktree citation: the familiar cited a file it read, not a page it
 * fetched. There is nothing to open in a browser and no domain to name, so the
 * card shows what actually identifies the source — the path, the line range,
 * and the lines themselves, numbered from the range start when one was given.
 * The quoted text is the citation's own snippet; nothing is read off disk here,
 * so the card can never show a peek the citation did not carry.
 */
function RepoCitationCard({
  citation,
  projectRoot,
}: {
  citation: Citation;
  projectRoot?: string | null;
}) {
  const file = citation.file!;
  const range = lineRangeLabel(file);
  const peek = (citation.snippet ?? "").split("\n").slice(0, 4);
  const firstLine = file.lineStart ?? 1;
  return (
    <article
      data-source-kind="repo"
      className="flex w-[var(--citation-card-w,320px)] max-w-[calc(100vw-var(--space-8))] flex-col overflow-hidden"
    >
      <header className="flex items-center gap-2 border-b border-[var(--border-hairline)] px-3 py-2">
        <Icon name="ph:file-text" width={13} height={13} className="shrink-0 text-[var(--accent-presence)]" aria-hidden />
        <span
          className="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] text-[var(--text-primary)]"
          title={file.path}
        >
          {file.path}
        </span>
        {range ? (
          <span className="shrink-0 rounded-[var(--radius-sm)] bg-[color-mix(in_oklch,var(--accent-presence)_14%,transparent)] px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[length:var(--text-2xs)] font-semibold text-[var(--accent-presence)]">
            {range}
          </span>
        ) : null}
      </header>

      {peek.some((line) => line.trim()) ? (
        <div className="flex flex-col bg-[var(--code-surface)] py-2">
          {peek.map((line, index) => (
            <span key={index} className="flex items-baseline gap-2.5 pl-2.5 pr-3">
              <span className="w-6 shrink-0 text-right font-[family-name:var(--font-mono)] text-[length:var(--text-2xs)] leading-4 text-[var(--text-muted)]">
                {firstLine + index}
              </span>
              <span className="min-w-0 flex-1 truncate whitespace-pre font-[family-name:var(--font-mono)] text-[length:var(--text-2xs)] leading-4 text-[var(--code-foreground)]">
                {line}
              </span>
            </span>
          ))}
        </div>
      ) : null}

      <footer className="flex items-center gap-2 border-t border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-2">
        <span className="min-w-0 truncate font-[family-name:var(--font-mono)] text-[length:var(--text-2xs)] text-[var(--text-muted)]">
          {citation.title}
        </span>
        {projectRoot ? (
          <button
            type="button"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("cave:open-project-file", {
                  detail: {
                    path: file.path,
                    line: file.lineStart,
                    projectRoot,
                  },
                }),
              )
            }
            title={`Open ${file.path}${file.lineStart ? `:${file.lineStart}` : ""} in the Code workspace`}
            className="focus-ring ml-auto inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-control)] px-2 py-1 text-[length:var(--text-2xs)] font-medium text-[var(--accent-presence)] hover:bg-[color-mix(in_oklch,var(--accent-presence)_12%,transparent)]"
          >
            Open in Code
            <Icon name="ph:arrow-square-out" width={10} height={10} aria-hidden />
          </button>
        ) : null}
      </footer>
    </article>
  );
}

function CitationCard({
  citation,
  onOpenUrl,
  projectRoot,
}: {
  citation: Citation;
  onOpenUrl?: (url: string) => void;
  projectRoot?: string | null;
}) {
  if (citation.file) {
    return <RepoCitationCard citation={citation} projectRoot={projectRoot} />;
  }
  const presentation = citationSourcePresentation(citation);
  const openSource = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!citation.url || !onOpenUrl || !isPlainPrimaryClick(event)) return;
    event.preventDefault();
    onOpenUrl(citation.url);
  };

  return (
    <article
      data-source-kind={presentation.kind}
      className="flex w-[var(--citation-card-w,320px)] max-w-[calc(100vw-var(--space-8))] flex-col overflow-hidden"
    >
      <header className="flex items-start gap-3 border-b border-[var(--border-hairline)] bg-[color-mix(in_oklch,var(--accent-presence)_6%,transparent)] p-3">
        <span className="flex h-[var(--space-8)] w-[var(--space-8)] shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-[color-mix(in_oklch,var(--accent-presence)_36%,var(--border-hairline))] bg-[color-mix(in_oklch,var(--accent-presence)_14%,transparent)] text-[var(--accent-presence)]">
          <Icon name={SOURCE_ICONS[presentation.kind]} width={16} height={16} aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block text-[length:var(--text-2xs)] font-semibold uppercase tracking-widest text-[var(--accent-presence)]">
            {presentation.provider}
          </span>
          <span className="mt-0.5 block truncate font-[family-name:var(--font-mono)] text-[length:var(--text-2xs)] text-[var(--text-muted)]">
            {presentation.context}
          </span>
        </span>
      </header>

      <div className="flex flex-col gap-2 p-3">
        <h3 className="flex items-start gap-2 break-words text-[length:var(--text-md)] font-semibold leading-snug text-[var(--text-primary)]">
          {/* The marker number, so the card and the inline chip that opened it
              read as the same source rather than two lookups. */}
          <span
            aria-hidden
            className="mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[color-mix(in_oklch,var(--foreground)_12%,transparent)] font-[family-name:var(--font-mono)] text-[length:var(--text-2xs)] font-semibold text-[var(--text-secondary)]"
          >
            {citation.n}
          </span>
          <span className="line-clamp-2 min-w-0">{citation.title}</span>
        </h3>
        <p className="line-clamp-3 text-[length:var(--text-xs)] leading-normal text-[var(--text-secondary)]">
          {presentation.summary}
        </p>
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-2">
        <span className="min-w-0 truncate text-[length:var(--text-2xs)] text-[var(--text-muted)]">
          {citation.domain || (citation.url ? "External source" : "Local reference")}
        </span>
        {citation.url ? (
          <a
            href={citation.url}
            target="_blank"
            rel="noreferrer"
            onClick={openSource}
            className="focus-ring inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-control)] px-2 py-1 text-[length:var(--text-xs)] font-medium text-[var(--accent-presence)] hover:bg-[color-mix(in_oklch,var(--accent-presence)_12%,transparent)]"
          >
            Open source
            <Icon name="ph:arrow-square-out" width={12} height={12} aria-hidden />
          </a>
        ) : (
          <span className="text-[length:var(--text-2xs)] text-[var(--text-muted)]">No link provided</span>
        )}
      </footer>
    </article>
  );
}

export function InlineCitationPreviews({
  citations,
  containerRef,
  onOpenUrl,
  projectRoot,
  renderedHtml,
}: {
  citations: readonly Citation[];
  containerRef: RefObject<HTMLElement | null>;
  onOpenUrl?: (url: string) => void;
  projectRoot?: string | null;
  renderedHtml: string;
}) {
  const anchorRef = useRef<HTMLElement | null>(null);
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const [open, setOpen] = useState(false);
  const preview = useMemo(() => createCitationPreviewCoordinator(setOpen), []);
  const citationsById = useMemo(
    () => new Map(citations.map((citation) => [citation.id, citation])),
    [citations],
  );
  const presentation = activeCitation
    ? citationSourcePresentation(activeCitation)
    : null;

  useEffect(() => () => preview.dispose(), [preview]);
  useEffect(() => {
    anchorRef.current?.setAttribute("aria-expanded", open ? "true" : "false");
  }, [open]);

  const activate = useCallback(
    (
      link: HTMLAnchorElement,
      citation: Citation,
      interaction: "row-hover" | "row-focus",
    ) => {
      if (anchorRef.current !== link) {
        anchorRef.current?.setAttribute("aria-expanded", "false");
        anchorRef.current = link;
      }
      setActiveCitation(citation);
      link.setAttribute("aria-expanded", "true");
      preview.enter(interaction);
    },
    [preview],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || citationsById.size === 0) return;
    anchorRef.current = null;
    setActiveCitation(null);
    preview.dismiss();

    const cleanups: Array<() => void> = [];
    for (const link of container.querySelectorAll<HTMLAnchorElement>('a[href^="#cite-"]')) {
      const href = link.getAttribute("href");
      const citation = href ? citationsById.get(href.slice(1)) : undefined;
      if (!citation) continue;
      const presentation = citationSourcePresentation(citation);

      link.classList.add("cave-citation-chip");
      link.dataset.sourceKind = presentation.kind;
      link.setAttribute("aria-label", `Open source: ${citation.title}. ${presentation.provider}.`);
      link.setAttribute("aria-haspopup", "dialog");
      link.setAttribute("aria-expanded", "false");

      const onMouseEnter = () => activate(link, citation, "row-hover");
      const onMouseLeave = () => preview.leave("row-hover");
      const onFocus = () => activate(link, citation, "row-focus");
      const onBlur = () => preview.leave("row-focus");
      const onClick = (event: MouseEvent) => {
        event.stopImmediatePropagation();
        if (!citation.url || window.matchMedia("(hover: none)").matches) {
          event.preventDefault();
          activate(link, citation, "row-focus");
          return;
        }
        if (
          onOpenUrl &&
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey
        ) {
          event.preventDefault();
          onOpenUrl(citation.url);
        }
      };

      if (citation.url) {
        link.href = citation.url;
        link.target = "_blank";
        link.rel = "noreferrer";
      }
      link.addEventListener("mouseenter", onMouseEnter);
      link.addEventListener("mouseleave", onMouseLeave);
      link.addEventListener("focus", onFocus);
      link.addEventListener("blur", onBlur);
      link.addEventListener("click", onClick);

      cleanups.push(() => {
        link.removeEventListener("mouseenter", onMouseEnter);
        link.removeEventListener("mouseleave", onMouseLeave);
        link.removeEventListener("focus", onFocus);
        link.removeEventListener("blur", onBlur);
        link.removeEventListener("click", onClick);
        link.classList.remove("cave-citation-chip");
        delete link.dataset.sourceKind;
        link.removeAttribute("aria-label");
        link.removeAttribute("aria-haspopup");
        link.removeAttribute("aria-expanded");
        link.removeAttribute("target");
        link.removeAttribute("rel");
        if (href) link.setAttribute("href", href);
      });
    }

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [activate, citationsById, containerRef, onOpenUrl, preview, renderedHtml]);

  if (!activeCitation || !presentation) return null;
  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setOpen(true);
        else preview.dismiss();
      }}
      anchorRef={anchorRef}
      placement="top-start"
      className="bg-[var(--bg-elevated)]"
      ariaLabel={`${presentation.provider} source preview`}
    >
      <PopoverBody className="p-0">
        <div
          onMouseEnter={() => preview.enter("preview-hover")}
          onMouseLeave={() => preview.leave("preview-hover")}
          onFocusCapture={() => preview.enter("preview-focus")}
          onBlurCapture={() => preview.leave("preview-focus")}
        >
          <CitationCard
            citation={activeCitation}
            onOpenUrl={onOpenUrl}
            projectRoot={projectRoot}
          />
        </div>
      </PopoverBody>
    </Popover>
  );
}

function CitationSourceRow({ citation }: { citation: Citation }) {
  return (
    <li id={citation.id} className="flex scroll-mt-4 items-start gap-2">
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
  );
}

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
          <CitationSourceRow key={citation.id} citation={citation} />
        ))}
      </ol>
    </section>
  );
}
