import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { loadConversation } from "@/lib/cave-conversations";
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
