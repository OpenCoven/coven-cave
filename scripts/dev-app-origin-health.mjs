/**
 * Bounded loopback-origin readiness probe for the Tauri development launcher.
 * A listening TCP port is not sufficient: a wedged Next compiler can accept
 * connections indefinitely while returning no HTTP response to the WebView.
 */
// Probe the same document the initial Tauri WebView loads. A lightweight API
// route can answer before the root React tree is compiled, which would still
// leave the desktop window black.
const READY_PATH = "/?__devShellProbe=1";
const DEFAULT_TIMEOUT_MS = 1_500;
const MAX_TIMEOUT_MS = 300_000;
const RETRY_DELAY_MS = 50;

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

export async function loopbackOriginResponds({
  port,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
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
        signal: AbortSignal.timeout(remainingMs),
      });
      if (response.status >= 200 && response.status < 400) return true;
      await response.body?.cancel();
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

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  const options = cliArgs(process.argv.slice(2));
  process.exitCode = options && await loopbackOriginResponds(options) ? 0 : 1;
}
