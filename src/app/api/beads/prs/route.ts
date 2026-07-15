import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { scrubSidecarInternalEnv } from "@/lib/coven-bin";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import { resolveRepoRoot } from "@/lib/server/issue-worktree-provision";
import {
  extractBeadIds,
  summarizePullRequest,
  type GitHubPullRequestInput,
} from "@/lib/beads-pr-management";
import type { MergedPrRef } from "@/lib/beads-work-queue";

// Browser-facing half of the PR bridge (cave-hlv.4). The Familiar Work Queue
// surface can't shell `gh`, so this route runs it server-side and hands the
// classified summaries to the client. It is the ONLY PR-truth source the queue
// UI reads — the client never invents PR state (per the epic's design note).

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const GH_TIMEOUT_MS = 30_000;
const MAX_GH_BUFFER = 16 * 1024 * 1024;

// Fields the lane classifier (summarizePullRequest) depends on. Kept in sync
// with scripts/beads-pr-shared.ts's GH_PR_FIELDS — the CLI patrol and this
// route must classify identically.
const OPEN_PR_FIELDS =
  "number,title,url,isDraft,headRefName,baseRefName,mergeStateStatus,reviewDecision,statusCheckRollup,updatedAt,body,labels";
// Merged PRs only feed the post-merge-cleanup lane, which needs just identity
// + bead links, so we request a lighter field set.
const MERGED_PR_FIELDS = "number,title,url,headRefName,body,labels,mergedAt";
const MERGED_PR_LIMIT = "30";

async function ghPrList(repoRoot: string, args: string[]): Promise<unknown> {
  const { stdout } = await execFileAsync("gh", args, {
    cwd: repoRoot, // cwd's repo → gh targets the right OWNER/REPO without hardcoding
    env: scrubSidecarInternalEnv({ ...process.env, GH_PROMPT_DISABLED: "1" }),
    timeout: GH_TIMEOUT_MS,
    maxBuffer: MAX_GH_BUFFER,
  });
  const parsed = JSON.parse(stdout.trim() || "[]");
  if (!Array.isArray(parsed)) throw new Error("gh pr list returned non-array JSON");
  return parsed;
}

function toMergedRef(pr: GitHubPullRequestInput & { mergedAt?: string | null }): MergedPrRef {
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    beadIds: extractBeadIds(pr),
    mergedAt: pr.mergedAt ?? null,
    headRefName: pr.headRefName ?? null,
  };
}

export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const url = new URL(req.url);
  const root = await resolveRepoRoot(url.searchParams.get("projectRoot") || process.cwd());
  if (!root.ok) {
    if ((root.error || "path not allowed") === "path not allowed") {
      return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
    }
    return NextResponse.json({ ok: false, error: root.error }, { status: root.status });
  }

  try {
    const [openRaw, mergedRaw] = await Promise.all([
      ghPrList(root.repoRoot, ["pr", "list", "--state", "open", "--limit", "100", "--json", OPEN_PR_FIELDS]),
      ghPrList(root.repoRoot, [
        "pr",
        "list",
        "--state",
        "merged",
        "--limit",
        MERGED_PR_LIMIT,
        "--json",
        MERGED_PR_FIELDS,
      ]),
    ]);

    const open = (openRaw as GitHubPullRequestInput[]).map(summarizePullRequest);
    const merged = (mergedRaw as Array<GitHubPullRequestInput & { mergedAt?: string | null }>).map(toMergedRef);

    return NextResponse.json({ ok: true, projectRoot: root.repoRoot, open, merged });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    const unavailable = err.code === "ENOENT";
    return NextResponse.json(
      { ok: false, error: unavailable ? "gh unavailable" : err.message || "gh command failed" },
      { status: unavailable ? 500 : 502 },
    );
  }
}
