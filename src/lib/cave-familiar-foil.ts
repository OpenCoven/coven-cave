"use client";

/**
 * Persisted foil plates, one per familiar.
 *
 * A plate is the black-and-white halftone `src/lib/foil` cuts from a portrait's
 * own specular regions (`buildFoilPlate`). It is pure maths over pixels — no
 * model, no daemon, no token — but it is not cheap: a 512px working frame runs
 * a 7×7 local-variance gate over a quarter of a million pixels. Rebuilding that
 * every time somebody looks at a card is the cost this store removes.
 *
 * ── Why IndexedDB, and not the disk stores next door ────────────────────────
 * Two per-familiar image stores already exist and they answer differently:
 *
 *   · `cave-familiar-images.ts` → IndexedDB, via the same `avatar-idb` driver
 *     this module uses. Cave-local avatar uploads.
 *   · `server/backdrop-store.ts` → a file under `~/.coven`, because
 *     origin-scoped IndexedDB was LOST when the packaged desktop app launched
 *     on a different loopback port, and a backdrop the user chose is not
 *     something we may lose.
 *
 * A plate is on the other side of exactly that line. It is a DERIVED cache, not
 * user content: everything needed to rebuild it is the portrait, which is
 * already persisted by one of those two stores. Losing a plate to an origin
 * change costs one lazy rebuild and nothing else, so the reason the backdrop
 * had to move to disk does not apply here — while the reason to stay on the
 * client does: only a browser can produce a plate at all (`buildFoilPlate`
 * needs a canvas), so a disk store would mean inventing an upload round-trip
 * for bytes the client already holds.
 *
 * ── Staleness ───────────────────────────────────────────────────────────────
 * `sourceKey` is a hash of the avatar SOURCE the plate was cut from — the URL
 * for a workspace avatar (which carries `?v=<mtime>`, so it changes with the
 * file) or the data URL itself for a Cave-local upload. A record whose key does
 * not match the familiar's current avatar is stale and gets rebuilt.
 *
 * A record may also arrive with NO key: the summoning rite has the plate in
 * hand before the daemon has told anyone what the new avatar's URL will be. An
 * unkeyed record is trusted once and stamped with the key it is first read
 * against — correct, because the rite built it from the very portrait it then
 * uploaded. The one way that could adopt a wrong plate is a portrait replaced
 * between the summoning and the first look at the card, and that path clears
 * the record instead (`familiar-image-upload.ts` / the rite's own re-upload).
 */

import { useSyncExternalStore } from "react";

import { avatarStorage } from "@/lib/avatar-idb";

const CHANNEL_NAME = "cave:familiar-foil";

export type FamiliarFoilPlate = {
  /** PNG data URL — the card's `--holo-tex`. */
  dataUrl: string;
  mime: string;
  updatedAt: string;
  /** Hash of the avatar source this plate was cut from; absent when unknown. */
  sourceKey?: string;
};

type PlateMap = Record<string, FamiliarFoilPlate>;

const EMPTY: PlateMap = Object.freeze({});

let cached: PlateMap = EMPTY;
let hydration: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

// Cross-window sync, matching `cave-familiar-images.ts`: a plate written in one
// window (the summoning rite) must be visible to another (a card opened in the
// tray webview) without a reload.
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
  const map = await avatarStorage().getAll("familiarFoil");
  cached = Object.keys(map).length > 0 ? (map as PlateMap) : EMPTY;
  notify();
}

function ensureHydrated(): Promise<void> {
  if (!hydration) hydration = hydrate();
  return hydration;
}

if (typeof window !== "undefined") void ensureHydrated();

/**
 * FNV-1a, the same 32-bit hash the rite seeds its glitch with. Used here to
 * turn an avatar source (a URL with an mtime, or a data URL) into a short
 * stable key — the value only ever has to compare equal to itself.
 */
export function foilSourceKey(source: string | null | undefined): string | null {
  if (!source) return null;
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Store (or replace) the plate for one familiar. */
export async function setFamiliarFoil(
  id: string,
  plate: { dataUrl: string; sourceKey?: string | null },
): Promise<void> {
  await ensureHydrated();
  const entry: FamiliarFoilPlate = {
    dataUrl: plate.dataUrl,
    mime: "image/png",
    updatedAt: new Date().toISOString(),
    ...(plate.sourceKey ? { sourceKey: plate.sourceKey } : {}),
  };
  try {
    await avatarStorage().put("familiarFoil", id, entry);
  } catch {
    // A plate that will not persist is not an error the user can act on — the
    // card still renders, it just recomputes next time.
    return;
  }
  cached = { ...cached, [id]: entry };
  notify();
  broadcast();
}

/** Drop the plate for one familiar — call whenever its portrait changes. */
export async function clearFamiliarFoil(id: string): Promise<void> {
  await ensureHydrated();
  try {
    await avatarStorage().delete("familiarFoil", id);
  } catch {
    /* the stale record stays; the source-key check still catches it */
  }
  if (!(id in cached)) return;
  const next = { ...cached };
  delete next[id];
  cached = Object.keys(next).length > 0 ? next : EMPTY;
  notify();
  broadcast();
}

/**
 * The stored plate for `id`, but only when it can be trusted for `sourceKey`.
 *
 * Returns `{ plate, adopted }` — `adopted` marks the unkeyed record described
 * in the module note, which the caller should stamp with the current key.
 */
export function usableFamiliarFoil(
  id: string,
  sourceKey: string | null,
): { dataUrl: string; adopted: boolean } | null {
  const record = cached[id];
  if (!record?.dataUrl) return null;
  if (!record.sourceKey) return { dataUrl: record.dataUrl, adopted: true };
  if (!sourceKey || record.sourceKey !== sourceKey) return null;
  return { dataUrl: record.dataUrl, adopted: false };
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const getSnapshot = () => cached;
const getServerSnapshot = () => EMPTY;

export function useFamiliarFoil(): PlateMap {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function readFamiliarFoilSnapshot(): PlateMap {
  return cached;
}

/** Resolves once the store has loaded persisted plates. */
export function whenFamiliarFoilHydrated(): Promise<void> {
  return ensureHydrated();
}

/** Test seam — drops the in-memory cache and forces a re-read. */
export function resetFamiliarFoilForTests(): void {
  cached = EMPTY;
  hydration = null;
}
