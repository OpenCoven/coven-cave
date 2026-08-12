"use client";

import { useSyncExternalStore } from "react";
import { avatarStorage } from "@/lib/avatar-idb";

const LEGACY_IMAGES_KEY = "cave:familiar-images:v1";
const CHANNEL_NAME = "cave:familiar-images";
export const MAX_FAMILIAR_IMAGE_DATAURL_BYTES = Math.floor(2 * 1024 * 1024 * 4 / 3) + 100;
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
type AvatarMutationResponse = {
  ok: boolean;
  avatarUrl?: string | null;
  revision?: number | null;
  error?: string;
};
type AvatarBroadcast = { id: string; avatarUrl: string | null };

const EMPTY: ImageMap = Object.freeze({});

let cached: ImageMap = EMPTY;
let hydration: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

function hostImage(avatarUrl: string): FamiliarImage {
  const revision = /[?&]v=(\d+)/.exec(avatarUrl)?.[1];
  const timestamp = revision ? Number(revision) : Date.now();
  return {
    dataUrl: avatarUrl,
    mime: "image/png",
    updatedAt: new Date(Number.isFinite(timestamp) ? timestamp : Date.now()).toISOString(),
  };
}

function applyHostAvatar(id: string, avatarUrl: string | null): void {
  if (avatarUrl) {
    cached = { ...cached, [id]: hostImage(avatarUrl) };
  } else if (id in cached) {
    const next = { ...cached };
    delete next[id];
    cached = Object.keys(next).length > 0 ? next : EMPTY;
  }
  notify();
  if (typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
    window.dispatchEvent(new CustomEvent("cave:familiar-avatar-changed", {
      detail: { id, avatarUrl },
    }));
  }
}

let channel: BroadcastChannel | null = null;
function ensureChannel(): void {
  if (channel || typeof BroadcastChannel === "undefined") return;
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent<AvatarBroadcast>) => {
    const message = event.data;
    if (
      message &&
      typeof message === "object" &&
      typeof message.id === "string" &&
      (typeof message.avatarUrl === "string" || message.avatarUrl === null)
    ) {
      applyHostAvatar(message.id, message.avatarUrl);
    }
  };
  (channel as { unref?: () => void }).unref?.();
}

function broadcast(message: AvatarBroadcast): void {
  ensureChannel();
  channel?.postMessage(message);
}

function readLegacyLocalStorage(): ImageMap | null {
  try {
    const raw = window.localStorage.getItem(LEGACY_IMAGES_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ImageMap;
    }
  } catch {
    return null;
  }
  return null;
}

async function hostAvatarUrls(): Promise<Record<string, string> | null> {
  let response: Response;
  try {
    response = await fetch("/api/familiars", { cache: "no-store" });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const body = await response.json().catch(() => null) as {
    familiars?: Array<{ id?: unknown; avatarUrl?: unknown }>;
  } | null;
  if (!body?.familiars) return null;

  const urls: Record<string, string> = {};
  for (const familiar of body.familiars) {
    if (typeof familiar.id === "string" && typeof familiar.avatarUrl === "string") {
      urls[familiar.id] = familiar.avatarUrl;
    }
  }
  return urls;
}

function dataUrlToBlob(image: { dataUrl: string; mime: string }): Blob {
  const comma = image.dataUrl.indexOf(",");
  if (comma === -1) throw new Error("Could not read image.");
  const encoded = image.dataUrl.slice(comma + 1);
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: image.mime });
}

async function uploadFamiliarAvatar(
  id: string,
  image: { dataUrl: string; mime: string },
): Promise<{ ok: true; avatarUrl: string } | { ok: false; reason: string }> {
  let response: Response;
  try {
    response = await fetch(`/api/familiars/${encodeURIComponent(id)}/avatar`, {
      method: "POST",
      headers: { "content-type": image.mime, accept: "application/json" },
      body: dataUrlToBlob(image),
    });
  } catch {
    return { ok: false, reason: "Could not save avatar." };
  }
  const body = await response.json().catch(() => null) as AvatarMutationResponse | null;
  if (!response.ok || body?.ok !== true || typeof body.avatarUrl !== "string") {
    return { ok: false, reason: body?.error ?? "Could not save avatar." };
  }
  return { ok: true, avatarUrl: body.avatarUrl };
}

async function hydrate(): Promise<void> {
  if (typeof window === "undefined") return;
  ensureChannel();

  const pending = await avatarStorage().getAll("familiarImages");
  const legacy = readLegacyLocalStorage();
  let legacyBackedUp = true;
  if (legacy) {
    for (const [id, image] of Object.entries(legacy)) {
      if (pending[id]) continue;
      pending[id] = image;
      try {
        await avatarStorage().put("familiarImages", id, image);
      } catch {
        legacyBackedUp = false;
      }
    }
  }

  if (Object.keys(pending).length === 0) {
    cached = EMPTY;
    notify();
    return;
  }

  cached = pending;
  notify();
  const hostUrls = await hostAvatarUrls();
  if (hostUrls === null) {
    if (legacy && legacyBackedUp) {
      try {
        window.localStorage.removeItem(LEGACY_IMAGES_KEY);
      } catch {
        // The IndexedDB copy remains authoritative until a later migration.
      }
    }
    return;
  }

  const migrated: ImageMap = {};
  for (const [id, image] of Object.entries(pending)) {
    const existing = hostUrls[id];
    if (existing) {
      migrated[id] = hostImage(existing);
      await avatarStorage().delete("familiarImages", id).catch(() => {});
      continue;
    }

    const result = await uploadFamiliarAvatar(id, image);
    if (result.ok) {
      migrated[id] = hostImage(result.avatarUrl);
      await avatarStorage().delete("familiarImages", id).catch(() => {});
    } else {
      migrated[id] = image;
    }
  }

  cached = Object.keys(migrated).length > 0 ? migrated : EMPTY;
  notify();
  if (
    legacy &&
    Object.keys(legacy).every((id) =>
      cached[id]?.dataUrl.startsWith("/api/familiars/") || pending[id] !== undefined
    )
  ) {
    try {
      window.localStorage.removeItem(LEGACY_IMAGES_KEY);
    } catch {
      // The host or IndexedDB copy already retains every entry.
    }
  }
}

function ensureHydrated(): Promise<void> {
  if (!hydration) hydration = hydrate();
  return hydration;
}

if (typeof window !== "undefined") void ensureHydrated();

export async function setFamiliarImage(
  id: string,
  image: { dataUrl: string; mime: string },
): Promise<SetResult> {
  if (!ALLOWED_MIMES.has(image.mime)) {
    return { ok: false, reason: "Unsupported format. Use PNG, JPEG, WebP, or SVG." };
  }
  if (image.dataUrl.length > MAX_FAMILIAR_IMAGE_DATAURL_BYTES) {
    return { ok: false, reason: "Image too large (max 2MB)." };
  }
  await ensureHydrated();

  const result = await uploadFamiliarAvatar(id, image);
  if (!result.ok) return result;

  await avatarStorage().delete("familiarImages", id).catch(() => {});
  applyHostAvatar(id, result.avatarUrl);
  broadcast({ id, avatarUrl: result.avatarUrl });
  return { ok: true };
}

export async function clearFamiliarImage(id: string): Promise<SetResult> {
  await ensureHydrated();
  let response: Response;
  try {
    response = await fetch(`/api/familiars/${encodeURIComponent(id)}/avatar`, {
      method: "DELETE",
      headers: { accept: "application/json" },
    });
  } catch {
    return { ok: false, reason: "Could not remove avatar." };
  }
  const body = await response.json().catch(() => null) as AvatarMutationResponse | null;
  if (!response.ok || body?.ok !== true) {
    return { ok: false, reason: body?.error ?? "Could not remove avatar." };
  }

  await avatarStorage().delete("familiarImages", id).catch(() => {});
  applyHostAvatar(id, null);
  broadcast({ id, avatarUrl: null });
  return { ok: true };
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

export function whenFamiliarImagesHydrated(): Promise<void> {
  return ensureHydrated();
}
