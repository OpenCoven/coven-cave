import { isDirectRun as isDirectRunOf } from "./direct-run.mjs";

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
 * A configured token no longer gates that route against this probe, whatever
 * `pnpm mobile:tailscale:app` set: server.ts stamps x-coven-cave-local-peer on
 * any request whose TCP peer is loopback, carries no forwarding markers and
 * names a loopback Host (`isDirectLoopbackRequest`), and src/proxy.ts lets that
 * stamp through the ordinary app APIs as `trustedLocalBrowserApi`. This probe is
 * exactly that shape, so it reads 200 either way.
 *
 * `gated` is therefore a defensive branch rather than the token case it was
 * written for, and it still earns its keep: a 401/403 now means Next answered
 * without server.ts in front of it (the stamp's secret is unset, so the peer
 * check fails closed), or a CovenCave older than the stamp is holding the port
 * with a token set, or the holder is simply somebody else's authenticated
 * server. None of those can be told apart from here, so the launcher refuses
 * rather than attaching to a server it cannot identify.
 *
 * Usage: node scripts/dev-port-owner.mjs --port 3000 [--timeout-ms 1500]
 * Prints one of: free | ours | gated | stranger
 *
 * The packaged shell has the related Rust classifier at
 * src-tauri/src/sidecar_startup.rs::classify_port_occupant. Its `Cave` verdict
 * corresponds to this probe's `ours`; native startup also takes a per-port
 * claim before spawning. The probes intentionally differ for a silent TCP
 * connection, so keep their shared port and identity contract aligned without
 * assuming identical handling.
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

// See scripts/direct-run.mjs for the three ways a naive URL/argv comparison
// breaks.
function isDirectRun() {
  return isDirectRunOf(import.meta.url);
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
