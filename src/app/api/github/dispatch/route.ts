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
import { resolveSecret } from "@/lib/vault";

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

  const token = resolveSecret("GITHUB_PAT") ?? null;
  if (!token) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }

  try {
    // repo passed REPO_RE and workflow passed WORKFLOW_RE — safe to interpolate.
    const res = await fetch(`${GH}/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
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
    // Success is 204 No Content.
    if (res.status !== 204) {
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      const message = typeof data?.message === "string" ? data.message : `github error (${res.status})`;
      return NextResponse.json({ ok: false, error: message }, { status: res.status === 403 ? 403 : 502 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "failed to dispatch" },
      { status: 502 },
    );
  }
}
