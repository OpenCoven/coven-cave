"use client";

import { useSyncExternalStore } from "react";

import {
  applyPreferencesPatch,
  createDefaultPreferences,
  legacyStorageToPreferencesPatch,
  normalizeCavePreferences,
  preferencesToLegacyStorage,
  type CavePreferences,
  type CavePreferencesPatch,
} from "./preferences-schema.ts";

const BOOTSTRAP_ID = "cave-preferences-bootstrap";
const CHANNEL_NAME = "cave:app-preferences";

// Only these non-secret, user-facing values are eligible for one-time import.
// The schema helper is an additional allowlist/normalization boundary.
const LEGACY_KEYS = [
  "coven-theme",
  "coven-mode",
  "coven-custom-theme",
  "coven:recent-colors",
  "cave:font:serif",
  "cave:font:sans",
  "cave:font:mono",
  "cave:screen-scale",
  "cave:reading-leading",
  "cave:reading-tracking",
  "cave:reading-align",
  "cave:reading-width",
  "cave:reading-weight",
  "cave:reading-hyphens",
  "cave:datetime-clock",
  "cave:datetime-date",
  "cave:datetime-density",
  "cave:corner-radius",
  "cave:home-news-enabled",
  "cave:mobile-mode-enabled",
  "cave:backdrop:v1",
] as const;

declare global {
  interface Window {
    __COVEN_CAVE_PREFERENCES__?: unknown;
    __COVEN_CAVE_PREFERENCES_AUTHORITATIVE__?: boolean;
  }
}

function readBootstrap(): CavePreferences | null {
  if (typeof window === "undefined") return null;
  const direct = window.__COVEN_CAVE_PREFERENCES__;
  if (direct && window.__COVEN_CAVE_PREFERENCES_AUTHORITATIVE__ !== false) {
    return normalizeCavePreferences(direct);
  }
  if (typeof document === "undefined") return null;
  const node = document.getElementById(BOOTSTRAP_ID);
  if (!node?.textContent) return null;
  if (node.getAttribute("data-authoritative") === "false") return null;
  try {
    return normalizeCavePreferences(JSON.parse(node.textContent));
  } catch {
    return null;
  }
}

function activeStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    // Storage may be denied by the browser.
  }
  return null;
}

function readLegacyValues(): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  const storage = activeStorage();
  if (!storage) return values;
  for (const key of LEGACY_KEYS) {
    try {
      const value = storage.getItem(key);
      if (value !== null) values[key] = value;
    } catch {
      break;
    }
  }
  return values;
}

function hasOwnKeys(value: object): boolean {
  return Object.keys(value).length > 0;
}

function isCanonicalPreferencesPayload(value: unknown): value is CavePreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<CavePreferences>;
  return candidate.version === 1 &&
    typeof candidate.initialized === "boolean" &&
    typeof candidate.revision === "number" &&
    Boolean(candidate.appearance && typeof candidate.appearance === "object") &&
    Boolean(candidate.general && typeof candidate.general === "object") &&
    Boolean(candidate.phone && typeof candidate.phone === "object");
}

function mergePatch(left: CavePreferencesPatch, right: CavePreferencesPatch): CavePreferencesPatch {
  const merge = (a: unknown, b: unknown): unknown => {
    if (!b || typeof b !== "object" || Array.isArray(b)) return b;
    const base = a && typeof a === "object" && !Array.isArray(a) ? a as Record<string, unknown> : {};
    const out: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(b as Record<string, unknown>)) {
      out[key] = merge(base[key], value);
    }
    return out;
  };
  return merge(left, right) as CavePreferencesPatch;
}

let authoritativeBootstrap = readBootstrap();
let snapshot = authoritativeBootstrap ?? createDefaultPreferences(false);
let canonicalInitialized = authoritativeBootstrap?.initialized === true;
let canonicalLoaded = authoritativeBootstrap !== null;
let legacyPatch: CavePreferencesPatch | null = null;
let storageIdentity = activeStorage();

// On the first upgraded launch, expose the current origin's legacy values
// synchronously so the mounted appearance controllers do not flash defaults.
// Persistence waits for the authenticated bootstrap controller.
if (activeStorage() && !snapshot.initialized) {
  legacyPatch = legacyStorageToPreferencesPatch(readLegacyValues());
  if (hasOwnKeys(legacyPatch)) {
    const effective = applyPreferencesPatch(snapshot, legacyPatch);
    snapshot = { ...effective, initialized: false };
  }
}

const listeners = new Set<() => void>();
let pendingPatch: CavePreferencesPatch = {};
let drainPromise: Promise<boolean> | null = null;
let initializedPromise: Promise<CavePreferences> | null = null;
let channel: BroadcastChannel | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;
let retryBlocked: "terminal" | "exhausted" | null = null;

const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 30_000;
const RETRY_MAX_ATTEMPTS = 6;

type PatchSendResult =
  | { ok: true }
  | { ok: false; retryable: boolean };

function notify() {
  for (const listener of listeners) listener();
}

// Node tests and embedded webviews can replace the Storage object wholesale.
// Until a canonical ACK exists, treat that as a fresh origin rather than
// leaking optimistic state from the previous storage namespace.
function synchronizeStorageIdentity() {
  const current = activeStorage();
  if (canonicalInitialized || current === storageIdentity) return;
  storageIdentity = current;
  snapshot = authoritativeBootstrap ?? createDefaultPreferences(false);
  legacyPatch = legacyStorageToPreferencesPatch(readLegacyValues());
  if (hasOwnKeys(legacyPatch)) {
    const effective = applyPreferencesPatch(snapshot, legacyPatch);
    snapshot = { ...effective, initialized: false };
  }
  pendingPatch = {};
  initializedPromise = null;
  cancelRetryTimer();
  retryAttempt = 0;
  retryBlocked = null;
}

function mirrorLegacy(preferences: CavePreferences) {
  const storage = activeStorage();
  if (!storage) return;
  const values = preferencesToLegacyStorage(preferences);
  for (const [key, value] of Object.entries(values)) {
    try {
      storage.setItem(key, value);
    } catch {
      return;
    }
  }
}

function ensureChannel() {
  if (channel || typeof BroadcastChannel === "undefined") return;
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = () => void refreshAppPreferences();
  (channel as { unref?: () => void }).unref?.();
}

function broadcast() {
  ensureChannel();
  channel?.postMessage("changed");
}

function commitCanonical(preferences: unknown) {
  if (!isCanonicalPreferencesPayload(preferences)) return false;
  const canonical = normalizeCavePreferences(preferences);
  canonicalLoaded = true;
  canonicalInitialized = canonical.initialized;
  snapshot = hasOwnKeys(pendingPatch)
    ? applyPreferencesPatch(canonical, pendingPatch)
    : canonical;
  if (!canonicalInitialized) snapshot = { ...snapshot, initialized: false };
  mirrorLegacy(snapshot);
  notify();
  try {
    performance.mark("cave:canonical-preferences-applied");
  } catch {
    // User Timing is optional in tests and older embedded webviews.
  }
  return true;
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function sendPatch(
  patch: CavePreferencesPatch,
  options: { keepalive?: boolean } = {},
): Promise<PatchSendResult> {
  try {
    const response = await fetch("/api/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
      ...(options.keepalive ? { keepalive: true } : {}),
    });
    const data = (await response.json().catch(() => null)) as
      | { ok?: boolean; preferences?: CavePreferences }
      | null;
    if (!response.ok || !data?.ok || !isCanonicalPreferencesPayload(data.preferences)) {
      return { ok: false, retryable: retryableStatus(response.status) };
    }
    commitCanonical(data.preferences);
    retryAttempt = 0;
    retryBlocked = null;
    broadcast();
    return { ok: true };
  } catch {
    return { ok: false, retryable: true };
  }
}

function cancelRetryTimer(): void {
  if (retryTimer === null) return;
  clearTimeout(retryTimer);
  retryTimer = null;
}

function scheduleRetry(): void {
  if (retryTimer !== null || retryBlocked || !hasOwnKeys(pendingPatch)) return;
  if (retryAttempt >= RETRY_MAX_ATTEMPTS) {
    retryBlocked = "exhausted";
    return;
  }
  const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * (2 ** Math.min(retryAttempt, 6)));
  retryAttempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (!hasOwnKeys(pendingPatch)) return;
    if (canonicalInitialized) void scheduleDrain();
    else void initializeAppPreferences();
  }, delay);
  (retryTimer as { unref?: () => void }).unref?.();
}

async function drain(options: { keepalive?: boolean } = {}): Promise<boolean> {
  let ok = true;
  while (hasOwnKeys(pendingPatch)) {
    const patch = pendingPatch;
    pendingPatch = {};
    const result = await sendPatch(patch, options);
    if (result.ok) continue;
    // Preserve the failed patch for a later retry. Newer writes win when the
    // failed request overlaps the same leaf.
    pendingPatch = mergePatch(patch, pendingPatch);
    ok = false;
    if (result.retryable) scheduleRetry();
    else retryBlocked = "terminal";
    break;
  }
  return ok;
}

function scheduleDrain(options: { keepalive?: boolean } = {}): Promise<boolean> {
  cancelRetryTimer();
  if (retryBlocked) return Promise.resolve(false);
  if (!drainPromise) {
    drainPromise = Promise.resolve()
      .then(() => drain(options))
      .finally(() => {
        drainPromise = null;
      });
  }
  return drainPromise;
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("online", () => {
    if (retryBlocked === "exhausted") {
      retryBlocked = null;
      retryAttempt = 0;
    }
    if (!retryBlocked && hasOwnKeys(pendingPatch)) void flushAppPreferences();
  });
}

export function readAppPreferences(): CavePreferences {
  synchronizeStorageIdentity();
  return snapshot;
}

export function subscribeAppPreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppPreferences(): CavePreferences {
  return useSyncExternalStore(subscribeAppPreferences, readAppPreferences, readAppPreferences);
}

/** Optimistically apply and coalesce a typed patch, then persist in FIFO order. */
export function updateAppPreferences(patch: CavePreferencesPatch): void {
  synchronizeStorageIdentity();
  if (!hasOwnKeys(patch)) return;
  pendingPatch = mergePatch(pendingPatch, patch);
  snapshot = applyPreferencesPatch(snapshot, patch);
  if (!canonicalInitialized) snapshot = { ...snapshot, initialized: false };
  mirrorLegacy(snapshot);
  notify();
  if (retryBlocked === "exhausted") {
    retryBlocked = null;
    retryAttempt = 0;
  }
  if (canonicalInitialized && !retryBlocked) void scheduleDrain();
}

/** Resolve after all currently queued writes settle. False means retryable failure. */
export async function flushAppPreferences(
  options: { keepalive?: boolean } = {},
): Promise<boolean> {
  if (retryBlocked) return false;
  if (!canonicalInitialized) {
    await initializeAppPreferences();
    if (!canonicalInitialized) return false;
  }
  if (hasOwnKeys(pendingPatch)) void scheduleDrain(options);
  const active = drainPromise;
  if (!active) return true;
  const ok = await active;
  if (ok && hasOwnKeys(pendingPatch)) return flushAppPreferences(options);
  return ok;
}

export async function refreshAppPreferences(): Promise<CavePreferences> {
  try {
    const response = await fetch("/api/preferences", { cache: "no-store" });
    const data = (await response.json().catch(() => null)) as
      | { ok?: boolean; preferences?: CavePreferences }
      | null;
    if (response.ok && data?.ok && isCanonicalPreferencesPayload(data.preferences)) {
      authoritativeBootstrap = normalizeCavePreferences(data.preferences);
      commitCanonical(authoritativeBootstrap);
    }
  } catch {
    // Keep the synchronous bootstrap/session snapshot while the sidecar is unavailable.
  }
  return snapshot;
}

/**
 * Hydrate from the server and perform the one-time, allowlisted current-origin
 * migration only while the central store is uninitialized. Legacy entries are
 * intentionally mirrored and never deleted.
 */
export function initializeAppPreferences(): Promise<CavePreferences> {
  if (initializedPromise) return initializedPromise;
  initializedPromise = (async () => {
    ensureChannel();
    if (!authoritativeBootstrap) await refreshAppPreferences();
    // A paint-only snapshot is never permission to initialize or write. If the
    // canonical read failed or returned malformed data, preserve every queued
    // edit locally and let the shell's explicit retry path try the GET again.
    if (!canonicalLoaded) return snapshot;
    if (!canonicalInitialized) {
      const migration = legacyPatch ?? legacyStorageToPreferencesPatch(readLegacyValues());
      // The legacy snapshot is the base; any interaction queued while the app
      // was booting wins at the same leaf. Detach exactly this payload so writes
      // arriving during the request remain pending for the next serialized send.
      const patch = mergePatch(migration, pendingPatch);
      pendingPatch = {};
      // An empty PATCH is meaningful here: it marks a brand-new central store
      // initialized without inventing any legacy values.
      const result = await sendPatch(patch);
      if (result.ok) {
        legacyPatch = null;
        authoritativeBootstrap = snapshot;
        if (hasOwnKeys(pendingPatch)) void scheduleDrain();
      } else {
        // Retry the same initialization payload later; writes made while it was
        // in flight remain newer and therefore win during the merge.
        pendingPatch = mergePatch(patch, pendingPatch);
        if (result.retryable) scheduleRetry();
        else retryBlocked = "terminal";
      }
    } else {
      mirrorLegacy(snapshot);
      if (hasOwnKeys(pendingPatch)) void scheduleDrain();
    }
    return snapshot;
  })();
  void initializedPromise.then(
    () => {
      if (!canonicalInitialized) initializedPromise = null;
    },
    () => {
      initializedPromise = null;
    },
  );
  return initializedPromise;
}
