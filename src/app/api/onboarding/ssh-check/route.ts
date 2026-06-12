import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { stripAnsi } from "@/lib/ansi";
import { covenSpawnEnv } from "@/lib/coven-bin";

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

/** Marker scoping the parse to our own probe output, not banner noise. */
const PROBE_MARKER = "__coven_cave_ssh_probe__";

export async function POST(req: Request) {
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
    const child = spawn("ssh", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: covenSpawnEnv(),
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve(
        NextResponse.json(
          {
            ok: false,
            reachable: false,
            error: `ssh did not respond within ${SSH_TIMEOUT_MS / 1000}s`,
            hint: `Check the host name and your network, or run \`ssh ${host}\` in a terminal to see what it is waiting on.`,
          },
          { status: 504 },
        ),
      );
    }, SSH_TIMEOUT_MS);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve(
        NextResponse.json(
          {
            ok: false,
            reachable: false,
            error: `ssh could not start: ${e.message}`,
            hint: "Install an OpenSSH client (macOS/Linux ship one; Windows: Settings > Apps > Optional features > OpenSSH Client).",
          },
          { status: 500 },
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const stdout = stripAnsi(out);
      const stderr = stripAnsi(err).slice(-2000);
      const reachable = code === 0 && stdout.includes(PROBE_MARKER);
      if (!reachable) {
        resolve(
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
      resolve(
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
  });
}
