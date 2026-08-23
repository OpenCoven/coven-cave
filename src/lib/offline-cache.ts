"use client";

/**
 * Client for the desktop shell's encrypted offline read cache (cave-f1k8n).
 *
 * The native side (`src-tauri/src/offline_cache.rs`) owns the crypto, the
 * caps, and the purge rules. This module owns the two things that have to
 * happen before a payload is allowed near the disk:
 *
 *  1. **Sanitization.** The cache is encrypted, but "encrypted" is not a
 *     licence to persist a bearer token or an attachment's bytes. Whatever
 *     survives {@link sanitizeForOfflineCache} is what gets stored, and the
 *     rules are deliberately conservative: a key that reads like a credential
 *     is dropped, and so is any value that looks like embedded file bytes.
 *  2. **Read-only framing.** A cached read is history, never live state.
 *     Every hit comes back with `readOnly: true` from the native layer and is
 *     re-asserted here, so a surface can label it without inferring anything
 *     from timestamps.
 *
 * Outside the desktop shell every call is a no-op that resolves to `null` or
 * `false` — the browser and mobile builds have no keychain to derive from, so
 * the honest answer is "no cache" rather than an unencrypted fallback.
 *
 * This sits underneath the in-memory tier in `conversation-cache.ts`: that one
 * removes the skeleton flash between thread switches and dies with the window,
 * this one survives a restart with the daemon down.
 */

import { isTauri } from "./tauri-platform.ts";

/** Mirrors `OFFLINE_CACHE_SCHEMA_VERSION` in `offline_cache.rs`. */
export const OFFLINE_CACHE_SCHEMA_VERSION = 1;

/** Mirrors `MAX_ENTRY_BYTES` in `offline_cache.rs`. */
export const OFFLINE_CACHE_MAX_ENTRY_BYTES = 1024 * 1024;

/** Mirrors `MAX_NAME_LEN` in `offline_cache.rs`. */
const MAX_NAME_LENGTH = 128;

/** Mirrors `MAX_REVISION_LEN` in `offline_cache.rs`. */
const MAX_REVISION_LENGTH = 256;

/**
 * Cache namespaces. A scope is cleared as a unit and is part of the key
 * derivation, so adding one is a deliberate act rather than a free-form
 * string at a call site.
 */
export type OfflineCacheScope = "conversation";

/** Mirrors `OfflineCacheFaultKind` in `offline_cache.rs`. */
export type OfflineCacheFaultKind =
  | "truncated"
  | "magic_mismatch"
  | "header_malformed"
  | "schema_mismatch"
  | "instance_mismatch"
  | "entry_mismatch"
  | "length_mismatch"
  | "undecryptable"
  | "oversized"
  | "payload_malformed"
  | "io";

export type OfflineCacheFault = {
  kind: OfflineCacheFaultKind;
  detail: string;
};

type NativeOfflineCacheEntry = {
  payload: string;
  revision: string;
  updatedAtUnixMs: number;
  readOnly: boolean;
};

type NativeOfflineCacheReadResult = {
  entry?: NativeOfflineCacheEntry;
  fault?: OfflineCacheFault;
  purged: boolean;
};

export type OfflineCacheStatus = {
  schemaVersion: number;
  instanceId: string;
  entries: number;
  bytes: number;
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
  faults: OfflineCacheFault[];
};

/**
 * A cache hit. `readOnly` is always `true` and is present so a surface can
 * say so out loud; nothing here can be written back through.
 */
export type OfflineCacheRead<T> = {
  data: T;
  revision: string;
  updatedAtUnixMs: number;
  readOnly: true;
};

export type OfflineCacheSanitizeResult = {
  value: unknown;
  /** Dot-separated paths that were removed. Key names only, never values. */
  dropped: string[];
};

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export type OfflineCacheDependencies = {
  invoke?: Invoke;
  supported?: () => boolean;
  warn?: (message: string) => void;
};

/**
 * Key names that must never reach disk. Matched against the key with
 * separators stripped, so `api_key`, `apiKey`, and `API-KEY` are one rule.
 */
const SECRET_KEY_PATTERN =
  /^(token|accesstoken|refreshtoken|idtoken|bearertoken|apikey|apisecret|secret|clientsecret|password|passphrase|credential|credentials|authorization|authheader|cookie|setcookie|sessionkey|sessiontoken|privatekey|signingkey|signature|jwt|otp|pin)$/;

/**
 * Key names whose values are file bytes rather than text. A conversation
 * payload legitimately has `content`, so the byte-ish names are listed
 * explicitly instead of guessing from the value alone.
 */
const ATTACHMENT_KEY_PATTERN =
  /^(bytes|base64|blob|buffer|binary|filedata|rawdata|arraybuffer|dataurl|datauri|thumbnail|preview|imagedata)$/;

/** Anything at or beyond this length is a payload, not a caption. */
const MAX_INLINE_STRING_LENGTH = 8 * 1024;

function normalizeKey(key: string): string {
  return key.replace(/[-_.\s]/g, "").toLowerCase();
}

function looksLikeEmbeddedBytes(value: string): boolean {
  if (/^data:[^,]*;base64,/i.test(value)) return true;
  if (value.length < MAX_INLINE_STRING_LENGTH) return false;
  // A long run of pure base64 alphabet is bytes someone stringified; prose,
  // markdown, and JSON all contain characters outside it well before this
  // length.
  return /^[A-Za-z0-9+/=\r\n]+$/.test(value);
}

function joinPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

function sanitizeValue(value: unknown, path: string, dropped: string[]): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeValue(item, joinPath(path, String(index)), dropped));
  }
  if (typeof value === "string") {
    if (looksLikeEmbeddedBytes(value)) {
      dropped.push(path);
      return undefined;
    }
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "object") {
    // Typed arrays, Blobs, Dates, class instances: nothing structured enough
    // to reason about, so nothing that belongs in a durable cache.
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      dropped.push(path);
      return undefined;
    }
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        dropped.push(joinPath(path, key));
        continue;
      }
      const normalized = normalizeKey(key);
      if (SECRET_KEY_PATTERN.test(normalized) || ATTACHMENT_KEY_PATTERN.test(normalized)) {
        dropped.push(joinPath(path, key));
        continue;
      }
      const sanitized = sanitizeValue(child, joinPath(path, key), dropped);
      if (sanitized !== undefined) out[key] = sanitized;
    }
    return out;
  }
  // undefined, functions, symbols, bigint: not JSON, so not cacheable.
  if (value !== undefined) dropped.push(path);
  return undefined;
}

/**
 * Strip everything that must not be persisted, and report what went. The
 * result is plain JSON data: no class instances, no typed arrays, no
 * credential-shaped keys, and no embedded file bytes.
 */
export function sanitizeForOfflineCache(value: unknown): OfflineCacheSanitizeResult {
  const dropped: string[] = [];
  return { value: sanitizeValue(value, "", dropped), dropped };
}

function isValidName(value: string): boolean {
  return value.length > 0 && value.length <= MAX_NAME_LENGTH && !/[\p{Cc}]/u.test(value);
}

function defaultSupported(): boolean {
  return isTauri();
}

async function resolveInvoke(dependencies: OfflineCacheDependencies): Promise<Invoke | null> {
  if (dependencies.invoke) return dependencies.invoke;
  if (typeof window === "undefined") return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke as Invoke;
  } catch {
    return null;
  }
}

/** True when a durable offline cache exists at all. */
export function isOfflineCacheSupported(dependencies: OfflineCacheDependencies = {}): boolean {
  return (dependencies.supported ?? defaultSupported)();
}

function isReadResult(value: unknown): value is NativeOfflineCacheReadResult {
  return typeof value === "object" && value !== null && "purged" in value;
}

/**
 * Read a cached payload. Returns `null` for a miss, for an unsupported
 * platform, and for a purged entry — all three mean "nothing to show" and
 * none of them is an error the caller should surface.
 */
export async function readOfflineCache<T = unknown>(
  scope: OfflineCacheScope,
  key: string,
  dependencies: OfflineCacheDependencies = {},
): Promise<OfflineCacheRead<T> | null> {
  if (!isOfflineCacheSupported(dependencies) || !isValidName(key)) return null;
  const invoke = await resolveInvoke(dependencies);
  if (!invoke) return null;
  try {
    const result = await invoke("offline_cache_read", { scope, key });
    if (!isReadResult(result) || !result.entry) return null;
    const { payload, revision, updatedAtUnixMs, readOnly } = result.entry;
    if (readOnly !== true) return null;
    return {
      data: JSON.parse(payload) as T,
      revision,
      updatedAtUnixMs,
      readOnly: true,
    };
  } catch {
    // A cache read never fails a surface: the daemon path is the source of
    // truth and a miss is always a legitimate answer.
    return null;
  }
}

/**
 * Persist a payload for offline reading. Returns whether anything was stored:
 * an unsupported platform, an unsanitizable value, and an over-budget payload
 * are all `false` rather than throws, because none of them should interrupt
 * the live path that produced the data.
 */
export async function writeOfflineCache(
  scope: OfflineCacheScope,
  key: string,
  value: unknown,
  revision: string,
  dependencies: OfflineCacheDependencies = {},
): Promise<boolean> {
  if (!isOfflineCacheSupported(dependencies) || !isValidName(key)) return false;
  if (revision.length > MAX_REVISION_LENGTH) return false;
  const { value: sanitized } = sanitizeForOfflineCache(value);
  if (sanitized === undefined) return false;
  let payload: string;
  try {
    payload = JSON.stringify(sanitized);
  } catch {
    return false;
  }
  const payloadBytes = typeof TextEncoder !== "undefined" ? new TextEncoder().encode(payload).length : payload.length;
  if (payloadBytes > OFFLINE_CACHE_MAX_ENTRY_BYTES) return false;
  const invoke = await resolveInvoke(dependencies);
  if (!invoke) return false;
  try {
    await invoke("offline_cache_write", { scope, key, payload, revision });
    return true;
  } catch {
    dependencies.warn?.("[cave] offline cache write is unavailable");
    return false;
  }
}

/** Drop one scope, or the whole cache for this instance when scope is omitted. */
export async function clearOfflineCache(
  scope?: OfflineCacheScope,
  dependencies: OfflineCacheDependencies = {},
): Promise<boolean> {
  if (!isOfflineCacheSupported(dependencies)) return false;
  const invoke = await resolveInvoke(dependencies);
  if (!invoke) return false;
  try {
    await invoke("offline_cache_clear", { scope: scope ?? null });
    return true;
  } catch {
    return false;
  }
}

/**
 * Cache occupancy and the recent classified faults, for diagnostics. Returns
 * `null` where there is no cache rather than a zeroed status, so a caller
 * cannot mistake "unsupported" for "empty".
 */
export async function readOfflineCacheStatus(
  dependencies: OfflineCacheDependencies = {},
): Promise<OfflineCacheStatus | null> {
  if (!isOfflineCacheSupported(dependencies)) return null;
  const invoke = await resolveInvoke(dependencies);
  if (!invoke) return null;
  try {
    const status = await invoke("offline_cache_status");
    if (typeof status !== "object" || status === null) return null;
    return status as OfflineCacheStatus;
  } catch {
    return null;
  }
}
