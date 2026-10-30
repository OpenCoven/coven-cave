import { warmHarnessSpawnPath } from "@/lib/harness-spawn-env";
import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { covenSpawnEnv } from "@/lib/coven-bin";
import {
  BoundedProcessOutput,
  safeProcessErrorMessage,
  terminateProcessTree,
} from "@/lib/process-execution";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Onboarding SSH preflight: can this machine reach `host` non-interactively,
 * and does the remote have a `coven` CLI?
 *
 * Mirrors familiar-runtime's host validation so the check can only target a
 * host string that could also be saved on a familiar. BatchMode keeps the
 * probe from hanging on a password prompt — key-based auth is the supported
 * path, and the hint explains the one-time `ssh <host>` host-key dance.
 */
const SAFE_SSH_HOST_RE = /^[A-Za-z0-9._:-]+$/;

const SSH_TIMEOUT_MS = 15_000;
const MAX_PROBE_OUTPUT_BYTES = 8_192;

/** Marker scoping the parse to our own probe output, not banner noise. */
const PROBE_MARKER = "__coven_cave_ssh_probe__";

export async function POST(req: Request) {
  // The PATH discovery behind covenSpawnEnv() is synchronous; join the
  // server's warm-up (or run it) off the event loop first (#5448).
  await warmHarnessSpawnPath();
  let body: { host?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid json body" },
      { status: 400 },
    );
  }

  const host = typeof body.host === "string" ? body.host.trim() : "";
  if (!host || !SAFE_SSH_HOST_RE.test(host)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Host must be an SSH alias or hostname (letters, digits, dots, underscores, dashes, colons).",
      },
      { status: 400 },
    );
  }

  // Fixed probe script; only the validated host varies, and `--` stops ssh
  // from parsing it as an option.
  const probe = `echo ${PROBE_MARKER} && (command -v coven || echo no-coven)`;
  const args = [
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=8",
    "--",
    host,
    probe,
  ];

  return new Promise<Response>((resolve) => {
    const spawnFailure = (error: unknown) => NextResponse.json(
      {
        ok: false,
        reachable: false,
        error: safeProcessErrorMessage(error, "SSH"),
        hint: "Install an OpenSSH client (macOS/Linux ship one; Windows: Settings > Apps > Optional features > OpenSSH Client).",
      },
      { status: 500 },
    );
    if (req.signal.aborted) {
      resolve(
        NextResponse.json(
          { ok: false, reachable: false, error: "SSH check cancelled" },
          { status: 499 },
        ),
      );
      return;
    }
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("ssh", args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: covenSpawnEnv(),
        shell: false,
        detached: process.platform !== "win32",
      });
    } catch (error) {
      resolve(spawnFailure(error));
      return;
    }
    // stdout is a structured remote executable path. Preserve valid Nix hashes;
    // user-facing error output is separately redacted across chunk boundaries.
    const out = new BoundedProcessOutput(MAX_PROBE_OUTPUT_BYTES, { redact: false });
    const err = new BoundedProcessOutput(MAX_PROBE_OUTPUT_BYTES);
    let settled = false;
    let stopping = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (response: Response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.signal.removeEventListener("abort", onAbort);
      resolve(response);
    };
    const stop = (cancelled: boolean) => {
      if (settled || stopping) return;
      stopping = true;
      clearTimeout(timer);
      const complete = (cleanupComplete: boolean) => finish(NextResponse.json(
        {
          ok: false,
          reachable: false,
          cleanupComplete,
          error: cancelled ? "SSH check cancelled" : `ssh did not respond within ${SSH_TIMEOUT_MS / 1000}s`,
          ...(!cancelled ? { hint: `Check the host name and your network, or run \`ssh ${host}\` in a terminal to see what it is waiting on.` } : {}),
        },
        { status: cancelled ? 499 : 504 },
      ));
      void terminateProcessTree(child).then(complete, () => complete(false));
    };
    const onAbort = () => stop(true);
    timer = setTimeout(() => stop(false), SSH_TIMEOUT_MS);
    req.signal.addEventListener("abort", onAbort, { once: true });
    child.stdout?.on("data", (data: Buffer) => { out.append(data); });
    child.stderr?.on("data", (data: Buffer) => { err.append(data); });
    child.on("error", (error) => {
      if (!stopping) finish(spawnFailure(error));
    });
    child.on("close", (code) => {
      if (stopping || settled) return;
      const stdout = out.text();
      const stderr = err.text();
      const reachable = code === 0 && stdout.includes(PROBE_MARKER);
      if (!reachable) {
        finish(
          NextResponse.json(
            {
              ok: false,
              reachable: false,
              error: `ssh exited with code ${code}`,
              stderr,
              hint: `Run \`ssh ${host}\` once in a terminal to accept the host key and confirm key-based auth works — Cave connects non-interactively and never prompts for passwords.`,
            },
            { status: 502 },
          ),
        );
        return;
      }
      const probeTail = stdout.slice(
        stdout.indexOf(PROBE_MARKER) + PROBE_MARKER.length,
      );
      const covenLine =
        probeTail
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find((line) => line.length > 0) ?? "no-coven";
      const covenPath = covenLine === "no-coven" ? null : covenLine;
      finish(
        NextResponse.json({
          ok: true,
          reachable: true,
          covenPath,
          ...(covenPath
            ? {}
            : {
                hint: "Connected, but `coven` is not on the remote PATH. Install it there with `npm i -g @opencoven/cli@latest`, or set a custom remote command on the familiar.",
              }),
        }),
      );
    });
    // Cover cancellation between the early check and listener registration.
    if (req.signal.aborted) onAbort();
  });
}
