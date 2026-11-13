/**
 * In-place ways out of an access limit in Chat (#6445).
 *
 * Explore runs a familiar read-only (Claude in native plan mode). When a chat
 * is limited or a turn is refused for access, Chat offers one action that can
 * actually work, and never one that cannot:
 * - Explore -> Build for this chat, unless the runtime reports Build
 *   unavailable (Claude without Coven `--write-scope`).
 * - A read-only project -> grant the familiar write access (the person
 *   confirms, the server's grant route logs it, and Undo restores the previous
 *   direct grant), or retry in Explore. Both changes carry the grant the
 *   person saw as a precondition, so the route refuses either one (409
 *   `grant_changed`) if someone else changed the grant in between.
 * - A runtime that can't enforce Explore -> retry in Build.
 * - A runtime write-scope blocker -> retry in Explore.
 *
 * Access changes here are always an explicit press by the person. Nothing in
 * a model's output can trigger them, and the grant route accepts only the
 * local desktop (or the opted-in phone).
 */
import type { CommandPermissionMode } from "./command-controls.ts";

/** Whether this chat's runtime can run a Build turn, as the server reports it. */
export type ChatBuildAccess =
  | { available: true }
  | { available: false; code: string; message: string };

/**
 * The send route's refusal for a Claude Build turn when the installed Coven
 * has no `--write-scope` (#6393). One copy, so the model-state report and the
 * refusal say the same thing.
 */
export function claudeBuildUnavailableMessage(permissionForwarding: boolean): string {
  return permissionForwarding
    ? "Full access is unavailable for Claude on this runtime. Choose a runtime that can enforce project write access, then retry."
    : "This runtime cannot safely apply project write access. Update Coven and restart Cave, then retry.";
}

/**
 * What model-state reports about Build. Only the known blocker is reported
 * unavailable: a local Claude binding whose Coven can't apply project write
 * scope. Everything else is "not known to be blocked"; the send route still
 * decides every turn.
 */
export function chatBuildAccessFor(input: {
  harness: string;
  localBinding: boolean;
  writeScopeSupported: boolean;
  permissionForwarding: boolean;
}): ChatBuildAccess {
  if (input.harness !== "claude" || !input.localBinding || input.writeScopeSupported) return { available: true };
  return { available: false, code: "scoped_write_unavailable", message: claudeBuildUnavailableMessage(input.permissionForwarding) };
}

/** Read `access.build` from a model-state response. Unknown or malformed -> null (the send route decides). */
export function parseChatBuildAccess(json: unknown): ChatBuildAccess | null {
  if (!json || typeof json !== "object") return null;
  const build = (json as { access?: { build?: unknown } }).access?.build;
  if (!build || typeof build !== "object") return null;
  const record = build as { available?: unknown; code?: unknown; message?: unknown };
  if (record.available === true) return { available: true };
  if (record.available === false && typeof record.message === "string" && record.message.trim()) {
    return {
      available: false,
      code: typeof record.code === "string" && record.code ? record.code : "build_unavailable",
      message: record.message.trim(),
    };
  }
  return null;
}

type ToolTrail = ReadonlyArray<{ name?: string; input?: string }> | undefined;

const PLAN_FILE = /(?:^|[\\/])\.claude[\\/]plans[\\/][^\\/]+\.md\b/;

/**
 * True when an Explore turn finished a Claude plan. Claude Code's `-p` plan
 * mode writes the plan under `~/.claude/plans/` and then reaches for an
 * ExitPlanMode tool that `-p` does not offer, so the tool trail is the only
 * signal (its result frame carries no permission denial).
 */
export function planReadyFromTools(tools: ToolTrail): boolean {
  if (!tools?.length) return false;
  return tools.some((tool) => {
    const name = tool.name ?? "";
    const input = tool.input ?? "";
    if (name === "ExitPlanMode") return true;
    if (/\bExitPlanMode\b/.test(input)) return true;
    return (name === "Write" || name === "Edit" || name === "MultiEdit") && PLAN_FILE.test(input);
  });
}

/** Refusal codes Chat answers with an access action. */
export const ACCESS_REFUSAL_CODES = [
  "project_write_access_required",
  "read_only_unavailable",
  "scoped_write_unavailable",
  "runtime_write_scope_unavailable",
  "write_scope_environment_unsupported",
  "write_scope_aliases_unsupported",
  "write_scope_path_unsupported",
  "write_scope_profile_unqualified",
  "write_permission_denied",
] as const;
export type AccessRefusalCode = (typeof ACCESS_REFUSAL_CODES)[number];

export function isAccessRefusalCode(code: unknown): code is AccessRefusalCode {
  return typeof code === "string" && (ACCESS_REFUSAL_CODES as readonly string[]).includes(code);
}

export type AccessFixAction = "grant-write-retry" | "retry-explore" | "retry-build" | "open-project-access";

/**
 * The actions that can clear a refusal. Order is display order; the first is
 * primary. An empty list means only the message (and Retry/Dismiss) applies.
 */
export function accessRefusalActions(input: {
  code: AccessRefusalCode;
  /** The access the refused turn asked for. */
  requested: CommandPermissionMode;
  buildAccess: ChatBuildAccess | null;
  /** The familiar's effective access to the chat's project, when known. */
  projectAccess: "read" | "write" | null;
  /** A registered project and familiar the grant can name. */
  canGrant: boolean;
}): AccessFixAction[] {
  const buildRunnable = input.buildAccess?.available !== false;
  switch (input.code) {
    case "project_write_access_required":
      // A grant only helps where Build can run. Elsewhere the retry would be
      // refused again by the runtime, so Explore is the one working action.
      return [...(input.canGrant && buildRunnable ? ["grant-write-retry" as const] : []), "retry-explore"];
    case "read_only_unavailable":
      // Build is an escalation the person chooses; offer it only when it can run.
      return buildRunnable && input.projectAccess !== "read" ? ["retry-build"] : [];
    case "write_permission_denied":
      // The runtime sandbox refused a path outside this familiar's grants.
      return ["open-project-access"];
    default:
      // Every write-scope blocker is a runtime limit. Explore still works.
      return input.requested === "full" ? ["retry-explore"] : [];
  }
}

/** Continuation sent by "Build this plan". The route replays the transcript into the new Build session. */
export const BUILD_PLAN_PROMPT = "Go ahead and build the plan above.";

// Per-chat access (Build or Explore) chosen from these actions. The composer's
// Access menu stays the shared default; this only overrides it for one chat.
const OVERRIDES_KEY = "cave:chat-access-overrides:v1";
const OVERRIDES_LIMIT = 100;
const MODES: readonly CommandPermissionMode[] = ["read", "full"];

function readOverrides(storage: Pick<Storage, "getItem"> | null): Array<[string, CommandPermissionMode]> {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(OVERRIDES_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is [string, CommandPermissionMode] =>
      Array.isArray(entry) && typeof entry[0] === "string" && entry[0].length > 0 && MODES.includes(entry[1] as CommandPermissionMode));
  } catch {
    return [];
  }
}

export function readChatAccessOverride(
  storage: Pick<Storage, "getItem"> | null,
  sessionId: string | null | undefined,
): CommandPermissionMode | null {
  if (!sessionId) return null;
  return readOverrides(storage).find(([id]) => id === sessionId)?.[1] ?? null;
}

/** Record (or with `null`, clear) one chat's access. Keeps the newest {@link OVERRIDES_LIMIT} chats. */
export function writeChatAccessOverride(
  storage: Pick<Storage, "getItem" | "setItem"> | null,
  sessionId: string | null | undefined,
  mode: CommandPermissionMode | null,
): void {
  if (!storage || !sessionId) return;
  const rest = readOverrides(storage).filter(([id]) => id !== sessionId);
  const next = mode ? [...rest, [sessionId, mode] as [string, CommandPermissionMode]] : rest;
  try {
    storage.setItem(OVERRIDES_KEY, JSON.stringify(next.slice(-OVERRIDES_LIMIT)));
  } catch {
    /* best effort: the in-memory choice still applies to this view */
  }
}

/** A grant the person just made from Chat, with what Undo restores. */
export type ChatGrantUndo = {
  familiarId: string;
  familiarName: string;
  projectId: string;
  projectName: string;
  /** The familiar's direct grant before the change; null means none (Undo revokes). */
  previous: "read" | "write" | null;
  /** The level this change set; Undo applies only while it is still current. */
  granted: "read" | "write";
};

/** A grant change the route refused, with its stable code when it sent one. */
export class GrantChangeError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = "GrantChangeError";
    this.status = status;
    this.code = code;
  }
}

type Fetch = typeof fetch;

async function grantRequest(fetchImpl: Fetch, method: "POST" | "DELETE", body: Record<string, unknown>): Promise<void> {
  const res = await fetchImpl("/api/project-grants", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: unknown; code?: unknown } | null;
  if (!res.ok || json?.ok !== true) {
    throw new GrantChangeError(
      typeof json?.error === "string" && json.error ? json.error : `grant change failed (${res.status})`,
      res.status,
      typeof json?.code === "string" ? json.code : null,
    );
  }
}

/** The familiar's current direct grant on the project, from the grant route. */
export async function readDirectProjectGrant(
  fetchImpl: Fetch,
  familiarId: string,
  projectId: string,
): Promise<"read" | "write" | null> {
  const res = await fetchImpl("/api/project-grants", { cache: "no-store" });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; grants?: unknown } | null;
  if (!res.ok || json?.ok !== true || !Array.isArray(json.grants)) {
    throw new Error(`couldn't read project access (${res.status})`);
  }
  const grant = json.grants.find((entry): entry is { access?: unknown } =>
    !!entry && typeof entry === "object"
      && (entry as { familiarId?: unknown }).familiarId === familiarId
      && (entry as { projectId?: unknown }).projectId === projectId);
  if (!grant) return null;
  return grant.access === "read" ? "read" : "write";
}

/** Give the familiar `access` to the project and return what Undo restores. */
export async function grantProjectAccess(
  fetchImpl: Fetch,
  target: Omit<ChatGrantUndo, "previous" | "granted">,
  access: "read" | "write",
): Promise<ChatGrantUndo> {
  const previous = await readDirectProjectGrant(fetchImpl, target.familiarId, target.projectId);
  await grantRequest(fetchImpl, "POST", {
    targetFamiliarId: target.familiarId,
    projectId: target.projectId,
    access,
    expectedAccess: previous,
  });
  return { ...target, previous, granted: access };
}

/**
 * Undo a grant made from Chat: restore the previous direct grant, or revoke it
 * if there was none. The route refuses (409 `grant_changed`) when the grant is
 * no longer the one this change set, so Undo never overwrites a newer decision.
 */
export async function undoProjectGrant(fetchImpl: Fetch, undo: ChatGrantUndo): Promise<void> {
  const target = { targetFamiliarId: undo.familiarId, projectId: undo.projectId, expectedAccess: undo.granted };
  if (undo.previous) await grantRequest(fetchImpl, "POST", { ...target, access: undo.previous });
  else await grantRequest(fetchImpl, "DELETE", target);
}
