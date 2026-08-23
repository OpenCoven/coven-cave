"use client";

import "@/styles/chat-spec-card.css";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/lib/icon";
import { copyText } from "@/lib/clipboard";
import { readerOutline, readingStats } from "@/lib/reader-outline";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { MarkdownBlock } from "@/components/message-bubble";

const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";

export function readerExportFilename(title: string, fallback: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return `${slug || fallback}.md`;
}

export type ChatMarkdownReaderProps = {
  title: string;
  /** Small label above the title — "Familiar spec", "Project document", … */
  eyebrow: string;
  /** Lowercase noun for the close control, e.g. "spec" or "document". */
  noun: string;
  /** Capitalized subject used in copy/download announcements. */
  subject: string;
  /** Document body. Null while `loading`, or when `error` is set. */
  markdown: string | null;
  loading?: boolean;
  error?: string | null;
  /** Extra meta shown ahead of the derived "N sections · M min read". */
  metaPrefix?: string | null;
  /** Slug base for the downloaded file when the title yields nothing. */
  fallbackFilename: string;
  /** Surface-specific header controls, rendered before Copy. */
  headerActions?: ReactNode;
  /** Recovery controls rendered under the error state. */
  errorActions?: ReactNode;
  onClose: () => void;
  onOpenUrl?: (url: string) => void;
};

/**
 * The chat's dedicated Markdown reader: one modal shell shared by inline
 * `spec`/`handoff` cards and by project `.md` files opened from prose refs, so
 * every document in the conversation reads the same way instead of half of
 * them bouncing the reader out to the Code workspace.
 */
export function ChatMarkdownReader({
  title,
  eyebrow,
  noun,
  subject,
  markdown,
  loading = false,
  error = null,
  metaPrefix = null,
  fallbackFilename,
  headerActions,
  errorActions,
  onClose,
  onOpenUrl,
}: ChatMarkdownReaderProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const documentRef = useRef<HTMLDivElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const headingsRef = useRef<HTMLElement[]>([]);
  const titleId = useId();
  const outline = useMemo(() => readerOutline(markdown ?? ""), [markdown]);

  const close = useCallback(() => onClose(), [onClose]);
  useFocusTrap(true, dialogRef, { onEscape: close });

  useEffect(() => {
    setActiveId(outline[0]?.id ?? null);
    const container = documentRef.current;
    if (!container) return;

    const anchorHeadings = () => {
      const headings = Array.from(
        container.querySelectorAll<HTMLElement>(HEADING_SELECTOR),
      );
      headings.forEach((heading, index) => {
        const entry = outline[index];
        if (entry) heading.id = entry.id;
      });
      headingsRef.current = headings;
    };

    anchorHeadings();
    const observer = new MutationObserver(anchorHeadings);
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [outline]);

  const onScroll = () => {
    const container = documentRef.current;
    if (!container) return;
    const scrollable = container.scrollHeight - container.clientHeight;
    const progress = scrollable > 0 ? container.scrollTop / scrollable : 0;
    progressRef.current?.style.setProperty(
      "--spec-progress",
      String(Math.min(1, Math.max(0, progress))),
    );

    const top = container.getBoundingClientRect().top;
    let current = outline[0]?.id ?? null;
    headingsRef.current.forEach((heading, index) => {
      if (heading.getBoundingClientRect().top - top <= 72) {
        current = outline[index]?.id ?? current;
      }
    });
    setActiveId(current);
  };

  const goTo = (id: string) => {
    const container = documentRef.current;
    const target = headingsRef.current.find((heading) => heading.id === id);
    if (!container || !target) return;
    const top =
      target.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    container.scrollTo({ top, behavior: reduceMotion ? "auto" : "smooth" });
    setActiveId(id);
  };

  const copy = async () => {
    if (!markdown) return;
    const copied = await copyText(markdown);
    setAnnouncement(
      copied
        ? `${subject} copied as Markdown.`
        : `${subject} could not be copied.`,
    );
  };

  const download = () => {
    if (!markdown) return;
    const blob = new Blob([markdown], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = readerExportFilename(title, fallbackFilename);
    link.click();
    requestAnimationFrame(() => URL.revokeObjectURL(url));
    setAnnouncement(`${subject} downloaded as Markdown.`);
  };

  const meta = markdown
    ? [
        metaPrefix,
        outline.length > 0
          ? `${outline.length} section${outline.length === 1 ? "" : "s"}`
          : null,
        `${readingStats(markdown).minutes} min read`,
      ]
        .filter(Boolean)
        .join(" · ")
    : metaPrefix ?? "";

  const reader = (
    <div
      className="chat-spec-reader__backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        className="chat-spec-reader"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="chat-spec-reader__progress" aria-hidden>
          <div ref={progressRef} className="chat-spec-reader__progress-bar" />
        </div>
        <header className="chat-spec-reader__header">
          <span className="chat-spec-reader__mark" aria-hidden>
            <Icon name="ph:file-text-bold" width={16} />
          </span>
          <div className="chat-spec-reader__heading">
            <span className="chat-spec-reader__eyebrow">{eyebrow}</span>
            <h2 id={titleId}>{title}</h2>
          </div>
          <span className="chat-spec-reader__meta">{meta}</span>
          {headerActions}
          {markdown ? (
            <>
              <button
                type="button"
                className="ui-btn ui-btn--ghost ui-btn--sm focus-ring"
                onClick={() => void copy()}
              >
                <Icon name="ph:copy" width={14} aria-hidden />
                Copy
              </button>
              <button
                type="button"
                className="ui-btn ui-btn--ghost ui-btn--sm focus-ring"
                onClick={download}
              >
                <Icon name="ph:download-simple" width={14} aria-hidden />
                Markdown
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="chat-spec-reader__close focus-ring"
            onClick={close}
            aria-label={`Close ${noun} reader`}
          >
            <Icon name="ph:x-bold" width={14} aria-hidden />
          </button>
        </header>

        <div className="chat-spec-reader__body">
          {markdown && outline.length > 0 ? (
            <nav className="chat-spec-reader__contents" aria-label="Contents">
              <span className="chat-spec-reader__eyebrow">Contents</span>
              <div className="chat-spec-reader__contents-list">
                {outline.map((heading) => (
                  <button
                    key={heading.id}
                    type="button"
                    className="chat-spec-reader__contents-link focus-ring"
                    aria-current={activeId === heading.id ? "location" : undefined}
                    data-level={heading.level}
                    onClick={() => goTo(heading.id)}
                  >
                    {heading.text}
                  </button>
                ))}
              </div>
            </nav>
          ) : null}

          <div
            ref={documentRef}
            className="chat-spec-reader__document focus-ring-inset"
            role="region"
            aria-label={`${title} document`}
            tabIndex={0}
            onScroll={onScroll}
          >
            <article className="chat-spec-reader__measure">
              {error ? (
                <ErrorState
                  headline={`This ${noun} could not be opened`}
                  subtitle={error}
                  actions={errorActions}
                />
              ) : markdown ? (
                <MarkdownBlock
                  text={markdown}
                  className="cave-md--reader"
                  onOpenUrl={onOpenUrl}
                />
              ) : loading ? (
                <SkeletonRows count={6} />
              ) : null}
            </article>
          </div>
        </div>
        <span className="sr-only" aria-live="polite">
          {loading ? `Loading ${noun}…` : announcement}
        </span>
      </div>
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(reader, document.body)
    : null;
}
