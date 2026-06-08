"use client";

/**
 * Tiny in-memory store tracking recent failures of daemon-bound writes
 * (PATCH /api/config, PUT /api/familiars/:id/icon). Studio footer reads
 * this to surface "Saved locally, daemon offline" when relevant.
 *
 * Not persisted across reloads — a fresh page is a fresh attempt.
 * A successful write clears the failure state. A failure within the
 * last STALE_AFTER_MS window keeps the indicator visible.
 */

import { useSyncExternalStore } from "react";

const STALE_AFTER_MS = 60_000;

type State = {
  lastFailureAt: number | null;
  lastFailureReason: string | null;
};

let state: State = { lastFailureAt: null, lastFailureReason: null };
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

export function reportDaemonSyncFailure(reason: string): void {
  state = { lastFailureAt: Date.now(), lastFailureReason: reason };
  notify();
}

export function reportDaemonSyncSuccess(): void {
  if (state.lastFailureAt === null) return;
  state = { lastFailureAt: null, lastFailureReason: null };
  notify();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const SERVER_SNAPSHOT: State = Object.freeze({ lastFailureAt: null, lastFailureReason: null });
function getServerSnapshot() { return SERVER_SNAPSHOT; }
function getSnapshot() { return state; }

export function useDaemonSyncStatus(): {
  offline: boolean;
  reason: string | null;
} {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (snap.lastFailureAt === null) return { offline: false, reason: null };
  const age = Date.now() - snap.lastFailureAt;
  if (age > STALE_AFTER_MS) return { offline: false, reason: null };
  return { offline: true, reason: snap.lastFailureReason };
}
