// The one place that decides which port Cave listens on.
//
// Before this file, nothing agreed: `scripts/dev-app.sh` scanned 3000–3010 for
// whatever happened to be free, the packaged desktop app bound a RANDOM port
// every launch (`find_free_port()` in src-tauri/src/sidecar_startup.rs binds
// 127.0.0.1:0), and playwright.config.ts pinned 3100 on its own. A port that
// moves is not just untidy — it leaks into durable state. The mobile pairing
// secret lives in `mobile-tailscale-${port}` (mobile-access-provision.ts), so a
// per-launch port meant a per-launch state directory, and `tailscale serve`
// needed a self-repair pass to chase the loopback port it had been pointed at.
//
// One port per channel, fixed:
//
//   dev         3000   the entrenched one — docs, iOS, muscle memory
//   production  3020   its own neighbour, so a packaged build and a dev server
//                      can run side by side without fighting
//   e2e         3100   unchanged; playwright.config.ts already pinned it
//
// Rust cannot import this module. `src-tauri/src/sidecar_ports.rs` carries the
// same numbers and `scripts/port-contract.test.mjs` fails if the copies ever
// disagree — the same two-place convention `scripts/sidecar-bundle-deps.test.mjs`
// uses for the sidecar budget, where a literal is pinned precisely so raising it
// is a deliberate edit in two reviewed places rather than a silent drift.

/** Fixed port per build channel. Change here AND in src-tauri/src/sidecar_ports.rs. */
export const CAVE_PORTS = Object.freeze({
  dev: 3000,
  production: 3020,
  e2e: 3100,
});

/** @typedef {keyof typeof CAVE_PORTS} CaveChannel */

export const CAVE_PORT_ENV = "COVEN_CAVE_PORT";

/**
 * A port is only usable if it is a whole number in the TCP range. Port 0 is
 * excluded deliberately: it means "bind anything", which is the behaviour this
 * module exists to remove. An operator who wants that can still pass an
 * explicit port.
 */
export function isUsablePort(value) {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

/** Parses an env value, returning null for anything that is not a usable port. */
export function parsePort(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return isUsablePort(parsed) ? parsed : null;
}

/**
 * The port for a channel, honouring an explicit override.
 *
 * COVEN_CAVE_PORT wins over PORT so an operator can pin Cave specifically
 * without disturbing a PORT that some parent process set for its own reasons —
 * pnpm exports its whole config to children as env vars, and inheriting one of
 * those by accident is exactly how an "undedicated" port comes back. An
 * unparseable override is ignored rather than fatal: a typo in a shell profile
 * should not stop the app from starting, and the resolved port is logged by
 * every caller.
 */
export function resolvePort(channel, env = process.env) {
  const fallback = CAVE_PORTS[channel];
  if (!isUsablePort(fallback)) {
    throw new Error(`unknown Cave channel: ${String(channel)}`);
  }
  return parsePort(env?.[CAVE_PORT_ENV]) ?? parsePort(env?.PORT) ?? fallback;
}

/** The channel a Node process is running as, from the env the callers already set. */
export function currentChannel(env = process.env) {
  if (env?.COVEN_CAVE_E2E === "1") return "e2e";
  if (env?.COVEN_CAVE_BUNDLE === "1") return "production";
  return "dev";
}
