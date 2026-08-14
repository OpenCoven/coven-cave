import { NextResponse } from "next/server";
import { probeDaemonUrl } from "@/lib/server/daemon-probe";
import {
  daemonDiagnosticContextFromRequest,
  DAEMON_DIAGNOSTIC_CORRELATION_HEADER,
  diagnosticError,
  recordDaemonDiagnosticEvent,
} from "@/lib/server/daemon-diagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const diagnostics = daemonDiagnosticContextFromRequest(req);
  const respond = (body: Record<string, unknown>, status = 200) =>
    NextResponse.json(
      { ...body, correlationId: diagnostics.correlationId },
      {
        status,
        headers: {
          [DAEMON_DIAGNOSTIC_CORRELATION_HEADER]: diagnostics.correlationId,
        },
      },
    );
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    recordDaemonDiagnosticEvent(diagnostics, {
      component: "next",
      operation: "daemon-probe",
      phase: "validation",
      outcome: "failed",
      process: { pid: process.pid },
      endpoint: { kind: "hub-http", classification: "invalid-request" },
      error: diagnosticError("invalid JSON body", "invalid-request"),
    });
    return respond({ ok: false, error: "invalid JSON body" }, 400);
  }
  const url = typeof body === "object" && body !== null && "url" in body
    ? String((body as { url?: unknown }).url ?? "").trim()
    : "";
  if (!url) return respond({ ok: false, error: "invalid hub URL" }, 400);
  try {
    return respond(await probeDaemonUrl(url, { diagnostics }));
  } catch {
    return respond({ ok: false, error: "invalid hub URL" }, 400);
  }
}
