import { NextResponse } from "next/server";
import { callDaemon } from "@/lib/coven-daemon";
import { redactSecretsDeep, redactSecretText } from "@/lib/secret-redaction";

export const dynamic = "force-dynamic";

/**
 * The daemon's `/api/v1/skills/eval-loop/:id` already returns an enveloped
 * `{ ok, state: EvalLoopState }`. Hand back just the inner EvalLoopState so the
 * proxy isn't double-wrapped (`{ ok, state: { ok, state } }`) — consumers read
 * `json.state` expecting the state itself, and a double wrap leaves
 * `state.iterations` undefined. Tolerates a daemon that returns the state bare.
 */
function unwrapDaemonEvalState(data: unknown): unknown {
  if (
    data &&
    typeof data === "object" &&
    "state" in data &&
    !("iterations" in data)
  ) {
    return (data as { state: unknown }).state;
  }
  return data;
}

/**
 * GET /api/skills/eval-loop/[familiarId]
 *
 * Proxies the daemon's eval-loop state for a given familiar.
 * Returns the iteration history, track stats, and running status.
 *
 * When the daemon is offline or the skill is not active for this familiar,
 * returns { ok: false, error: "..." } so the UI can show an empty state.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ familiarId: string }> },
) {
  const { familiarId } = await params;
  const res = await callDaemon<unknown>({
    path: `/api/v1/skills/eval-loop/${familiarId}`,
  });

  if (!res.ok || !res.data) {
    return NextResponse.json(
      {
        ok: false,
        error: redactSecretText(res.error ?? `daemon http ${res.status}`),
        state: null,
      },
    );
  }

  return NextResponse.json({ ok: true, state: redactSecretsDeep(unwrapDaemonEvalState(res.data)) });
}
