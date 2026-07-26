/**
 * Preflight cleanup for Codex CLI's OAuth callback port (TCP 1455).
 *
 * Codex CLI's `codex login` opens a local OAuth callback server on port
 * 1455. If a previous login flow gets killed mid-OAuth (esc, SIGINT,
 * browser closed, network blip) the listener sometimes leaks as an orphan
 * process. The next attempt then crashes with:
 *
 *   Codex OAuth failed: Failed to bind port 1455: Address already in use
 *   (os error 98 on Linux, os error 48 on macOS)
 *
 * Upstream Codex has no auto-recover or fallback-port logic, so we handle
 * it from our side. The preflight:
 *
 *   1. Tries to bind 127.0.0.1:1455 ourselves. If we can, the port is
 *      free; we drop the listener and return PortFree.
 *   2. If bind fails with EADDRINUSE, asks `lsof -ti tcp:1455` for the
 *      holding pid.
 *   3. Looks the pid up with `ps -o command=` to get a process descriptor
 *      and only kills it if its argv/path clearly contains a `codex`
 *      token (split on whitespace + path separators — won't match
 *      substrings like "vscodex" or "not-codex-tool").
 *   4. Re-checks the port is rebindable, with a short retry budget.
 *
 * If the holder doesn't look like codex, OR if we can't identify it at
 * all (no lsof, ambiguous results), the preflight refuses to kill anything
 * and returns a HeldByOther / HeldUnknown result. The caller surfaces a
 * "run `lsof -i tcp:1455` to investigate" message.
 */
import { createServer } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** The fixed port Codex CLI's OAuth callback server tries to bind. */
export const CODEX_OAUTH_PORT = 1455;

export type PreflightOutcome =
  | { kind: "port-free" }
  | { kind: "cleared-stale-codex"; killedPid: number; descriptor: string }
  | { kind: "held-by-other"; pid: number; descriptor: string }
  | { kind: "held-unknown" };

/** Probe whether a TCP port on 127.0.0.1 is rebindable right now. */
export async function portIsFree(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", (err: NodeJS.ErrnoException) => {
      // EADDRINUSE → not free. Any other bind error (EACCES, …) → also
      // treat as not-free so we surface the real error later when we
      // re-bind for the actual auth flow.
      resolve(err.code !== "EADDRINUSE" && err.code !== "EACCES" ? true : false);
    });
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen({ port, host: "127.0.0.1", exclusive: true });
  });
}

/**
 * Find the single pid holding `port` on localhost via `lsof -ti tcp:<port>`.
 * Returns null if lsof is missing, the port has no holder, or multiple
 * processes hold it (refuses to disambiguate — safer to print instructions).
 */
export async function pidHoldingPort(port: number): Promise<number | null> {
  let stdout: string;
  try {
    const result = await execFileAsync("lsof", ["-ti", `tcp:${port}`], {
      timeout: 2000,
    });
    stdout = result.stdout;
  } catch (err: unknown) {
    const code = (err as { code?: unknown }).code;
    // lsof returns exit code 1 when no matching open files; that's not
    // an error condition for us. Anything else (ENOENT for missing lsof,
    // timeout, etc) → return null and let the caller fall through to
    // HeldUnknown.
    if (code === 1) return null;
    return null;
  }

  const pids = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => Number.parseInt(line, 10))
    .filter((n) => Number.isFinite(n));

  if (pids.length !== 1) return null;
  return pids[0]!;
}

/**
 * Get a best-effort process descriptor for `pid` via `ps -o command=`.
 * Returns an empty string if the process is gone or ps is unavailable.
 */
export async function describePid(pid: number): Promise<string> {
  try {
    // `command=` (with the trailing =) suppresses the header so we get
    // just the argv line. Works on both macOS and Linux ps.
    const { stdout } = await execFileAsync(
      "ps",
      ["-o", "command=", "-p", String(pid)],
      { timeout: 2000 },
    );
    return stdout.trim();
  } catch {
    return "";
  }
}

/**
 * Token-level heuristic for whether a descriptor looks like a Codex CLI
 * process. Split on whitespace, slashes, and backslashes so that:
 *   "node /opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js login"
 * matches (it has the `codex` token from the path *and* `codex.js`),
 * but
 *   "/opt/vscodex/bin/start" or "not-codex-tool foo"
 * does NOT.
 */
export function descriptorLooksLikeCodex(descriptor: string): boolean {
  if (!descriptor) return false;
  const tokens = descriptor.split(/[\s/\\]+/);
  return tokens.some(
    (t) => t === "codex" || t === "codex.js" || t === "@openai/codex",
  );
}

/**
 * SIGTERM the pid, wait up to 1s, then SIGKILL if still alive. Returns
 * true if the process actually exited.
 */
async function killPid(pid: number): Promise<boolean> {
  try {
    process.kill(pid, "SIGTERM");
  } catch (err) {
    // ESRCH = already gone; treat as success.
    if ((err as NodeJS.ErrnoException).code === "ESRCH") return true;
    return false;
  }

  // Wait up to 1s for graceful exit.
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (!isPidAlive(pid)) return true;
  }

  // Escalate to SIGKILL.
  try {
    process.kill(pid, "SIGKILL");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ESRCH") return true;
    return false;
  }

  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 50));
    if (!isPidAlive(pid)) return true;
  }
  return !isPidAlive(pid);
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function waitForPortFree(port: number, maxMs: number): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (await portIsFree(port)) return true;
    await new Promise((r) => setTimeout(r, 75));
  }
  return portIsFree(port);
}

/**
 * Full preflight: check the port, identify and (if-and-only-if it's a
 * codex process) clear a stale holder, then re-verify the port is free.
 */
export async function preflightCodexOAuthPort(): Promise<PreflightOutcome> {
  if (await portIsFree(CODEX_OAUTH_PORT)) {
    return { kind: "port-free" };
  }

  const pid = await pidHoldingPort(CODEX_OAUTH_PORT);
  if (pid === null) {
    return { kind: "held-unknown" };
  }

  const descriptor = await describePid(pid);
  if (!descriptorLooksLikeCodex(descriptor)) {
    return { kind: "held-by-other", pid, descriptor };
  }

  const killed = await killPid(pid);
  if (!killed) {
    return { kind: "held-by-other", pid, descriptor };
  }

  if (!(await waitForPortFree(CODEX_OAUTH_PORT, 1500))) {
    return { kind: "held-by-other", pid, descriptor };
  }

  return { kind: "cleared-stale-codex", killedPid: pid, descriptor };
}
