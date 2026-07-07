"use client";

/**
 * One-time migration: legacy browser-local avatar (IndexedDB via
 * user-avatar-image.ts) → server file (POST /api/profile/avatar).
 * Runs at most once per page load, only when the server has no avatar and the
 * local store has a non-SVG one. SVG legacy avatars stay local (server rejects
 * SVG). The local record is cleared only after the server accepted the bytes.
 */
import {
  readUserAvatarImageSnapshot,
  whenUserAvatarHydrated,
  clearUserAvatarImage,
} from "@/lib/user-avatar-image";
import {
  readUserProfileSnapshot,
  whenUserProfileHydrated,
  uploadUserProfileAvatar,
} from "@/lib/user-profile";

let attempted = false;

export async function runUserAvatarMigration(): Promise<void> {
  if (attempted || typeof window === "undefined") return;
  attempted = true;
  await Promise.all([whenUserProfileHydrated(), whenUserAvatarHydrated()]);
  const server = readUserProfileSnapshot();
  if (!server || server.avatar.present) return;
  const legacy = readUserAvatarImageSnapshot();
  if (!legacy || legacy.mime === "image/svg+xml") return;
  const res = await uploadUserProfileAvatar({ dataUrl: legacy.dataUrl, mime: legacy.mime });
  if (res.ok) await clearUserAvatarImage();
}
