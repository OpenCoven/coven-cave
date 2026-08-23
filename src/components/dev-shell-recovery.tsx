"use client";

import dynamic from "next/dynamic";

// The overlay lives in its own module, reached through next/dynamic, purely so
// that `@/styles/dev-shell-recovery.css` stays out of the production graph.
// The component below already compiles away under NODE_ENV !== "development",
// but a *static* import of that stylesheet does not: Turbopack attributes it to
// the root layout's stylesheet set, so every production page load downloaded
// ~2 KB of dev-only overlay CSS. It also counted against the root-layout CSS
// budget in scripts/bundle-budget.mjs, which is what surfaced it.
const DevShellRecoveryOverlay = dynamic(
  () => import("./dev-shell-recovery-overlay").then((module) => module.DevShellRecoveryOverlay),
  { ssr: false },
);

/**
 * Keeps the desktop dev window from sitting silently on a dead loopback origin.
 * Without this the window keeps the last-rendered document forever, and the
 * first navigation reports a raw ChunkLoadError or ERR_CONNECTION_REFUSED with
 * no way back short of hunting the process tree by hand.
 */
export function DevShellRecovery() {
  // A build-time constant, so production drops the overlay, its heartbeat, and
  // — because the import above is lazy — its stylesheet.
  if (process.env.NODE_ENV !== "development") return null;
  return <DevShellRecoveryOverlay />;
}
