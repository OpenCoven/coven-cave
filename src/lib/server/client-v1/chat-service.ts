// Canonical conversation-mutation domain service for the `/api/client/v1`
// facade (cave-client-v1 plan, Task 7). Everything here DELEGATES to the
// SAME internal functions the legacy Cave routes already use — there is
// exactly one conversation-mutation authority, never a forked
// reimplementation:
//
//   - create:  `createVoiceChatSession` (@/lib/server/voice-chat-create.ts),
//     the SAME domain function `/api/chat/conversation/route.ts` (voice
//     new-chat) calls, wired with the SAME `createDefaultVoiceChatCreateDeps`
//     dependency shape that route's inline `deps` mirrors, and the SAME
//     `authorizeChatProjectLaunch` project-launch gate that route uses.
//   - patch:   the SAME title/pinned/archived primitives
//     `/api/sessions/[id]/route.ts` calls (`setSessionTitle`,
//     `setSessionPinnedLocal`, `archiveSessionLocal`/`summonSessionLocal`,
//     all of @/lib/cave-config.ts) — each already owns its own title-ownership
//     rule and sessions-list-cache invalidation; this module never
//     reimplements either. After those succeed, the conversation's own
//     canonical file is re-loaded and run through the SAME `saveConversation`
//     every other mutating path uses, advancing its `updatedAt` — this
//     facade's persistence checkpoint for a patch.
//   - delete:  the SAME cleanup primitives
//     `/api/chat/conversation/[id]/route.ts`'s explicit (non-`ifEmpty`)
//     DELETE uses — plus `deleteClientConversationAttachments` for bound
//     client-v1 uploads — but reordered so every cleanup primitive runs FIRST,
//     while the conversation file still exists, and `deleteConversation` runs
//     LAST; see `deleteClientConversation`'s doc comment for why.
//
// Authorization for an EXISTING conversation (PATCH/DELETE) is fail-closed
// and OWNER-DERIVED, never caller-selected (spec-review finding): earlier
// revisions accepted an optional `?familiarId` scope, and an unscoped call
// bypassed project-grant checks entirely — a credential could widen or
// redirect which grant gate applied. Now the conversation's OWN canonical
// `familiarId` + project root (the same fields `createVoiceChatSession`
// stamped onto the file at creation) are the only authority: the owning
// familiar must still exist, and — when the conversation carries a project
// root — that familiar must still hold a live grant for it, via the SAME
// `authorizeChatProjectLaunch` gate `createClientConversation` uses. A
// rootless conversation has no project grant to check but remains scoped to
// its owning familiar's continued existence — never treated as universally
// mutable just because there is no project. Any missing/mismatched/ambiguous
// ownership signal fails closed to the SAME plain not-found used for an
// unknown id, never distinguishing the two for the caller.
//
// Every mutation response is a bounded `ConversationMutationReceipt` — id,
// familiarId, title/pinned/archivedAt, project identifiers, timestamps, and a
// digest-based revision — NEVER the internal conversation object or
// `getClientConversationDetail`'s projection (which carries the full active
// turn/message array). A receipt is what gets returned over the wire AND
// what Task 6's idempotency ledger persists to disk for replay, so this
// bound is also what keeps a huge transcript/attachment set from ever
// reaching either the client or the on-disk operation-store JSON file.
//
// This module has no knowledge of HTTP, bearer auth, or the idempotency
// ledger — those are the route handlers' job (via `requireClientPrincipal`
// and `runIdempotentMutation`). It only ever returns a discriminated result;
// it never writes a `Response` itself, so it stays testable without a
// fetch/Request shim and can never accidentally bypass a route's auth gate.

import crypto from "node:crypto";

import {
  applySessionMetadataWithCheckpoint,
  getSessionDeletionGeneration,
  loadState,
  sacrificeSessionLocal,
  withFamiliarLifecycleGuard,
  type CaveState,
} from "@/lib/cave-config";
import {
  deleteConversation,
  isSafeConversationSessionId,
  loadConversation,
  saveConversation,
  withConversationLock,
  type ConversationFile,
} from "@/lib/cave-conversations";
import { unlinkSessionFromCards } from "@/lib/cave-board";
import { projectForRoot, type CaveProject } from "@/lib/cave-projects";
import { chatProjectAccessId } from "@/lib/chat-project-access";
import { MAX_CHAT_TITLE_LENGTH, sanitizeSessionTitle } from "@/lib/cave-chat-titles";
import {
  canAccessProject,
  requiredAccessLevel,
  withProjectAccessGuard,
  type ProjectAccessSnapshot,
} from "@/lib/project-permissions";
import {
  authorizeChatProjectLaunch,
  ChatProjectLaunchError,
} from "@/lib/server/chat-project-launch";
import { validateCaveProjectRoot } from "@/lib/server/project-paths";
import { normalizeProjectRoot } from "@/lib/server/session-security";
import { cwdFromConversationRuntime } from "@/lib/server/chat-work-branch";
import {
  createVoiceChatCreateDepsFromConfig,
  createVoiceChatSession,
  type VoiceChatCreateDeps,
} from "@/lib/server/voice-chat-create";
import { isValidFamiliarId } from "@/lib/server/familiar-id";

import { deleteClientConversationAttachments } from "./attachment-service.ts";
import type { ClientV1ErrorCode } from "./contract.ts";

// ─────────────────────────────────────────────────────────────────────────
// Shared result shape
// ─────────────────────────────────────────────────────────────────────────

/**
 * A safe, stable outcome any chat-service call can return on a business-rule
 * rejection (never a thrown raw error — see the module comment). `status`/
 * `code`/`message` map directly onto `clientV1Error`; `retryable` mirrors the
 * same field on the wire envelope. Route handlers decide, from `status`
 * alone, whether an idempotency claim may be completed (< 500) or must stay
 * pending for the stale-claim retry path (>= 500) — see
 * `idempotent-mutation.ts`.
 */
export type ChatServiceErrorResult = {
  ok: false;
  status: number;
  code: ClientV1ErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

const NOT_FOUND_RESULT: ChatServiceErrorResult = {
  ok: false,
  status: 404,
  code: "not_found",
  message: "Conversation not found.",
  retryable: false,
};

function internalErrorResult(retryable = true): ChatServiceErrorResult {
  return {
    ok: false,
    status: 500,
    code: "internal_error",
    message: "An internal error occurred. Please try again later.",
    retryable,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Bounded mutation receipt
// ─────────────────────────────────────────────────────────────────────────

/**
 * The ONLY shape a create/patch mutation ever returns or persists to Task 6's
 * idempotency ledger. Deliberately a small, closed set of safe summary
 * identifiers/state — never turns, messages, prompts, tool output, or
 * attachment metadata/filesystem paths, regardless of how large the
 * underlying transcript is. `revision` is an opaque digest over exactly these
 * fields (see `computeReceiptRevision`) — distinct from
 * `read-model.ts`'s `ClientConversationSummary.revision`, which also mixes in
 * daemon-derived `status`/`preview` this receipt never carries.
 */
export type ConversationMutationReceipt = {
  id: string;
  familiarId: string;
  title: string;
  pinned: boolean;
  archivedAt: string | null;
  projectId: string | null;
  projectRoot: string | null;
  createdAt: string;
  updatedAt: string;
  revision: string;
};

function computeReceiptRevision(receipt: Omit<ConversationMutationReceipt, "revision">): string {
  const input = JSON.stringify([
    receipt.id,
    receipt.familiarId,
    receipt.title,
    receipt.pinned,
    receipt.archivedAt,
    receipt.projectId,
    receipt.projectRoot,
    receipt.createdAt,
    receipt.updatedAt,
  ]);
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * Projects a canonical `ConversationFile` (as just loaded/mutated under
 * `withConversationLock`) into the bounded receipt. Title/pinned/archived are
 * read fresh from `@/lib/cave-config.ts`'s state — the SAME source
 * `setSessionTitle`/`setSessionPinnedLocal`/`archiveSessionLocal`/
 * `summonSessionLocal` just wrote, and the SAME override precedence
 * `session-list-merge.ts` uses for the canonical list/GET title
 * (`state.sessionTitles[id] ?? sanitizeSessionTitle(conv.title) ?? "Chat"`) —
 * so the receipt's `title` never drifts from what a subsequent GET would
 * report. `projectId` is resolved from the SAME registered-project lookup
 * (`projectForRoot`) `read-model.ts` uses, never a re-derived heuristic.
 *
 * `preloadedState`, when supplied, is used verbatim instead of a fresh
 * `loadState()` — required by `patchClientConversation`'s
 * `applySessionMetadataWithCheckpoint` checkpoint, which must build this
 * receipt from the SAME in-memory, not-yet-persisted `CaveState` object the
 * just-applied title/pinned/archived patch mutated; a fresh `loadState()`
 * there would re-read the pre-patch values straight off disk.
 */
async function buildConversationReceipt(
  conv: ConversationFile,
  projects: readonly CaveProject[],
  preloadedState?: CaveState,
): Promise<ConversationMutationReceipt> {
  const state = preloadedState ?? await loadState();
  const authority = conversationProjectAuthority(conv);
  const projectRoot = authority.kind === "project" ? authority.root : null;
  const project = projectRoot ? projectForRoot(projectRoot, projects) : null;
  const base: Omit<ConversationMutationReceipt, "revision"> = {
    id: conv.sessionId,
    familiarId: conv.familiarId,
    title: state.sessionTitles[conv.sessionId] ?? sanitizeSessionTitle(conv.title) ?? "Chat",
    pinned: Boolean(state.sessionPinned?.[conv.sessionId]),
    archivedAt: state.sessionArchived[conv.sessionId] ?? null,
    projectId: project?.id ?? null,
    projectRoot,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
  };
  return { ...base, revision: computeReceiptRevision(base) };
}

type ConversationProjectAuthority =
  | { kind: "project"; root: string }
  | { kind: "rootless" }
  | { kind: "ambiguous" };

/**
 * Safe migration rule for ownership decisions:
 * - property present: authoritative root or explicit projectless (`null`);
 * - legacy `local:<cwd>`: derive the cwd, preserving existing local behavior;
 * - legacy no-runtime or the historical empty `local:` sentinel: projectless;
 * - legacy remote/SSH or malformed runtime: ambiguous and mutation-denied.
 */
function conversationProjectAuthority(
  conv: Pick<ConversationFile, "projectRoot" | "runtime">,
): ConversationProjectAuthority {
  if (Object.hasOwn(conv, "projectRoot")) {
    if (conv.projectRoot === null) return { kind: "rootless" };
    if (typeof conv.projectRoot !== "string") return { kind: "ambiguous" };
    const root = conv.projectRoot.trim();
    return root ? { kind: "project", root } : { kind: "ambiguous" };
  }

  if (conv.runtime === undefined || conv.runtime === "local:") {
    return { kind: "rootless" };
  }
  const localRoot = cwdFromConversationRuntime(conv.runtime);
  return localRoot ? { kind: "project", root: localRoot } : { kind: "ambiguous" };
}

// ─────────────────────────────────────────────────────────────────────────
// Project-launch authorization (shared by create and existing-owner checks)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Runs the SAME `authorizeChatProjectLaunch` validate/resolve/grant pipeline
 * `createClientConversation` has always used for a fresh conversation,
 * factored out so `authorizeExistingConversationOwner` (below) can gate a
 * PATCH/DELETE against an EXISTING conversation's own project root through
 * the identical gate — never a parallel reimplementation.
 *
 * Takes the caller's already-loaded `ProjectAccessSnapshot` (from
 * `withProjectAccessGuard`) rather than loading/asserting access itself: the
 * grant decision is computed with the pure, synchronous
 * `canAccessProject`/`requiredAccessLevel` directly against that snapshot,
 * never via `assertProjectAccess` (which would re-acquire the permissions
 * store's write mutex from inside the guard's own held mutex — a deadlock;
 * see `withProjectAccessGuard`'s doc comment).
 */
async function runProjectLaunchAuthorization(
  permissions: ProjectAccessSnapshot,
  projects: readonly CaveProject[],
  familiarId: string,
  rawProjectRoot: string,
): Promise<{ root: string }> {
  return authorizeChatProjectLaunch(
    {
      validateProjectRoot: validateCaveProjectRoot,
      resolveProjectId: (requestedRoot, resolvedRoot) =>
        chatProjectAccessId({
          projects: [...projects],
          requestedProjectRoot: requestedRoot,
          resolvedCwd: resolvedRoot,
        }),
      isProjectRegistered: (projectId) => projects.some((project) => project.id === projectId),
      hasProjectAccess: async (requestedFamiliarId, projectId, surface) =>
        canAccessProject(
          permissions,
          { familiarId: requestedFamiliarId },
          projectId,
          requiredAccessLevel(surface),
        ),
    },
    {
      familiarId,
      projectRoot: normalizeProjectRoot(rawProjectRoot) ?? rawProjectRoot,
      surface: "session-launch",
    },
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Existing-conversation ownership authorization (PATCH/DELETE)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Fail-closed authorization for a mutation against an ALREADY-EXISTING
 * conversation. Unlike create (where the caller supplies `familiarId`), a
 * PATCH/DELETE caller never gets to pick which familiar's grants apply — an
 * earlier revision accepted a caller-selectable `?familiarId=` scope that let
 * an unscoped call bypass grant checks entirely (a spec-review finding). The
 * conversation's OWN canonical `familiarId` + project root (the same fields
 * `createVoiceChatSession` stamped onto the file at creation, read straight
 * off the just-loaded `ConversationFile` — never from any caller input) are
 * the only authority considered here:
 *
 *   1. Missing/invalid ownership on the record itself (no/malformed
 *      `familiarId`) fails closed.
 *   2. The owning familiar must still exist (`voiceChatDeps.loadFamiliarBinding`
 *      — the SAME existence check `createClientConversation` uses).
 *   3. When the conversation carries a project root, that familiar must
 *      still hold a live grant for it, via the SAME
 *      `authorizeChatProjectLaunch` gate `createClientConversation` uses —
 *      ANY launch-authorization failure (unregistered/unavailable/ungranted/
 *      invalid) fails closed rather than leaking which specific reason
 *      blocked it.
 *   4. A rootless conversation has no project grant to check but remains
 *      scoped to its owning familiar's continued existence (step 2) — never
 *      treated as universally mutable just because there is no project.
 *
 * Every failure here collapses to the SAME plain not-found a genuinely
 * unknown conversation id would return, so a paired credential can never
 * distinguish "this id was never real" from "this id is real but you (or its
 * owning familiar) cannot touch it".
 *
 * `voiceChatDeps` is always the SAME preloaded-config-snapshot deps
 * (`@/lib/server/voice-chat-create.ts`'s `createVoiceChatCreateDepsFromConfig`)
 * `patchClientConversation`/`deleteClientConversation` build once from the
 * `withFamiliarLifecycleGuard` config snapshot their whole effect runs
 * inside — never a fresh `loadConfig()` call, which would try to reacquire
 * that guard's own dedicated lock and deadlock.
 */
async function authorizeExistingConversationOwner(
  voiceChatDeps: VoiceChatCreateDeps,
  permissions: ProjectAccessSnapshot,
  projects: readonly CaveProject[],
  conv: ConversationFile,
): Promise<{ ok: true } | ChatServiceErrorResult> {
  const ownerFamiliarId = conv.familiarId?.trim();
  if (!ownerFamiliarId || !isValidFamiliarId(ownerFamiliarId)) {
    return NOT_FOUND_RESULT;
  }

  const binding = await voiceChatDeps.loadFamiliarBinding(ownerFamiliarId);
  if (!binding) {
    return NOT_FOUND_RESULT;
  }

  const projectAuthority = conversationProjectAuthority(conv);
  if (projectAuthority.kind === "ambiguous") {
    return NOT_FOUND_RESULT;
  }
  if (projectAuthority.kind === "rootless") {
    // Rootless still owner-scoped: no project grant to check, but the
    // familiar-exists check above already ran and must have passed.
    return { ok: true };
  }

  try {
    await runProjectLaunchAuthorization(
      permissions,
      projects,
      ownerFamiliarId,
      projectAuthority.root,
    );
  } catch (error) {
    if (error instanceof ChatProjectLaunchError) {
      return NOT_FOUND_RESULT;
    }
    throw error;
  }

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────
// Create
// ─────────────────────────────────────────────────────────────────────────

export type CreateConversationInput = {
  familiarId: string;
  /** Explicit `null` means no project — never omit this field. */
  projectRoot: string | null;
};

const CREATE_CONVERSATION_KEYS: ReadonlySet<string> = new Set(["familiarId", "projectRoot"]);
const MAX_PROJECT_ROOT_LENGTH = 4096; // mirrors normalizeProjectRoot's own bound

/**
 * Strictly parses the create-conversation request body: exactly
 * `{ familiarId: string, projectRoot: string | null }`, nothing more, nothing
 * less. Throws a plain `Error` with a client-safe message on any deviation
 * (extra/missing keys, wrong types, an out-of-shape familiar id, or an
 * unbounded/empty project root string) — the route maps that message onto a
 * 400 `invalid_request`.
 */
export function parseCreateConversationInput(value: unknown): CreateConversationInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be a JSON object.");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== CREATE_CONVERSATION_KEYS.size ||
    !keys.every((key) => CREATE_CONVERSATION_KEYS.has(key))
  ) {
    throw new Error('Request body must contain exactly "familiarId" and "projectRoot".');
  }

  if (typeof record.familiarId !== "string") {
    throw new Error('"familiarId" must be a string.');
  }
  const familiarId = record.familiarId.trim();
  if (!isValidFamiliarId(familiarId)) {
    throw new Error('"familiarId" is not a valid familiar id.');
  }

  if (record.projectRoot !== null && typeof record.projectRoot !== "string") {
    throw new Error('"projectRoot" must be a string or null.');
  }
  let projectRoot: string | null = null;
  if (typeof record.projectRoot === "string") {
    const trimmed = record.projectRoot.trim();
    if (!trimmed || trimmed.length > MAX_PROJECT_ROOT_LENGTH) {
      throw new Error('"projectRoot" must be a non-empty path of a bounded length.');
    }
    projectRoot = trimmed;
  }

  return { familiarId, projectRoot };
}

export type CreateConversationResult =
  | { ok: true; conversation: ConversationMutationReceipt }
  | ChatServiceErrorResult;

/**
 * Creates an empty canonical conversation for a standalone client — the SAME
 * `createVoiceChatSession` flow `/api/chat/conversation/route.ts` (voice
 * new-chat) uses, gated by the SAME familiar-existence check and the SAME
 * `authorizeChatProjectLaunch` project grant as that route, but tolerating an
 * explicit `projectRoot: null` (no project) — the standalone client, unlike
 * the voice surface, has no product requirement that every chat carry a
 * project. When a project root IS supplied, it goes through the exact same
 * validate/resolve/grant pipeline as the voice route so a client-v1 caller
 * can never mint a conversation against a project it (or its bound familiar)
 * has no access to.
 *
 * `effectId` is the deterministic id `runIdempotentMutation`
 * (idempotent-mutation.ts) derives from THIS request's full idempotency
 * composite identity (`deriveIdempotentEffectId`) — the route's real POST
 * handler always supplies it; the default (a fresh random UUID) exists only
 * so every pre-existing direct/unit-test call site that predates this
 * parameter keeps working unchanged. `createVoiceChatSession` mints the new
 * conversation's session id FROM this value via its existing `mintSessionId`
 * dependency seam — never a freshly random one — so a retry under the SAME
 * `Idempotency-Key` (whether because the first attempt's completion could
 * not be confirmed, or because its claim was reclaimed after abandonment or
 * ledger repair) reproduces the EXACT same conversation id.
 *
 * Before minting, this reconciles against that id: if a conversation already
 * exists at `effectId`, this is necessarily a retry (a fresh random UUID
 * collision is not a real-world concern) — when its owner familiar AND
 * resolved project root exactly match this request's, the SAME bounded
 * receipt is returned rather than overwriting or recreating anything, so a
 * completion failure followed by a same-key retry can never produce a
 * second conversation. A mismatch instead fails closed with a 409 conflict —
 * this facade never overwrites an existing conversation's identity, and
 * never silently hands back a conversation that belongs to a different
 * request.
 *
 * The entire authorization decision and the create effect itself run inside
 * `withFamiliarLifecycleGuard` (@/lib/cave-config.ts, OUTER — cave-client-v1
 * plan Task 7 followup) and `withProjectAccessGuard`
 * (@/lib/project-permissions.ts, INSIDE it, only when `input.projectRoot` is
 * non-null): a familiar-removal racing this call either fully precedes it
 * (this call then 404s on the familiar-existence check) or fully follows it
 * (this call's effect is already durable before the removal can apply), and
 * a grant/group revocation racing this call either fully precedes it (this
 * call then fails closed) or fully follows it (this call's effect is already
 * durable before the revocation can apply) — never interleaved either way.
 * The familiar binding lookup uses a deps object built from the guard's own
 * preloaded config snapshot (`createVoiceChatCreateDepsFromConfig`) rather
 * than a fresh `loadConfig()` call — the guard's callback must never
 * reacquire its own dedicated lock.
 */
export async function createClientConversation(
  input: CreateConversationInput,
  effectId: string = crypto.randomUUID(),
): Promise<CreateConversationResult> {
  return withFamiliarLifecycleGuard(async (config) => {
    const voiceChatDeps = createVoiceChatCreateDepsFromConfig(config);
    return withProjectAccessGuard(async (permissions, projects) => {
      const binding = await voiceChatDeps.loadFamiliarBinding(input.familiarId);
      if (!binding) {
        return { ...NOT_FOUND_RESULT, message: "That familiar does not exist." };
      }

      let projectRoot: string | null = null;
      if (input.projectRoot !== null) {
        try {
          const authorized = await runProjectLaunchAuthorization(
            permissions,
            projects,
            input.familiarId,
            input.projectRoot,
          );
          projectRoot = authorized.root;
        } catch (error) {
          if (error instanceof ChatProjectLaunchError) {
            return {
              ok: false,
              status: error.status,
              code: error.code === "project_access_denied" ? "forbidden" : "invalid_request",
              message: error.message,
              retryable: false,
              details: { reason: error.code },
            };
          }
          throw error;
        }
      }

      return withConversationLock(effectId, async () => {
        // The canonical file and sacrifice tombstone are one decision under
        // the same lock explicit DELETE uses. A sacrificed deterministic id is
        // terminal even if an earlier completion/ledger write was lost.
        const [existing, state] = await Promise.all([
          loadConversation(effectId),
          loadState(),
        ]);
        if (state.sessionSacrificed[effectId]) {
          return {
            ok: false,
            status: 409,
            code: "conflict",
            message: "This conversation was deleted and cannot be recreated.",
            retryable: false,
          };
        }

        // Reconciliation for a same-key retry — see this function's doc comment.
        if (existing) {
          const existingAuthority = conversationProjectAuthority(existing);
          const existingProjectRoot =
            existingAuthority.kind === "project"
              ? existingAuthority.root
              : existingAuthority.kind === "rootless"
                ? null
                : undefined;
          if (existing.familiarId === input.familiarId && existingProjectRoot === projectRoot) {
            return { ok: true, conversation: await buildConversationReceipt(existing, projects, state) };
          }
          return {
            ok: false,
            status: 409,
            code: "conflict",
            message: "This request's identity already resolved to a different conversation.",
            retryable: false,
          };
        }

        const created = await createVoiceChatSession(
          { ...voiceChatDeps, mintSessionId: () => effectId },
          { familiarId: input.familiarId, projectRoot },
        );
        if (!created.ok) {
          if (created.error === "familiar_not_found") {
            return { ...NOT_FOUND_RESULT, message: "That familiar does not exist." };
          }
          return internalErrorResult();
        }

        const conv = await loadConversation(created.sessionId);
        if (!conv) return internalErrorResult();
        return { ok: true, conversation: await buildConversationReceipt(conv, projects) };
      });
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Patch
// ─────────────────────────────────────────────────────────────────────────

export type PatchConversationInput = {
  title?: string;
  pinned?: boolean;
  archived?: boolean;
};

const PATCH_CONVERSATION_KEYS: ReadonlySet<string> = new Set(["title", "pinned", "archived"]);
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;

/**
 * Strictly parses the patch request body: only `title`/`pinned`/`archived`
 * keys are permitted, at least one must be present, and each present field
 * must match its exact type and bound (a non-empty, control-character-free
 * title of at most `MAX_CHAT_TITLE_LENGTH`). Throws a plain `Error` with a
 * client-safe message on any deviation — the route maps that message onto a
 * 400 `invalid_request`. This never accepts `familiarId`, `projectRoot`,
 * `turns`, `status`, or `revision` — a client can never mutate those fields
 * through this endpoint.
 */
export function parsePatchConversationInput(value: unknown): PatchConversationInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be a JSON object.");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 0) {
    throw new Error("Request body must include at least one of \"title\", \"pinned\", \"archived\".");
  }
  if (!keys.every((key) => PATCH_CONVERSATION_KEYS.has(key))) {
    throw new Error('Request body may only contain "title", "pinned", and "archived".');
  }

  const result: PatchConversationInput = {};

  if ("title" in record) {
    if (typeof record.title !== "string") throw new Error('"title" must be a string.');
    const trimmed = record.title.trim();
    if (!trimmed || trimmed.length > MAX_CHAT_TITLE_LENGTH || CONTROL_CHAR_RE.test(trimmed)) {
      throw new Error(
        `"title" must be a non-empty string of at most ${MAX_CHAT_TITLE_LENGTH} characters with no control characters.`,
      );
    }
    result.title = trimmed;
  }

  if ("pinned" in record) {
    if (typeof record.pinned !== "boolean") throw new Error('"pinned" must be a boolean.');
    result.pinned = record.pinned;
  }

  if ("archived" in record) {
    if (typeof record.archived !== "boolean") throw new Error('"archived" must be a boolean.');
    result.archived = record.archived;
  }

  return result;
}

export type PatchConversationResult =
  | { ok: true; conversation: ConversationMutationReceipt }
  | ChatServiceErrorResult;

/**
 * Applies a bounded `{title?, pinned?, archived?}` patch to one conversation
 * as a SINGLE atomic transaction spanning both the cave-state.json metadata
 * write AND the conversation file's own `saveConversation` checkpoint — see
 * `@/lib/cave-config.ts`'s `applySessionMetadataWithCheckpoint` for the
 * all-or-none guarantee this relies on: if the checkpoint (this patch's
 * `saveConversation` call) fails, NONE of the requested title/pinned/archived
 * fields are ever durably written; if the state save that follows a
 * successful checkpoint fails, the same holds (the conversation file's
 * `updatedAt` may have advanced, but no metadata field landed) — a retry
 * under the SAME Idempotency-Key is always safe.
 *
 * Authorization and every mutation run inside `withFamiliarLifecycleGuard`
 * (@/lib/cave-config.ts, OUTERMOST — cave-client-v1 plan Task 7 followup),
 * `withProjectAccessGuard` (@/lib/project-permissions.ts, INSIDE it), and
 * `withConversationLock(sessionId, ...)` (@/lib/cave-conversations.ts,
 * INNERMOST) — that lock order (never reversed) is what lets a familiar
 * removal or a grant/group revocation racing this call either fully precede
 * it (this call then fails closed) or fully follow it (this call's effect is
 * already durable first), while still giving this facade the SAME
 * per-conversation serialization the legacy conversation routes already rely
 * on:
 *
 *   1. Two different Idempotency-Keys patching the same conversation
 *      execute their mutations one at a time, never interleaved.
 *   2. A PATCH racing a DELETE on the same id is deterministic: whichever
 *      acquires the conversation lock first runs to completion before the
 *      other's existence check (re-run AFTER acquiring the lock, not just
 *      before) observes the conversation. A DELETE that wins never gets
 *      "resurrected" by a PATCH that started first but is still waiting on
 *      the lock — that PATCH's re-check inside the lock sees the
 *      conversation is gone and 404s instead of writing stray
 *      `pinned`/`title`/`archived` state for a session id nothing
 *      references anymore.
 *
 * Authorization is derived ENTIRELY from the just-loaded conversation's own
 * canonical `familiarId`/project root (`authorizeExistingConversationOwner`)
 * — never from any caller-supplied scope. A conversation whose owning
 * familiar no longer exists, or no longer holds its project grant, 404s
 * exactly like an unknown id, never distinguishing the two for the caller.
 *
 * Title/pinned/archived are applied through the exact same pure mutators
 * `setSessionTitle`/`setSessionPinnedLocal`/`archiveSessionLocal`/
 * `summonSessionLocal` themselves call — `applySessionMetadataWithCheckpoint`
 * never duplicates or reimplements that ownership/sanitize/provenance logic.
 * The checkpoint it runs re-loads the conversation's OWN canonical file
 * (never given title/pinned/archived fields of its own — those remain
 * cave-config.ts state) and passes it through the SAME `saveConversation`
 * (@/lib/cave-conversations.ts) every other conversation-mutating path uses:
 * it stamps a fresh `updatedAt`, atomically rewrites the file, and busts the
 * per-file summary cache and the sessions-list cache again. The response is
 * a bounded `ConversationMutationReceipt` (see above), built from the SAME
 * in-memory, not-yet-persisted metadata state the patch just applied (never
 * a second disk read that could race the pending state save) — never the
 * `getClientConversationDetail` projection, so a rename/pin/archive can
 * never balloon the response (or its persisted idempotency-ledger entry)
 * with the conversation's full turn/message history.
 */
export async function patchClientConversation(
  sessionId: string,
  input: PatchConversationInput,
): Promise<PatchConversationResult> {
  if (!isSafeConversationSessionId(sessionId)) return NOT_FOUND_RESULT;

  return withFamiliarLifecycleGuard((config) => {
    const voiceChatDeps = createVoiceChatCreateDepsFromConfig(config);
    return withProjectAccessGuard((permissions, projects) =>
      withConversationLock(sessionId, async () => {
        const conv = await loadConversation(sessionId);
        if (!conv) return NOT_FOUND_RESULT;

        const authorized = await authorizeExistingConversationOwner(
          voiceChatDeps,
          permissions,
          projects,
          conv,
        );
        if (!authorized.ok) return authorized;

        return applySessionMetadataWithCheckpoint(sessionId, input, async (state) => {
          // This is the patch's persistence checkpoint: re-load the latest
          // on-disk file (picking up anything a concurrent write inside this
          // SAME conversation-lock critical section may have changed) and run
          // it through `saveConversation`. A throw here propagates out of
          // `applySessionMetadataWithCheckpoint`'s transaction, so the
          // title/pinned/archived mutation just applied to `state` is
          // discarded rather than persisted — the route's idempotency wrapper
          // never records a false "completed" mutation for a partially-applied
          // patch.
          const latest = await loadConversation(sessionId);
          if (!latest) {
            throw new Error("conversation disappeared during patch checkpoint");
          }
          await saveConversation(latest);
          return {
            ok: true as const,
            conversation: await buildConversationReceipt(latest, projects, state),
          };
        });
      }),
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Delete
// ─────────────────────────────────────────────────────────────────────────

export type DeleteConversationResult =
  | { ok: true; id: string; deleted: true }
  | ChatServiceErrorResult;

export type AuthorizedClientConversationResult<T> =
  | { ok: true; value: T; deletionGeneration?: number }
  | ChatServiceErrorResult;

/**
 * Run a send/retry authorization and its launch setup under the same canonical
 * familiar -> project -> conversation lock order used by Task 7 mutations.
 * The effect receives the canonical record; caller-supplied owner/grant fields
 * are never inputs to the authorization decision.
 */
export async function withAuthorizedClientConversation<T>(
  sessionId: string,
  effect: (conversation: ConversationFile) => Promise<T>,
): Promise<AuthorizedClientConversationResult<T>> {
  if (!isSafeConversationSessionId(sessionId)) return NOT_FOUND_RESULT;
  return withFamiliarLifecycleGuard((config) => {
    const voiceChatDeps = createVoiceChatCreateDepsFromConfig(config);
    return withProjectAccessGuard((permissions, projects) =>
      withConversationLock(sessionId, async () => {
        const conversation = await loadConversation(sessionId);
        if (!conversation) return NOT_FOUND_RESULT;
        const authorized = await authorizeExistingConversationOwner(
          voiceChatDeps,
          permissions,
          projects,
          conversation,
        );
        if (!authorized.ok) return authorized;
        // This read is deliberately inside the same cross-process conversation
        // fence as authorization. Client-v1 carries it through reservation
        // and launch so a later DELETE cannot be undone by transcript writes.
        const deletionGeneration = await getSessionDeletionGeneration(sessionId);
        return {
          ok: true as const,
          value: await effect(conversation),
          deletionGeneration,
        };
      }),
    );
  });
}

/**
 * Deletes one conversation through the exact same cleanup primitives
 * `/api/chat/conversation/[id]/route.ts`'s explicit (non-`ifEmpty`) DELETE
 * uses — plus `deleteClientConversationAttachments` (drops any bound
 * client-v1 attachment records/files), `sacrificeSessionLocal` (marks the
 * session id soft-deleted so a stale retried write can never resurrect it,
 * and drops any daemon-side session state), and `unlinkSessionFromCards`
 * (drops any Board card affiliation) — but in a deliberately DIFFERENT order
 * than that route: this facade runs EVERY cleanup step FIRST, while the
 * canonical conversation file still exists, and only calls
 * `deleteConversation` (removes the file,
 * busts the sessions-list cache) LAST. That ordering is what makes a
 * mid-cleanup failure safely resumable under the SAME Idempotency-Key: if
 * `deleteClientConversationAttachments`/`sacrificeSessionLocal`/
 * `unlinkSessionFromCards` throws, the conversation file is untouched and this
 * call's per-conversation lock is released without ever reaching
 * `deleteConversation` — a retry (same key, same conversation still loadable)
 * starts from the exact same state rather than from a half-deleted,
 * unrecoverable one. Every cleanup primitive is itself idempotent:
 * `deleteClientConversationAttachments` re-removes any already-deleted
 * canonical files and only rewrites the ownership index once, and
 * `sacrificeSessionLocal`/`unlinkSessionFromCards` can safely re-run too.
 * All four calls run inside the SAME `withConversationLock(sessionId, ...)`
 * critical
 * section a concurrent PATCH on this id also uses — see
 * `patchClientConversation`'s doc comment for the race this guarantees.
 *
 * Authorization is derived ENTIRELY from the just-loaded conversation's own
 * canonical `familiarId`/project root (`authorizeExistingConversationOwner`)
 * — never from any caller-supplied scope. A conversation outside its owning
 * familiar's project grants (or one that simply does not exist) 404s exactly
 * like PATCH/GET — a repeat DELETE call for an already-deleted id 404s on
 * the second call rather than silently reporting `{ deleted: false }`.
 *
 * `deleteConversation`'s own result is trusted literally: it returns `false`
 * on ANY unlink failure. That is a TRANSIENT failure, not a durable outcome
 * — it is surfaced as a retryable >= 500 `service_unavailable`, NEVER as a
 * cacheable 409/2xx, so `runIdempotentMutation`'s caller-side idempotency
 * wrapper never persists/completes it (see idempotent-mutation.ts: only
 * responses < 500 are ever recorded as "completed"). The claim behind this
 * Idempotency-Key stays pending/reclaimable; a same-key retry after reclaim
 * re-runs this same cleanup-then-delete sequence (every cleanup step having
 * already run in that case is harmless — they are idempotent, see above) and
 * can succeed once the transient condition clears. This conversation is
 * therefore NEVER left in a state where a client is told "conflict,
 * permanent" for a delete that merely hasn't happened yet — the record
 * still exists, and the SAME key remains the correct, safe way to retry it.
 * Any cleanup-step failure (`deleteClientConversationAttachments`/
 * `sacrificeSessionLocal`/`unlinkSessionFromCards` throwing) propagates as a
 * thrown error rather than being swallowed, so it surfaces consistently
 * through the route's normal error path instead of a silently-incomplete
 * "success" — and, per the reordering above, with the conversation file still
 * fully intact for that retry.
 */
export async function deleteClientConversation(sessionId: string): Promise<DeleteConversationResult> {
  if (!isSafeConversationSessionId(sessionId)) return NOT_FOUND_RESULT;

  return withFamiliarLifecycleGuard((config) => {
    const voiceChatDeps = createVoiceChatCreateDepsFromConfig(config);
    return withProjectAccessGuard((permissions, projects) =>
      withConversationLock(sessionId, async () => {
        const conv = await loadConversation(sessionId);
        if (!conv) return NOT_FOUND_RESULT;

        const authorized = await authorizeExistingConversationOwner(
          voiceChatDeps,
          permissions,
          projects,
          conv,
        );
        if (!authorized.ok) return authorized;

        // Cleanup runs FIRST, while the canonical conversation file still
        // exists — see this function's doc comment for why the order matters.
        await deleteClientConversationAttachments(sessionId);
        await sacrificeSessionLocal(sessionId);
        await unlinkSessionFromCards(sessionId);

        const deleted = await deleteConversation(sessionId);
        if (!deleted) {
          // A TRANSIENT failure, never a durable/cacheable outcome — see this
          // function's doc comment. >= 500 here is load-bearing: it is the
          // ONLY thing that stops `runIdempotentMutation` from calling
          // `completeOperation` and permanently recording an incomplete
          // delete as "done".
          return {
            ok: false,
            status: 503,
            code: "service_unavailable",
            message: "The conversation could not be deleted. Please retry.",
            retryable: true,
          };
        }

        return { ok: true, id: sessionId, deleted: true };
      }),
    );
  });
}
