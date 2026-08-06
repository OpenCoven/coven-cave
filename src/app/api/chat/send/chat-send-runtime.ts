import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  latestConversationReplaySession,
  loadConversation,
  normalizeDaemonConversationId,
  persistResolvedReplayConversationId,
  validatedConversationHarnessSessionId,
} from "@/lib/cave-conversations";
import { callDaemon, extractDaemonError } from "@/lib/coven-daemon";
import {
  familiarWorkspacesRoot,
  readFamiliarWorkspaces,
} from "@/lib/coven-paths";
import { ACTIVE_SESSION_STATUSES } from "@/lib/chat-auto-archive";

/** Resolve the local cwd recorded when a conversation was first created. */
export async function conversationCwd(sessionId?: string): Promise<string | undefined> {
  if (!sessionId) return undefined;
  try {
    const conv = await loadConversation(sessionId);
    const runtime = conv?.runtime;
    if (runtime?.startsWith("local:")) {
      const cwd = runtime.slice("local:".length).trim();
      return cwd || undefined;
    }
  } catch {
    /* fall back to the caller's default */
  }
  return undefined;
}

type DaemonSessionRow = { id?: string; project_root?: string };
type DaemonSessionRecord = DaemonSessionRow & {
  status?: string;
  conversationId?: string | null;
  conversation_id?: string | null;
  updated_at?: string | null;
};

/**
 * Resume-cwd fallback for sessions the Cave conversation store has no local
 * runtime for — e.g. threads opened from Familiar analytics (`/#chat-<id>`)
 * that were spawned by the daemon rather than the chat bridge. Without this,
 * their first chat turn had no root anywhere and died on the 400
 * "projectRoot is required" refusal (cave-yjnr). The daemon is the right
 * trust anchor: it already ran a harness in this session's `project_root`
 * (same argument as session-project-roots.ts), so resuming there is exactly
 * "the directory the conversation started in" — never a homedir downgrade.
 */
export async function daemonSessionCwd(sessionId?: string): Promise<string | undefined> {
  if (!sessionId) return undefined;
  try {
    const res = await callDaemon<DaemonSessionRow[]>({ path: "/api/v1/sessions" });
    if (!res.ok || !Array.isArray(res.data)) return undefined;
    const row = res.data.find((session) => session?.id === sessionId);
    const root = row?.project_root?.trim();
    if (root && path.isAbsolute(root)) return root;
  } catch {
    /* daemon offline — the caller keeps its remaining fallbacks */
  }
  return undefined;
}

export type ReplayBackedResumeResolution =
  | { ok: true; resumeSessionId: string | null; replayBound: boolean }
  | {
    ok: false;
    retryable: boolean;
    code: "conversation_continuity_lookup_failed" | "conversation_continuity_syncing" | "conversation_continuity_unavailable";
    error: string;
    retryAfter?: string;
  };

export async function resolveReplayBackedResumeSessionId(
  sessionId?: string,
): Promise<ReplayBackedResumeResolution> {
  if (!sessionId) return { ok: true, resumeSessionId: null, replayBound: false };
  const conversation = await loadConversation(sessionId).catch(() => null);
  if (!conversation) return { ok: true, resumeSessionId: null, replayBound: false };
  const validatedNativeId = validatedConversationHarnessSessionId(conversation);
  if (validatedNativeId) {
    return { ok: true, resumeSessionId: validatedNativeId, replayBound: false };
  }
  const latestReplay = latestConversationReplaySession(conversation);
  if (!latestReplay?.sessionId) {
    return { ok: true, resumeSessionId: null, replayBound: false };
  }
  const res = await callDaemon<DaemonSessionRecord>({
    path: `/api/v1/sessions/${encodeURIComponent(latestReplay.sessionId)}`,
  });
  if (!res.ok || !res.data) {
    if (res.status === 404) {
      return {
        ok: false,
        retryable: false,
        code: "conversation_continuity_unavailable",
        error:
          `Daemon session ${latestReplay.sessionId} is no longer available, so Cave cannot recover the native conversation needed to resume this replayed chat safely.`,
      };
    }
    return {
      ok: false,
      retryable: true,
      code: "conversation_continuity_lookup_failed",
      error:
        `Cave could not verify replay continuity from daemon session ${latestReplay.sessionId}: ${extractDaemonError(res) ?? res.error ?? `daemon http ${res.status}`}. Retry once the daemon is reachable.`,
      retryAfter: "2",
    };
  }
  const status = typeof res.data.status === "string" ? res.data.status.trim().toLowerCase() : "";
  const conversationId =
    normalizeDaemonConversationId(res.data.conversationId)
    ?? normalizeDaemonConversationId(res.data.conversation_id);
  if (conversationId) {
    const persisted = await persistResolvedReplayConversationId({
      sessionId,
      replaySessionId: latestReplay.sessionId,
      conversationId,
      status: res.data.status ?? null,
      updatedAt: res.data.updated_at ?? null,
    });
    return { ok: true, resumeSessionId: persisted ?? conversationId, replayBound: true };
  }
  if (ACTIVE_SESSION_STATUSES.has(status)) {
    return {
      ok: false,
      retryable: true,
      code: "conversation_continuity_syncing",
      error:
        `Daemon session ${latestReplay.sessionId} is still ${status} and has not exposed a native conversation id yet. Retry in a moment so Cave can resume the same provider conversation instead of forking a new one.`,
      retryAfter: "2",
    };
  }
  return {
    ok: false,
    retryable: false,
    code: "conversation_continuity_unavailable",
    error:
      `Daemon session ${latestReplay.sessionId} finished without a resumable native conversation id. Cave will not fall back to the stable chat id and fork this replayed conversation.`,
  };
}

/**
 * Resolve a familiar workspace while keeping familiar IDs and symlink targets
 * within the configured Coven workspace root.
 */
export async function resolveFamiliarWorkspace(
  familiarId: string,
): Promise<string | undefined> {
  if (!/^[a-z0-9_-]+$/i.test(familiarId)) return undefined;
  const declared = await readFamiliarWorkspaces();
  const declaredWorkspace = declared.get(familiarId);
  if (declaredWorkspace) {
    try {
      const resolvedDeclared = await realpath(declaredWorkspace);
      const s = await stat(resolvedDeclared);
      if (s.isDirectory()) return resolvedDeclared;
    } catch {
      /* fall through to the derived workspace path */
    }
  }
  const familiarsRoot = familiarWorkspacesRoot();
  const candidate = path.resolve(familiarsRoot, familiarId);
  const relative = path.relative(familiarsRoot, candidate);
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    relative.split(path.sep).includes("..")
  ) {
    return undefined;
  }
  try {
    const root = await realpath(familiarsRoot);
    const resolvedCandidate = await realpath(candidate);
    if (resolvedCandidate !== root && !resolvedCandidate.startsWith(root + path.sep)) {
      return undefined;
    }
    const s = await stat(resolvedCandidate);
    if (s.isDirectory()) return resolvedCandidate;
  } catch {
    /* not found */
  }
  return undefined;
}
