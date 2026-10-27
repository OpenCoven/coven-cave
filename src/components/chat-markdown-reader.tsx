"use client";

import "@/styles/chat-spec-card.css";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon } from "@/lib/icon";
import { copyText } from "@/lib/clipboard";
import { readerOutline, readingStats } from "@/lib/reader-outline";
import { parseMdDocument } from "@/lib/md-frontmatter";
import { Modal } from "@/components/ui/modal";
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
  const documentRef = useRef<HTMLDivElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const headingsRef = useRef<HTMLElement[]>([]);
  const parsedDocument = useMemo(() => parseMdDocument(markdown ?? ""), [markdown]);
  const outline = useMemo(() => readerOutline(parsedDocument.body), [parsedDocument.body]);
  // Keep source comments and formatting intact; exports still use `markdown`.
  const metadata = parsedDocument.hasFrontmatter && markdown
    ? markdown.slice(0, markdown.length - parsedDocument.body.length).trimEnd()
    : null;


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
        `${readingStats(parsedDocument.body).minutes} min read`,
      ]
        .filter(Boolean)
        .join(" · ")
    : metaPrefix ?? "";

  return (
    <Modal open onClose={onClose} size="reader" bodyLayout="fill"
      breadcrumb={[eyebrow, parsedDocument.title ?? title]} description={meta || undefined}
      closeLabel={`Close ${noun} reader`}
      headerActions={headerActions}
      footerActions={<>          {markdown ? (
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
</>}
    >
      <div className="chat-spec-reader__progress" aria-hidden>
        <div ref={progressRef} className="chat-spec-reader__progress-bar" />
      </div>
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
                <>
                  {metadata ? (
                    <details className="chat-spec-reader__metadata">
                      <summary className="focus-ring">Document details</summary>
                      <pre>{metadata}</pre>
                    </details>
                  ) : null}
                  <MarkdownBlock
                    text={parsedDocument.body}
                    className="cave-md--reader"
                    onOpenUrl={onOpenUrl}
                  />
                </>
              ) : loading ? (
                <SkeletonRows count={6} />
              ) : null}
            </article>
          </div>
        </div>
        <span className="sr-only" aria-live="polite">
          {loading ? `Loading ${noun}…` : announcement}
        </span>
    </Modal>
  );
}
