import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { loadConversation } from "@/lib/cave-conversations";
import { callDaemon } from "@/lib/coven-daemon";
import {
  familiarWorkspacesRoot,
  readFamiliarWorkspaces,
} from "@/lib/coven-paths";

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
