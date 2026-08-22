/**
 * Just-in-time hydration of attached X posts into a research mission run, and
 * the removal that has to outlive the run.
 *
 * Contract (docs/superpowers/specs/2026-07-27-x-api-research-and-publishing-design.md,
 * "Mission source attachment"):
 *
 * - The DURABLE ledger stores identity and the user's own note only —
 *   provider, post id, canonical URL, availability. No post body, ever.
 * - Post text is written to `<workspace>/runtime/x/` immediately before the
 *   iteration launches, and removed the moment the mission leaves an active
 *   status. It is never indexed, embedded, published, or copied anywhere else.
 * - A source that cannot be hydrated never silently disappears: a deleted post
 *   is recorded durably and named to the iteration as unavailable, and every
 *   other failure refuses the launch instead of running short of the evidence
 *   the user attached.
 *
 * Deliberately NOT the same thing as research-link-materialization.ts, which
 * writes X *Articles* permanently into `source-files/` and is supposed to.
 */
import type { ResearchMission, ResearchSourceRef } from "../research-missions.ts";
import { XApiError, type NormalizedXPost, type XErrorCode } from "../x-api.ts";
import {
  RESEARCH_MISSION_X_RUNTIME_DIR,
  removeResearchMissionXRuntime,
  sweepResearchMissionXRuntimeResidue,
  writeResearchMissionXRuntimeFiles,
} from "./research-mission-store.ts";
import type { SavedXSource, XSourceAvailability } from "./x-sources.ts";

/**
 * Crash residue older than this belongs to a dead process. It matches the X
 * post cache TTL on purpose: hydrated text is derived from that cache, so this
 * window promises hydrated content never outlives the cache entry it came from.
 */
export const X_RUNTIME_RESIDUE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Statuses in which a mission may legitimately hold hydrated post text. */
const ACTIVE_RESEARCH_STATUSES: ReadonlySet<ResearchMission["status"]> = new Set([
  "queued",
  "planning",
  "running",
]);

export function researchMissionHoldsXRuntime(status: ResearchMission["status"]): boolean {
  return ACTIVE_RESEARCH_STATUSES.has(status);
}

export type HydratedXSourceFile = {
  postId: string;
  canonicalUrl: string;
  authorUsername: string;
  /** POSIX-joined, relative to the mission workspace. */
  relativePath: string;
};

export type UnavailableXSource = {
  postId: string;
  canonicalUrl: string;
  reason: "deleted";
};

export type ResearchMissionXHydration = {
  files: HydratedXSourceFile[];
  unavailable: UnavailableXSource[];
  /** Identity-only refs to merge into the mission's durable ledger. */
  sources: ResearchSourceRef[];
};

export const EMPTY_X_HYDRATION: ResearchMissionXHydration = {
  files: [],
  unavailable: [],
  sources: [],
};

/**
 * An attached source could not be hydrated for a reason that is not a durable
 * fact about the post. The launch is refused rather than run without evidence
 * the user explicitly attached.
 */
export class ResearchMissionXHydrationError extends Error {
  declare readonly code: XErrorCode | "internal";
  declare readonly postId: string | undefined;

  constructor(code: XErrorCode | "internal", message: string, postId?: string) {
    super(message);
    this.name = "ResearchMissionXHydrationError";
    this.code = code;
    this.postId = postId;
  }
}

export type XHydrationDependencies = {
  listSavedXSources(familiarId: string): Promise<SavedXSource[]>;
  getCachedXPost(postId: string): Promise<NormalizedXPost | null>;
  cacheNormalizedXPosts(posts: NormalizedXPost[]): Promise<void>;
  markXPostAvailability(postId: string, availability: XSourceAvailability): Promise<void>;
  requireXResearchCapability(familiarId: string): Promise<void>;
  lookupXPost(familiarId: string, postId: string): Promise<NormalizedXPost>;
};

async function productionDependencies(): Promise<XHydrationDependencies> {
  // Dynamic: x-access.ts pulls in next/server for its error mapper, and the
  // research runner must stay importable outside a Next request context.
  const [sources, access, client] = await Promise.all([
    import("./x-sources.ts"),
    import("./x-access.ts"),
    import("./x-client.ts"),
  ]);
  return {
    listSavedXSources: sources.listSavedXSources,
    getCachedXPost: (postId) => sources.getCachedXPost(postId),
    cacheNormalizedXPosts: (posts) => sources.cacheNormalizedXPosts(posts),
    markXPostAvailability: (postId, availability) =>
      sources.markXPostAvailability(postId, availability),
    requireXResearchCapability: (familiarId) =>
      access.requireXCapability(familiarId, "research"),
    lookupXPost: (familiarId, postId) =>
      access.withXAuthenticatedRead(
        familiarId,
        ["tweet.read", "users.read"],
        (accessToken) => client.lookupXPost(accessToken, postId),
      ),
  };
}

function runtimeFileName(postId: string): string {
  return `x-post-${postId}.md`;
}

/**
 * The temporary file the iteration reads. Everything here is reproducible from
 * the X post cache; nothing here is a durable Cave record.
 */
function renderRuntimePost(post: NormalizedXPost, note: string): string {
  const lines = [
    `# X post ${post.id}`,
    "",
    `- Post ID: ${post.id}`,
    `- Canonical URL: ${post.canonicalUrl}`,
    `- Author: @${post.author.username}`,
    `- Posted: ${post.createdAt}`,
  ];
  if (note.trim()) lines.push(`- Your note when you saved it: ${note.trim()}`);
  lines.push(
    "",
    "This file is TEMPORARY. Cave rehydrated it for this iteration only and",
    "removes it when the iteration ends. Cite and synthesize it like any other",
    "source, but do not copy the post body into sources.json, findings.md, or",
    "any other durable file — record the canonical URL and post ID instead.",
    "",
    "---",
    "",
    post.text,
    "",
  );
  return lines.join("\n");
}

/**
 * The one and only shape an X post takes in the durable mission ledger.
 *
 * Both writers go through here — the attach route, so an attachment is visible
 * before any run, and hydration, so each run refreshes availability — which is
 * what makes "identity and the user's note only" a single auditable rule
 * rather than a convention two call sites have to remember.
 */
export function xSourceLedgerRef(
  source: SavedXSource,
  availability: XSourceAvailability = source.availability,
  authorUsername: string | null = usernameFromCanonicalUrl(source.canonicalUrl),
): ResearchSourceRef {
  // Identity and the user's own note only. Nothing derived from the post body
  // reaches this object, which is what keeps the durable ledger clean.
  return {
    id: `x-post-${source.postId}`,
    title: authorUsername
      ? `X post by @${authorUsername} (${source.postId})`
      : `X post ${source.postId}`,
    url: source.canonicalUrl,
    sourceType: "x-post",
    publisher: "X",
    ...(source.note.trim() ? { note: source.note.trim() } : {}),
    status: "candidate",
    provider: "x",
    externalId: source.postId,
    availability,
  };
}

/** Author handle recoverable from the saved canonical URL alone. */
function usernameFromCanonicalUrl(canonicalUrl: string): string | null {
  const match = /^https:\/\/x\.com\/([A-Za-z0-9_]{1,15})\/status\/\d+$/.exec(canonicalUrl);
  return match ? match[1] : null;
}

function hydrationFailure(error: unknown, postId: string): ResearchMissionXHydrationError {
  if (error instanceof XApiError) {
    return new ResearchMissionXHydrationError(
      error.code,
      `An X source attached to this mission could not be retrieved (${error.safeMessage}). Resolve it or detach the source, then retry.`,
      postId,
    );
  }
  return new ResearchMissionXHydrationError(
    "internal",
    "An X source attached to this mission could not be retrieved. Resolve it or detach the source, then retry.",
    postId,
  );
}

/**
 * Rehydrate every X source attached to `mission` into its `runtime/x/`
 * directory, immediately before the iteration launches.
 *
 * Familiar-scoped throughout: only sources saved under `mission.familiarId`
 * are even read, so a source claiming a foreign mission id can never be
 * hydrated into it.
 */
export async function hydrateMissionXSources(
  mission: Pick<ResearchMission, "id" | "familiarId">,
  overrides: Partial<XHydrationDependencies> = {},
): Promise<ResearchMissionXHydration> {
  const deps: XHydrationDependencies = {
    ...await productionDependencies(),
    ...overrides,
  };

  // A mission with no attached X sources must not touch X config, credentials
  // or the network, and must still clear residue from a previous run.
  const saved = await deps.listSavedXSources(mission.familiarId);
  const attached = saved.filter((source) => source.attachedMissionIds.includes(mission.id));
  if (attached.length === 0) {
    await removeResearchMissionXRuntime(mission.id);
    return EMPTY_X_HYDRATION;
  }

  // Fail closed on the capability BEFORE any content is resolved: an attached
  // source on a familiar whose X research is switched off must stop the run,
  // not quietly hydrate.
  await deps.requireXResearchCapability(mission.familiarId).catch((error: unknown) => {
    throw hydrationFailure(error, attached[0].postId);
  });

  const files: HydratedXSourceFile[] = [];
  const unavailable: UnavailableXSource[] = [];
  const sources: ResearchSourceRef[] = [];
  const pending: Array<{ fileName: string; content: string }> = [];

  // Resolve everything before writing anything, so a blocking failure leaves
  // no partially hydrated directory behind for the next reader to trust.
  for (const source of attached) {
    if (source.availability === "deleted") {
      unavailable.push({
        postId: source.postId,
        canonicalUrl: source.canonicalUrl,
        reason: "deleted",
      });
      sources.push(xSourceLedgerRef(
        source,
        "deleted",
        usernameFromCanonicalUrl(source.canonicalUrl),
      ));
      continue;
    }

    let post = await deps.getCachedXPost(source.postId);
    if (!post) {
      try {
        post = await deps.lookupXPost(mission.familiarId, source.postId);
      } catch (error) {
        // A not-found IS the answer, and a durable one: record it, omit the
        // file, and let the run proceed knowing the post is gone. Every other
        // failure is transient or a configuration fault, and running without
        // the attached evidence would misrepresent the mission's inputs.
        if (error instanceof XApiError && error.code === "not-found") {
          await deps.markXPostAvailability(source.postId, "deleted");
          unavailable.push({
            postId: source.postId,
            canonicalUrl: source.canonicalUrl,
            reason: "deleted",
          });
          sources.push(xSourceLedgerRef(
            source,
            "deleted",
            usernameFromCanonicalUrl(source.canonicalUrl),
          ));
          continue;
        }
        throw hydrationFailure(error, source.postId);
      }
      await deps.cacheNormalizedXPosts([post]);
    }

    const fileName = runtimeFileName(source.postId);
    pending.push({ fileName, content: renderRuntimePost(post, source.note) });
    files.push({
      postId: source.postId,
      canonicalUrl: post.canonicalUrl,
      authorUsername: post.author.username,
      relativePath: `${RESEARCH_MISSION_X_RUNTIME_DIR}/${fileName}`,
    });
    sources.push(xSourceLedgerRef(source, "available", post.author.username));
  }

  try {
    await writeResearchMissionXRuntimeFiles(mission.id, pending);
  } catch (error) {
    // Never leave half a hydration on disk.
    await removeResearchMissionXRuntime(mission.id).catch(() => {});
    throw hydrationFailure(error, attached[0].postId);
  }
  return { files, unavailable, sources };
}

/**
 * Merge identity-only X refs into a mission's durable ledger, keyed on
 * provider identity so repeated hydration updates one entry instead of piling
 * up duplicates.
 */
export function mergeXSourceRefs(
  stored: ResearchSourceRef[],
  hydrated: ResearchSourceRef[],
): ResearchSourceRef[] {
  if (hydrated.length === 0) return stored;
  const sameSource = (item: ResearchSourceRef, ref: ResearchSourceRef) => (
    (item.provider === "x" && item.externalId === ref.externalId)
    || item.id === ref.id
    || (Boolean(ref.url) && item.url === ref.url)
  );
  let next = [...stored];
  for (const ref of hydrated) {
    const index = next.findIndex((item) => sameSource(item, ref));
    if (index < 0) {
      next = [...next, ref];
      continue;
    }
    // The user's own edits to the ledger entry survive; only the fields
    // hydration is authoritative for are refreshed.
    next[index] = {
      ...next[index],
      url: ref.url,
      sourceType: ref.sourceType,
      provider: ref.provider,
      externalId: ref.externalId,
      availability: ref.availability,
    };
  }
  return next;
}

/**
 * Remove a mission's hydrated post text. Called from every place a run can
 * stop, and never allowed to fail a caller: three independent mechanisms
 * perform this removal (settle, next launch, startup sweep), so one of them
 * failing is retried rather than escalated.
 */
export async function dropMissionXRuntime(missionId: string): Promise<void> {
  await removeResearchMissionXRuntime(missionId);
}

/**
 * Application-startup sweep for runtime residue a killed process left behind.
 */
export async function sweepResearchMissionXRuntime(
  now: Date = new Date(),
): Promise<string[]> {
  return sweepResearchMissionXRuntimeResidue(X_RUNTIME_RESIDUE_MAX_AGE_MS, now);
}
