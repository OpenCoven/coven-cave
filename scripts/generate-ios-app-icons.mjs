// Regenerate the iOS AppIcon slots from the composed app-icon tile.
//
// iOS is deliberately NOT produced by `tauri icon`, and running that command
// over this directory is a regression rather than a shortcut:
//
//   - Apple rejects a marketing icon carrying an alpha channel. `tauri icon`
//     emits every slot as RGBA; the committed set is uniformly 3-channel.
//   - `tauri icon` bakes WHITE corners into its iOS output, which would ship
//     white slivers around every home-screen icon.
//
// So the set is flattened onto opaque black — matching the tile's own field, so
// the squircle corners read black rather than white — and written at each
// slot's exact committed dimension. iOS applies its own mask, so the artwork
// stays a full square here.
//
// This exists because the same regeneration was done by hand once (#4577) and
// left no reproducible path: the next person to touch the brand art had no way
// to rebuild iOS without rediscovering both constraints above.
//
// Usage: node scripts/generate-ios-app-icons.mjs <composed-tile.png> [out-dir]
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const [tile, outDirArg] = process.argv.slice(2);
if (!tile) {
  console.error("usage: generate-ios-app-icons.mjs <composed-tile.png> [out-dir]");
  process.exit(1);
}
const outDir = outDirArg ?? "src-tauri/icons/ios";

// Slot -> pixel size. Derived from the committed set; the filename alone is not
// a reliable source (AppIcon-512@2x is 1024, and several slots repeat a size
// under a `-1` suffix that the asset catalog references separately).
const SLOTS = {
  "AppIcon-20x20@1x.png": 20,
  "AppIcon-20x20@2x-1.png": 40,
  "AppIcon-20x20@2x.png": 40,
  "AppIcon-20x20@3x.png": 60,
  "AppIcon-29x29@1x.png": 29,
  "AppIcon-29x29@2x-1.png": 58,
  "AppIcon-29x29@2x.png": 58,
  "AppIcon-29x29@3x.png": 87,
  "AppIcon-40x40@1x.png": 40,
  "AppIcon-40x40@2x-1.png": 80,
  "AppIcon-40x40@2x.png": 80,
  "AppIcon-40x40@3x.png": 120,
  "AppIcon-512@2x.png": 1024,
  "AppIcon-60x60@2x.png": 120,
  "AppIcon-60x60@3x.png": 180,
  "AppIcon-76x76@1x.png": 76,
  "AppIcon-76x76@2x.png": 152,
  "AppIcon-83.5x83.5@2x.png": 167,
};

// The usage string offers an out-dir, so honour it for a path that does not
// exist yet: sharp's toFile() does not create parents, and without this the
// script fails with a bare ENOENT that reads like a bug in the pipeline rather
// than a missing directory. Recursive, so it is also a no-op for the default.
await mkdir(outDir, { recursive: true });

// Flatten to opaque black once, at full resolution, then downsample. Flattening
// after the resize would let the transparent corners blend toward grey at small
// sizes; doing it first keeps every corner exactly #000.
const master = await sharp(tile)
  .flatten({ background: { r: 0, g: 0, b: 0 } })
  .toBuffer();

let written = 0;
for (const [name, size] of Object.entries(SLOTS)) {
  await sharp(master)
    .resize(size, size, { fit: "fill" })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toFile(path.join(outDir, name));
  written += 1;
}

// Fail loudly if the directory holds a slot this table does not know about —
// silently leaving a stale icon behind is how a half-updated set ships.
const present = (await readdir(outDir)).filter((f) => f.endsWith(".png"));
const unknown = present.filter((f) => !(f in SLOTS));
if (unknown.length > 0) {
  console.error(`✗ unmanaged icons in ${outDir}: ${unknown.join(", ")}`);
  process.exit(1);
}

// Verify what was actually produced rather than trusting the pipeline.
for (const [name, size] of Object.entries(SLOTS)) {
  const meta = await sharp(path.join(outDir, name)).metadata();
  if (meta.hasAlpha || meta.channels !== 3) {
    console.error(`✗ ${name} has alpha (channels=${meta.channels}) — Apple rejects this`);
    process.exit(1);
  }
  if (meta.width !== size || meta.height !== size) {
    console.error(`✗ ${name} is ${meta.width}x${meta.height}, expected ${size}x${size}`);
    process.exit(1);
  }
}

console.log(`wrote ${written} iOS icons to ${outDir} — all 3-channel, alpha-free, dimensions unchanged`);
