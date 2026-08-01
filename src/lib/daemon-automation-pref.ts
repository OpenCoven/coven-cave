"use client";

/**
 * Unattended daemon lifecycle preferences (cave-bqywj).
 *
 * Two opt-in switches, both default OFF: relaunch a local daemon that died,
 * and upgrade Coven. Cave already knows how to do both — what it does not do
 * today is either of them without a person clicking.
 *
 * Two, not the three this module first described: there is no separate daemon
 * artifact to upgrade. /api/onboarding/install's allowlist has one Coven entry,
 * `coven-cli` -> `@opencoven/cli`, and the daemon is that binary run as a
 * daemon.
 *
 * Default-off is the whole design. These restart processes and install
 * binaries on the user's machine, and the CLI is the thing they type at, so a
 * silent version change there is the more surprising of the two. The schema
 * normalizes with `=== true` rather than `!== false` so a corrupt or partial
 * preferences file fails closed instead of enabling automation nobody asked
 * for.
 *
 * There is deliberately NO auto-reconnect switch here. Reconnection is already
 * unconditional — `useLocalDaemonReadiness` re-probes /api/daemon/status every
 * 5s, workspace.tsx polls it on the same cadence and drops the offline banner
 * as soon as the daemon answers, and the PTY bridge runs its own backoff
 * reconnect loop. A toggle would either do nothing or, defaulting to off,
 * REMOVE working recovery. See the note on cave-bqywj.
 *
 * Follows the celebrations-pref.ts shape: useSyncExternalStore keeps every
 * subscriber live across same-tab writes and cross-tab storage events.
 */

import { useSyncExternalStore } from "react";
import {
  DEFAULT_DAEMON_AUTOMATION,
  type CaveDaemonAutomationPreferences,
} from "./preferences-schema.ts";
import {
  readAppPreferences,
  subscribeAppPreferences,
  updateAppPreferences,
} from "./app-preferences.ts";

export type DaemonAutomationKey = keyof CaveDaemonAutomationPreferences;

let cached: CaveDaemonAutomationPreferences | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

export function readDaemonAutomation(): CaveDaemonAutomationPreferences {
  if (cached === null) cached = readAppPreferences().daemon ?? DEFAULT_DAEMON_AUTOMATION;
  return cached;
}

export function writeDaemonAutomation(key: DaemonAutomationKey, enabled: boolean): void {
  cached = { ...readDaemonAutomation(), [key]: enabled };
  updateAppPreferences({ daemon: { [key]: enabled } });
  notify();
}

subscribeAppPreferences(() => {
  cached = null;
  notify();
});

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Live view of both switches. The server snapshot is the defaults —
 * every flag off — so SSR and a first paint before preferences load can never
 * render as though automation were already enabled.
 */
export function useDaemonAutomation(): CaveDaemonAutomationPreferences {
  return useSyncExternalStore(subscribe, readDaemonAutomation, () => DEFAULT_DAEMON_AUTOMATION);
}
