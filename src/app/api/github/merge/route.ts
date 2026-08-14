/**
 * /api/github/merge
 *
 * Merge a pull request (design docs/chat-github-integration.md §3, tier-2)
 * via REST `PUT /repos/{repo}/pulls/{number}/merge`. Branch-protection
 * semantics stay on GitHub's side — its guard errors ("required status
 * checks", "review required", "not mergeable") pass through VERBATIM so the
 * confirm card can show the real reason.
 *
 * `deleteBranch` adds the usual post-merge tidy as a second, strictly
 * subordinate step. The merge is irreversible, so a failed ref delete is
 * reported in the payload (`branchDeleteError`) and never allowed to turn a
 * landed merge into an `ok: false` the caller might retry.
 *
 * The branch name is NOT taken from the request. It is read back from GitHub's
 * own PR object after the merge, for two reasons: a caller cannot steer this
 * route at an arbitrary ref path (CodeQL js/request-forgery — and a regex test
 * is not a sanitiser), and a caller that sent a stale or simply wrong ref would
 * otherwise have deleted a branch nobody asked about.
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
  return value.length <= 255 && !value.includes("..") && BRANCH_SEGMENTS_RE.test(value);
}

export type GitHubMergeInput = {
  repo: string;
  number: number;
  method: "squash" | "merge" | "rebase";
  deleteBranch?: boolean;
};
export type GitHubMergeResult =
  | {
      ok: true;
      merged: true;
      sha: string | null;
      branchDeleted: boolean;
      branchDeleteError: string | null;
    }
  | {
      ok: false;
      status: number;
      error: string;
      reason: "auth_required" | "upstream" | "network";
    };

export async function executeGitHubMerge(input: GitHubMergeInput): Promise<GitHubMergeResult> {
  const token = resolveGitHubToken();
  if (!token) {
    return { ok: false, status: 401, error: "auth_required", reason: "auth_required" };
  }

  try {
    const res = await fetch(`${GH}/repos/${input.repo}/pulls/${input.number}/merge`, {
      method: "PUT",
      headers: ghHeaders(token),
      cache: "no-store",
      body: JSON.stringify({ merge_method: input.method }),
    });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !data || data.merged !== true) {
      const message = typeof data?.message === "string" ? data.message : `github error (${res.status})`;
      return { ok: false, status: res.status, error: message, reason: "upstream" };
    }

    let branchDeleted = false;
    let branchDeleteError: string | null = null;
    if (input.deleteBranch) {
      try {
        const prRes = await fetch(`${GH}/repos/${input.repo}/pulls/${input.number}`, {
          headers: ghHeaders(token),
          cache: "no-store",
        });
        const pr = (await prRes.json().catch(() => null)) as { head?: { ref?: unknown } } | null;
        const ref = typeof pr?.head?.ref === "string" ? pr.head.ref.trim() : "";
        if (!isSafeBranch(ref)) {
          branchDeleteError = ref ? "branch name is not one this route will delete" : "could not read the head branch";
          return {
            ok: true,
            merged: true,
            sha: typeof data.sha === "string" ? data.sha : null,
            branchDeleted: false,
            branchDeleteError,
          };
        }
        const del = await fetch(`${GH}/repos/${input.repo}/git/refs/heads/${ref}`, {
          method: "DELETE",
          headers: ghHeaders(token),
          cache: "no-store",
        });
        if (del.ok || del.status === 404) {
          branchDeleted = true;
        } else {
          const err = (await del.json().catch(() => null)) as Record<string, unknown> | null;
          branchDeleteError = typeof err?.message === "string" ? err.message : `github error (${del.status})`;
        }
      } catch (error) {
        branchDeleteError = error instanceof Error ? error.message : "failed to delete branch";
      }
    }

    return {
      ok: true,
      merged: true,
      sha: typeof data.sha === "string" ? data.sha : null,
      branchDeleted,
      branchDeleteError,
    };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      error: error instanceof Error ? error.message : "failed to merge",
      reason: "network",
    };
  }
}

function toLegacyResponse(result: GitHubMergeResult): Response {
  if (result.ok) return NextResponse.json(result);
  return NextResponse.json(
    { ok: false, error: result.error },
    { status: result.reason === "auth_required" ? 401 : result.status === 403 ? 403 : 502 },
  );
}

export async function POST(req: Request) {
  let body: { repo?: unknown; number?: unknown; method?: unknown; deleteBranch?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const repo = typeof body.repo === "string" ? body.repo.trim() : "";
  const number = Number.parseInt(String(body.number ?? ""), 10);
  const method = typeof body.method === "string" ? body.method : "squash";
  const deleteBranch = body.deleteBranch === true;

  if (!REPO_RE.test(repo)) {
    return NextResponse.json({ ok: false, error: "invalid repo" }, { status: 400 });
  }
  if (!Number.isInteger(number) || number <= 0) {
    return NextResponse.json({ ok: false, error: "invalid number" }, { status: 400 });
  }
  if (!METHODS.has(method)) {
    return NextResponse.json({ ok: false, error: "invalid method" }, { status: 400 });
  }

  return toLegacyResponse(await executeGitHubMerge({
    repo,
    number,
    method: method as GitHubMergeInput["method"],
    deleteBranch,
  }));
}
