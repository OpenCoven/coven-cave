"use client";

/**
 * Cave-local per-project avatar image store.
 *
 * Keyed by normalized project root — the identity every surface already
 * buckets by (sessions carry project_root; comux and the chat sidebar group by
 * root; CaveProject ids are per-machine nanoids). Images are base64 data URLs
 * persisted in IndexedDB (see avatar-idb.ts) with an in-memory map as the
 * render source. No legacy localStorage migration — this store is IDB-native.
 */

import { useSyncExternalStore } from "react";
import { avatarStorage } from "@/lib/avatar-idb";
import { MAX_FAMILIAR_IMAGE_DATAURL_BYTES } from "./cave-familiar-images.ts";
import { normalizeProjectRoot } from "./cave-projects-types.ts";

const CHANNEL_NAME = "cave:project-images";
const STORAGE_FULL_REASON = "Cave avatar storage full. Remove an image to free space.";
const ALLOWED_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);

export type ProjectImage = {
  dataUrl: string;
  mime: string;
  updatedAt: string;
};

type ImageMap = Record<string, ProjectImage>;
type SetResult = { ok: true } | { ok: false; reason: string };

const EMPTY: ImageMap = Object.freeze({});

let cached: ImageMap = EMPTY;
let hydration: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify() { for (const fn of listeners) fn(); }

// Cross-window sync — writes broadcast and other windows re-read IndexedDB.
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

async function hydrate(): Promise<void> {
  if (typeof window === "undefined") return;
  ensureChannel();
  const map = await avatarStorage().getAll("projectAvatars");
  cached = Object.keys(map).length > 0 ? map : EMPTY;
  notify();
}

function ensureHydrated(): Promise<void> {
  if (!hydration) hydration = hydrate();
  return hydration;
}

if (typeof window !== "undefined") void ensureHydrated();

export async function setProjectImage(root: string, image: { dataUrl: string; mime: string }): Promise<SetResult> {
  if (!ALLOWED_MIMES.has(image.mime)) {
    return { ok: false, reason: "Unsupported format. Use PNG, JPEG, WebP, or SVG." };
  }
  if (image.dataUrl.length > MAX_FAMILIAR_IMAGE_DATAURL_BYTES) {
    return { ok: false, reason: "Image too large (max 2MB)." };
  }
  await ensureHydrated();
  const key = normalizeProjectRoot(root);
  const entry: ProjectImage = { dataUrl: image.dataUrl, mime: image.mime, updatedAt: new Date().toISOString() };
  // Persist first, then commit to memory — a refused write must not leave the
  // cache claiming an image that storage never accepted.
  try {
    await avatarStorage().put("projectAvatars", key, entry);
  } catch {
    return { ok: false, reason: STORAGE_FULL_REASON };
  }
  cached = { ...cached, [key]: entry };
  notify();
  broadcast();
  return { ok: true };
}

export async function clearProjectImage(root: string): Promise<void> {
  await ensureHydrated();
  const key = normalizeProjectRoot(root);
  if (!(key in cached)) return;
  try {
    await avatarStorage().delete("projectAvatars", key);
  } catch {
    return; // keep memory and storage consistent — the image simply stays
  }
  const next = { ...cached };
  delete next[key];
  cached = Object.keys(next).length > 0 ? next : EMPTY;
  notify();
  broadcast();
}

/** Follow a root edit: re-key the stored image so the avatar survives. */
export async function moveProjectImage(fromRoot: string, toRoot: string): Promise<void> {
  await ensureHydrated();
  const from = normalizeProjectRoot(fromRoot);
  const to = normalizeProjectRoot(toRoot);
  const entry = cached[from];
  if (!entry || from === to) return;
  try {
    await avatarStorage().put("projectAvatars", to, entry);
  } catch {
    return; // couldn't write the new key — leave the old record in place
  }
  const next = { ...cached, [to]: entry };
  try {
    await avatarStorage().delete("projectAvatars", from);
    delete next[from];
  } catch { /* both keys persisted — snapshot mirrors storage */ }
  cached = next;
  notify();
  broadcast();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const getSnapshot = () => cached;
const getServerSnapshot = () => EMPTY;

/** Map of normalized project root → image. */
export function useProjectImages(): ImageMap {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function readProjectImagesSnapshot(): ImageMap {
  return cached;
}

/** Resolves once the store has loaded persisted images. */
export function whenProjectImagesHydrated(): Promise<void> {
  return ensureHydrated();
}
