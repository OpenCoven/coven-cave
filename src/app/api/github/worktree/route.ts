/**
 * /api/github/worktree
 *
 * Provisions (idempotently) a dedicated `git worktree` for a GitHub issue/PR so
 * concurrent agent sessions working different issues on the same repo never
 * collide in the shared checkout. See `src/lib/issue-worktree.ts` for the naming
 * scheme and the "isolate only under contention" rule, and CLAUDE.md for the
 * human convention this mirrors. The git work itself lives in
 * `src/lib/server/issue-worktree-provision.ts`, shared with the board-chat
 * session-start flow.
 *
 * POST { projectRoot, kind, number, title, baseRef? }
 *   → { ok, worktree, branch, created, baseRef }   (created:false if it existed)
 */

import { NextResponse } from "next/server";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { MAX_SESSION_JSON_BYTES } from "@/lib/server/session-security";
import {
  provisionIssueWorktree,
  resolveRepoRoot,
} from "@/lib/server/issue-worktree-provision";
import type { IssueWorktreeKind } from "@/lib/issue-worktree";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KINDS: IssueWorktreeKind[] = ["pr", "issue", "review_request", "notification"];

export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const parsed = await readJsonBody<{
    projectRoot?: string;
    kind?: string;
    number?: number | null;
    title?: string | null;
    baseRef?: string | null;
  }>(req, MAX_SESSION_JSON_BYTES);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const root = await resolveRepoRoot(String(body.projectRoot ?? ""));
  if (!root.ok) {
    return NextResponse.json({ ok: false, error: root.error }, { status: root.status });
  }

  const kind = (KINDS.includes(body.kind as IssueWorktreeKind)
    ? body.kind
    : "issue") as IssueWorktreeKind;

  const result = await provisionIssueWorktree(
    root.repoRoot,
    { kind, number: body.number ?? null, title: body.title ?? null },
    body.baseRef ?? null,
  );

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({
    ok: true,
    worktree: result.worktree,
    branch: result.branch,
    created: result.created,
    baseRef: result.baseRef,
  });
}
