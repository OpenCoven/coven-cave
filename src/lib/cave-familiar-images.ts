"use client";

/**
 * Cave-local per-familiar avatar image store.
 *
 * Images are base64 data URLs persisted in IndexedDB (see avatar-idb.ts) with
 * an in-memory map as the render source: components read synchronously via
 * useSyncExternalStore while hydration/writes happen async. Images from the
 * old localStorage store (`cave:familiar-images:v1`) are migrated to IndexedDB
 * on first load and the legacy key is removed — those payloads were eating the
 * ~5MB origin quota shared with every other cave:* key.
 *
 * Each image is capped at 2MB pre-encode; oversized/invalid uploads resolve to
 * `{ ok: false, reason }` so the UI can surface a toast and refuse the write.
 */

import { useSyncExternalStore } from "react";
import { avatarStorage } from "@/lib/avatar-idb";

const LEGACY_IMAGES_KEY = "cave:familiar-images:v1";
const CHANNEL_NAME = "cave:familiar-images";
export const MAX_FAMILIAR_IMAGE_DATAURL_BYTES = Math.floor(2 * 1024 * 1024 * 4 / 3) + 100; // ~2.8MB
const STORAGE_FULL_REASON = "Cave avatar storage full. Remove an image to free space.";
const ALLOWED_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);

export type FamiliarImage = {
  dataUrl: string;
  mime: string;
  updatedAt: string;
};

type ImageMap = Record<string, FamiliarImage>;
type SetResult = { ok: true } | { ok: false; reason: string };

const EMPTY: ImageMap = Object.freeze({});

let cached: ImageMap = EMPTY;
let hydration: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify() { for (const fn of listeners) fn(); }

// Cross-window sync (e.g. the Tauri tray quick-chat webview): localStorage
// `storage` events are gone with the localStorage store, so writes broadcast
// and other windows re-read IndexedDB.
let channel: BroadcastChannel | null = null;
function ensureChannel(): void {
  if (channel || typeof BroadcastChannel === "undefined") return;
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = () => {
    hydration = null;
    void ensureHydrated();
  };
  // Node's global BroadcastChannel holds the event loop open — unref so test
  // processes can exit. Browsers have no unref; the optional call is a no-op.
  (channel as { unref?: () => void }).unref?.();
}
function broadcast(): void {
  ensureChannel();
  channel?.postMessage("changed");
}

function readLegacyLocalStorage(): ImageMap | null {
  try {
    const raw = window.localStorage.getItem(LEGACY_IMAGES_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ImageMap;
    }
  } catch { /* corrupt/unreadable — ignore */ }
  return null;
}

async function hydrate(): Promise<void> {
  if (typeof window === "undefined") return;
  ensureChannel();
  const map = await avatarStorage().getAll("familiarImages");

  // One-time migration from the legacy localStorage store. Entries always
  // reach the in-memory map (so existing avatars keep rendering even if
  // IndexedDB is unavailable), but the legacy key is only removed once every
  // entry actually persisted.
  const legacy = readLegacyLocalStorage();
  if (legacy) {
    let allPersisted = true;
    for (const [id, image] of Object.entries(legacy)) {
      if (map[id]) continue; // an IndexedDB copy is newer — it wins
      map[id] = image;
      try {
        await avatarStorage().put("familiarImages", id, image);
      } catch {
        allPersisted = false;
      }
    }
    if (allPersisted) {
      try { window.localStorage.removeItem(LEGACY_IMAGES_KEY); } catch { /* ignore */ }
    }
  }

  cached = Object.keys(map).length > 0 ? map : EMPTY;
  notify();
}

function ensureHydrated(): Promise<void> {
  if (!hydration) hydration = hydrate();
  return hydration;
}

if (typeof window !== "undefined") void ensureHydrated();

export async function setFamiliarImage(id: string, image: { dataUrl: string; mime: string }): Promise<SetResult> {
  if (!ALLOWED_MIMES.has(image.mime)) {
    return { ok: false, reason: "Unsupported format. Use PNG, JPEG, WebP, or SVG." };
  }
  if (image.dataUrl.length > MAX_FAMILIAR_IMAGE_DATAURL_BYTES) {
    return { ok: false, reason: "Image too large (max 2MB)." };
  }
  await ensureHydrated();
  const entry: FamiliarImage = { dataUrl: image.dataUrl, mime: image.mime, updatedAt: new Date().toISOString() };
  // Persist first, then commit to memory — a refused write must not leave the
  // cache claiming an image that storage never accepted.
  try {
    await avatarStorage().put("familiarImages", id, entry);
  } catch {
    return { ok: false, reason: STORAGE_FULL_REASON };
  }
  cached = { ...cached, [id]: entry };
  notify();
  broadcast();
  return { ok: true };
}

export async function clearFamiliarImage(id: string): Promise<void> {
  await ensureHydrated();
  if (!(id in cached)) return;
  try {
    await avatarStorage().delete("familiarImages", id);
  } catch {
    return; // keep memory and storage consistent — the image simply stays
  }
  const next = { ...cached };
  delete next[id];
  cached = Object.keys(next).length > 0 ? next : EMPTY;
  notify();
  broadcast();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const getSnapshot = () => cached;
const getServerSnapshot = () => EMPTY;

export function useFamiliarImages(): ImageMap {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function readFamiliarImagesSnapshot(): ImageMap {
  return cached;
}

/** Resolves once the store has loaded (and migrated) persisted images. */
export function whenFamiliarImagesHydrated(): Promise<void> {
  return ensureHydrated();
}
