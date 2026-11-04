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
import { upstreamApiError } from "@/lib/server/upstream-api-error";
import { upstreamFetch } from "@/lib/server/upstream-fetch";
import { ambiguousWrite, isAmbiguousWriteStatus, writeThrew } from "@/lib/server/upstream-answer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GH = "https://api.github.com";
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
// A workflow file name (letters/digits/dot/dash/underscore, .yml/.yaml) or a
// numeric workflow id — the barrier before path interpolation.
const WORKFLOW_RE = /^(?:\d+|[A-Za-z0-9._-]+\.ya?ml)$/;
const REF_RE = /^[A-Za-z0-9._\/-]{1,255}$/;
const MAX_INPUTS = 10;

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
    for (const [k, v] of Object.entries(body.inputs as Record<string, unknown>).slice(0, MAX_INPUTS)) {
      if (typeof v === "string") inputs[k] = v;
    }
    if (Object.keys(inputs).length === 0) inputs = undefined;
  }

  const token = resolveGitHubToken();
  if (!token) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }

  try {
    // repo passed REPO_RE and workflow passed WORKFLOW_RE — safe to interpolate.
    let res: Response;
    try {
      res = await upstreamFetch("github", `${GH}/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({ ref, ...(inputs ? { inputs } : {}) }),
      });
    } catch (e) {
      // The request may have reached GitHub before this failed; only a
      // write that provably never left is a plain, retryable failure (#6369).
      return writeThrew("GitHub", "workflow dispatch", e, "failed to dispatch workflow");
    }
    // A 5xx after GitHub received the write leaves its outcome unknown (#6369).
    if (isAmbiguousWriteStatus(res.status)) return ambiguousWrite("GitHub", "workflow dispatch");
    // Any 2xx is GitHub accepting the dispatch: 204 classically, or 200 with
    // run details. The body is not needed, so a torn 2xx is still accepted
    // rather than reported as a failure that invites a second dispatch.
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      const message = typeof data?.message === "string" ? data.message : `github error (${res.status})`;
      return upstreamApiError("GitHub", res, {
        configured: true,
        error: message,
        responseBody: data,
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "failed to dispatch" },
      { status: 502 },
    );
  }
}
