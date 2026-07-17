import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import {
  backdropPath,
  BackdropValidationError,
  deleteBackdropFile,
  deleteFamiliarBackdropFile,
  detectBackdropMime,
  MAX_BACKDROP_BYTES,
  readBackdropFile,
  readFamiliarBackdropFile,
  writeBackdropFile,
  writeFamiliarBackdropFile,
} from "./backdrop-store.ts";

const routeSource = await readFile(
  new URL("../../app/api/preferences/backdrop/route.ts", import.meta.url),
  "utf8",
);

// Genuine 1x1 PNG; JPEG/WebP only need their basic signatures because the
// store intentionally performs magic validation, not image decoding.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
  0x49, 0x46, 0x00, 0x01, 0xff, 0xd9,
]);
const WEBP = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
]);

const root = await mkdtemp(path.join(tmpdir(), "cave-backdrop-store-"));
const originalOverride = process.env.COVEN_BACKDROP_PATH;
const originalFamiliarDir = process.env.COVEN_FAMILIAR_BACKDROP_DIR;
const originalCovenHome = process.env.COVEN_HOME;

after(async () => {
  if (originalOverride === undefined) delete process.env.COVEN_BACKDROP_PATH;
  else process.env.COVEN_BACKDROP_PATH = originalOverride;
  if (originalFamiliarDir === undefined) delete process.env.COVEN_FAMILIAR_BACKDROP_DIR;
  else process.env.COVEN_FAMILIAR_BACKDROP_DIR = originalFamiliarDir;
  if (originalCovenHome === undefined) delete process.env.COVEN_HOME;
  else process.env.COVEN_HOME = originalCovenHome;
  await rm(root, { recursive: true, force: true });
});

function useTarget(name: string): string {
  const target = path.join(root, name, "cave-backdrop.jpg");
  process.env.COVEN_BACKDROP_PATH = target;
  return target;
}

async function expectValidation(
  action: () => Promise<unknown>,
  status: BackdropValidationError["status"],
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof BackdropValidationError);
    assert.equal(error.status, status);
    return true;
  });
}

test("path is resolved at call-time from override or COVEN_HOME", () => {
  delete process.env.COVEN_BACKDROP_PATH;
  process.env.COVEN_HOME = path.join(root, "home-a");
  assert.equal(backdropPath(), path.join(root, "home-a", "cave", "backdrop.jpg"));
  process.env.COVEN_HOME = path.join(root, "home-b");
  assert.equal(backdropPath(), path.join(root, "home-b", "cave", "backdrop.jpg"));

  const override = path.join(root, "explicit", "image.jpg");
  process.env.COVEN_BACKDROP_PATH = `  ${override}  `;
  assert.equal(backdropPath(), override);
});

test("safe raster signatures are detected and SVG is never accepted", () => {
  assert.equal(detectBackdropMime(PNG), "image/png");
  assert.equal(detectBackdropMime(JPEG), "image/jpeg");
  assert.equal(detectBackdropMime(WEBP), "image/webp");
  assert.equal(detectBackdropMime(Buffer.from("<svg><script/></svg>")), null);
  assert.equal(detectBackdropMime(Buffer.from("not an image")), null);
});

test("write/read round-trips bytes, MIME, and a stable strong ETag", async () => {
  const target = useTarget("roundtrip");
  const saved = await writeBackdropFile(PNG, "image/png");
  assert.equal(saved.mime, "image/png");
  assert.match(saved.etag, /^"sha256-[A-Za-z0-9_-]+"$/);
  assert.deepEqual(await readFile(target), PNG);

  const loaded = await readBackdropFile();
  assert.ok(loaded);
  assert.equal(loaded.mime, "image/png");
  assert.equal(loaded.etag, saved.etag);
  assert.deepEqual(loaded.bytes, PNG);
});

test("replacement changes format atomically and delete is idempotent", async () => {
  useTarget("replace-delete");
  await writeBackdropFile(PNG, "image/png");
  await writeBackdropFile(JPEG, "image/jpeg; charset=binary");
  const loaded = await readBackdropFile();
  assert.equal(loaded?.mime, "image/jpeg");
  assert.deepEqual(loaded?.bytes, JPEG);

  await deleteBackdropFile();
  assert.equal(await readBackdropFile(), null);
  await deleteBackdropFile();
  assert.equal(await readBackdropFile(), null);
});

test("validation rejects empty, oversized, unsupported, malformed, and mismatched data", async () => {
  useTarget("validation");
  await expectValidation(() => writeBackdropFile(new Uint8Array(), "image/png"), 400);
  await expectValidation(
    () => writeBackdropFile(new Uint8Array(MAX_BACKDROP_BYTES + 1), "image/png"),
    413,
  );
  await expectValidation(() => writeBackdropFile(Buffer.from("<svg/>"), "image/svg+xml"), 415);
  await expectValidation(() => writeBackdropFile(Buffer.from("garbage"), "image/png"), 400);
  await expectValidation(() => writeBackdropFile(PNG, "image/jpeg"), 400);
  assert.equal(await readBackdropFile(), null, "rejected writes never create the canonical file");
});

test("malformed or oversized data already on disk is not served", async () => {
  const target = useTarget("bad-on-disk");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, "<svg xmlns='http://www.w3.org/2000/svg'/>");
  assert.equal(await readBackdropFile(), null);
  await writeFile(target, new Uint8Array(MAX_BACKDROP_BYTES + 1));
  assert.equal(await readBackdropFile(), null);
});

test("concurrent writes never tear data or share temp names", async () => {
  const target = useTarget("concurrent");
  await Promise.all([
    writeBackdropFile(PNG, "image/png"),
    writeBackdropFile(JPEG, "image/jpeg"),
    writeBackdropFile(WEBP, "image/webp"),
  ]);
  const loaded = await readBackdropFile();
  assert.ok(loaded);
  const candidates = new Map([
    ["image/png", PNG],
    ["image/jpeg", JPEG],
    ["image/webp", WEBP],
  ]);
  assert.deepEqual(loaded.bytes, candidates.get(loaded.mime), "the winner is one complete image");
  const names = await readdir(path.dirname(target));
  assert.deepEqual(names.filter((name) => name.endsWith(".tmp")), []);
});

test("a failed atomic rename cleans its unique temp file", async () => {
  const target = useTarget("rename-failure");
  await mkdir(target, { recursive: true }); // A directory cannot be replaced by the temp file.
  await assert.rejects(() => writeBackdropFile(PNG, "image/png"));
  const names = await readdir(path.dirname(target));
  assert.deepEqual(
    names.filter((name) => name.startsWith("cave-backdrop.jpg.") && name.endsWith(".tmp")),
    [],
  );
});

test("route keeps normal API auth plus local-only, bounded, no-store raster semantics", () => {
  for (const method of ["GET", "PUT", "DELETE"]) {
    assert.match(routeSource, new RegExp(`export async function ${method}\\(req: Request\\) \\{[\\s\\S]*?rejectNonLocalRequest\\(req\\)`));
  }
  assert.match(routeSource, /MAX_BACKDROP_BYTES/);
  assert.match(routeSource, /req\.body\?\.getReader\(\)/, "PUT streams instead of unbounded arrayBuffer parsing");
  assert.match(routeSource, /total > MAX_BACKDROP_BYTES[\s\S]*BackdropValidationError\("backdrop image is too large", 413\)/);
  assert.match(routeSource, /SAFE_BACKDROP_MIME_TYPES[\s\S]*unsupported backdrop image type[\s\S]*415/);
  assert.match(routeSource, /writeBackdropFile\(bytes, mime\)/);
  assert.match(
    routeSource,
    /patchPreferences\([\s\S]*image: \{ present: true, mime: image\.mime, updatedAt \}/,
    "PUT records canonical image metadata in the preferences snapshot",
  );
  assert.match(
    routeSource,
    /deleteBackdropFile\(\)[\s\S]*patchPreferences\([\s\S]*present: false, mime: null/,
    "DELETE clears canonical image metadata",
  );
  assert.match(routeSource, /"Cache-Control": "no-store"/);
  assert.match(routeSource, /!image[\s\S]*status: 204/, "missing optional bytes return a successful empty response");
  assert.match(routeSource, /"X-Content-Type-Options": "nosniff"/);
  assert.match(routeSource, /req\.headers\.get\("if-none-match"\) === image\.etag[\s\S]*status: 304/);
  assert.doesNotMatch(routeSource, /image\/svg|svg\+xml/i, "the route never allowlists SVG");
});

// ── per-familiar overrides (cave-j0dz) ───────────────────────────────────────

const familiarRouteSource = await readFile(
  new URL("../../app/api/familiars/[id]/backdrop/route.ts", import.meta.url),
  "utf8",
);

function useFamiliarDir(name: string): string {
  const dir = path.join(root, name);
  process.env.COVEN_FAMILIAR_BACKDROP_DIR = dir;
  return dir;
}

test("familiar backdrops round-trip in their own directory and delete idempotently", async () => {
  const dir = useFamiliarDir("familiar-roundtrip");
  const saved = await writeFamiliarBackdropFile("nova", PNG, "image/png");
  assert.equal(saved.mime, "image/png");
  assert.deepEqual(await readFile(path.join(dir, "familiar-nova.img")), PNG);

  const loaded = await readFamiliarBackdropFile("nova");
  assert.ok(loaded);
  assert.equal(loaded.etag, saved.etag);
  assert.equal(await readFamiliarBackdropFile("someone-else"), null, "familiars are isolated");

  await deleteFamiliarBackdropFile("nova");
  await deleteFamiliarBackdropFile("nova"); // idempotent
  assert.equal(await readFamiliarBackdropFile("nova"), null);
});

test("traversal-shaped familiar ids are refused with a 400 validation error", async () => {
  useFamiliarDir("familiar-traversal");
  for (const evil of ["../escape", "a/b", "a\\b", "", ".hidden", "x".repeat(80)]) {
    await expectValidation(() => readFamiliarBackdropFile(evil), 400);
    await expectValidation(() => writeFamiliarBackdropFile(evil, PNG, "image/png"), 400);
    await expectValidation(() => deleteFamiliarBackdropFile(evil), 400);
  }
});

test("familiar route mirrors the app route's local-only, bounded, no-store semantics", () => {
  for (const method of ["GET", "PUT", "DELETE"]) {
    assert.match(
      familiarRouteSource,
      new RegExp(`export async function ${method}\\(req: Request[\\s\\S]*?rejectNonLocalRequest\\(req\\)`),
    );
  }
  assert.match(familiarRouteSource, /req\.body\?\.getReader\(\)/, "PUT streams instead of unbounded arrayBuffer parsing");
  assert.match(familiarRouteSource, /total > MAX_BACKDROP_BYTES[\s\S]*BackdropValidationError\("backdrop image is too large", 413\)/);
  assert.match(familiarRouteSource, /SAFE_BACKDROP_MIME_TYPES[\s\S]*unsupported backdrop image type[\s\S]*415/);
  assert.match(familiarRouteSource, /writeFamiliarBackdropFile\(params\.id, bytes, mime\)/);
  assert.match(familiarRouteSource, /"Cache-Control": "no-store"/);
  assert.match(familiarRouteSource, /!image[\s\S]*status: 204/, "missing familiar bytes return a successful empty response");
  assert.match(familiarRouteSource, /"X-Content-Type-Options": "nosniff"/);
  assert.match(familiarRouteSource, /req\.headers\.get\("if-none-match"\) === image\.etag[\s\S]*status: 304/);
  assert.doesNotMatch(familiarRouteSource, /image\/svg|svg\+xml/i, "the route never allowlists SVG");
  assert.doesNotMatch(
    familiarRouteSource,
    /patchPreferences/,
    "per-familiar images live outside the app-wide preferences snapshot",
  );
});
