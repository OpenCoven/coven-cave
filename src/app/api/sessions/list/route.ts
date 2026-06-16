import { NextResponse } from "next/server";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { callDaemon } from "@/lib/coven-daemon";
import { loadState } from "@/lib/cave-config";
import { listConversations } from "@/lib/cave-conversations";
import {
  localConversationSessionRows,
  mergeSessionRows,
} from "@/lib/session-list-merge";
import { loadProjects, projectForRoot } from "@/lib/cave-projects";
import type { SessionGitContext, SessionInitiator, SessionRow } from "@/lib/types";

export const dynamic = "force-dynamic";

type DaemonSession = {
  id: string;
  project_root: string;
  harness: string;
  title: string;
  status: string;
  exit_code: number | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  initiator?: SessionInitiator;
};

function isTrueProjectCwd(projectRoot: string): boolean {
  const trimmed = projectRoot.trim();
  if (!trimmed) return false;
  try {
    return fs.statSync(trimmed).isDirectory();
  } catch {
    return false;
  }
}

function git(projectRoot: string, args: string[]): string | null {
  try {
    const output = execFileSync("git", args, {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: 1000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const value = output.trim();
    return value || null;
  } catch {
    return null;
  }
}

function resolveGitPath(projectRoot: string, value: string | null): string | null {
  if (!value) return null;
  return path.resolve(path.isAbsolute(value) ? value : path.join(projectRoot, value));
}

function readGitContext(projectRoot: string): SessionGitContext | null {
  const trimmed = projectRoot.trim();
  if (!isTrueProjectCwd(trimmed)) return null;

  const branch =
    git(trimmed, ["branch", "--show-current"]) ??
    git(trimmed, ["rev-parse", "--short", "HEAD"]);
  const worktreeRoot = git(trimmed, ["rev-parse", "--show-toplevel"]);
  const gitDir = resolveGitPath(trimmed, git(trimmed, ["rev-parse", "--git-dir"]));
  const commonDir = resolveGitPath(trimmed, git(trimmed, ["rev-parse", "--git-common-dir"]));
  const isWorktree = Boolean(gitDir && commonDir && gitDir !== commonDir);

  if (!branch && !worktreeRoot && !isWorktree) return null;
  return { branch, worktreeRoot, isWorktree };
}

function readDiffStat(projectRoot: string): { additions: number; deletions: number } | null {
  const out = git(projectRoot, ["diff", "HEAD", "--shortstat"]);
  if (out == null) return { additions: 0, deletions: 0 };
  const add = /(\d+) insertion/.exec(out);
  const del = /(\d+) deletion/.exec(out);
  return { additions: add ? Number(add[1]) : 0, deletions: del ? Number(del[1]) : 0 };
}

function enrichSessionsWithGitContext(sessions: SessionRow[]): SessionRow[] {
  const gitContextByRoot = new Map<string, SessionGitContext | null>();
  const diffByRoot = new Map<string, { additions: number; deletions: number } | null>();
  return sessions.map((session) => {
    const root = session.project_root?.trim();
    if (!root) return session;
    if (!gitContextByRoot.has(root)) {
      gitContextByRoot.set(root, readGitContext(root));
    }
    const gitContext = gitContextByRoot.get(root) ?? null;
    if (!diffByRoot.has(root)) {
      diffByRoot.set(root, gitContext ? readDiffStat(root) : null);
    }
    const diff = diffByRoot.get(root) ?? null;
    const enriched: SessionRow = { ...session };
    if (gitContext) enriched.git = gitContext;
    if (diff) enriched.diff = diff;
    return enriched;
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const includeArchived = url.searchParams.get("includeArchived") === "1";

  const [res, state, projects] = await Promise.all([
    callDaemon<DaemonSession[]>({ path: "/api/v1/sessions" }),
    loadState(),
    loadProjects(),
  ]);
  const localConversations = await listConversations();
  if (!res.ok || !res.data) {
    const localSessions = localConversationSessionRows(localConversations, state, includeArchived);
    if (localSessions.length > 0) {
      return NextResponse.json({
        ok: true,
        degraded: true,
        error: res.error ?? `daemon http ${res.status}`,
        sessions: enrichSessionsWithGitContext(localSessions),
      });
    }
    return NextResponse.json(
      { ok: false, error: res.error ?? `daemon http ${res.status}`, sessions: [] },
      { status: 503 },
    );
  }

  function isKnownProjectOrValidDir(projectRoot: string): boolean {
    if (projectForRoot(projectRoot, projects)) return true;
    return isTrueProjectCwd(projectRoot);
  }

  const sessions = mergeSessionRows({
    daemonSessions: res.data,
    localConversations,
    state,
    includeArchived,
    isValidDaemonProjectRoot: isKnownProjectOrValidDir,
  });

  return NextResponse.json({ ok: true, sessions: enrichSessionsWithGitContext(sessions) });
}
