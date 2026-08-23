// @ts-nocheck
//
// Untrusted likeness intake.
//
// A posted likeness is the only new untrusted input the rite adds, and it ends
// up on disk where a harness process opens it. These assertions are about what
// an attacker-controlled upload can and cannot reach.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { readdir, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(tmpdir(), "cave-scry-test-"));
process.env.COVEN_CAVE_HOME = home;

const sharp = (await import("sharp")).default;
const {
  ScryLikenessError,
  scryStagingRoot,
  stageLikeness,
  sweepStaleLikenesses,
  validateLikenessBytes,
} = await import("./scry-likeness.ts");
const { SCRY_MAX_LIKENESS_BYTES } = await import("../scry.ts");

async function pngBytes(options = {}) {
  return await sharp({
    create: {
      width: options.width ?? 8,
      height: options.height ?? 8,
      channels: 3,
      background: { r: 12, g: 200, b: 90 },
    },
  })
    .png()
    .toBuffer();
}

async function jpegWithExif() {
  // A JPEG carrying EXIF, including a GPS block. `withExif` writes the tags.
  return await sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 200, g: 40, b: 40 } },
  })
    .withExif({ IFD0: { Copyright: "SCRY-EXIF-CANARY" }, GPS: { GPSLatitudeRef: "N" } })
    .jpeg()
    .toBuffer();
}

function refusal(fn) {
  try {
    fn();
  } catch (error) {
    if (error instanceof ScryLikenessError) return error;
    throw error;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The declared type is never believed on its own.
// ---------------------------------------------------------------------------

{
  const png = await pngBytes();

  assert.equal(
    validateLikenessBytes(png, "image/png"),
    "image/png",
    "a PNG declared as a PNG is accepted",
  );
  assert.equal(
    validateLikenessBytes(png, "image/png; charset=binary"),
    "image/png",
    "content-type parameters do not defeat the comparison",
  );

  const mismatched = refusal(() => validateLikenessBytes(png, "image/jpeg"));
  assert.ok(mismatched, "PNG bytes declared as JPEG must be refused");
  assert.equal(mismatched.status, 400);

  const html = Buffer.from("<html><script>alert(1)</script></html>", "utf8");
  const lying = refusal(() => validateLikenessBytes(html, "image/png"));
  assert.ok(lying, "a payload that is not an image at all must be refused however it is labelled");
  assert.equal(lying.status, 400);

  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', "utf8");
  const svgRefusal = refusal(() => validateLikenessBytes(svg, "image/svg+xml"));
  assert.ok(svgRefusal, "SVG is refused — it is active content, and the avatar route excludes it for the same reason");
  assert.equal(svgRefusal.status, 415, "an unsupported declared type is refused before the bytes are even read");

  const empty = refusal(() => validateLikenessBytes(new Uint8Array(), "image/png"));
  assert.ok(empty, "an empty body is refused");
  assert.equal(empty.status, 400);

  const huge = refusal(() =>
    validateLikenessBytes(Buffer.alloc(SCRY_MAX_LIKENESS_BYTES + 1), "image/png"),
  );
  assert.ok(huge, "an oversized likeness is refused");
  assert.equal(huge.status, 413, "oversize is reported as 413, not as a generic bad request");
}

// A payload that merely *starts* like an image but does not decode must not be
// staged. The signature check alone would let this through.
{
  const fake = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from("this is not actually a PNG body", "utf8"),
  ]);
  assert.equal(
    validateLikenessBytes(fake, "image/png"),
    "image/png",
    "the signature check by itself accepts this — which is why the decoder runs too",
  );
  let staged = null;
  try {
    staged = await stageLikeness(fake, "image/png");
  } catch (error) {
    assert.ok(error instanceof ScryLikenessError, "an undecodable payload is refused as a likeness error");
    assert.equal(error.status, 400);
  }
  assert.equal(staged, null, "nothing that fails to decode reaches the staging directory");
}

// ---------------------------------------------------------------------------
// Nothing the client sends reaches the filesystem.
// ---------------------------------------------------------------------------

{
  const staged = await stageLikeness(await pngBytes(), "image/png");
  const root = scryStagingRoot();
  const base = path.basename(staged.path);

  assert.equal(
    path.dirname(staged.path),
    root,
    "the staged file lands in the scry staging directory and nowhere else",
  );
  assert.match(
    base,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/,
    `the whole filename is a generated UUID plus a fixed extension, got ${base}`,
  );
  assert.ok(staged.path.startsWith(root + path.sep), "the staged path is contained by the staging root");

  const bytes = await readFile(staged.path);
  assert.deepEqual(
    Array.from(bytes.subarray(0, 8)),
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    "the staged file is a re-encoded PNG, not a copy of whatever was posted",
  );

  if (process.platform !== "win32") {
    const mode = statSync(staged.path).mode & 0o777;
    assert.equal(mode, 0o600, `the staged likeness is owner-only, got ${mode.toString(8)}`);
  }

  await staged.dispose();
  const after = await readdir(root);
  assert.equal(after.includes(base), false, "dispose removes the staged likeness");
  await staged.dispose();
  assert.equal((await readdir(root)).includes(base), false, "dispose is safe to call twice");
}

// A second scry never collides with the first.
{
  const a = await stageLikeness(await pngBytes(), "image/png");
  const b = await stageLikeness(await pngBytes(), "image/png");
  assert.notEqual(a.path, b.path, "two scries stage to two distinct paths");
  await a.dispose();
  await b.dispose();
}

// ---------------------------------------------------------------------------
// The bytes handed to a harness carry no camera metadata.
// ---------------------------------------------------------------------------

{
  const source = await jpegWithExif();
  assert.ok(
    source.includes(Buffer.from("SCRY-EXIF-CANARY", "utf8")),
    "the fixture really does carry the EXIF canary before staging",
  );
  const staged = await stageLikeness(source, "image/jpeg");
  const written = await readFile(staged.path);
  assert.equal(
    written.includes(Buffer.from("SCRY-EXIF-CANARY", "utf8")),
    false,
    "re-encoding drops EXIF, so a phone photo's metadata is not handed to a harness process along with the picture",
  );
  const meta = await sharp(written).metadata();
  assert.equal(meta.exif, undefined, "no EXIF block survives into the staged likeness");
  await staged.dispose();
}

// ---------------------------------------------------------------------------
// A very large image is bounded before a harness sees it.
// ---------------------------------------------------------------------------

{
  const big = await pngBytes({ width: 3000, height: 2000 });
  const staged = await stageLikeness(big, "image/png");
  const meta = await sharp(await readFile(staged.path)).metadata();
  assert.ok(
    meta.width <= 1024 && meta.height <= 1024,
    `the staged likeness is bounded on its longest edge, got ${meta.width}x${meta.height}`,
  );
  assert.equal(meta.width, 1024, "the aspect ratio is preserved rather than the image being squared");
  await staged.dispose();
}

// ---------------------------------------------------------------------------
// Residue from a crashed request is cleared; live work is not.
// ---------------------------------------------------------------------------

{
  const root = scryStagingRoot();
  const stale = path.join(root, "00000000-0000-4000-8000-000000000000.png");
  await writeFile(stale, await pngBytes(), { mode: 0o600 });
  // Back-date it rather than moving the clock forward, so the live likeness
  // staged below is genuinely inside the window while this one is outside it.
  // A forward-dated sweep would age BOTH out and prove nothing about survival.
  const threeHoursAgo = (Date.now() - 3 * 60 * 60 * 1000) / 1000;
  await utimes(stale, threeHoursAgo, threeHoursAgo);

  const fresh = await stageLikeness(await pngBytes(), "image/png");
  const freshName = path.basename(fresh.path);

  const removed = await sweepStaleLikenesses(Date.now());
  assert.equal(removed, 1, "exactly the abandoned likeness is swept");

  const listing = await readdir(root);
  assert.equal(listing.includes(path.basename(stale)), false, "the abandoned likeness is gone");
  assert.equal(
    listing.includes(freshName),
    true,
    "a likeness staged for a scry that is still running must survive the sweep that scry itself triggers",
  );

  assert.equal(
    await sweepStaleLikenesses(Date.now()),
    0,
    "a second sweep finds nothing left to remove",
  );
  await fresh.dispose();
}

rmSync(home, { recursive: true, force: true });
console.log("scry likeness intake ok");
