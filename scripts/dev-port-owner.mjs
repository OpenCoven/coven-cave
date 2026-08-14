import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Who owns the dedicated dev port?
 *
 * The launcher used to scan 3000..3010 and take whatever was free, so "the port
 * is busy" was never a question it had to answer — it just moved. With a fixed
 * port (scripts/ports.mjs) moving is exactly the behaviour being retired, so the
 * conflict has to be resolved by identity instead:
 *
 *   free      nothing is listening                       -> start a dev server
 *   ours      it answers as CovenCave                    -> attach, don't start
 *   stranger  something else is holding the port         -> refuse, by name
 *
 * Identity comes from /api/app/build-info, which is deliberately value-free
 * ("public, value-free artifact identity" — src/app/api/app/build-info/route.ts).
 *
 * Caveat worth knowing: that route is behind the global gate in src/proxy.ts, so
 * a dev server started WITH a sidecar token (`pnpm mobile:tailscale:app`) answers
 * 401 rather than 200. A probe cannot then tell it apart from a stranger, so it
 * is reported as `gated` and the launcher refuses rather than guessing. Plain
 * `pnpm dev` sets no token, which is the case where attach actually matters.
 *
 * Usage: node scripts/dev-port-owner.mjs --port 3000 [--timeout-ms 1500]
 * Prints one of: free | ours | gated | stranger
 */

const DEFAULT_TIMEOUT_MS = 1_500;

export function parseArgs(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!flag.startsWith("--")) continue;
    args.set(flag.slice(2), argv[i + 1]);
  }
  return args;
}

/**
 * @returns {Promise<"free" | "ours" | "gated" | "stranger">}
 */
export async function classifyPortOwner({
  port,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
} = {}) {
  let response;
  try {
    response = await fetchImpl(`http://127.0.0.1:${port}/api/app/build-info`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json" },
    });
  } catch {
    // Connection refused is the ordinary "nothing is here" case. A timeout also
    // lands here: something is accepting connections without answering, which is
    // not a Cave we can attach to — treat it as free so the caller's own bind
    // attempt produces the real, specific error.
    return "free";
  }

  if (response.status === 401 || response.status === 403) return "gated";
  if (!response.ok) return "stranger";

  try {
    const payload = await response.json();
    return payload && payload.name === "CovenCave" ? "ours" : "stranger";
  } catch {
    // A 200 that is not our JSON is somebody else's server.
    return "stranger";
  }
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  const args = parseArgs(process.argv.slice(2));
  const port = Number(args.get("port"));
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    console.error("dev-port-owner: --port must be a valid TCP port");
    process.exit(2);
  }
  const timeoutRaw = args.get("timeout-ms");
  const timeoutMs = timeoutRaw === undefined ? DEFAULT_TIMEOUT_MS : Number(timeoutRaw);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100) {
    console.error("dev-port-owner: --timeout-ms must be at least 100");
    process.exit(2);
  }
  console.log(await classifyPortOwner({ port, timeoutMs }));
}
