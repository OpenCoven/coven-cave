/**
 * /api/github/merge
 *
 * Merge a pull request (design docs/chat-github-integration.md §3, tier-2)
 * via REST `PUT /repos/{repo}/pulls/{number}/merge`. Branch-protection
 * semantics stay on GitHub's side — its guard errors ("required status
 * checks", "review required", "not mergeable") pass through VERBATIM so the
 * confirm card can show the real reason.
 *
 * `deleteBranch` + `headRef` add the usual post-merge tidy as a second, strictly
 * subordinate step. The merge is irreversible, so a failed ref delete is
 * reported in the payload (`branchDeleteError`) and never allowed to turn a
 * landed merge into an `ok: false` the caller might retry.
 *
 * Requires a PAT — never echoed, never logged.
 */

import { NextResponse } from "next/server";
import { resolveGitHubToken } from "@/lib/github-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GH = "https://api.github.com";
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const METHODS = new Set(["squash", "merge", "rebase"]);

// A branch name we are willing to interpolate into `git/refs/heads/…`. Branch
// names legitimately contain slashes, so REPO_RE cannot be reused: this allows
// slash-joined segments of [A-Za-z0-9._-] with no empty segment (hence no
// leading or trailing slash) and no segment starting with "-" (git rejects
// those). Deliberately narrower than git's own rules — the composer only ever
// sends a headRef this route just read back from GitHub.
const BRANCH_SEGMENTS_RE = /^[A-Za-z0-9._][A-Za-z0-9._-]*(?:\/[A-Za-z0-9._][A-Za-z0-9._-]*)*$/;

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

function isSafeBranch(value: string): boolean {
  // ".." is spellable from the allowed characters and is both a git-invalid ref
  // and the path-traversal sequence, so it needs its own rejection.
  return value.length <= 255 && !value.includes("..") && BRANCH_SEGMENTS_RE.test(value);
}

export async function POST(req: Request) {
  let body: { repo?: unknown; number?: unknown; method?: unknown; deleteBranch?: unknown; headRef?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const repo = typeof body.repo === "string" ? body.repo.trim() : "";
  const number = Number.parseInt(String(body.number ?? ""), 10);
  const method = typeof body.method === "string" ? body.method : "squash";
  const deleteBranch = body.deleteBranch === true;
  const headRef = typeof body.headRef === "string" ? body.headRef.trim() : "";

  if (!REPO_RE.test(repo)) {
    return NextResponse.json({ ok: false, error: "invalid repo" }, { status: 400 });
  }
  if (!Number.isInteger(number) || number <= 0) {
    return NextResponse.json({ ok: false, error: "invalid number" }, { status: 400 });
  }
  if (!METHODS.has(method)) {
    return NextResponse.json({ ok: false, error: "invalid method" }, { status: 400 });
  }
  // Validated before the merge, never after: rejecting a bad ref once the merge
  // has landed would report a failure for work that already happened.
  if (deleteBranch && !isSafeBranch(headRef)) {
    return NextResponse.json({ ok: false, error: "invalid headRef" }, { status: 400 });
  }

  const token = resolveGitHubToken();
  if (!token) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }

  try {
    // repo passed REPO_RE and number is a positive integer — safe to interpolate.
    const res = await fetch(`${GH}/repos/${repo}/pulls/${number}/merge`, {
      method: "PUT",
      headers: ghHeaders(token),
      cache: "no-store",
      body: JSON.stringify({ merge_method: method }),
    });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !data || data.merged !== true) {
      // 405/409 carry GitHub's protection/mergeability reason — pass verbatim.
      const message = typeof data?.message === "string" ? data.message : `github error (${res.status})`;
      return NextResponse.json({ ok: false, error: message }, { status: res.status === 403 ? 403 : 502 });
    }

    let branchDeleted = false;
    let branchDeleteError: string | null = null;
    if (deleteBranch) {
      try {
        // headRef passed isSafeBranch — safe to interpolate into the ref path.
        const del = await fetch(`${GH}/repos/${repo}/git/refs/heads/${headRef}`, {
          method: "DELETE",
          headers: ghHeaders(token),
          cache: "no-store",
        });
        // 404 means the ref is already gone — usually the repo's own
        // "automatically delete head branches" setting won the race. The
        // requested end state holds, so report it as deleted.
        if (del.ok || del.status === 404) {
          branchDeleted = true;
        } else {
          const err = (await del.json().catch(() => null)) as Record<string, unknown> | null;
          branchDeleteError = typeof err?.message === "string" ? err.message : `github error (${del.status})`;
        }
      } catch (e) {
        branchDeleteError = e instanceof Error ? e.message : "failed to delete branch";
      }
    }

    return NextResponse.json({
      ok: true,
      merged: true,
      sha: typeof data.sha === "string" ? data.sha : null,
      branchDeleted,
      branchDeleteError,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "failed to merge" },
      { status: 502 },
    );
  }
}
