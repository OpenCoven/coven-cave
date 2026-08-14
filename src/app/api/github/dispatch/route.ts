/**
 * /api/github/dispatch
 *
 * Trigger `workflow_dispatch` (design docs/chat-github-integration.md §3,
 * tier-2): `POST /repos/{repo}/actions/workflows/{workflow}/dispatches` with
 * a ref and optional string inputs. The workflow is a file name (ci.yml) or
 * numeric id, validated to a safe charset before interpolation; the ref rides
 * the JSON body (not the path).
 *
 * Requires a PAT — never echoed, never logged.
 */

import { NextResponse } from "next/server";
import { resolveGitHubToken } from "@/lib/github-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GH = "https://api.github.com";
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const WORKFLOW_RE = /^(?:\d+|[A-Za-z0-9._-]+\.ya?ml)$/;
const REF_RE = /^[A-Za-z0-9._\/-]{1,255}$/;
const MAX_INPUTS = 10;

export type GitHubDispatchInput = {
  repo: string;
  workflow: string;
  ref: string;
  inputs?: Record<string, string>;
};
export type GitHubDispatchResult =
  | { ok: true }
  | {
      ok: false;
      status: number;
      error: string;
      reason: "auth_required" | "upstream" | "network";
    };

export async function executeGitHubDispatch(input: GitHubDispatchInput): Promise<GitHubDispatchResult> {
  const token = resolveGitHubToken();
  if (!token) {
    return { ok: false, status: 401, error: "auth_required", reason: "auth_required" };
  }

  try {
    const res = await fetch(`${GH}/repos/${input.repo}/actions/workflows/${input.workflow}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({ ref: input.ref, ...(input.inputs ? { inputs: input.inputs } : {}) }),
    });
    if (res.status !== 204) {
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      const message = typeof data?.message === "string" ? data.message : `github error (${res.status})`;
      return { ok: false, status: res.status, error: message, reason: "upstream" };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      error: error instanceof Error ? error.message : "failed to dispatch",
      reason: "network",
    };
  }
}

function toLegacyResponse(result: GitHubDispatchResult): Response {
  if (result.ok) return NextResponse.json(result);
  return NextResponse.json(
    { ok: false, error: result.error },
    { status: result.reason === "auth_required" ? 401 : result.status === 403 ? 403 : 502 },
  );
}

export async function POST(req: Request) {
  let body: { repo?: unknown; workflow?: unknown; ref?: unknown; inputs?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const repo = typeof body.repo === "string" ? body.repo.trim() : "";
  const workflow = typeof body.workflow === "string" ? body.workflow.trim() : "";
  const ref = typeof body.ref === "string" ? body.ref.trim() : "";

  if (!REPO_RE.test(repo)) {
    return NextResponse.json({ ok: false, error: "invalid repo" }, { status: 400 });
  }
  if (!WORKFLOW_RE.test(workflow)) {
    return NextResponse.json({ ok: false, error: "invalid workflow" }, { status: 400 });
  }
  if (!REF_RE.test(ref)) {
    return NextResponse.json({ ok: false, error: "invalid ref" }, { status: 400 });
  }

  let inputs: Record<string, string> | undefined;
  if (body.inputs && typeof body.inputs === "object" && !Array.isArray(body.inputs)) {
    inputs = {};
    for (const [key, value] of Object.entries(body.inputs as Record<string, unknown>).slice(0, MAX_INPUTS)) {
      if (typeof value === "string") inputs[key] = value;
    }
    if (Object.keys(inputs).length === 0) inputs = undefined;
  }

  return toLegacyResponse(await executeGitHubDispatch({ repo, workflow, ref, ...(inputs ? { inputs } : {}) }));
}
