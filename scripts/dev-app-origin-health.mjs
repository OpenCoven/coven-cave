/**
 * Bounded loopback-origin readiness probe for the Tauri development launcher.
 * A listening TCP port is not sufficient: a wedged Next compiler can accept
 * connections indefinitely while returning no HTTP response to the WebView.
 */
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Probe the same document the initial Tauri WebView loads. A lightweight API
// route can answer before the root React tree is compiled, which would still
// leave the desktop window black.
const READY_PATH = "/?__devShellProbe=1";
const DEFAULT_TIMEOUT_MS = 1_500;
const MAX_TIMEOUT_MS = 300_000;
const RETRY_DELAY_MS = 50;
const READINESS_TOKEN_HEADER = "x-coven-cave-readiness-token";
const READINESS_PROOF_HEADER = "x-coven-cave-readiness";

export function parsePort(value) {
  if (!/^\d+$/.test(value ?? "")) return null;
  const port = Number(value);
  return Number.isSafeInteger(port) && port >= 1 && port <= 65_535 ? port : null;
}

export function parseTimeout(value) {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (!/^\d+$/.test(value)) return null;
  const timeoutMs = Number(value);
  return Number.isSafeInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= MAX_TIMEOUT_MS
    ? timeoutMs
    : null;
}

export function resolveProbeToken(env = process.env) {
  return env.COVEN_CAVE_DEV_PROBE_TOKEN?.trim() ?? "";
}

async function awaitByDeadline(promise, deadline) {
  const settlement = Promise.resolve(promise).catch(() => {});
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) return;

  let timeout;
  try {
    await Promise.race([
      settlement,
      new Promise((resolve) => {
        timeout = setTimeout(resolve, remainingMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export async function loopbackOriginResponds({
  port,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
  probeToken = resolveProbeToken(),
} = {}) {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) return false;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > MAX_TIMEOUT_MS) return false;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now();
    try {
      const response = await fetchImpl(`http://127.0.0.1:${port}${READY_PATH}`, {
        method: "GET",
        redirect: "manual",
        headers: {
          accept: "text/html",
          ...(probeToken ? { [READINESS_TOKEN_HEADER]: probeToken } : {}),
        },
        signal: AbortSignal.timeout(remainingMs),
      });
      if (
        response.status >= 200
        && response.status < 400
        && response.headers?.get?.(READINESS_PROOF_HEADER) === "1"
      ) {
        return true;
      }
      await awaitByDeadline(response.body?.cancel(), deadline);
    } catch {}

    const retryInMs = Math.min(RETRY_DELAY_MS, deadline - Date.now());
    if (retryInMs <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, retryInMs));
  }
  return false;
}

function cliArgs(argv) {
  let port = null;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--port") port = parsePort(argv[++index]);
    else if (argv[index] === "--timeout-ms") timeoutMs = parseTimeout(argv[++index]);
    else return null;
  }
  return port === null || timeoutMs === null ? null : { port, timeoutMs };
}

// Compare CANONICAL filesystem paths, not `import.meta.url` against
// `new URL(process.argv[1], "file:")` (cave-gcb0i). On Windows argv[1] arrives
// as `C:\...\dev-app-origin-health.mjs`, which the URL parser reads as an
// opaque `c:` scheme rather than the `file:///C:/...` href this module
// reports, so the guard is false and the probe never runs. Because
// `origin_is_ready()` in scripts/dev-app.sh reads this script's exit status, a
// no-op that exits 0 reads as "the origin is ready" — the launcher then opens
// the Tauri window against a server that has answered nothing, which is the
// permanently black window this probe exists to prevent.
// realpathSync also collapses a symlinked entry point (Node realpaths the main
// module's URL but leaves argv[1] as the link path) and Windows path casing.
const canonicalPath = (target) => {
  const resolved = resolve(target);
  let real = resolved;
  try { real = realpathSync.native(resolved); } catch { /* not on disk */ }
  return process.platform === "win32" ? real.toLowerCase() : real;
};

export const isDirectRun = (argv1, moduleUrl) => {
  if (!argv1) return false;
  try { return canonicalPath(argv1) === canonicalPath(fileURLToPath(moduleUrl)); }
  catch { return false; }
};

if (isDirectRun(process.argv[1], import.meta.url)) {
  const options = cliArgs(process.argv.slice(2));
  process.exitCode = options && await loopbackOriginResponds(options) ? 0 : 1;
}
