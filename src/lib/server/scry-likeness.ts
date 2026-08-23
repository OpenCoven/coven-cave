/**
 * Staging an untrusted likeness for a scry.
 *
 * A posted likeness is the only new untrusted input the rite introduces, and it
 * ends up on disk where a local harness process opens it. Everything here
 * exists to keep that narrow:
 *
 *   - **The declared type is never believed on its own.** The bytes are sniffed
 *     for a PNG/JPEG/WebP signature (`detectBackdropMime` — the repository's
 *     magic-byte reader, named for its first caller) and the declared
 *     `content-type` must agree with what the bytes actually are. A `.png`
 *     filename, or a `content-type: image/png` header, buys nothing.
 *   - **The filename never reaches the filesystem.** The staged path is
 *     `<caveHome>/scry/<uuid>.png`, generated here. Nothing a client sends is
 *     joined into a path, and the join is still containment-checked.
 *   - **The bytes are re-encoded, not copied.** `sharp` decodes and re-emits a
 *     PNG, which both rejects anything that merely starts with an image
 *     signature and drops EXIF — so a phone photo's GPS coordinates are not
 *     handed to a harness process along with the picture.
 *   - **Nothing unbounded is retained.** The staged file is unlinked as soon as
 *     the scry finishes, and a bounded sweep clears anything a crashed request
 *     left behind. The likeness never enters a store record; the rite uploads
 *     the original through the existing avatar route if the person summons.
 */

import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { caveHome } from "../coven-paths.ts";
import {
  detectBackdropMime,
  type SafeBackdropMime,
} from "./backdrop-store.ts";
import { SCRY_ACCEPTED_MIME_TYPES, SCRY_MAX_LIKENESS_BYTES } from "../scry.ts";

/** Longest edge the harness ever sees. Plenty for reading a portrait. */
const SCRY_LIKENESS_MAX_DIM = 1024;

/** A staged likeness this old belongs to a request that never finished. */
const STAGED_LIKENESS_MAX_AGE_MS = 60 * 60 * 1000;

/** Bound the sweep so a pathological directory cannot stall a request. */
const SWEEP_SCAN_LIMIT = 200;

export class ScryLikenessError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ScryLikenessError";
    this.status = status;
  }
}

export type StagedLikeness = {
  /** Absolute path to the normalized PNG the harness is asked to open. */
  path: string;
  /** Unlink the staged file. Safe to call more than once. */
  dispose: () => Promise<void>;
};

export function scryStagingRoot(): string {
  return path.join(/* turbopackIgnore: true */ caveHome(), "scry");
}

function isContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function normalizedMime(value: string): string {
  return value.split(";", 1)[0].trim().toLowerCase();
}

/** Resolve the staging root, refusing a symlinked root outright. */
async function resolvedRoot(): Promise<string> {
  const root = scryStagingRoot();
  await mkdir(/* turbopackIgnore: true */ root, { recursive: true, mode: 0o700 });
  const meta = await lstat(/* turbopackIgnore: true */ root);
  if (meta.isSymbolicLink() || !meta.isDirectory()) {
    throw new ScryLikenessError("scry staging root is not a directory", 500);
  }
  return realpath(/* turbopackIgnore: true */ root);
}

/**
 * Validate the posted bytes against the declared type.
 *
 * Exported so the route and its tests can assert the refusal statuses without
 * touching the filesystem.
 */
export function validateLikenessBytes(
  bytes: Uint8Array,
  declaredMime: string,
): SafeBackdropMime {
  if (bytes.byteLength === 0) {
    throw new ScryLikenessError("the likeness is empty", 400);
  }
  if (bytes.byteLength > SCRY_MAX_LIKENESS_BYTES) {
    throw new ScryLikenessError("the likeness is too large", 413);
  }
  const mime = normalizedMime(declaredMime);
  if (!(SCRY_ACCEPTED_MIME_TYPES as readonly string[]).includes(mime)) {
    throw new ScryLikenessError("unsupported likeness type", 415);
  }
  const detected = detectBackdropMime(bytes);
  if (!detected) {
    throw new ScryLikenessError("the likeness has no recognizable image signature", 400);
  }
  if (detected !== mime) {
    throw new ScryLikenessError("the likeness does not match its declared type", 400);
  }
  return detected;
}

/**
 * Clear staged likenesses older than the retention window.
 *
 * A scry disposes its own file, so this only ever finds the residue of a
 * request that died mid-flight. Bounded and best-effort: a sweep failure must
 * never fail the scry it ran ahead of.
 */
export async function sweepStaleLikenesses(now: number = Date.now()): Promise<number> {
  let removed = 0;
  try {
    const root = await resolvedRoot();
    const entries = await readdir(/* turbopackIgnore: true */ root);
    for (const entry of entries.slice(0, SWEEP_SCAN_LIMIT)) {
      const target = path.join(/* turbopackIgnore: true */ root, entry);
      if (!isContained(root, target)) continue;
      try {
        const meta = await stat(/* turbopackIgnore: true */ target);
        if (!meta.isFile()) continue;
        if (now - meta.mtimeMs < STAGED_LIKENESS_MAX_AGE_MS) continue;
        await rm(/* turbopackIgnore: true */ target, { force: true });
        removed++;
      } catch {
        /* another actor won the race, or the entry vanished */
      }
    }
  } catch {
    /* best effort */
  }
  return removed;
}

/**
 * Validate, normalize, and stage a posted likeness.
 *
 * The returned path is what the harness is told to open. Callers must call
 * `dispose()` — in a `finally` — whether the scry succeeded or not.
 */
export async function stageLikeness(
  bytes: Uint8Array,
  declaredMime: string,
): Promise<StagedLikeness> {
  validateLikenessBytes(bytes, declaredMime);

  let png: Buffer;
  try {
    png = await sharp(Buffer.from(bytes))
      .rotate() // honor EXIF orientation before the metadata is dropped
      .resize(SCRY_LIKENESS_MAX_DIM, SCRY_LIKENESS_MAX_DIM, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch {
    // A payload that carries a valid signature but does not decode is not an
    // image, whatever its first eight bytes claim.
    throw new ScryLikenessError("the likeness is not a decodable image", 400);
  }

  const root = await resolvedRoot();
  // The whole of the name is a v4 UUID plus a fixed extension. No part of the
  // request contributes to it.
  const target = path.join(/* turbopackIgnore: true */ root, `${randomUUID()}.png`);
  if (!isContained(root, target)) {
    throw new ScryLikenessError("could not stage the likeness", 500);
  }
  // `wx` refuses to follow a symlink planted at the target.
  await writeFile(/* turbopackIgnore: true */ target, png, { mode: 0o600, flag: "wx" });

  let disposed = false;
  return {
    path: target,
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      await rm(/* turbopackIgnore: true */ target, { force: true }).catch(() => {});
    },
  };
}
