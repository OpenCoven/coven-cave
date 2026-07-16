"use client";

/**
 * Backdrop store — a user-chosen image behind the Chat and Home surfaces,
 * with an accent derived from the image so the app tints to match its vibe.
 *
 * Canonical prefs and image bytes live behind the local app-owned preferences
 * API, independent of the sidecar port. `cave:backdrop:v1` and the legacy
 * IndexedDB record remain non-destructive mirrors/migration sources; the image
 * still fades in after its asynchronous read.
 *
 * The accent override rides one custom property: setting `--accent-presence`
 * inline on <html> cascades through the existing color-mix chains
 * (`--ring-focus`, presence dots, tint recipes) — no per-token theme work,
 * and clearing the override restores the active theme untouched.
 */

import { useSyncExternalStore } from "react";
import { contrastRatio, oklabToRgb, parseThemeColor, rgbToOklab } from "@/lib/theme-contrast";
import {
  readAppPreferences,
  refreshAppPreferences,
  subscribeAppPreferences,
  updateAppPreferences,
} from "@/lib/app-preferences";
import {
  createBackdropImageState,
  type BackdropMigrationResult,
} from "@/lib/backdrop-image-state";

const PREFS_KEY = "cave:backdrop:v1";
const DB_NAME = "cave-backdrop";
const DB_VERSION = 1;
const STORE_NAME = "backdrop";
const IMAGE_KEY = "image";
/** Longest edge the stored image is downscaled to — plenty for a blurred
 *  backdrop, and keeps the IDB record small. */
const MAX_EDGE = 1920;

export type BackdropAccentSeed = { L: number; a: number; b: number };

export type BackdropPrefs = {
  enabled: boolean;
  /** 0–100 — how much of the image shows through the scrim. */
  intensity: number;
  /** Tint the app's accent to the image palette. */
  matchAccent: boolean;
  /** Dominant vibrant color sampled from the image (OKLab), or null when the
   *  image is effectively monochrome. Lightness is re-fit against the live
   *  background at apply time, so one seed serves dark and light modes. */
  accentSeed: BackdropAccentSeed | null;
};

const DEFAULT_PREFS: BackdropPrefs = {
  enabled: false,
  intensity: 50,
  matchAccent: true,
  accentSeed: null,
};

// ── prefs store (localStorage + useSyncExternalStore) ───────────────────────

let cachedPrefs: BackdropPrefs | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

export function readBackdropPrefs(): BackdropPrefs {
  if (cachedPrefs) return cachedPrefs;
  const central = readAppPreferences().appearance.backdrop;
  cachedPrefs = {
    enabled: central.enabled,
    intensity: clamp(central.intensity, 0, 100),
    matchAccent: central.matchAccent,
    accentSeed: central.accentSeed ? { ...central.accentSeed } : null,
  };
  return cachedPrefs;
}

export function writeBackdropPrefs(patch: Partial<BackdropPrefs>): BackdropPrefs {
  const next = { ...readBackdropPrefs(), ...patch };
  cachedPrefs = next;
  updateAppPreferences({ appearance: { backdrop: next } });
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    /* private mode — the session still works, it just won't persist */
  }
  // Prefs (accent, intensity, enablement) take effect immediately everywhere —
  // including routes that don't mount the layer, like /settings. The image
  // itself is the layer's job.
  applyBackdropToDocument(next, undefined);
  notify();
  return next;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const getServerPrefs = () => DEFAULT_PREFS;

export function useBackdropPrefs(): BackdropPrefs {
  return useSyncExternalStore(subscribe, readBackdropPrefs, getServerPrefs);
}

function clamp(n: number, lo: number, hi: number): number {
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
}

// ── image record (IndexedDB) ─────────────────────────────────────────────────

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
}

async function readLegacyBackdropImage(): Promise<Blob | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(IMAGE_KEY);
      req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error("backdrop read failed"));
    });
  } finally {
    db.close();
  }
}

async function writeLegacyBackdropImage(blob: Blob): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put(blob, IMAGE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("backdrop write failed"));
    });
  } finally {
    db.close();
  }
}

async function readCentralBackdropImage() {
  const response = await fetch("/api/preferences/backdrop", { cache: "no-store" });
  // 204 is the clean current contract; accept 404 from older sidecars during
  // rolling upgrades so a missing optional image stays backward-compatible.
  if (response.status === 204 || response.status === 404) return { kind: "missing" as const };
  if (!response.ok) {
    // In particular, 401/403 are auth failures rather than proof that no
    // central image exists. The image state keeps them retryable.
    throw new Error(`Could not read backdrop image (${response.status}).`);
  }
  return { kind: "found" as const, blob: await response.blob() };
}

async function persistCentralBackdropImage(blob: Blob | null): Promise<void> {
  const response = await fetch("/api/preferences/backdrop", {
    method: blob ? "PUT" : "DELETE",
    ...(blob ? { headers: { "content-type": blob.type || "image/jpeg" }, body: blob } : {}),
  });
  if (!response.ok) throw new Error(`Could not persist backdrop image (${response.status}).`);
  // Refresh the central tombstone/metadata before the image revision is
  // published. In particular, a clear must not briefly fall back to the
  // preserved legacy IndexedDB image while the layer is still enabled.
  await refreshBackdropMetadata();
}

function backdropMigrationBlocked(): boolean {
  const image = readAppPreferences().appearance.backdrop.image;
  return image.present === false && Boolean(image.updatedAt);
}

const backdropImageState = createBackdropImageState({
  readCentral: readCentralBackdropImage,
  readLegacy: readLegacyBackdropImage,
  persistCentral: persistCentralBackdropImage,
  mirrorLegacy: writeLegacyBackdropImage,
  migrationBlocked: backdropMigrationBlocked,
});

function imageMetadataFingerprint(): string {
  const image = readAppPreferences().appearance.backdrop.image;
  return `${image.present}:${image.mime ?? ""}:${image.updatedAt ?? ""}`;
}

let observedImageMetadata = imageMetadataFingerprint();
let suppressImageMetadataInvalidation = 0;

subscribeAppPreferences(() => {
  cachedPrefs = null;
  notify();

  const nextImageMetadata = imageMetadataFingerprint();
  if (nextImageMetadata !== observedImageMetadata) {
    observedImageMetadata = nextImageMetadata;
    if (suppressImageMetadataInvalidation === 0) {
      // A different window/process replaced or cleared the central image.
      backdropImageState.invalidateCentral();
    }
  }
});

async function refreshBackdropMetadata(): Promise<void> {
  suppressImageMetadataInvalidation += 1;
  try {
    await refreshAppPreferences();
    observedImageMetadata = imageMetadataFingerprint();
  } finally {
    suppressImageMetadataInvalidation -= 1;
  }
}

/** Read the port-independent image, with a retryable legacy fallback. */
export function readBackdropImage(): Promise<Blob | null> {
  return backdropImageState.read();
}

/**
 * Import the current origin's old IndexedDB record after authenticated app
 * bootstrap. A true central 404 is the only state that permits upload; auth,
 * network, server, and IndexedDB failures remain retryable. Legacy bytes are
 * never deleted.
 */
export async function migrateLegacyBackdropImage(): Promise<BackdropMigrationResult> {
  return backdropImageState.migrateLegacy();
}

export function useBackdropImageRevision(): number {
  return useSyncExternalStore(
    backdropImageState.subscribe,
    backdropImageState.revision,
    () => 0,
  );
}

/** Persist centrally; keep the current-origin IDB record as a legacy mirror. */
export async function writeBackdropImage(blob: Blob | null): Promise<void> {
  await backdropImageState.write(blob);
}

// ── vibe extraction ──────────────────────────────────────────────────────────

/** Downscale the picked file for storage and sample it for the accent seed.
 *  Returns the stored blob + the dominant vibrant OKLab color (null when the
 *  image has no meaningfully chromatic pixels — e.g. a grayscale photo). */
export async function prepareBackdropImage(
  file: Blob,
): Promise<{ blob: Blob; accentSeed: BackdropAccentSeed | null }> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", 0.85);
    });

    // Sample a small grid for the palette — 48×48 is plenty to find the vibe.
    const sample = document.createElement("canvas");
    sample.width = 48;
    sample.height = 48;
    const sctx = sample.getContext("2d");
    if (!sctx) return { blob, accentSeed: null };
    sctx.drawImage(bitmap, 0, 0, 48, 48);
    const { data } = sctx.getImageData(0, 0, 48, 48);
    return { blob, accentSeed: dominantVibrantOklab(data) };
  } finally {
    bitmap.close();
  }
}

/** Bucket chromatic pixels by hue and return the mean OKLab of the most
 *  populous bucket — the image's dominant vibrant color. */
export function dominantVibrantOklab(rgba: Uint8ClampedArray): BackdropAccentSeed | null {
  const BUCKETS = 24;
  const sums = Array.from({ length: BUCKETS }, () => ({ n: 0, L: 0, a: 0, b: 0 }));
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    const lab = rgbToOklab({ r: rgba[i] / 255, g: rgba[i + 1] / 255, b: rgba[i + 2] / 255, alpha: 1 });
    const chroma = Math.hypot(lab.a, lab.b);
    // Skip near-neutrals and near-black/white — they carry no vibe.
    if (chroma < 0.05 || lab.L < 0.15 || lab.L > 0.92) continue;
    const hue = Math.atan2(lab.b, lab.a);
    const bucket = Math.floor(((hue + Math.PI) / (2 * Math.PI)) * BUCKETS) % BUCKETS;
    const cell = sums[bucket];
    // Weight by chroma so saturated pixels steer their bucket's mean.
    cell.n += chroma;
    cell.L += lab.L * chroma;
    cell.a += lab.a * chroma;
    cell.b += lab.b * chroma;
  }
  let best = sums[0];
  for (const cell of sums) if (cell.n > best.n) best = cell;
  if (best.n <= 0) return null;
  return { L: best.L / best.n, a: best.a / best.n, b: best.b / best.n };
}

/** Fit the seed's lightness against the live background so the derived accent
 *  keeps a legible presence (target ≥ 3:1, the app's decorative-accent floor)
 *  in the CURRENT theme/mode. Hue and chroma stay the image's. */
export function fitAccentToBackground(seed: BackdropAccentSeed, bgCss: string): string {
  const bg = parseThemeColor(bgCss);
  const chroma = Math.min(0.16, Math.hypot(seed.a, seed.b));
  const hue = Math.atan2(seed.b, seed.a);
  let L = clamp(seed.L, 0.35, 0.85);
  if (bg) {
    const bgIsDark = rgbToOklab(bg).L < 0.5;
    for (let step = 0; step < 14; step++) {
      const candidate = oklabToRgb({ L, a: chroma * Math.cos(hue), b: chroma * Math.sin(hue), alpha: 1 });
      if (contrastRatio(candidate, bg) >= 3) break;
      L = clamp(L + (bgIsDark ? 0.04 : -0.04), 0.2, 0.92);
    }
  }
  const c = chroma.toFixed(4);
  const h = ((hue * 180) / Math.PI + 360) % 360;
  return `oklch(${L.toFixed(4)} ${c} ${h.toFixed(1)})`;
}

// ── applying to the document ─────────────────────────────────────────────────

/** Applies prefs (and optionally the image object URL) to <html>. Pass
 *  `imageUrl: undefined` to leave the current image untouched (pref-only
 *  updates); `null` clears it. */
export function applyBackdropToDocument(prefs: BackdropPrefs, imageUrl?: string | null): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const active = prefs.enabled;
  if (active) root.dataset.backdrop = "1";
  else delete root.dataset.backdrop;
  root.style.setProperty("--cave-backdrop-opacity", String(clamp(prefs.intensity, 0, 100) / 100));
  if (imageUrl !== undefined) {
    if (imageUrl && active) root.style.setProperty("--cave-backdrop-image", `url("${imageUrl}")`);
    else root.style.removeProperty("--cave-backdrop-image");
  }
  if (active && prefs.matchAccent && prefs.accentSeed) {
    const bg = getComputedStyle(root).getPropertyValue("--bg-base").trim() || "oklch(0.13 0.022 293)";
    root.style.setProperty("--accent-presence", fitAccentToBackground(prefs.accentSeed, bg));
  } else {
    root.style.removeProperty("--accent-presence");
  }
}

// ── per-familiar backdrop override (cave-j0dz) ───────────────────────────────
//
// A familiar can carry its own backdrop image. While that familiar is the
// active chat scope, its image overrides the app-wide one; every other
// surface (and familiars without one) falls back to the generic backdrop.
// Bytes live server-side beside the app image (`/api/familiars/:id/backdrop`);
// this store is a thin fetch + revision layer so the layer and the Studio
// Look tab stay in sync after uploads/removals.

const familiarBackdropRevisions = new Map<string, number>();
const familiarBackdropMissingUntil = new Map<string, { revision: number; expiresAt: number }>();
const familiarBackdropReads = new Map<string, { revision: number; read: Promise<Blob | null> }>();
const familiarBackdropListeners = new Set<() => void>();
const FAMILIAR_BACKDROP_MISSING_TTL_MS = 5 * 60_000;

function notifyFamiliarBackdrop() {
  for (const fn of familiarBackdropListeners) fn();
}

function familiarBackdropUrl(familiarId: string): string {
  return `/api/familiars/${encodeURIComponent(familiarId)}/backdrop`;
}

/** Fetch a familiar's backdrop override; null when it has none (204/legacy 404). */
export async function readFamiliarBackdropImage(familiarId: string): Promise<Blob | null> {
  if (!familiarId) return null;
  const revision = familiarBackdropRevisions.get(familiarId) ?? 0;
  const missing = familiarBackdropMissingUntil.get(familiarId);
  if (missing?.revision === revision && missing.expiresAt > Date.now()) return null;
  const pending = familiarBackdropReads.get(familiarId);
  if (pending?.revision === revision) return await pending.read;

  const read = (async () => {
    const response = await fetch(familiarBackdropUrl(familiarId), { cache: "no-store" });
    if (response.status === 204 || response.status === 404) {
      familiarBackdropMissingUntil.set(familiarId, {
        revision,
        expiresAt: Date.now() + FAMILIAR_BACKDROP_MISSING_TTL_MS,
      });
      return null;
    }
    if (!response.ok) throw new Error(`Could not read familiar backdrop (${response.status}).`);
    familiarBackdropMissingUntil.delete(familiarId);
    return response.blob();
  })();
  familiarBackdropReads.set(familiarId, { revision, read });
  try {
    return await read;
  } finally {
    if (familiarBackdropReads.get(familiarId)?.read === read) familiarBackdropReads.delete(familiarId);
  }
}

/** Persist (PUT) or remove (DELETE with null) a familiar's backdrop override. */
export async function writeFamiliarBackdropImage(
  familiarId: string,
  blob: Blob | null,
): Promise<void> {
  const response = await fetch(familiarBackdropUrl(familiarId), {
    method: blob ? "PUT" : "DELETE",
    ...(blob ? { headers: { "content-type": blob.type || "image/jpeg" }, body: blob } : {}),
  });
  if (!response.ok) throw new Error(`Could not persist familiar backdrop (${response.status}).`);
  familiarBackdropRevisions.set(
    familiarId,
    (familiarBackdropRevisions.get(familiarId) ?? 0) + 1,
  );
  familiarBackdropMissingUntil.delete(familiarId);
  notifyFamiliarBackdrop();
}

function subscribeFamiliarBackdrop(fn: () => void): () => void {
  familiarBackdropListeners.add(fn);
  return () => {
    familiarBackdropListeners.delete(fn);
  };
}

/** Bumps whenever `familiarId`'s override is replaced or removed in this tab. */
export function useFamiliarBackdropRevision(familiarId: string | null): number {
  return useSyncExternalStore(
    subscribeFamiliarBackdrop,
    () => (familiarId ? familiarBackdropRevisions.get(familiarId) ?? 0 : 0),
    () => 0,
  );
}
