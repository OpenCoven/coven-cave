"use client";

/**
 * Cave-local avatar image for the human chat participant.
 *
 * This intentionally mirrors the familiar avatar store shape, but keeps the
 * human image separate from any familiar id so "You" can have one avatar across
 * regular chat and group chat without polluting familiar state.
 */

import { useSyncExternalStore } from "react";
import { MAX_FAMILIAR_IMAGE_DATAURL_BYTES } from "./cave-familiar-images.ts";

const USER_AVATAR_KEY = "cave:user-avatar-image:v1";
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

let cached: UserAvatarImage | null | undefined;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

function readFromStorage(): UserAvatarImage | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(USER_AVATAR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "dataUrl" in parsed &&
      "mime" in parsed &&
      typeof parsed.dataUrl === "string" &&
      typeof parsed.mime === "string"
    ) {
      return parsed as UserAvatarImage;
    }
  } catch {
    /* corrupt — discard */
  }
  return null;
}

function getSnapshot(): UserAvatarImage | null {
  if (cached === undefined) cached = readFromStorage();
  return cached;
}

function writeSnapshot(next: UserAvatarImage | null) {
  cached = next;
  if (typeof window !== "undefined") {
    if (next) window.localStorage.setItem(USER_AVATAR_KEY, JSON.stringify(next));
    else window.localStorage.removeItem(USER_AVATAR_KEY);
  }
  notify();
}

export function setUserAvatarImage(image: { dataUrl: string; mime: string }): SetResult {
  if (!ALLOWED_MIMES.has(image.mime)) {
    return { ok: false, reason: "Unsupported format. Use PNG, JPEG, WebP, or SVG." };
  }
  if (image.dataUrl.length > MAX_FAMILIAR_IMAGE_DATAURL_BYTES) {
    return { ok: false, reason: "Image too large (max 2MB)." };
  }
  writeSnapshot({ ...image, updatedAt: new Date().toISOString() });
  return { ok: true };
}

export function clearUserAvatarImage(): void {
  writeSnapshot(null);
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === USER_AVATAR_KEY) {
      cached = undefined;
      notify();
    }
  });
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const getServerSnapshot = () => null;

export function useUserAvatarImage(): UserAvatarImage | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function readUserAvatarImageSnapshot(): UserAvatarImage | null {
  return getSnapshot();
}
