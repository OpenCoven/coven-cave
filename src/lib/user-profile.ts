"use client";

/**
 * Client store for the server-side operator profile (GET/PATCH /api/profile).
 * Module-store pattern: in-memory snapshot,
 * useSyncExternalStore subscription, BroadcastChannel cross-window sync.
 * Persist-first: the snapshot only updates after the server accepted a write.
 */

import { useSyncExternalStore } from "react";
import type { UserProfile, UserProfilePatch } from "@/lib/user-profile-shared";
export { userDisplayName } from "@/lib/user-profile-shared";
export type { UserProfile } from "@/lib/user-profile-shared";

export type UserProfileSnapshot = {
  profile: UserProfile;
  avatar: { present: boolean; updatedAt?: string; objectUrl?: string };
};

const CHANNEL_NAME = "cave:user-profile";

let cached: UserProfileSnapshot | null = null;
let hydration: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

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

/**
 * The packaged app's sidecar requires an auth token on every /api/* request.
 * Only the patched window.fetch (sidecar-auth-bridge) carries it — a native
 * <img src="/api/profile/avatar"> request has no token and 401s, rendering the
 * WebKit broken-image glyph. So the store fetches the bytes itself and hands
 * components a same-origin blob: URL instead. While loading (or on failure)
 * `objectUrl` stays unset and renderers fall back to the initial/icon.
 */
let avatarObjectUrl: string | null = null;
let avatarLoadedFor: string | null = null;
let avatarFetchSeq = 0;

function avatarWithObjectUrl(avatar: { present: boolean; updatedAt?: string }): UserProfileSnapshot["avatar"] {
  return avatar.present && avatarObjectUrl ? { ...avatar, objectUrl: avatarObjectUrl } : { ...avatar };
}

async function refreshAvatarObjectUrl(updatedAt: string): Promise<void> {
  if (typeof window === "undefined") return;
  if (avatarLoadedFor === updatedAt && avatarObjectUrl) return;
  const seq = ++avatarFetchSeq;
  try {
    const res = await fetch(`/api/profile/avatar?v=${encodeURIComponent(updatedAt)}`);
    if (!res.ok) return;
    const blob = await res.blob();
    if (seq !== avatarFetchSeq) return; // superseded by a newer upload/removal
    if (avatarObjectUrl) URL.revokeObjectURL(avatarObjectUrl);
    avatarObjectUrl = URL.createObjectURL(blob);
    avatarLoadedFor = updatedAt;
    if (cached?.avatar.present) {
      cached = { ...cached, avatar: { ...cached.avatar, objectUrl: avatarObjectUrl } };
      notify();
    }
  } catch { /* keep the fallback rendering; next hydrate retries */ }
}

function clearAvatarObjectUrl(): void {
  avatarFetchSeq++;
  if (avatarObjectUrl) URL.revokeObjectURL(avatarObjectUrl);
  avatarObjectUrl = null;
  avatarLoadedFor = null;
}

async function hydrate(): Promise<void> {
  if (typeof window === "undefined") return;
  ensureChannel();
  try {
    const res = await fetch("/api/profile");
    const json = (await res.json()) as { ok?: boolean; profile?: UserProfile; avatar?: UserProfileSnapshot["avatar"] };
    if (res.ok && json?.ok) {
      const avatar = json.avatar ?? { present: false };
      if (!avatar.present) clearAvatarObjectUrl();
      cached = { profile: json.profile ?? {}, avatar: avatarWithObjectUrl(avatar) };
      notify();
      if (avatar.present) void refreshAvatarObjectUrl(avatar.updatedAt ?? "0");
    }
  } catch { /* daemon offline — keep previous snapshot (or null → "You") */ }
}

function ensureHydrated(): Promise<void> {
  if (!hydration) hydration = hydrate();
  return hydration;
}

if (typeof window !== "undefined") void ensureHydrated();

export type SaveResult = { ok: true } | { ok: false; reason: string };

export async function saveUserProfile(patch: UserProfilePatch): Promise<SaveResult> {
  const res = await fetch("/api/profile", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  }).catch(() => null);
  const json = res ? ((await res.json().catch(() => null)) as { ok?: boolean; profile?: UserProfile; error?: string } | null) : null;
  if (!res || !res.ok || !json?.ok) {
    return { ok: false, reason: json?.error ?? "Could not save profile." };
  }
  cached = { profile: json.profile ?? {}, avatar: cached?.avatar ?? { present: false } };
  notify();
  broadcast();
  return { ok: true };
}

export async function uploadUserProfileAvatar(image: { dataUrl: string; mime: string }): Promise<SaveResult> {
  const res = await fetch("/api/profile/avatar", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(image),
  }).catch(() => null);
  const json = res ? ((await res.json().catch(() => null)) as { ok?: boolean; updatedAt?: string; error?: string } | null) : null;
  if (!res || !res.ok || !json?.ok) {
    return { ok: false, reason: json?.error ?? "Could not upload image." };
  }
  const updatedAt = json.updatedAt ?? new Date().toISOString();
  cached = {
    profile: cached?.profile ?? {},
    avatar: avatarWithObjectUrl({ present: true, updatedAt }),
  };
  notify();
  broadcast();
  void refreshAvatarObjectUrl(updatedAt);
  return { ok: true };
}

export async function removeUserProfileAvatar(): Promise<SaveResult> {
  const res = await fetch("/api/profile/avatar", { method: "DELETE" }).catch(() => null);
  const json = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
  if (!res?.ok) return { ok: false, reason: json?.error ?? "Could not remove image." };
  clearAvatarObjectUrl();
  cached = { profile: cached?.profile ?? {}, avatar: { present: false } };
  notify();
  broadcast();
  return { ok: true };
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const getSnapshot = () => cached;
const getServerSnapshot = () => null;

export function useUserProfile(): UserProfileSnapshot | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function readUserProfileSnapshot(): UserProfileSnapshot | null {
  return cached;
}

/** Same-origin blob: URL for the stored avatar, fetched with the authenticated
 *  fetch (the packaged app's sidecar token never reaches native <img> requests).
 *  Null while absent, still loading, or when the fetch failed — callers render
 *  their initial/icon fallback instead of a broken image. */
export function userAvatarUrl(snapshot: UserProfileSnapshot | null): string | null {
  if (!snapshot?.avatar.present) return null;
  return snapshot.avatar.objectUrl ?? null;
}

/** Resolves once the profile has been fetched (used by the avatar migration). */
export function whenUserProfileHydrated(): Promise<void> {
  return ensureHydrated();
}
