import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { stripAnsi } from "@/lib/ansi";
import {
  COVEN_WINDOWS_NOT_FOUND_DIAGNOSTIC,
  covenLaunchCommand,
  covenWrapperSpawnEnv,
} from "@/lib/coven-bin";
import { covenCliMissingError, isMissingExecutableError } from "@/lib/coven-spawn-error";
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

  let launch;
  try {
    launch = covenLaunchCommand();
  } catch {
    return respond({ ok: false, error: COVEN_WINDOWS_NOT_FOUND_DIAGNOSTIC }, 409);
  }

  return new Promise<Response>((resolve) => {
    const { command, fixedArgs } = launch;
    const child = spawn(command, [...fixedArgs, ...args], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...covenWrapperSpawnEnv(),
        COVEN_CAVE_CORRELATION_ID: diagnostics.correlationId,
        COVEN_CAVE_DIAGNOSTIC_GENERATION: String(diagnostics.generation),
        COVEN_CAVE_DIAGNOSTIC_OPERATION: operation,
        COVEN_CAVE_DIAGNOSTIC_ATTEMPT: "1",
      },
    });
    let out = "";
    let err = "";
    let settled = false;
    const settle = (
      body: Record<string, unknown>,
      status: number,
      outcome: "succeeded" | "failed" | "timed-out",
      classification: string,
      error?: unknown,
    ) => {
      if (settled) return;
      settled = true;
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
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    const t = setTimeout(() => {
      child.kill("SIGTERM");
      settle(
        { ok: false, error: "timeout", stdout: stripAnsi(out), stderr: stripAnsi(err) },
        504,
        "timed-out",
        "cli-timeout",
        "timeout",
      );
    }, 6000);
    child.on("error", (e) => {
      clearTimeout(t);
      settle(
        isMissingExecutableError(e)
          ? covenCliMissingError()
          : { ok: false, error: e.message },
        500,
        "failed",
        "cli-spawn-error",
        e,
      );
    });
    child.on("close", (code) => {
      clearTimeout(t);
      settle(
        {
          ok: code === 0,
          exitCode: code,
          stdout: stripAnsi(out),
          stderr: stripAnsi(err),
        },
        200,
        code === 0 ? "succeeded" : "failed",
        code === 0 ? "completed" : "cli-error",
        code === 0 ? undefined : `CLI exited with status ${code ?? "unknown"}`,
      );
    });
  });
}
