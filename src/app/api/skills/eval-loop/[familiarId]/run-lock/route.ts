import { NextResponse } from "next/server";
import { callDaemon, extractDaemonError } from "@/lib/coven-daemon";
import { redactSecretText } from "@/lib/secret-redaction";

export const dynamic = "force-dynamic";

type Body = { force?: boolean };

/**
 * DELETE /api/skills/eval-loop/[familiarId]/run-lock
 *
 * Proxies daemon-owned eval-loop lock recovery. Cave never deletes files in a
 * familiar workspace directly; the daemon resolves and clears its own lock.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ familiarId: string }> },
) {
  const { familiarId } = await params;

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    // body optional
  }

  const res = await callDaemon<unknown>({
    path: `/api/v1/skills/eval-loop/${familiarId}/run-lock`,
    method: "DELETE",
    body: { force: body.force === true },
  });

  if (!res.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: redactSecretText(extractDaemonError(res) ?? `daemon http ${res.status}`),
      },
    );
  }

  return NextResponse.json({ ok: true, ...((res.data as object) ?? {}) });
}
