import { NextResponse } from "next/server";
import { callDaemon } from "@/lib/coven-daemon";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { MAX_SESSION_JSON_BYTES } from "@/lib/server/session-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CommitBody = {
  branch?: string | null;
  message?: string | null;
  coAuthors?: string[] | null;
  dryRun?: boolean | null;
};

/**
 * Materialize a delta into a signed git branch.
 *
 * Commit is an explicit operator action: Cave never materializes
 * automatically, so both preview and commit exist only behind deliberate
 * operator actions.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const { id } = await params;
  const parsed = await readJsonBody<CommitBody>(req, MAX_SESSION_JSON_BYTES);
  if (!parsed.ok) return parsed.response;

  const body: CommitBody = parsed.body ?? {};
  const branch = typeof body.branch === "string" ? body.branch.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const coAuthors = Array.isArray(body.coAuthors)
    ? body.coAuthors.filter(
        (author: unknown): author is string => typeof author === "string" && author.trim().length > 0,
      )
    : [];

  const res = await callDaemon<unknown>({
    method: "POST",
    path: `/api/v1/afs/sessions/${encodeURIComponent(id)}/commit`,
    body: {
      ...(branch ? { branch } : {}),
      ...(message ? { message } : {}),
      ...(coAuthors.length > 0 ? { coAuthors } : {}),
      ...(typeof body.dryRun === "boolean" ? { dryRun: body.dryRun } : {}),
    },
    // Materialization walks the change set and shells out to git; the default
    // 4s budget is too tight for a real repository.
    timeoutMs: 60_000,
    // A commit is not idempotent — a transport retry could land two branches.
    retryTransportFailure: false,
  });

  if (!res.ok) {
    // afs.base_diverged, afs.path_outside_root, afs.copy_up_too_large,
    // afs.commit_conflict and afs.commit_unsigned all reach the operator
    // verbatim; the whole point of the codes is that they are actionable.
    return NextResponse.json(res.data ?? { error: res.error }, { status: res.status || 502 });
  }
  return NextResponse.json(res.data);
}
