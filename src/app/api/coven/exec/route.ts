import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { covenLaunchCommand, covenSpawnEnv } from "@/lib/coven-bin";
import { covenCliMissingError, isMissingExecutableError } from "@/lib/coven-spawn-error";
import {
  BoundedProcessOutput,
  safeProcessErrorMessage,
  terminateProcessTree,
} from "@/lib/process-execution";
import {
  daemonDiagnosticContextFromRequest,
  DAEMON_DIAGNOSTIC_CORRELATION_HEADER,
  diagnosticError,
  recordDaemonDiagnosticEvent,
} from "@/lib/server/daemon-diagnostics";

export const dynamic = "force-dynamic";

/** Allowlist of coven sub-commands callable from chat slash commands. */
const ALLOWED = new Set(["doctor", "daemon"]);

const SUBCOMMAND_ARGS: Record<string, string[]> = {
  doctor: [],
  daemon: ["status"],
};
const EXEC_TIMEOUT_MS = 6_000;
const EXEC_OUTPUT_BYTES = 64 * 1024;

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
  let body: { command?: string };
  try {
    body = await req.json();
  } catch {
    return respond({ ok: false, error: "invalid json body" }, 400);
  }
  if (!body.command || !ALLOWED.has(body.command)) {
    return respond({ ok: false, error: "command not allowed" }, 400);
  }

  const args = [body.command, ...(SUBCOMMAND_ARGS[body.command] ?? [])];
  const operation = `coven-${body.command}`;
  const startedAt = Date.now();
  recordDaemonDiagnosticEvent(diagnostics, {
    component: "cli",
    operation,
    phase: "execution",
    outcome: "started",
    process: { pid: process.pid },
    endpoint: { kind: "cli", classification: "allowlisted-command" },
  });

  return new Promise<Response>((resolve) => {
    const { command, fixedArgs } = covenLaunchCommand();
    const child = spawn(command, [...fixedArgs, ...args], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...covenSpawnEnv(),
        COVEN_CAVE_CORRELATION_ID: diagnostics.correlationId,
        COVEN_CAVE_DIAGNOSTIC_GENERATION: String(diagnostics.generation),
        COVEN_CAVE_DIAGNOSTIC_OPERATION: operation,
        COVEN_CAVE_DIAGNOSTIC_ATTEMPT: "1",
      },
      detached: process.platform !== "win32",
    });
    const out = new BoundedProcessOutput(EXEC_OUTPUT_BYTES);
    const err = new BoundedProcessOutput(EXEC_OUTPUT_BYTES);
    let settled = false;
    let timedOut = false;
    const settle = (
      body: Record<string, unknown>,
      status: number,
      outcome: "succeeded" | "failed" | "timed-out",
      classification: string,
      error?: unknown,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      recordDaemonDiagnosticEvent(diagnostics, {
        component: "cli",
        operation,
        phase: "execution",
        durationMs: Date.now() - startedAt,
        outcome,
        process: { pid: child.pid },
        endpoint: {
          kind: "cli",
          classification,
          status,
        },
        error: error ? diagnosticError(error, classification) : null,
      });
      resolve(respond(body, status));
    };
    const timeoutResponse = () =>
      settle(
        { ok: false, error: "timeout", stdout: out.text(), stderr: err.text() },
        504,
        "timed-out",
        "cli-timeout",
        "timeout",
      );
    child.stdout.on("data", (data) => out.append(data));
    child.stderr.on("data", (data) => err.append(data));
    const timer = setTimeout(() => {
      timedOut = true;
      void terminateProcessTree(child).finally(timeoutResponse);
    }, EXEC_TIMEOUT_MS);
    child.on("error", (e) => {
      settle(
        isMissingExecutableError(e)
          ? covenCliMissingError()
          : { ok: false, error: safeProcessErrorMessage(e, "Coven CLI") },
        500,
        "failed",
        "cli-spawn-error",
        e,
      );
    });
    child.on("close", (code) => {
      if (timedOut) {
        timeoutResponse();
        return;
      }
      settle(
        {
          ok: code === 0,
          exitCode: code,
          stdout: out.text(),
          stderr: err.text(),
        },
        200,
        code === 0 ? "succeeded" : "failed",
        code === 0 ? "completed" : "cli-error",
        code === 0 ? undefined : `CLI exited with status ${code ?? "unknown"}`,
      );
    });
  });
}
