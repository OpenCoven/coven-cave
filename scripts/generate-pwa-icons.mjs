// Derive PWA icons from the canonical 512×512 Tauri icon. Run on
// prebuild (and manually with `node scripts/generate-pwa-icons.mjs`)
// to refresh the public/icons/ directory after the source icon changes.
//
// Outputs (all in /public/icons/):
//   - icon-192.png        — standard PWA icon
//   - icon-512.png        — high-res PWA icon
//   - icon-512-maskable.png — maskable icon with 20% safe-area inset
//                              (Android adaptive icons crop into the
//                               outer ~10% so the visual mark must live
//                               in the inner 80% of the canvas)
//   - apple-touch-icon.png — 180px for iOS home-screen
//   - favicon-32.png       — 32px favicon
//
// Idempotent: re-running produces identical bytes.

import sharp from "sharp";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(here);
const source = `${repoRoot}/src-tauri/icons/icon.png`;
const outDir = `${repoRoot}/public/icons`;

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const tasks = [
  { name: "icon-192.png", size: 192, mask: false },
  { name: "icon-512.png", size: 512, mask: false },
  { name: "icon-512-maskable.png", size: 512, mask: true },
  { name: "apple-touch-icon.png", size: 180, mask: false },
  { name: "favicon-32.png", size: 32, mask: false },
];

let failed = false;
for (const t of tasks) {
  const out = `${outDir}/${t.name}`;
  try {
    if (t.mask) {
      // Maskable: shrink the mark to 80% and pad with the brand
      // background colour so adaptive icon cropping doesn't clip the
      // glyph. The padding colour matches the manifest theme_color.
      const inner = Math.round(t.size * 0.8);
      const pad = Math.round((t.size - inner) / 2);
      await sharp(source)
        .resize(inner, inner, { fit: "contain", background: { r: 10, g: 10, b: 10, alpha: 1 } })
        .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 10, g: 10, b: 10, alpha: 1 } })
        .png()
        .toFile(out);
    } else {
      await sharp(source).resize(t.size, t.size).png().toFile(out);
    }
    console.log(`✓ ${t.name} (${t.size}×${t.size}${t.mask ? ", maskable" : ""})`);
  } catch (err) {
    failed = true;
    console.error(`✗ ${t.name}: ${err instanceof Error ? err.message : err}`);
  }
}

if (failed) process.exit(1);
