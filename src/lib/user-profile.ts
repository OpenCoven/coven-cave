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
  avatar: { present: boolean; updatedAt?: string };
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

async function hydrate(): Promise<void> {
  if (typeof window === "undefined") return;
  ensureChannel();
  try {
    const res = await fetch("/api/profile");
    const json = (await res.json()) as { ok?: boolean; profile?: UserProfile; avatar?: UserProfileSnapshot["avatar"] };
    if (res.ok && json?.ok) {
      cached = { profile: json.profile ?? {}, avatar: json.avatar ?? { present: false } };
      notify();
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
  cached = {
    profile: cached?.profile ?? {},
    avatar: { present: true, updatedAt: json.updatedAt ?? new Date().toISOString() },
  };
  notify();
  broadcast();
  return { ok: true };
}

export async function removeUserProfileAvatar(): Promise<SaveResult> {
  const res = await fetch("/api/profile/avatar", { method: "DELETE" }).catch(() => null);
  const json = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
  if (!res?.ok) return { ok: false, reason: json?.error ?? "Could not remove image." };
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

/** `/api/profile/avatar?v=<updatedAt>` when present, else null. */
export function userAvatarUrl(snapshot: UserProfileSnapshot | null): string | null {
  if (!snapshot?.avatar.present) return null;
  return `/api/profile/avatar?v=${encodeURIComponent(snapshot.avatar.updatedAt ?? "0")}`;
}

/** Resolves once the profile has been fetched (used by the avatar migration). */
export function whenUserProfileHydrated(): Promise<void> {
  return ensureHydrated();
}
