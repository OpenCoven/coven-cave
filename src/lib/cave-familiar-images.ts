"use client";

/**
 * Cave-local per-familiar avatar image store.
 *
 * Images are stored as base64 data URLs in localStorage under
 * `cave:familiar-images:v1`. Each image is capped at 2MB pre-encode and the
 * whole store at ~20MB total. Larger uploads return `{ ok: false, reason }`
 * so the UI can surface a toast and refuse the write.
 */

import { useSyncExternalStore } from "react";

const IMAGES_KEY = "cave:familiar-images:v1";
export const MAX_FAMILIAR_IMAGE_DATAURL_BYTES = Math.floor(2 * 1024 * 1024 * 4 / 3) + 100; // ~2.8MB
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
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

let cached: ImageMap | null = null;
const listeners = new Set<() => void>();

function notify() { for (const fn of listeners) fn(); }

function readFromStorage(): ImageMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(IMAGES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ImageMap;
    }
  } catch { /* corrupt — discard */ }
  return {};
}

function getMap(): ImageMap {
  if (cached === null) cached = readFromStorage();
  return cached;
}

function writeMap(next: ImageMap) {
  cached = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(IMAGES_KEY, JSON.stringify(next));
  }
  notify();
}

function totalBytes(map: ImageMap): number {
  let sum = 0;
  for (const v of Object.values(map)) sum += v.dataUrl.length;
  return sum;
}

export function setFamiliarImage(id: string, image: { dataUrl: string; mime: string }): SetResult {
  if (!ALLOWED_MIMES.has(image.mime)) {
    return { ok: false, reason: "Unsupported format. Use PNG, JPEG, WebP, or SVG." };
  }
  if (image.dataUrl.length > MAX_FAMILIAR_IMAGE_DATAURL_BYTES) {
    return { ok: false, reason: "Image too large (max 2MB)." };
  }
  const curr = getMap();
  const previousEntry = curr[id];
  const projected =
    totalBytes(curr) - (previousEntry?.dataUrl.length ?? 0) + image.dataUrl.length;
  if (projected > MAX_TOTAL_BYTES) {
    return { ok: false, reason: "Cave avatar storage full. Remove an image to free space." };
  }
  const next = {
    ...curr,
    [id]: { dataUrl: image.dataUrl, mime: image.mime, updatedAt: new Date().toISOString() },
  };
  writeMap(next);
  return { ok: true };
}

export function clearFamiliarImage(id: string): void {
  const curr = getMap();
  if (!(id in curr)) return;
  const next = { ...curr };
  delete next[id];
  writeMap(next);
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === IMAGES_KEY) {
      cached = null;
      notify();
    }
  });
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const EMPTY: ImageMap = Object.freeze({});
const getServerSnapshot = () => EMPTY;

export function useFamiliarImages(): ImageMap {
  return useSyncExternalStore(subscribe, getMap, getServerSnapshot);
}

export function readFamiliarImagesSnapshot(): ImageMap {
  return getMap();
}
