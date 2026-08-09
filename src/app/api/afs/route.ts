import { NextResponse } from "next/server";
import { callDaemon } from "@/lib/coven-daemon";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import {
  afsSessionForCovenSession,
  readAfsCapabilities,
  type AfsCapabilities,
  type AfsSession,
} from "@/lib/afs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Capabilities plus the AFS delta bound to a Cave session.
 *
 * AFS routes expose a session's working tree, so — like session handoff —
 * they are same-user local IPC and every entry point rejects a non-local
 * request (`specs/coven-agent-fs/DESIGN.md` §3).
 *
 * One round trip answers "should the pane render at all, and does this
 * session even have a delta", which is the question every pane asks first.
 */
export type AfsOverviewResponse = {
  ok: boolean;
  capabilities: AfsCapabilities;
  session: AfsSession | null;
  error?: string;
};

export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const covenSessionId = new URL(req.url).searchParams.get("sessionId") ?? "";

  const health = await callDaemon<unknown>({ path: "/api/v1/health" });
  const capabilities = readAfsCapabilities(health.data);

  // A daemon without AFS is a supported state, not a failure: Cave and the
  // daemon ship on decoupled versions. Report it and let the pane hide.
  if (!capabilities.afs) {
    return NextResponse.json<AfsOverviewResponse>({ ok: true, capabilities, session: null });
  }

  const listed = await callDaemon<{ sessions?: AfsSession[] }>({ path: "/api/v1/afs/sessions" });
  if (!listed.ok) {
    return NextResponse.json<AfsOverviewResponse>(
      {
        ok: false,
        capabilities,
        session: null,
        error: listed.error ?? "The daemon could not list agent filesystem sessions.",
      },
      { status: listed.status || 502 },
    );
  }

  const sessions = listed.data?.sessions ?? [];
  return NextResponse.json<AfsOverviewResponse>({
    ok: true,
    capabilities,
    session: afsSessionForCovenSession(sessions, covenSessionId),
  });
}
