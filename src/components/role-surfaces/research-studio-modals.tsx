"use client";

/**
 * Studio tab modals + shared presentation helpers (cave-dl74, Phase B4).
 *
 * Three dialogs from the design (lines 361–533): the generate-with-directions
 * config modal, the per-kind generation viewer, and the markdown editor. All
 * of them follow the repo modal contract — useFocusTrap (Tab cycle, Escape,
 * focus restore), backdrop click to close, useAnnouncer on open.
 *
 * Honesty rules baked in here:
 * - The config footnote states plainly that content is drafted extractively
 *   from the run's artifact and that directions are stored for future
 *   pipelines without altering the draft (the backend guarantees this).
 * - The markdown editor has NO persistence path — research-generations.ts
 *   exposes only list/create/remove — so the primary action is "Copy updated
 *   draft" (clipboard), never a fake saved-state. Rich mode is a read-only
 *   rendered preview; the markdown text stays the single source of truth
 *   (no editable-DOM round-tripping).
 * - Viewer footer offers only real exports: clipboard copy and a Blob
 *   "Download .md" of the actual content. No pdf/pptx/png buttons.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { MarkdownBlock } from "@/components/message-bubble";
import { RelativeTime } from "@/components/ui/relative-time";
import {
  RESEARCH_GENERATION_DIRECTIONS_MAX_LENGTH,
  type ResearchGeneration,
  type ResearchGenerationKind,
  type ResearchGenerationMediaKind,
} from "@/lib/research-generations";
import type { ResearchMission } from "@/lib/research-missions";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useAnnouncer } from "@/components/ui/live-region";

// ── kind presentation (real kinds — the creatable union) ─────────────────────

export type StudioKindMeta = {
  glyph: string;
  label: string;
  /** Design's mono kicker: the output family. */
  format: string;
  /** Card description — matches what the extractor actually does. */
  blurb: string;
  /** Format tags — only formats this build really emits. */
  tags: string[];
};

export const STUDIO_KIND_META: Record<ResearchGenerationKind, StudioKindMeta> = {
  diagram: {
    glyph: "◇",
    label: "Diagram",
    format: "visual",
    blurb: "A mermaid flow built from the run's phases and artifact sections.",
    tags: ["mermaid"],
  },
  blog: {
    glyph: "¶",
    label: "Blog / article",
    format: "text",
    blurb: "The run's artifact markdown as an editable draft copy.",
    tags: ["md"],
  },
  slides: {
    glyph: "▤",
    label: "Slides",
    format: "text",
    blurb: "A readout outline from the artifact's headings and bullets.",
    tags: ["outline", "md"],
  },
  infographic: {
    glyph: "▦",
    label: "Infographic",
    format: "visual",
    blurb: "The numbers in the artifact, each with its source line.",
    tags: ["stats", "md"],
  },
  thread: {
    glyph: "＠",
    label: "Social thread",
    format: "text",
    blurb: "A post series from the artifact's headings and key claims.",
    tags: ["text"],
  },
};

/** Glyph/format for the disabled media cards. Labels and hints come from
 *  RESEARCH_GENERATION_MEDIA_KINDS — the single source of truth — so this map
 *  carries presentation only. */
export const STUDIO_MEDIA_PRESENTATION: Record<
  ResearchGenerationMediaKind,
  { glyph: string; format: string }
> = {
  podcast: { glyph: "◉", format: "audio" },
  "short-video": { glyph: "▶", format: "video" },
  "long-video": { glyph: "▶", format: "video" },
};

// ── shared pure helpers ──────────────────────────────────────────────────────

/**
 * Missions that can act as a Studio source. Mirrors the server's
 * pickSourceArtifact rule (server/research-generations.ts): a markdown
 * artifact that is published or still working — rejected never qualifies.
 * Creating against anything else earns the POST's 409, which we surface, but
 * the chips should not offer dead ends in the first place.
 */
export function missionHasMarkdownArtifact(
  mission: Pick<ResearchMission, "artifacts">,
): boolean {
  return mission.artifacts.some(
    (artifact) =>
      artifact.relativePath.toLowerCase().endsWith(".md") &&
      (artifact.state === "published" || artifact.state === "working"),
  );
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Display title. Real data only: the blog draft's first heading, the slide
 *  deck's cover title, else "<Kind> — <source mission title>". */
export function generationTitle(generation: ResearchGeneration): string {
  const content = generation.content;
  if (content?.kind === "blog") {
    const heading = content.markdown
      .split("\n")
      .map((line) => line.trim())
      .find((line) => /^#{1,3}\s+\S/.test(line));
    if (heading) return heading.replace(/^#+\s*/, "");
  }
  if (content?.kind === "slides" && content.slides.length > 0) {
    return content.slides[0].title;
  }
  return `${STUDIO_KIND_META[generation.kind].label} — ${generation.sourceTitle}`;
}

/** Status line text — words carry the tone (color is reinforcement only),
 *  and the "ready" detail is counted from the actual content. */
export function generationStatusText(generation: ResearchGeneration): string {
  if (generation.status === "failed") {
    return `failed — ${generation.error ?? "no draft produced"}`;
  }
  if (generation.status === "cancelled") return "cancelled";
  const content = generation.content;
  switch (content?.kind) {
    case "slides":
      return `ready · ${content.slides.length} slide${content.slides.length === 1 ? "" : "s"}`;
    case "thread":
      return `ready · ${content.posts.length} post${content.posts.length === 1 ? "" : "s"}`;
    case "infographic":
      return `ready · ${content.stats.length} stat${content.stats.length === 1 ? "" : "s"}`;
    case "blog":
      return `ready · ${countWords(content.markdown)} words`;
    case "diagram":
      return "ready · mermaid";
    default:
      return "ready";
  }
}

/** Serialize a generation's real content as markdown for copy/download. */
export function generationContentToMarkdown(generation: ResearchGeneration): string | null {
  const content = generation.content;
  if (!content) return null;
  switch (content.kind) {
    case "blog":
      return content.markdown;
    case "diagram":
      return `# ${generationTitle(generation)}\n\n\`\`\`mermaid\n${content.mermaid}\n\`\`\`\n`;
    case "slides":
      return `${content.slides
        .map(
          (slide, index) =>
            `## ${index + 1}. ${slide.title}\n\n${slide.bullets.map((bullet) => `- ${bullet}`).join("\n")}`,
        )
        .join("\n\n")}\n`;
    case "thread":
      return `${content.posts.map((post) => `**${post.pre}** ${post.text}`).join("\n\n")}\n`;
    case "infographic":
      return `${content.stats.map((stat) => `- **${stat.value}** — ${stat.context}`).join("\n")}\n`;
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Blob download of real markdown content. `override` lets the editor export
 *  its live (unsaved) text. */
export function downloadGenerationMarkdown(
  generation: ResearchGeneration,
  override?: string,
): void {
  const markdown = override ?? generationContentToMarkdown(generation);
  if (!markdown) return;
  const blob = new Blob([markdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${generation.kind}-${slugify(generation.sourceTitle) || generation.id}.md`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

// ── copy flash (design genAct: ⧉ → ✓ for 1200ms) ────────────────────────────

/** Flash duration from the design's genAct. The flash is a pure label swap —
 *  no animation frames — so it is reduced-motion safe by construction; the
 *  CSS layer additionally zeroes its transitions under
 *  prefers-reduced-motion (surface-research-studio.css). */
export const COPY_FLASH_MS = 1200;

export function useCopyFlash() {
  const [flash, setFlash] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { announce } = useAnnouncer();

  useEffect(
    () => () => {
      // Null on cancel so a StrictMode/Suspense re-run can't wedge a stale timer.
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    },
    [],
  );

  const copy = useCallback(
    async (key: string, text: string) => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        announce("Copy failed — clipboard unavailable", "assertive");
        return;
      }
      announce("Copied to clipboard");
      if (timerRef.current) clearTimeout(timerRef.current);
      setFlash(key);
      timerRef.current = setTimeout(() => {
        setFlash(null);
        timerRef.current = null;
      }, COPY_FLASH_MS);
    },
    [announce],
  );

  return { flash, copy };
}

// ── modal shell ──────────────────────────────────────────────────────────────

type StudioModalProps = {
  onClose: () => void;
  /** z-index tier per the design: config 65 / viewer 60 / editor 70. */
  variant: "config" | "viewer" | "editor";
  labelledBy: string;
  announceText: string;
  children: ReactNode;
};

/** Mounted only while open. Focus trap + Escape + focus restore come from
 *  useFocusTrap; backdrop click closes; open is announced to AT. */
function StudioModal({ onClose, variant, labelledBy, announceText, children }: StudioModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(true, dialogRef, { onEscape: onClose });
  const { announce } = useAnnouncer();
  const announcedRef = useRef(false);

  useEffect(() => {
    if (announcedRef.current) return;
    announcedRef.current = true;
    announce(announceText);
  }, [announce, announceText]);

  return (
    <div
      className={`research-studio-modal__backdrop research-studio-modal__backdrop--${variant}`}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`research-studio-modal research-studio-modal--${variant}`}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

// ── config modal (design 361–388) ────────────────────────────────────────────

export type StudioSourceOption = { id: string; title: string };

export function GenerationConfigModal({
  kind,
  sources,
  selectedSourceId,
  onSelectSource,
  directions,
  onDirectionsChange,
  error,
  creating,
  onSubmit,
  onClose,
}: {
  kind: ResearchGenerationKind;
  sources: StudioSourceOption[];
  selectedSourceId: string | null;
  onSelectSource: (id: string) => void;
  directions: string;
  onDirectionsChange: (value: string) => void;
  /** Server-side create failure — e.g. the 409 "no markdown artifact" message. */
  error: string | null;
  creating: boolean;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const meta = STUDIO_KIND_META[kind];
  const nearCap = directions.length >= RESEARCH_GENERATION_DIRECTIONS_MAX_LENGTH - 200;

  return (
    <StudioModal
      onClose={onClose}
      variant="config"
      labelledBy="research-studio-config-title"
      announceText={`Generate ${meta.label} dialog opened`}
    >
      <header className="research-studio-modal__head" data-kind={kind}>
        <span className="research-studio-modal__tile" aria-hidden>
          {meta.glyph}
        </span>
        <div className="research-studio-modal__head-text">
          <span className="research-studio__kicker">Studio · new generation</span>
          <h4 id="research-studio-config-title">Generate {meta.label}</h4>
        </div>
        <button
          type="button"
          className="research-studio-modal__close"
          onClick={onClose}
          aria-label="Close dialog"
        >
          ✕
        </button>
      </header>
      <div className="research-studio-modal__body">
        <div className="research-studio-config__sources">
          <span className="research-studio-config__label" id="research-studio-config-source-label">
            Source
          </span>
          <div
            className="research-studio__chips"
            role="group"
            aria-labelledby="research-studio-config-source-label"
          >
            {sources.map((source) => (
              <button
                key={source.id}
                type="button"
                className="research-studio__chip"
                aria-pressed={source.id === selectedSourceId}
                onClick={() => onSelectSource(source.id)}
              >
                {source.title}
              </button>
            ))}
          </div>
        </div>
        <div className="research-studio-config__field">
          <label className="research-studio-config__label" htmlFor="research-studio-directions">
            Directions (optional)
          </label>
          <textarea
            id="research-studio-directions"
            className="research-studio-config__textarea"
            value={directions}
            maxLength={RESEARCH_GENERATION_DIRECTIONS_MAX_LENGTH}
            onChange={(event) => onDirectionsChange(event.target.value)}
            placeholder="Audience, tone, emphasis — kept with the generation for future pipelines"
          />
          {nearCap ? (
            <span className="research-studio-config__count" aria-live="polite">
              {directions.length} / {RESEARCH_GENERATION_DIRECTIONS_MAX_LENGTH}
            </span>
          ) : null}
        </div>
        <p className="research-studio-config__note">
          Content is drafted extractively from the run&rsquo;s artifact. Directions are stored
          for future pipelines and do not alter the draft.
        </p>
        {error ? (
          <p role="alert" className="research-studio-config__error">
            {error}
          </p>
        ) : null}
      </div>
      <footer className="research-studio-modal__footer">
        <button type="button" className="research-studio-act research-studio-act--ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="research-studio-act research-studio-act--primary"
          onClick={onSubmit}
          disabled={creating || selectedSourceId === null}
        >
          {creating ? "Drafting…" : `✦ Generate ${meta.label}`}
        </button>
      </footer>
    </StudioModal>
  );
}

// ── viewer modal (design 391–493) ────────────────────────────────────────────

function SlidesViewer({ generation }: { generation: ResearchGeneration }) {
  const slides = generation.content?.kind === "slides" ? generation.content.slides : [];
  const [index, setIndex] = useState(0);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; startLeft: number; moved: boolean } | null>(null);

  if (slides.length === 0) return null;
  const current = slides[Math.min(index, slides.length - 1)];

  // Design gvDragStart: mouse-drag scrolls the thumb strip. The thumbs are
  // real <button>s so the strip stays fully keyboard operable; a drag beyond
  // 4px suppresses the click it would otherwise fire.
  const onStripMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    const el = stripRef.current;
    if (!el) return;
    dragRef.current = { startX: event.clientX, startLeft: el.scrollLeft, moved: false };
    const move = (ev: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = ev.clientX - drag.startX;
      if (Math.abs(dx) > 4) drag.moved = true;
      el.scrollLeft = drag.startLeft - dx;
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      el.dataset.dragging = "false";
      // Let the click event (which fires after mouseup) read `moved` first.
      setTimeout(() => {
        dragRef.current = null;
      }, 0);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
    el.dataset.dragging = "true";
  };

  const select = (next: number) => {
    if (dragRef.current?.moved) return;
    setIndex(next);
  };

  return (
    <div className="research-studio-viewer__slides">
      <div className="research-studio-viewer__slide">
        <span className="research-studio-viewer__slide-kicker">
          Readout · slide {index + 1} of {slides.length}
        </span>
        <h3 className="research-studio-viewer__slide-title">{current.title}</h3>
        <ul className="research-studio-viewer__slide-bullets">
          {current.bullets.map((bullet, bulletIndex) => (
            <li key={bulletIndex}>{bullet}</li>
          ))}
        </ul>
      </div>
      <div className="research-studio-viewer__deck-nav">
        <button
          type="button"
          className="research-studio-act"
          onClick={() => setIndex((index - 1 + slides.length) % slides.length)}
          aria-label="Previous slide"
        >
          ‹
        </button>
        <div
          ref={stripRef}
          className="research-studio-viewer__thumbs"
          onMouseDown={onStripMouseDown}
          role="group"
          aria-label="Slides"
        >
          {slides.map((slide, thumbIndex) => (
            <button
              key={thumbIndex}
              type="button"
              className="research-studio-viewer__thumb"
              aria-pressed={thumbIndex === index}
              aria-label={`Slide ${thumbIndex + 1}: ${slide.title}`}
              onClick={() => select(thumbIndex)}
            >
              <span className="research-studio-viewer__thumb-n">{thumbIndex + 1}</span>
              <span className="research-studio-viewer__thumb-title">{slide.title}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="research-studio-act"
          onClick={() => setIndex((index + 1) % slides.length)}
          aria-label="Next slide"
        >
          ›
        </button>
        <span className="research-studio-viewer__slide-num">
          {index + 1}/{slides.length}
        </span>
      </div>
    </div>
  );
}

export function GenerationViewerModal({
  generation,
  onClose,
  onOpenEditor,
}: {
  generation: ResearchGeneration;
  onClose: () => void;
  /** Blog only: open the markdown editor over the viewer. */
  onOpenEditor?: () => void;
}) {
  const meta = STUDIO_KIND_META[generation.kind];
  const content = generation.content;
  const title = generationTitle(generation);
  const { flash, copy } = useCopyFlash();

  const points =
    content?.kind === "thread"
      ? { label: "Thread", rows: content.posts.map((post) => ({ pre: post.pre, text: post.text })) }
      : content?.kind === "infographic"
        ? {
            label: "Stat sheet",
            rows: content.stats.map((stat) => ({
              pre: stat.value,
              text: stat.context,
            })),
          }
        : null;

  const footerCopyText =
    content?.kind === "diagram" ? content.mermaid : generationContentToMarkdown(generation);
  const footerCopyLabel =
    content?.kind === "diagram" ? "Copy Mermaid" : content?.kind === "thread" ? "Copy thread" : "Copy";

  return (
    <StudioModal
      onClose={onClose}
      variant="viewer"
      labelledBy="research-studio-viewer-title"
      announceText={`${meta.label} viewer opened: ${title}`}
    >
      <header className="research-studio-modal__head" data-kind={generation.kind}>
        <span className="research-studio-modal__tile" aria-hidden>
          {meta.glyph}
        </span>
        <div className="research-studio-modal__head-text">
          <span className="research-studio__kicker">
            {meta.label}
            <span className="research-studio__meta-sep">
              {" "}
              from {generation.sourceTitle} ·{" "}
              <RelativeTime iso={generation.createdAt} fallback="just now" />
            </span>
          </span>
          <h4 id="research-studio-viewer-title">{title}</h4>
        </div>
        <button
          type="button"
          className="research-studio-modal__close"
          onClick={onClose}
          aria-label="Close viewer"
        >
          ✕
        </button>
      </header>
      <div className="research-studio-modal__body">
        {!content ? (
          <p className="research-studio-viewer__missing">
            This generation has no content — it {generation.status}
            {generation.error ? `: ${generation.error}` : "."}
          </p>
        ) : null}

        {content?.kind === "slides" ? <SlidesViewer generation={generation} /> : null}

        {content?.kind === "diagram" ? (
          <div className="research-studio-viewer__code-wrap">
            <span className="research-studio-viewer__label">Mermaid source</span>
            <pre className="research-studio__code">{content.mermaid}</pre>
          </div>
        ) : null}

        {content?.kind === "blog" ? (
          <>
            <div className="research-studio-viewer__blog-head">
              <span className="research-studio-viewer__label">Draft — read-only preview</span>
              {onOpenEditor ? (
                <button
                  type="button"
                  className="research-studio-act research-studio-act--accent"
                  onClick={onOpenEditor}
                >
                  ⤢ Open in Markdown editor
                </button>
              ) : null}
            </div>
            <div className="research-studio-viewer__markdown">
              <MarkdownBlock text={content.markdown} />
            </div>
          </>
        ) : null}

        {points ? (
          <div className="research-studio-viewer__points">
            <span className="research-studio-viewer__label">{points.label}</span>
            <ul className="research-studio-viewer__point-list">
              {points.rows.map((row, rowIndex) => (
                <li key={rowIndex} className="research-studio-viewer__point">
                  <span className="research-studio-viewer__point-pre">{row.pre}</span>
                  <span className="research-studio-viewer__point-text">{row.text}</span>
                  <button
                    type="button"
                    className="research-studio-act research-studio-act--tiny"
                    data-flash={flash === `point-${rowIndex}`}
                    onClick={() =>
                      copy(
                        `point-${rowIndex}`,
                        content?.kind === "infographic" ? `${row.pre} — ${row.text}` : row.text,
                      )
                    }
                  >
                    {flash === `point-${rowIndex}` ? "✓ Copied" : "⧉ Copy"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <footer className="research-studio-modal__footer">
        {footerCopyText ? (
          <button
            type="button"
            className="research-studio-act"
            data-flash={flash === "footer-copy"}
            onClick={() => copy("footer-copy", footerCopyText)}
          >
            {flash === "footer-copy" ? "✓ Copied" : `⧉ ${footerCopyLabel}`}
          </button>
        ) : null}
        {content ? (
          <button
            type="button"
            className="research-studio-act"
            onClick={() => downloadGenerationMarkdown(generation)}
          >
            ⤓ Download .md
          </button>
        ) : null}
        <button
          type="button"
          className="research-studio-act research-studio-act--ghost research-studio-modal__footer-end"
          onClick={onClose}
        >
          Close
        </button>
      </footer>
    </StudioModal>
  );
}

// ── markdown editor modal (design 496–533) ───────────────────────────────────

/**
 * Edits the blog generation's markdown. Decision (Phase B4): the backend
 * exposes no update fetcher — research-generations.ts is list/create/remove
 * only — so this editor does not pretend to persist. The primary action
 * copies the updated draft to the clipboard and the footer says plainly that
 * drafts save back when generation editing lands (gap filed for Phase C).
 * The seg toggle implements Markdown (textarea, source of truth) as primary;
 * "Rich" is a read-only rendered preview of the same text — no execCommand.
 */
export function MarkdownEditorModal({
  generation,
  onClose,
}: {
  generation: ResearchGeneration;
  onClose: () => void;
}) {
  const initial = generation.content?.kind === "blog" ? generation.content.markdown : "";
  const [text, setText] = useState(initial);
  const [mode, setMode] = useState<"markdown" | "rich">("markdown");
  const { flash, copy } = useCopyFlash();
  const words = countWords(text);

  return (
    <StudioModal
      onClose={onClose}
      variant="editor"
      labelledBy="research-studio-editor-title"
      announceText="Markdown editor opened"
    >
      <header className="research-studio-modal__head" data-kind="blog">
        <span className="research-studio-modal__tile research-studio-modal__tile--sm" aria-hidden>
          ¶
        </span>
        <div className="research-studio-modal__head-text">
          <span className="research-studio__kicker">Markdown editor</span>
          <h4 id="research-studio-editor-title">{generationTitle(generation)}</h4>
        </div>
        <div className="research-studio-editor__seg" role="group" aria-label="Editor mode">
          <button
            type="button"
            className="research-studio-editor__seg-opt"
            aria-pressed={mode === "markdown"}
            onClick={() => setMode("markdown")}
          >
            Markdown
          </button>
          <button
            type="button"
            className="research-studio-editor__seg-opt"
            aria-pressed={mode === "rich"}
            onClick={() => setMode("rich")}
          >
            Rich preview
          </button>
        </div>
        <button
          type="button"
          className="research-studio-modal__close"
          onClick={onClose}
          aria-label="Close editor"
        >
          ✕
        </button>
      </header>
      {mode === "markdown" ? (
        <textarea
          className="research-studio-editor__textarea"
          value={text}
          onChange={(event) => setText(event.target.value)}
          spellCheck={false}
          aria-label="Draft markdown"
        />
      ) : (
        <div className="research-studio-editor__preview">
          <MarkdownBlock text={text} />
        </div>
      )}
      <footer className="research-studio-modal__footer">
        <span className="research-studio-editor__note">
          {words} word{words === 1 ? "" : "s"} · edits live here for now — drafts save back when
          generation editing lands.
        </span>
        <button
          type="button"
          className="research-studio-act research-studio-act--primary research-studio-modal__footer-end"
          data-flash={flash === "draft"}
          onClick={() => copy("draft", text)}
        >
          {flash === "draft" ? "✓ Copied" : "⧉ Copy updated draft"}
        </button>
        <button
          type="button"
          className="research-studio-act"
          onClick={() => downloadGenerationMarkdown(generation, text)}
        >
          ⤓ Download .md
        </button>
      </footer>
    </StudioModal>
  );
}
