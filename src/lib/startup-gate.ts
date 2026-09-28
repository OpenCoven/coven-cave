/**
 * App-load gate for requests nobody is waiting on yet (#5649).
 *
 * After a server start every route's first request costs seconds of loading,
 * and the browser runs six requests per host: ~20 requests leaving the page
 * together made a chat opened in the first seconds wait 2+ s in the browser
 * queue for a transcript the server answers in milliseconds. Loaders for
 * things not yet on screen (update banner, slash-menu data, capability lists,
 * launcher groups) wait on this gate instead.
 *
 * It opens STARTUP_SETTLE_MS after the first chat transcript paints — room for
 * that chat's own follow-up requests — or STARTUP_GATE_MAX_MS after load for a
 * page that never opens one. Once open it stays open.
 */

export const STARTUP_SETTLE_MS = 300;
export const STARTUP_GATE_MAX_MS = 4_000;

let open = false;
let settleTimer: ReturnType<typeof setTimeout> | null = null;
let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
const waiters: Array<() => void> = [];

function openGate(): void {
  if (open) return;
  open = true;
  if (settleTimer) clearTimeout(settleTimer);
  if (fallbackTimer) clearTimeout(fallbackTimer);
  settleTimer = null;
  fallbackTimer = null;
  for (const resolve of waiters.splice(0)) resolve();
}

function armFallback(): void {
  if (open || fallbackTimer || typeof setTimeout !== "function") return;
  fallbackTimer = setTimeout(openGate, STARTUP_GATE_MAX_MS);
}

/** Resolves once app load has settled; immediately after that. */
export function whenStartupSettled(): Promise<void> {
  if (open || typeof window === "undefined") return Promise.resolve();
  armFallback();
  return new Promise((resolve) => waiters.push(resolve));
}

/** The first chat transcript has painted. */
export function markStartupSettled(): void {
  if (open || settleTimer) return;
  settleTimer = setTimeout(openGate, STARTUP_SETTLE_MS);
}

/** Test seam: close the gate as at page load. */
export function resetStartupGateForTests(): void {
  open = false;
  if (settleTimer) clearTimeout(settleTimer);
  if (fallbackTimer) clearTimeout(fallbackTimer);
  settleTimer = null;
  fallbackTimer = null;
  waiters.splice(0);
}
