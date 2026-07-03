"use client";

/**
 * Cave-local avatar image for the human chat participant.
 *
 * This intentionally mirrors the familiar avatar store shape, but keeps the
 * human image separate from any familiar id so "You" can have one avatar across
 * regular chat and group chat without polluting familiar state.
 *
 * Persisted in IndexedDB (see avatar-idb.ts) with an in-memory snapshot as the
 * render source; the old localStorage record (`cave:user-avatar-image:v1`) is
 * migrated over on first load and its key removed.
 */

import { useSyncExternalStore } from "react";
import { avatarStorage } from "@/lib/avatar-idb";
import { MAX_FAMILIAR_IMAGE_DATAURL_BYTES } from "./cave-familiar-images.ts";

const LEGACY_USER_AVATAR_KEY = "cave:user-avatar-image:v1";
const USER_AVATAR_ID = "user";
const CHANNEL_NAME = "cave:user-avatar-image";
const STORAGE_FULL_REASON = "Cave avatar storage full. Remove an image to free space.";
const ALLOWED_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);

export type UserAvatarImage = {
  dataUrl: string;
  mime: string;
  updatedAt: string;
};

type SetResult = { ok: true } | { ok: false; reason: string };

let cached: UserAvatarImage | null = null;
let hydration: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

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

function isUserAvatarImage(value: unknown): value is UserAvatarImage {
  return Boolean(
    value &&
      typeof value === "object" &&
      "dataUrl" in value &&
      "mime" in value &&
      typeof (value as UserAvatarImage).dataUrl === "string" &&
      typeof (value as UserAvatarImage).mime === "string",
  );
}

function readLegacyLocalStorage(): UserAvatarImage | null {
  try {
    const raw = window.localStorage.getItem(LEGACY_USER_AVATAR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (isUserAvatarImage(parsed)) return parsed;
  } catch { /* corrupt/unreadable — ignore */ }
  return null;
}

async function hydrate(): Promise<void> {
  if (typeof window === "undefined") return;
  ensureChannel();
  const map = await avatarStorage().getAll("userAvatar");
  let next: UserAvatarImage | null = isUserAvatarImage(map[USER_AVATAR_ID]) ? map[USER_AVATAR_ID] : null;

  // One-time migration from the legacy localStorage record. It always reaches
  // the in-memory snapshot; the legacy key is only removed once it persisted.
  if (!next) {
    const legacy = readLegacyLocalStorage();
    if (legacy) {
      next = legacy;
      try {
        await avatarStorage().put("userAvatar", USER_AVATAR_ID, legacy);
        window.localStorage.removeItem(LEGACY_USER_AVATAR_KEY);
      } catch { /* keep the legacy key; retry next load */ }
    }
  } else {
    // IndexedDB copy wins — drop a leftover legacy record so it can't shadow
    // a future clear.
    try { window.localStorage.removeItem(LEGACY_USER_AVATAR_KEY); } catch { /* ignore */ }
  }

  cached = next;
  notify();
}

function ensureHydrated(): Promise<void> {
  if (!hydration) hydration = hydrate();
  return hydration;
}

if (typeof window !== "undefined") void ensureHydrated();

export async function setUserAvatarImage(image: { dataUrl: string; mime: string }): Promise<SetResult> {
  if (!ALLOWED_MIMES.has(image.mime)) {
    return { ok: false, reason: "Unsupported format. Use PNG, JPEG, WebP, or SVG." };
  }
  if (image.dataUrl.length > MAX_FAMILIAR_IMAGE_DATAURL_BYTES) {
    return { ok: false, reason: "Image too large (max 2MB)." };
  }
  await ensureHydrated();
  const entry: UserAvatarImage = { ...image, updatedAt: new Date().toISOString() };
  // Persist first, then commit to memory — a refused write must not leave the
  // cache claiming an avatar that storage never accepted.
  try {
    await avatarStorage().put("userAvatar", USER_AVATAR_ID, entry);
  } catch {
    return { ok: false, reason: STORAGE_FULL_REASON };
  }
  cached = entry;
  notify();
  broadcast();
  return { ok: true };
}

export async function clearUserAvatarImage(): Promise<void> {
  await ensureHydrated();
  if (!cached) return;
  try {
    await avatarStorage().delete("userAvatar", USER_AVATAR_ID);
  } catch {
    return; // keep memory and storage consistent
  }
  cached = null;
  notify();
  broadcast();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const getSnapshot = () => cached;
const getServerSnapshot = () => null;

export function useUserAvatarImage(): UserAvatarImage | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function readUserAvatarImageSnapshot(): UserAvatarImage | null {
  return cached;
}

/** Resolves once the store has loaded (and migrated) the persisted avatar. */
export function whenUserAvatarHydrated(): Promise<void> {
  return ensureHydrated();
}
