/**
 * Research Studio generations — types, validation, and client fetchers.
 *
 * Extractive generations (diagram, blog draft, slide outline, infographic stat
 * sheet, or social thread) are drafted synchronously from a research mission's
 * published findings. Media generations are an explicit asynchronous contract:
 * they can be queued/rendering and carry a script/storyboard before a media
 * file exists. Neither path invents content from editorial directions.
 *
 * Media creation remains capability-gated until the runner and readiness
 * surfaces are available. Keeping the media union separate from the
 * extractive union prevents synchronous drafters from accidentally accepting
 * an asynchronous kind.
 */

export const RESEARCH_GENERATION_KINDS = [
  "diagram",
  "blog",
  "slides",
  "infographic",
  "thread",
] as const;

export type ResearchGenerationKind = (typeof RESEARCH_GENERATION_KINDS)[number];

export function isResearchGenerationKind(value: unknown): value is ResearchGenerationKind {
  return (RESEARCH_GENERATION_KINDS as readonly unknown[]).includes(value);
}

/** Media and extractive statuses share one stored contract; kind-specific
 * validation below keeps queued/rendering out of synchronous records. */
export const RESEARCH_GENERATION_STATUSES = [
  "draft",
  "queued",
  "rendering",
  "ready",
  "failed",
  "cancelled",
] as const;

export type ResearchGenerationStatus = (typeof RESEARCH_GENERATION_STATUSES)[number];

export function isResearchGenerationStatus(value: unknown): value is ResearchGenerationStatus {
  return (RESEARCH_GENERATION_STATUSES as readonly unknown[]).includes(value);
}

export function isResearchGenerationStatusForKind(
  kind: ResearchGenerationCreatableKind,
  status: unknown,
): status is ResearchGenerationStatus {
  if (!isResearchGenerationStatus(status)) return false;
  return isResearchGenerationMediaKind(kind)
    ? true
    : status === "ready" || status === "failed" || status === "cancelled";
}

export const RESEARCH_GENERATION_STAGES = [
  "scripting",
  "synthesizing",
  "encoding",
] as const;

export type ResearchGenerationStage = (typeof RESEARCH_GENERATION_STAGES)[number];

export function isResearchGenerationStage(value: unknown): value is ResearchGenerationStage {
  return (RESEARCH_GENERATION_STAGES as readonly unknown[]).includes(value);
}

/** Media generation kinds exposed by Studio. Readiness is resolved at runtime. */
export const RESEARCH_GENERATION_MEDIA_KINDS = [
  {
    kind: "podcast",
    label: "Podcast",
    hint: "An audio briefing narrated from the artifact's cited findings.",
  },
  {
    kind: "short-video",
    label: "Short video",
    hint: "A concise video built from the artifact's key claims.",
  },
  {
    kind: "long-video",
    label: "Long video",
    hint: "A chaptered video built from the artifact's sections.",
  },
] as const;

export type ResearchGenerationMediaKind =
  (typeof RESEARCH_GENERATION_MEDIA_KINDS)[number]["kind"];

export function isResearchGenerationMediaKind(
  value: unknown,
): value is ResearchGenerationMediaKind {
  return RESEARCH_GENERATION_MEDIA_KINDS.some((media) => media.kind === value);
}

export type ResearchGenerationCreatableKind =
  | ResearchGenerationKind
  | ResearchGenerationMediaKind;

export function isResearchGenerationCreatableKind(
  value: unknown,
): value is ResearchGenerationCreatableKind {
  return isResearchGenerationKind(value) || isResearchGenerationMediaKind(value);
}

export const RESEARCH_GENERATION_CREATABLE_KINDS = [
  ...RESEARCH_GENERATION_KINDS,
  ...RESEARCH_GENERATION_MEDIA_KINDS.map((entry) => entry.kind),
] as const;

export type ResearchMediaProvider = "local" | "elevenlabs";
export type ResearchMediaLength = "brief" | "standard" | "extended";
export type ResearchPodcastSpeaker = "host" | "guest";

export const RESEARCH_PODCAST_STYLES = [
  "breakdown",
  "debate",
  "interview",
  "recap",
] as const;
export type ResearchPodcastStyle = (typeof RESEARCH_PODCAST_STYLES)[number];

export function isResearchPodcastStyle(
  value: unknown,
): value is ResearchPodcastStyle {
  return RESEARCH_PODCAST_STYLES.includes(value as ResearchPodcastStyle);
}

export type ResearchMediaRenderConfig = {
  provider: ResearchMediaProvider;
  /** Primary voice; also the fallback for any segment without a speaker map. */
  voice: string;
  length: ResearchMediaLength;
  /**
   * Podcast only: per-speaker voices for dialogue scripts. Absent means every
   * segment renders with `voice`, which keeps single-voice configs unchanged.
   */
  voices?: { host: string; guest: string };
  /**
   * Podcast only: drafting style. Absent means "breakdown" — old stored
   * configs keep validating and re-draft exactly as the default style.
   */
  style?: ResearchPodcastStyle;
};

export type ResearchGenerationProgress = {
  unit: "chapter";
  current: number;
  total: number;
  label: string;
};

export const RESEARCH_MEDIA_LENGTH_LIMITS = {
  podcast: {
    brief: { maxCharacters: 2_700 },
    standard: { maxCharacters: 7_200 },
    extended: { maxCharacters: 13_500 },
  },
  "short-video": {
    // These conservative source budgets leave time for slow technical terms,
    // citations, and provider-specific pacing. The renderer still measures the
    // real audio and enforces the duration cap before publication.
    brief: { maxDurationMs: 30_000, maxScenes: 6, maxCharacters: 300 },
    standard: { maxDurationMs: 60_000, maxScenes: 12, maxCharacters: 600 },
  },
  "long-video": {
    brief: { maxDurationMs: 300_000, maxChapters: 4, maxScenes: 20 },
    standard: { maxDurationMs: 600_000, maxChapters: 8, maxScenes: 40 },
    extended: { maxDurationMs: 1_200_000, maxChapters: 12, maxScenes: 80 },
  },
} as const;

export type ResearchMediaRenderConfigValidation =
  | { ok: true; value: ResearchMediaRenderConfig }
  | { ok: false; error: string };

export function validateResearchMediaRenderConfig(
  kind: unknown,
  input: unknown,
): ResearchMediaRenderConfigValidation {
  if (!isResearchGenerationMediaKind(kind)) {
    return { ok: false, error: "render config is only valid for media generations" };
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "media render config required" };
  }
  const value = input as Record<string, unknown>;
  if (value.provider !== "local" && value.provider !== "elevenlabs") {
    return { ok: false, error: "media provider must be local or elevenlabs" };
  }
  const voice = typeof value.voice === "string" ? value.voice.trim() : "";
  if (!voice || voice.length > 128) {
    return { ok: false, error: "media voice must be between 1 and 128 characters" };
  }
  if (
    value.length !== "brief" &&
    value.length !== "standard" &&
    value.length !== "extended"
  ) {
    return { ok: false, error: "media length must be brief, standard, or extended" };
  }
  if (kind === "short-video" && value.length === "extended") {
    return { ok: false, error: "short video length must be brief or standard" };
  }
  let voices: { host: string; guest: string } | undefined;
  if (value.voices !== undefined) {
    if (kind !== "podcast") {
      return { ok: false, error: "per-speaker voices are only valid for podcasts" };
    }
    if (!value.voices || typeof value.voices !== "object" || Array.isArray(value.voices)) {
      return { ok: false, error: "media voices must map host and guest voices" };
    }
    const pair = value.voices as Record<string, unknown>;
    const host = typeof pair.host === "string" ? pair.host.trim() : "";
    const guest = typeof pair.guest === "string" ? pair.guest.trim() : "";
    if (!host || host.length > 128 || !guest || guest.length > 128) {
      return {
        ok: false,
        error: "host and guest voices must be between 1 and 128 characters",
      };
    }
    voices = { host, guest };
  }
  let style: ResearchPodcastStyle | undefined;
  if (value.style !== undefined) {
    if (kind !== "podcast") {
      return { ok: false, error: "podcast style is only valid for podcasts" };
    }
    if (!isResearchPodcastStyle(value.style)) {
      return {
        ok: false,
        error: "podcast style must be breakdown, debate, interview, or recap",
      };
    }
    style = value.style;
  }
  return {
    ok: true,
    value: {
      provider: value.provider,
      voice,
      length: value.length,
      ...(voices ? { voices } : {}),
      ...(style ? { style } : {}),
    },
  };
}

export function isResearchGenerationProgress(
  value: unknown,
): value is ResearchGenerationProgress {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const progress = value as Record<string, unknown>;
  return (
    progress.unit === "chapter" &&
    typeof progress.current === "number" &&
    Number.isSafeInteger(progress.current) &&
    progress.current >= 1 &&
    typeof progress.total === "number" &&
    Number.isSafeInteger(progress.total) &&
    progress.total >= progress.current &&
    progress.total <= 64 &&
    typeof progress.label === "string" &&
    progress.label.trim().length >= 1 &&
    progress.label.trim().length <= 120
  );
}

export type ResearchGenerationSlide = {
  /** Heading text lifted from the artifact. */
  title: string;
  /** First bullets (or first body line) under that heading, verbatim. */
  bullets: string[];
};

export type ResearchGenerationThreadPost = {
  /** Position marker, e.g. "1/4" — pure structure, not content. */
  pre: string;
  /**
   * Post text lifted from the mission title or artifact claims, clamped to
   * RESEARCH_THREAD_POST_MAX_CHARS at a word boundary (mechanical truncation
   * marked with "…" — never rephrased).
   */
  text: string;
};

/**
 * Social post budget: the thread drafter clamps each post's text to this many
 * characters (the common short-post ceiling), and the Studio viewer shows the
 * per-post count against it.
 */
export const RESEARCH_THREAD_POST_MAX_CHARS = 280;

export type ResearchGenerationStat = {
  /** The extracted number token, e.g. "4–9×", "$120", "68%". */
  value: string;
  /** The sentence/line the number came from, verbatim. */
  context: string;
};

export type ResearchGenerationScriptSegment = {
  /** Stable segment id used by the runner for progress and cancellation. */
  id: string;
  /** Extracted narration text, never generated from directions. */
  text: string;
  /**
   * Dialogue speaker for two-voice podcasts. Absent on single-narrator
   * scripts, which render entirely with the config's primary voice.
   */
  speaker?: ResearchPodcastSpeaker;
};

export type ResearchGenerationStoryboardScene = {
  /** Stable scene id used by the renderer for progress and cancellation. */
  id: string;
  title: string;
  bullets: string[];
  narration: string;
};

export type ResearchGenerationVideoChapter = {
  id: string;
  title: string;
  scenes: ResearchGenerationStoryboardScene[];
};

export type ResearchGenerationMediaFileRef = {
  /** Filename/key relative to the generation's media directory. */
  key: string;
  mimeType: string;
  sizeBytes: number;
  durationMs?: number;
  provider?: ResearchMediaProvider;
  voice?: string;
};

/** Discriminated per kind; the tag always matches the generation's kind. */
export type ResearchGenerationContent =
  | { kind: "blog"; markdown: string }
  | { kind: "slides"; slides: ResearchGenerationSlide[] }
  | { kind: "thread"; posts: ResearchGenerationThreadPost[] }
  | { kind: "diagram"; mermaid: string }
  | { kind: "infographic"; stats: ResearchGenerationStat[] }
  | {
      kind: "podcast";
      script: ResearchGenerationScriptSegment[];
      audio?: ResearchGenerationMediaFileRef;
    }
  | {
      kind: "short-video";
      storyboard: ResearchGenerationStoryboardScene[];
      video?: ResearchGenerationMediaFileRef;
    }
  | {
      kind: "long-video";
      chapters: ResearchGenerationVideoChapter[];
      video?: ResearchGenerationMediaFileRef;
    };

export type ResearchGeneration = {
  version: 2;
  id: string;
  familiarId: string;
  kind: ResearchGenerationCreatableKind;
  /** Mission the content was extracted from. */
  sourceMissionId: string;
  /** Mission title at draft time, so the card survives mission archival. */
  sourceTitle: string;
  /** Artifact the markdown was read from (mission artifact key). */
  sourceArtifactKey?: string;
  /**
   * User directions, stored verbatim for display and forwarded to future
   * pipelines. NEVER used to synthesize content — extraction stays purely
   * mechanical so no directed emphasis can invent facts.
   */
  directions?: string;
  status: ResearchGenerationStatus;
  /**
   * Required for every newly drafted media record. Optional on the stored
   * shape only so pre-contract WIP records remain inspectable after upgrade.
   */
  renderConfig?: ResearchMediaRenderConfig;
  /** Coarse, persisted media stage; absent for terminal records. */
  stage?: ResearchGenerationStage;
  /** Real chapter position when a long render can report a bounded unit. */
  progress?: ResearchGenerationProgress;
  createdAt: string;
  updatedAt: string;
  /** Present when status is "ready". */
  content?: ResearchGenerationContent;
  /** Present when status is "failed" or "cancelled". */
  error?: string;
};

export function isResearchGenerationContent(
  value: unknown,
): value is ResearchGenerationContent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const content = value as Record<string, unknown>;
  const isMediaFileRef = (candidate: unknown): candidate is ResearchGenerationMediaFileRef => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
    const file = candidate as Record<string, unknown>;
    return (
      typeof file.key === "string" &&
      file.key.length > 0 &&
      !file.key.includes("/") &&
      !file.key.includes("\\") &&
      typeof file.mimeType === "string" &&
      file.mimeType.length > 0 &&
      typeof file.sizeBytes === "number" &&
      Number.isSafeInteger(file.sizeBytes) &&
      file.sizeBytes >= 0 &&
      (file.durationMs === undefined ||
        (typeof file.durationMs === "number" &&
          Number.isSafeInteger(file.durationMs) &&
          file.durationMs >= 0)) &&
      (file.provider === undefined || file.provider === "local" || file.provider === "elevenlabs") &&
      (file.voice === undefined ||
        (typeof file.voice === "string" &&
          file.voice.trim().length > 0 &&
          file.voice === file.voice.trim() &&
          file.voice.length <= 128))
    );
  };
  const isScript = (candidate: unknown): candidate is ResearchGenerationScriptSegment[] =>
    Array.isArray(candidate) &&
    candidate.every(
      (segment) =>
        segment &&
        typeof segment === "object" &&
        typeof (segment as ResearchGenerationScriptSegment).id === "string" &&
        (segment as ResearchGenerationScriptSegment).id.length > 0 &&
        typeof (segment as ResearchGenerationScriptSegment).text === "string" &&
        ((segment as ResearchGenerationScriptSegment).speaker === undefined ||
          (segment as ResearchGenerationScriptSegment).speaker === "host" ||
          (segment as ResearchGenerationScriptSegment).speaker === "guest"),
    );
  const isStoryboard = (candidate: unknown): candidate is ResearchGenerationStoryboardScene[] =>
    Array.isArray(candidate) &&
    candidate.every(
      (scene) =>
        scene &&
        typeof scene === "object" &&
        typeof (scene as ResearchGenerationStoryboardScene).id === "string" &&
        (scene as ResearchGenerationStoryboardScene).id.length > 0 &&
        typeof (scene as ResearchGenerationStoryboardScene).title === "string" &&
        Array.isArray((scene as ResearchGenerationStoryboardScene).bullets) &&
        (scene as ResearchGenerationStoryboardScene).bullets.every(
          (bullet) => typeof bullet === "string",
        ) &&
        typeof (scene as ResearchGenerationStoryboardScene).narration === "string",
    );
  switch (content.kind) {
    case "blog":
      return typeof content.markdown === "string";
    case "diagram":
      return typeof content.mermaid === "string";
    case "slides":
      return (
        Array.isArray(content.slides) &&
        content.slides.every(
          (slide) =>
            slide &&
            typeof slide === "object" &&
            typeof (slide as ResearchGenerationSlide).title === "string" &&
            Array.isArray((slide as ResearchGenerationSlide).bullets) &&
            (slide as ResearchGenerationSlide).bullets.every(
              (bullet) => typeof bullet === "string",
            ),
        )
      );
    case "thread":
      return (
        Array.isArray(content.posts) &&
        content.posts.every(
          (post) =>
            post &&
            typeof post === "object" &&
            typeof (post as ResearchGenerationThreadPost).pre === "string" &&
            typeof (post as ResearchGenerationThreadPost).text === "string",
        )
      );
    case "infographic":
      return (
        Array.isArray(content.stats) &&
        content.stats.every(
          (stat) =>
            stat &&
            typeof stat === "object" &&
            typeof (stat as ResearchGenerationStat).value === "string" &&
            typeof (stat as ResearchGenerationStat).context === "string",
        )
      );
    case "podcast":
      return (
        isScript(content.script) &&
        (content.audio === undefined || isMediaFileRef(content.audio))
      );
    case "short-video":
      return (
        isStoryboard(content.storyboard) &&
        (content.video === undefined || isMediaFileRef(content.video))
      );
    case "long-video":
      return (
        Array.isArray(content.chapters) &&
        content.chapters.every(
          (chapter) =>
            chapter &&
            typeof chapter === "object" &&
            typeof (chapter as ResearchGenerationVideoChapter).id === "string" &&
            (chapter as ResearchGenerationVideoChapter).id.length > 0 &&
            typeof (chapter as ResearchGenerationVideoChapter).title === "string" &&
            (chapter as ResearchGenerationVideoChapter).title.length > 0 &&
            isStoryboard((chapter as ResearchGenerationVideoChapter).scenes),
        ) &&
        (content.video === undefined || isMediaFileRef(content.video))
      );
    default:
      return false;
  }
}

// Mirrors the id shapes enforced by the mission validator and mission store
// (research-missions.ts / server/research-mission-store.ts) — kept local so
// this module stays dependency-free for the client bundle.
const FAMILIAR_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const MISSION_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const RESEARCH_GENERATION_DIRECTIONS_MAX_LENGTH = 2_000;

export function isValidResearchGenerationFamiliarId(value: unknown): value is string {
  return (
    typeof value === "string" && FAMILIAR_ID_RE.test(value) && !value.includes("..")
  );
}

export type CreateResearchGenerationInput = {
  familiarId: string;
  kind: ResearchGenerationCreatableKind;
  sourceMissionId: string;
  directions?: string;
  renderConfig?: ResearchMediaRenderConfig;
};

export type CreateResearchGenerationValidationOptions = {
  allowMedia?: boolean;
};

export type CreateResearchGenerationValidation =
  | { ok: true; value: CreateResearchGenerationInput }
  | { ok: false; error: string };

export function validateCreateResearchGenerationInput(
  input: unknown,
  options: CreateResearchGenerationValidationOptions = {},
): CreateResearchGenerationValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "generation input required" };
  }
  const value = input as Record<string, unknown>;
  const familiarId = typeof value.familiarId === "string" ? value.familiarId.trim() : "";
  if (!isValidResearchGenerationFamiliarId(familiarId)) {
    return { ok: false, error: "invalid familiar id" };
  }
  if (!isResearchGenerationCreatableKind(value.kind)) {
    return {
      ok: false,
      error: `invalid generation kind — expected one of ${RESEARCH_GENERATION_CREATABLE_KINDS.join(", ")}`,
    };
  }
  if (isResearchGenerationMediaKind(value.kind) && !options.allowMedia) {
    return { ok: false, error: "media generation is not enabled" };
  }
  let renderConfig: ResearchMediaRenderConfig | undefined;
  if (isResearchGenerationMediaKind(value.kind)) {
    const validatedConfig = validateResearchMediaRenderConfig(value.kind, value.renderConfig);
    if (!validatedConfig.ok) return validatedConfig;
    renderConfig = validatedConfig.value;
  } else if (value.renderConfig !== undefined) {
    return { ok: false, error: "render config is only valid for media generations" };
  }
  const sourceMissionId =
    typeof value.sourceMissionId === "string" ? value.sourceMissionId.trim() : "";
  if (!MISSION_ID_RE.test(sourceMissionId)) {
    return { ok: false, error: "invalid source mission id" };
  }
  const rawDirections = value.directions;
  if (rawDirections !== undefined && rawDirections !== null && typeof rawDirections !== "string") {
    return { ok: false, error: "directions must be a string" };
  }
  const directions = typeof rawDirections === "string" ? rawDirections : "";
  if (directions.length > RESEARCH_GENERATION_DIRECTIONS_MAX_LENGTH) {
    return {
      ok: false,
      error: `directions must be at most ${RESEARCH_GENERATION_DIRECTIONS_MAX_LENGTH} characters`,
    };
  }
  return {
    ok: true,
    value: {
      familiarId,
      kind: value.kind,
      sourceMissionId,
      ...(directions.trim() ? { directions } : {}),
      ...(renderConfig ? { renderConfig } : {}),
    },
  };
}

// ── client fetchers (research-mission-client style) ──────────────────────────

export type ResearchGenerationListResponse = {
  ok: boolean;
  generations?: ResearchGeneration[];
  error?: string;
};

export type ResearchGenerationResponse = {
  ok: boolean;
  generation?: ResearchGeneration;
  error?: string;
};

export type ResearchGenerationDeleteResponse = {
  ok: boolean;
  error?: string;
};

export type ResearchGenerationCancelResponse = {
  ok: boolean;
  generation?: ResearchGeneration;
  error?: string;
};

export type ResearchMediaReadyVoice = {
  id: string;
  name: string;
  engine: "piper" | "kokoro";
};

export type ResearchMediaReadiness = {
  providers: {
    local: {
      ready: boolean;
      voices: ResearchMediaReadyVoice[];
      hint?: string;
    };
    elevenlabs: {
      ready: boolean;
      defaultVoiceId: string;
      hint?: string;
    };
  };
  /** True only when both ffmpeg and ffprobe are available. */
  ffmpeg: { ready: boolean; hint?: string };
  podcast: { ready: boolean; hint?: string };
  shortVideo: { ready: boolean; hint?: string };
  longVideo: { ready: boolean; hint?: string };
};

export type ResearchGenerationReadiness = ResearchMediaReadiness;

export type ResearchGenerationReadinessResponse =
  | ({ ok: true } & ResearchGenerationReadiness)
  | { ok: false; error: string };

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export async function listResearchGenerations(
  familiarId: string,
  signal?: AbortSignal,
): Promise<ResearchGenerationListResponse> {
  const response = await fetch(
    `/api/research/generations?familiarId=${encodeURIComponent(familiarId)}`,
    { cache: "no-store", signal },
  );
  return readJson<ResearchGenerationListResponse>(response);
}

export async function createResearchGeneration(
  input: CreateResearchGenerationInput,
): Promise<ResearchGenerationResponse> {
  const response = await fetch("/api/research/generations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJson<ResearchGenerationResponse>(response);
}

export async function renderResearchGeneration(
  id: string,
  familiarId: string,
): Promise<ResearchGenerationResponse> {
  const response = await fetch("/api/research/generations/render", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, familiarId }),
  });
  return readJson<ResearchGenerationResponse>(response);
}

export async function removeResearchGeneration(
  id: string,
  familiarId: string,
): Promise<ResearchGenerationDeleteResponse> {
  const response = await fetch("/api/research/generations", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, familiarId }),
  });
  return readJson<ResearchGenerationDeleteResponse>(response);
}

export async function cancelResearchGeneration(
  id: string,
  familiarId: string,
): Promise<ResearchGenerationCancelResponse> {
  const response = await fetch("/api/research/generations/cancel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, familiarId }),
  });
  return readJson<ResearchGenerationCancelResponse>(response);
}

export async function getResearchGenerationReadiness(
  signal?: AbortSignal,
): Promise<ResearchGenerationReadinessResponse> {
  const response = await fetch("/api/research/generations/readiness", {
    cache: "no-store",
    signal,
  });
  return readJson<ResearchGenerationReadinessResponse>(response);
}
