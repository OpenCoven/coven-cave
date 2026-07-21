/**
 * Research Studio generations — types, validation, and client fetchers.
 *
 * A generation is a shareable artifact (diagram, blog draft, slide outline,
 * infographic stat sheet, or social thread) drafted server-side from a
 * research mission's published findings. Drafting is synchronous and
 * extractive — content is derived from the mission's artifact markdown, never
 * invented — so there are no queued/rendering progress states: a generation is
 * "ready" the moment it exists, or the create call fails outright.
 *
 * Podcast and video kinds from the Studio design are deliberately absent from
 * the kind union: they need a media pipeline that does not exist yet. They are
 * described by RESEARCH_GENERATION_MEDIA_KINDS so the Studio UI can render
 * their cards disabled from one source of truth instead of minting queued
 * records that could never complete.
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

/**
 * Drafting is synchronous — a stored generation is never in-flight, so there
 * are no queued/drafting/rendering statuses and no fake progress bars.
 */
export const RESEARCH_GENERATION_STATUSES = ["ready", "failed", "cancelled"] as const;

export type ResearchGenerationStatus = (typeof RESEARCH_GENERATION_STATUSES)[number];

export function isResearchGenerationStatus(value: unknown): value is ResearchGenerationStatus {
  return (RESEARCH_GENERATION_STATUSES as readonly unknown[]).includes(value);
}

/**
 * Studio media kinds the design shows but this build cannot honestly produce.
 * The UI renders these cards disabled with the hint; nothing else consumes
 * them. Kept out of ResearchGenerationKind on purpose — see module header.
 */
export const RESEARCH_GENERATION_MEDIA_KINDS = [
  {
    kind: "podcast",
    label: "Podcast",
    hint: "Needs a media pipeline — not available yet.",
  },
  {
    kind: "short-video",
    label: "Short video",
    hint: "Needs a media pipeline — not available yet.",
  },
  {
    kind: "long-video",
    label: "Long video",
    hint: "Needs a media pipeline — not available yet.",
  },
] as const;

export type ResearchGenerationMediaKind =
  (typeof RESEARCH_GENERATION_MEDIA_KINDS)[number]["kind"];

export type ResearchGenerationSlide = {
  /** Heading text lifted from the artifact. */
  title: string;
  /** First bullets (or first body line) under that heading, verbatim. */
  bullets: string[];
};

export type ResearchGenerationThreadPost = {
  /** Position marker, e.g. "1/4" — pure structure, not content. */
  pre: string;
  /** Post text lifted from the mission title or artifact claims. */
  text: string;
};

export type ResearchGenerationStat = {
  /** The extracted number token, e.g. "4–9×", "$120", "68%". */
  value: string;
  /** The sentence/line the number came from, verbatim. */
  context: string;
};

/** Discriminated per kind; the tag always matches the generation's kind. */
export type ResearchGenerationContent =
  | { kind: "blog"; markdown: string }
  | { kind: "slides"; slides: ResearchGenerationSlide[] }
  | { kind: "thread"; posts: ResearchGenerationThreadPost[] }
  | { kind: "diagram"; mermaid: string }
  | { kind: "infographic"; stats: ResearchGenerationStat[] };

export type ResearchGeneration = {
  version: 1;
  id: string;
  familiarId: string;
  kind: ResearchGenerationKind;
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
  kind: ResearchGenerationKind;
  sourceMissionId: string;
  directions?: string;
};

export type CreateResearchGenerationValidation =
  | { ok: true; value: CreateResearchGenerationInput }
  | { ok: false; error: string };

export function validateCreateResearchGenerationInput(
  input: unknown,
): CreateResearchGenerationValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "generation input required" };
  }
  const value = input as Record<string, unknown>;
  const familiarId = typeof value.familiarId === "string" ? value.familiarId.trim() : "";
  if (!isValidResearchGenerationFamiliarId(familiarId)) {
    return { ok: false, error: "invalid familiar id" };
  }
  if (!isResearchGenerationKind(value.kind)) {
    return {
      ok: false,
      error: `invalid generation kind — expected one of ${RESEARCH_GENERATION_KINDS.join(", ")}`,
    };
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
  const directions = typeof rawDirections === "string" ? rawDirections.trim() : "";
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
      ...(directions ? { directions } : {}),
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
