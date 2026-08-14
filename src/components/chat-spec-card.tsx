"use client";

import "@/styles/chat-spec-card.css";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/lib/icon";
import { copyText } from "@/lib/clipboard";
import { readerOutline } from "@/lib/reader-outline";
import type { SpecBlock } from "@/lib/spec-blocks";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { MarkdownBlock } from "@/components/message-bubble";

const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";

function exportFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return `${slug || "familiar-spec"}.md`;
}

export function ChatSpecCard({
  spec,
  onOpenUrl,
}: {
  spec: SpecBlock;
  onOpenUrl?: (url: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const documentRef = useRef<HTMLDivElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const headingsRef = useRef<HTMLElement[]>([]);
  const titleId = useId();
  const outline = useMemo(() => readerOutline(spec.markdown), [spec.markdown]);

  const close = useCallback(() => setOpen(false), []);
  useFocusTrap(open, dialogRef, { onEscape: close });

  useEffect(() => {
    if (!open) return;
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
  }, [open, outline]);

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
    const copied = await copyText(spec.markdown);
    setAnnouncement(copied ? "Spec copied as Markdown." : "Spec could not be copied.");
  };

  const download = () => {
    const blob = new Blob([spec.markdown], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = exportFilename(spec.title);
    link.click();
    requestAnimationFrame(() => URL.revokeObjectURL(url));
    setAnnouncement("Spec downloaded as Markdown.");
  };

  const meta = [
    spec.sectionCount > 0
      ? `${spec.sectionCount} section${spec.sectionCount === 1 ? "" : "s"}`
      : null,
    `${spec.readingMinutes} min read`,
  ]
    .filter(Boolean)
    .join(" · ");

  const reader = open ? (
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
            <span className="chat-spec-reader__eyebrow">Familiar spec</span>
            <h2 id={titleId}>{spec.title}</h2>
          </div>
          <span className="chat-spec-reader__meta">{meta}</span>
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
          <button
            type="button"
            className="chat-spec-reader__close focus-ring"
            onClick={close}
            aria-label="Close spec reader"
          >
            <Icon name="ph:x-bold" width={14} aria-hidden />
          </button>
        </header>

        <div className="chat-spec-reader__body">
          {outline.length > 0 ? (
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
            aria-label={`${spec.title} document`}
            tabIndex={0}
            onScroll={onScroll}
          >
            <article className="chat-spec-reader__measure">
              <MarkdownBlock
                text={spec.markdown}
                className="cave-md--reader"
                onOpenUrl={onOpenUrl}
              />
            </article>
          </div>
        </div>
        <span className="sr-only" aria-live="polite">
          {announcement}
        </span>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        type="button"
        className="chat-spec-card focus-ring"
        onClick={() => setOpen(true)}
      >
        <span className="chat-spec-card__icon" aria-hidden>
          <Icon name="ph:file-text-bold" width={20} />
        </span>
        <span className="chat-spec-card__content">
          <span className="chat-spec-card__eyebrow">Familiar spec</span>
          <strong>{spec.title}</strong>
          <span className="chat-spec-card__meta">{meta}</span>
        </span>
        <span className="chat-spec-card__action">
          Open spec
          <Icon name="ph:arrow-square-out" width={14} aria-hidden />
        </span>
      </button>
      {reader && typeof document !== "undefined"
        ? createPortal(reader, document.body)
        : null}
    </>
  );
}
