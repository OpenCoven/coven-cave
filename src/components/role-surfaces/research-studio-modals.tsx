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
import { PodcastTranscript } from "@/components/role-surfaces/podcast-transcript";
import { AuthedImage } from "@/components/ui/authed-image";
import { RelativeTime } from "@/components/ui/relative-time";
import { copyText } from "@/lib/clipboard";
import {
  RESEARCH_GENERATION_DIRECTIONS_MAX_LENGTH,
  RESEARCH_GENERATION_MEDIA_KINDS,
  RESEARCH_THREAD_POST_MAX_CHARS,
  isResearchGenerationKind,
  type ResearchGeneration,
  type ResearchGenerationCreatableKind,
  type ResearchGenerationKind,
  type ResearchGenerationMediaKind,
  type ResearchGenerationReadiness,
  type ResearchMediaLength,
  type ResearchMediaProvider,
  type ResearchPodcastStyle,
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

/** Glyph/format for media cards. Labels and blurbs come from
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

export function studioMetaForKind(kind: ResearchGenerationCreatableKind): StudioKindMeta {
  if (isResearchGenerationKind(kind)) return STUDIO_KIND_META[kind];
  const media = RESEARCH_GENERATION_MEDIA_KINDS.find((entry) => entry.kind === kind);
  const presentation = STUDIO_MEDIA_PRESENTATION[kind];
  return {
    glyph: presentation.glyph,
    label: media?.label ?? kind,
    format: presentation.format,
    blurb: media?.hint ?? "Media generation is not ready.",
    tags: [presentation.format],
  };
}

// ── shared pure helpers ──────────────────────────────────────────────────────

/**
 * Missions that can act as a Studio source. Mirrors the server's
 * pickSourceArtifact rule (server/research-generations.ts): a markdown
 * artifact that is published or still working — rejected never qualifies.
 * Creating against anything else earns the POST's 409, which we surface, but
 * the source dropdown should not offer dead ends in the first place.
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

/**
 * Rendered mermaid diagram — the exact pipeline chat messages use.
 * MarkdownBlock renders the ```mermaid fence via @create-markdown/preview-mermaid
 * (lazy singleton, app theme variables), and the shared post-render wiring
 * (useWireCopyButtons → wireMermaidDiagrams) adds the expand affordance that
 * opens the fullscreen zoom/pan viewer. Render failures fall back to the
 * plugin's own error placeholder — never a blank box.
 */
export function StudioMermaidDiagram({ mermaid }: { mermaid: string }) {
  return (
    <div className="research-studio__diagram">
      <MarkdownBlock text={`\`\`\`mermaid\n${mermaid}\n\`\`\``} />
    </div>
  );
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
  return `${studioMetaForKind(generation.kind).label} — ${generation.sourceTitle}`;
}

/** Status line text — words carry the tone (color is reinforcement only),
 *  and the "ready" detail is counted from the actual content. */
export function generationStatusText(generation: ResearchGeneration): string {
  if (generation.status === "failed") {
    return `failed — ${generation.error ?? "no draft produced"}`;
  }
  if (generation.status === "cancelled") return "cancelled";
  if (generation.status === "draft") return "draft ready · review before rendering";
  if (generation.status === "queued") return "Waiting to render";
  if (generation.status === "rendering") {
    const stage =
      generation.stage === "scripting"
        ? "Scripting"
        : generation.stage === "synthesizing"
          ? "Synthesizing"
          : generation.stage === "encoding"
            ? "Encoding"
            : "Rendering";
    if (generation.progress) {
      return `${stage} · Chapter ${generation.progress.current} of ${generation.progress.total}: ${generation.progress.label}`;
    }
    return stage;
  }
  const content = generation.content;
  switch (content?.kind) {
    case "podcast":
      return content.audio?.durationMs
        ? `ready · ${Math.round(content.audio.durationMs / 1_000)}s audio`
        : "ready · audio";
    case "short-video":
    case "long-video":
      return content.video?.durationMs
        ? `ready · ${Math.round(content.video.durationMs / 1_000)}s video`
        : "ready · video";
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
    case "podcast":
      return `# ${generationTitle(generation)}\n\n${content.script
        .map((segment) =>
          segment.speaker
            ? `**${segment.speaker === "host" ? "Host" : "Guest"}:** ${segment.text}`
            : segment.text,
        )
        .join("\n\n")}\n`;
    case "short-video":
      return `# ${generationTitle(generation)}\n\n${content.storyboard
        .map(
          (scene, index) =>
            `## ${index + 1}. ${scene.title}\n\n${scene.bullets.map((bullet) => `- ${bullet}`).join("\n")}\n\n${scene.narration}`,
        )
        .join("\n\n")}\n`;
    case "long-video":
      return `# ${generationTitle(generation)}\n\n${content.chapters
        .map(
          (chapter, chapterIndex) =>
            `## ${chapterIndex + 1}. ${chapter.title}\n\n${chapter.scenes
              .map(
                (scene, sceneIndex) =>
                  `### ${chapterIndex + 1}.${sceneIndex + 1} ${scene.title}\n\n${scene.bullets.map((bullet) => `- ${bullet}`).join("\n")}\n\n${scene.narration}`,
              )
              .join("\n\n")}`,
        )
        .join("\n\n")}\n`;
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

/**
 * Download an authenticated `/api/...` artifact via the patched `window.fetch`
 * (which carries the sidecar auth token in the packaged app) instead of a
 * native `<a href>` navigation, which would 401 against the fail-closed
 * `/api/` gate. Mirrors `downloadGenerationMarkdown`'s blob-anchor flow.
 */
async function downloadGenerationArtifact(url: string, filename: string): Promise<void> {
  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    // Network failure: leave the surface as-is; the action is retryable.
  }
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
      // copyText (lib/clipboard) falls back to execCommand where
      // navigator.clipboard doesn't exist — the packaged Tauri webview and
      // other non-secure contexts — and reports whether the copy landed.
      const ok = await copyText(text);
      if (!ok) {
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
  /**
   * False parks this dialog under a stacked one (viewer under editor):
   * its focus trap AND Escape handling are disabled — one live trap at a
   * time — and the subtree goes inert/aria-hidden so Tab and AT only see
   * the top dialog. Escape therefore closes only the top dialog; closing
   * it re-activates this one (default true).
   */
  active?: boolean;
  children: ReactNode;
};

/** Mounted only while open. Focus trap + Escape + focus restore come from
 *  useFocusTrap, gated on `active`; backdrop click closes; open is announced
 *  to AT. */
function StudioModal({
  onClose,
  variant,
  labelledBy,
  announceText,
  active = true,
  children,
}: StudioModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(active, dialogRef, { onEscape: onClose });
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
      aria-hidden={active ? undefined : true}
      inert={!active || undefined}
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

export function GenerationReviewModal({
  generation,
  onRender,
  rendering,
  error,
  onClose,
}: {
  generation: ResearchGeneration;
  onRender: () => void;
  rendering: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const content = generation.content;
  return (
    <StudioModal
      onClose={onClose}
      variant="config"
      labelledBy="research-studio-review-title"
      announceText={`${studioMetaForKind(generation.kind).label} draft ready for review`}
    >
      <header className="research-studio-modal__head" data-kind={generation.kind}>
        <span className="research-studio-modal__tile" aria-hidden>{studioMetaForKind(generation.kind).glyph}</span>
        <div className="research-studio-modal__head-text">
          <span className="research-studio__kicker">Studio · review draft</span>
          <h4 id="research-studio-review-title">Review before rendering</h4>
        </div>
        <button type="button" className="research-studio-modal__close" onClick={onClose} aria-label="Close dialog">✕</button>
      </header>
      <div className="research-studio-modal__body">
        <p className="research-studio-config__note">
          This is the exact extractive source the renderer will use. Nothing is rendered until you choose Render.
        </p>
        {generation.renderConfig ? (
          <dl className="research-studio-review__config">
            <div>
              <dt>Provider</dt>
              <dd>
                {generation.renderConfig.provider === "local"
                  ? "Local"
                  : "ElevenLabs"}
              </dd>
            </div>
            <div>
              <dt>Voice</dt>
              <dd>{generation.renderConfig.voice}</dd>
            </div>
            {generation.renderConfig.voices ? (
              <>
                <div>
                  <dt>Host voice</dt>
                  <dd>{generation.renderConfig.voices.host}</dd>
                </div>
                <div>
                  <dt>Guest voice</dt>
                  <dd>{generation.renderConfig.voices.guest}</dd>
                </div>
              </>
            ) : null}
            {generation.renderConfig.style ? (
              <div>
                <dt>Style</dt>
                <dd>{generation.renderConfig.style}</dd>
              </div>
            ) : null}
            <div>
              <dt>Length</dt>
              <dd>{generation.renderConfig.length}</dd>
            </div>
          </dl>
        ) : null}
        {content?.kind === "podcast" ? (
          <PodcastTranscript
            script={content.script}
            voices={generation.renderConfig?.voices}
            voice={generation.renderConfig?.voice}
            density="compact"
          />
        ) : content?.kind === "short-video" ? (
          <ol className="research-studio-review__list">
            {content.storyboard.map((scene) => (
              <li key={scene.id}><strong>{scene.title}</strong><span>{scene.narration}</span></li>
            ))}
          </ol>
        ) : content?.kind === "long-video" ? (
          <ol className="research-studio-review__list">
            {content.chapters.map((chapter) => (
              <li key={chapter.id}>
                <strong>{chapter.title}</strong>
                <span>{chapter.scenes.map((scene) => scene.narration).join(" ")}</span>
              </li>
            ))}
          </ol>
        ) : null}
        {error ? <p role="alert" className="research-studio-config__error">{error}</p> : null}
      </div>
      <footer className="research-studio-modal__footer">
        <button type="button" className="research-studio-act research-studio-act--ghost" onClick={onClose}>Keep draft</button>
        <button type="button" className="research-studio-act research-studio-act--primary" onClick={onRender} disabled={rendering}>
          {rendering ? "Queueing…" : "Render media"}
        </button>
      </footer>
    </StudioModal>
  );
}

export function GenerationConfigModal({
  kind,
  sources,
  selectedSourceId,
  onSelectSource,
  directions,
  onDirectionsChange,
  readiness,
  mediaProvider,
  onMediaProviderChange,
  mediaVoice,
  onMediaVoiceChange,
  mediaGuestVoice,
  onMediaGuestVoiceChange,
  mediaStyle,
  onMediaStyleChange,
  mediaLength,
  onMediaLengthChange,
  error,
  creating,
  onSubmit,
  onClose,
}: {
  kind: ResearchGenerationCreatableKind;
  sources: StudioSourceOption[];
  selectedSourceId: string | null;
  onSelectSource: (id: string) => void;
  directions: string;
  onDirectionsChange: (value: string) => void;
  readiness: ResearchGenerationReadiness | null;
  mediaProvider: ResearchMediaProvider;
  onMediaProviderChange: (provider: ResearchMediaProvider) => void;
  mediaVoice: string;
  onMediaVoiceChange: (voice: string) => void;
  /** Podcast-only guest voice; empty string means one voice for both speakers. */
  mediaGuestVoice: string;
  onMediaGuestVoiceChange: (voice: string) => void;
  /** Podcast-only drafting style; ignored for video kinds. */
  mediaStyle: ResearchPodcastStyle;
  onMediaStyleChange: (style: ResearchPodcastStyle) => void;
  mediaLength: ResearchMediaLength;
  onMediaLengthChange: (length: ResearchMediaLength) => void;
  /** Server-side create failure — e.g. the 409 "no markdown artifact" message. */
  error: string | null;
  creating: boolean;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const meta = studioMetaForKind(kind);
  const isMedia = !isResearchGenerationKind(kind);
  const nearCap = directions.length >= RESEARCH_GENERATION_DIRECTIONS_MAX_LENGTH - 200;
  const mediaConfigurationError = (() => {
    if (!isMedia) return null;
    if (!readiness) return "Media readiness is still loading.";
    if (mediaProvider === "local") {
      if (!readiness.providers.local.ready) {
        return (
          readiness.providers.local.hint ??
          "Local voice rendering is not ready."
        );
      }
      if (
        !readiness.providers.local.voices.some(
          (voice) => voice.id === mediaVoice,
        )
      ) {
        return "Choose a ready local voice.";
      }
      if (
        kind === "podcast" &&
        mediaStyle !== "recap" &&
        mediaGuestVoice &&
        !readiness.providers.local.voices.some(
          (voice) => voice.id === mediaGuestVoice,
        )
      ) {
        return "Choose a ready local voice for the guest.";
      }
    } else {
      if (!readiness.providers.elevenlabs.ready) {
        return (
          readiness.providers.elevenlabs.hint ??
          "ElevenLabs voice rendering is not ready."
        );
      }
      if (!mediaVoice.trim()) return "Enter an ElevenLabs voice ID.";
    }
    if (kind === "short-video" && mediaLength === "extended") {
      return "Short video length must be brief or standard.";
    }
    return null;
  })();

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
          <label
            className="research-studio-config__label"
            htmlFor="research-studio-config-source"
          >
            Research run
          </label>
          <select
            id="research-studio-config-source"
            className="research-studio__select"
            value={selectedSourceId ?? ""}
            onChange={(event) => onSelectSource(event.target.value)}
          >
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.title}
              </option>
            ))}
          </select>
          <span className="research-studio-config__hint">
          The draft extracts from this run&rsquo;s newest markdown artifact.
          </span>
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
        {isMedia ? (
          <div className="research-studio-config__media">
            <div className="research-studio-config__field">
              <label
                className="research-studio-config__label"
                htmlFor="research-studio-config-provider"
              >
                Voice provider
              </label>
              <select
                id="research-studio-config-provider"
                className="research-studio__select focus-ring"
                value={mediaProvider}
                aria-describedby="research-studio-config-provider-help"
                aria-invalid={mediaConfigurationError ? true : undefined}
                aria-errormessage={
                  mediaConfigurationError
                    ? "research-studio-config-media-error"
                    : undefined
                }
                onChange={(event) => {
                  const provider = event.target.value as ResearchMediaProvider;
                  onMediaProviderChange(provider);
                  onMediaVoiceChange(
                    provider === "local"
                      ? (readiness?.providers.local.voices[0]?.id ?? "")
                      : (readiness?.providers.elevenlabs.defaultVoiceId ?? ""),
                  );
                }}
              >
                {readiness?.providers.local.ready ? (
                  <option value="local">Local</option>
                ) : null}
                {readiness?.providers.elevenlabs.ready ? (
                  <option value="elevenlabs">ElevenLabs</option>
                ) : null}
              </select>
              <span
                id="research-studio-config-provider-help"
                className="research-studio-config__hint"
              >
                Uses only providers verified by current readiness checks.
              </span>
            </div>

            {mediaProvider === "local" ? (
              <div className="research-studio-config__field">
                <label
                  className="research-studio-config__label"
                  htmlFor="research-studio-config-local-voice"
                >
                  Local voice
                </label>
                <select
                  id="research-studio-config-local-voice"
                  className="research-studio__select focus-ring"
                  value={mediaVoice}
                  aria-describedby="research-studio-config-voice-help"
                  aria-invalid={mediaConfigurationError ? true : undefined}
                  aria-errormessage={
                    mediaConfigurationError
                      ? "research-studio-config-media-error"
                      : undefined
                  }
                  onChange={(event) => onMediaVoiceChange(event.target.value)}
                >
                  {readiness?.providers.local.voices.map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.name} · {voice.engine}
                    </option>
                  ))}
                </select>
                <span
                  id="research-studio-config-voice-help"
                  className="research-studio-config__hint"
                >
                  Ready voices installed on this machine.
                </span>
              </div>
            ) : (
              <div className="research-studio-config__field">
                <label
                  className="research-studio-config__label"
                  htmlFor="research-studio-config-elevenlabs-voice"
                >
                  ElevenLabs voice ID
                </label>
                <input
                  id="research-studio-config-elevenlabs-voice"
                  className="research-studio-config__input focus-ring"
                  value={mediaVoice}
                  placeholder={
                    readiness?.providers.elevenlabs.defaultVoiceId ?? ""
                  }
                  aria-describedby="research-studio-config-voice-help"
                  aria-invalid={mediaConfigurationError ? true : undefined}
                  aria-errormessage={
                    mediaConfigurationError
                      ? "research-studio-config-media-error"
                      : undefined
                  }
                  onChange={(event) => onMediaVoiceChange(event.target.value)}
                />
                <span
                  id="research-studio-config-voice-help"
                  className="research-studio-config__hint"
                >
                  The exact voice ID is frozen on this draft.
                </span>
              </div>
            )}

            {kind === "podcast" ? (
              <div className="research-studio-config__field">
                <label
                  className="research-studio-config__label"
                  htmlFor="research-studio-config-style"
                >
                  Style
                </label>
                <select
                  id="research-studio-config-style"
                  className="research-studio__select focus-ring"
                  value={mediaStyle}
                  aria-describedby="research-studio-config-style-help"
                  onChange={(event) =>
                    onMediaStyleChange(event.target.value as ResearchPodcastStyle)
                  }
                >
                  <option value="breakdown">Breakdown</option>
                  <option value="debate">Debate</option>
                  <option value="interview">Interview</option>
                  <option value="recap">Recap</option>
                </select>
                <span
                  id="research-studio-config-style-help"
                  className="research-studio-config__hint"
                >
                  {mediaStyle === "breakdown"
                    ? "A host and guest walk the findings section by section."
                    : mediaStyle === "debate"
                      ? "Contested findings lead; the host pushes, the guest defends."
                      : mediaStyle === "interview"
                        ? "The host asks; the guest answers with the findings."
                        : "One narrator reads the findings straight through."}
                </span>
              </div>
            ) : null}

            {kind === "podcast" && mediaStyle !== "recap" ? (
              <div className="research-studio-config__field">
                <label
                  className="research-studio-config__label"
                  htmlFor="research-studio-config-guest-voice"
                >
                  Guest voice (optional)
                </label>
                {mediaProvider === "local" ? (
                  <select
                    id="research-studio-config-guest-voice"
                    className="research-studio__select focus-ring"
                    value={mediaGuestVoice}
                    aria-describedby="research-studio-config-guest-voice-help"
                    aria-invalid={mediaConfigurationError ? true : undefined}
                    aria-errormessage={
                      mediaConfigurationError
                        ? "research-studio-config-media-error"
                        : undefined
                    }
                    onChange={(event) =>
                      onMediaGuestVoiceChange(event.target.value)
                    }
                  >
                    <option value="">Same as host voice</option>
                    {readiness?.providers.local.voices.map((voice) => (
                      <option key={voice.id} value={voice.id}>
                        {voice.name} · {voice.engine}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="research-studio-config-guest-voice"
                    className="research-studio-config__input focus-ring"
                    value={mediaGuestVoice}
                    placeholder="Same as host voice"
                    aria-describedby="research-studio-config-guest-voice-help"
                    aria-invalid={mediaConfigurationError ? true : undefined}
                    aria-errormessage={
                      mediaConfigurationError
                        ? "research-studio-config-media-error"
                        : undefined
                    }
                    onChange={(event) =>
                      onMediaGuestVoiceChange(event.target.value)
                    }
                  />
                )}
                <span
                  id="research-studio-config-guest-voice-help"
                  className="research-studio-config__hint"
                >
                  A second voice makes the podcast a host/guest dialogue.
                </span>
              </div>
            ) : null}

            <div className="research-studio-config__field">
              <label
                className="research-studio-config__label"
                htmlFor="research-studio-config-length"
              >
                Length
              </label>
              <select
                id="research-studio-config-length"
                className="research-studio__select focus-ring"
                value={mediaLength}
                aria-describedby="research-studio-config-length-help"
                aria-invalid={mediaConfigurationError ? true : undefined}
                aria-errormessage={
                  mediaConfigurationError
                    ? "research-studio-config-media-error"
                    : undefined
                }
                onChange={(event) =>
                  onMediaLengthChange(event.target.value as ResearchMediaLength)
                }
              >
                <option value="brief">Brief</option>
                <option value="standard">Standard</option>
                {kind !== "short-video" ? (
                  <option value="extended">Extended</option>
                ) : null}
              </select>
              <span
                id="research-studio-config-length-help"
                className="research-studio-config__hint"
              >
                {kind === "podcast"
                  ? "About 3, 8, or 15 minutes."
                  : kind === "short-video"
                    ? "Up to 30 or 60 seconds."
                    : "Up to 5, 10, or 20 minutes."}
              </span>
            </div>

            {mediaConfigurationError ? (
              <p
                id="research-studio-config-media-error"
                role="alert"
                className="research-studio-config__error"
              >
                {mediaConfigurationError}
              </p>
            ) : null}
          </div>
        ) : null}
        <p className="research-studio-config__note">
          {isMedia
            ? "A source script or storyboard is drafted from the artifact before media rendering."
            : "Content is drafted extractively from the run’s artifact. Directions are stored for future pipelines and do not alter the draft."}
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
          disabled={
            creating ||
            selectedSourceId === null ||
            mediaConfigurationError !== null
          }
        >
          {creating ? "Drafting…" : `✦ ${isMedia ? "Draft for review" : "Generate"} ${meta.label}`}
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
  active = true,
}: {
  generation: ResearchGeneration;
  onClose: () => void;
  /** Blog only: open the markdown editor over the viewer. */
  onOpenEditor?: () => void;
  /** False while the markdown editor is stacked on top — parks this dialog's
   *  focus trap and Escape handling so only the editor responds. */
  active?: boolean;
}) {
  const meta = studioMetaForKind(generation.kind);
  const content = generation.content;
  const title = generationTitle(generation);
  const { flash, copy } = useCopyFlash();

  const points =
    content?.kind === "thread"
      ? {
          label: "Thread",
          rows: content.posts.map((post) => ({
            pre: post.pre,
            text: post.text,
            // Post length against the social budget — honest posting aid, and
            // the count is real data, not decoration.
            note: `${post.text.length}/${RESEARCH_THREAD_POST_MAX_CHARS}`,
          })),
        }
      : content?.kind === "infographic"
        ? {
            label: "Stat sheet",
            rows: content.stats.map((stat) => ({
              pre: stat.value,
              text: stat.context,
              note: null,
            })),
          }
        : null;

  const footerCopyText =
    content?.kind === "diagram" ? content.mermaid : generationContentToMarkdown(generation);
  const footerCopyLabel =
    content?.kind === "diagram" ? "Copy Mermaid" : content?.kind === "thread" ? "Copy thread" : "Copy";
  const mediaUrl = `/api/research/generations/media?familiarId=${encodeURIComponent(generation.familiarId)}&id=${encodeURIComponent(generation.id)}`;
  const infographicUrl =
    content?.kind === "infographic" && content.stats.length > 0
      ? `/api/research/generations/infographic?familiarId=${encodeURIComponent(generation.familiarId)}&id=${encodeURIComponent(generation.id)}`
      : null;

  return (
    <StudioModal
      onClose={onClose}
      variant="viewer"
      active={active}
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
          <div className="research-studio-viewer__diagram">
            <span className="research-studio-viewer__label">Diagram</span>
            <StudioMermaidDiagram mermaid={content.mermaid} />
            <details className="research-studio-viewer__code-details">
              <summary>Mermaid source</summary>
              <pre className="research-studio__code">{content.mermaid}</pre>
            </details>
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

        {content?.kind === "podcast" && content.audio ? (
          <div className="research-studio-viewer__media">
            <span className="research-studio-viewer__label">Podcast audio</span>
            <audio
              className="research-studio-viewer__audio"
              controls
              preload="metadata"
              src={mediaUrl}
            >
              Your browser cannot play this audio file.
            </audio>
          </div>
        ) : null}

        {/* The script rides under the player so the episode can be read along
            with — or instead of — the audio, which is the only way a dialogue
            is scannable. */}
        {content?.kind === "podcast" ? (
          <div className="research-studio-viewer__points">
            <span className="research-studio-viewer__label">Transcript</span>
            <PodcastTranscript
              script={content.script}
              voices={generation.renderConfig?.voices}
              voice={generation.renderConfig?.voice}
            />
          </div>
        ) : null}

        {(content?.kind === "short-video" || content?.kind === "long-video") && content.video ? (
          <div className="research-studio-viewer__media">
            <span className="research-studio-viewer__label">Video preview</span>
            <video
              className="research-studio-viewer__video"
              controls
              preload="metadata"
              src={mediaUrl}
            >
              Your browser cannot play this video file.
            </video>
          </div>
        ) : null}

        {infographicUrl ? (
          <div className="research-studio-viewer__media">
            <span className="research-studio-viewer__label">Infographic preview</span>
            {/* SVG format keeps the preview crisp at any zoom; the PNG export
                below rasterizes the same server-rendered poster. AuthedImage
                fetches through the patched window.fetch so the packaged app's
                /api auth gate doesn't 401 the native image load. */}
            <AuthedImage
              className="research-studio-viewer__infographic"
              src={`${infographicUrl}&format=svg`}
              alt={`Infographic poster with ${content?.kind === "infographic" ? content.stats.length : 0} extracted stats from ${generation.sourceTitle}`}
            />
          </div>
        ) : null}

        {points ? (
          <div className="research-studio-viewer__points">
            <span className="research-studio-viewer__label">{points.label}</span>
            <ul className="research-studio-viewer__point-list">
              {points.rows.map((row, rowIndex) => (
                <li key={rowIndex} className="research-studio-viewer__point">
                  <span className="research-studio-viewer__point-pre">{row.pre}</span>
                  <span className="research-studio-viewer__point-text">
                    {row.text}
                    {row.note ? (
                      <span className="research-studio-viewer__point-note">{row.note}</span>
                    ) : null}
                  </span>
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
        {(content?.kind === "podcast" && content.audio) ||
        ((content?.kind === "short-video" || content?.kind === "long-video") && content.video) ? (
          <a
            className="research-studio-act"
            href={`${mediaUrl}&download=1`}
            download
          >
            ⤓ Download media
          </a>
        ) : null}
        {infographicUrl ? (
          <>
            <button
              type="button"
              className="research-studio-act"
              onClick={() =>
                void downloadGenerationArtifact(
                  infographicUrl,
                  `infographic-${slugify(generation.sourceTitle) || generation.id}.png`,
                )
              }
            >
              ⤓ Download .png
            </button>
            <button
              type="button"
              className="research-studio-act"
              onClick={() =>
                void downloadGenerationArtifact(
                  `${infographicUrl}&format=svg`,
                  `infographic-${slugify(generation.sourceTitle) || generation.id}.svg`,
                )
              }
            >
              ⤓ Download .svg
            </button>
          </>
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
