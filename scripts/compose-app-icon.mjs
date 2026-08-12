// Compose the app-icon source from the brand crown mark.
//
// The brand asset is a full-bleed white-glyph-on-black square. The app icon
// convention in this repo (src-tauri/icons/icon.png) is different and must be
// preserved: a rounded-rect black tile with TRANSPARENT corners, glyph filling
// ~78% of the canvas. Dropping the raw brand square in would put a hard-edged
// black tile in the macOS Dock and shrink the mark to ~55%.
//
// Usage: node compose-icon.mjs <brand.png> <out-icon.png> <out-tray-source.png>
import sharp from "sharp";

const [brand, outIcon, outTray] = process.argv.slice(2);
if (!brand || !outIcon || !outTray) {
  console.error("usage: compose-icon.mjs <brand.png> <out-icon.png> <out-tray-source.png>");
  process.exit(1);
}

const SIZE = 1024;
// Apple's squircle is ~22.37% of the side; the existing icon reads as ~180/1024.
const RADIUS = Math.round(SIZE * 0.2237);
const GLYPH_FRACTION = 0.78;

// Trim the brand square's black field down to the glyph's own bounding box so
// the scale below is measured against the MARK, not the artwork's padding.
const glyph = await sharp(brand)
  .trim({ background: "#000000", threshold: 10 })
  .toBuffer({ resolveWithObject: true });

console.log(`glyph bbox after trim: ${glyph.info.width}x${glyph.info.height}`);

const target = Math.round(SIZE * GLYPH_FRACTION);
const scaled = await sharp(glyph.data)
  .resize(target, target, { fit: "inside", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .toBuffer({ resolveWithObject: true });

// Black rounded tile, transparent outside the radius — matches the current icon.
const tile = Buffer.from(
  `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect x="0" y="0" width="${SIZE}" height="${SIZE}" rx="${RADIUS}" ry="${RADIUS}" fill="#000000"/>` +
    `</svg>`,
);

// The trimmed glyph still carries its own black field; compositing it onto the
// black tile blends seamlessly, so no alpha keying of the mark is needed.
await sharp(tile)
  .composite([
    {
      input: scaled.data,
      left: Math.round((SIZE - scaled.info.width) / 2),
      top: Math.round((SIZE - scaled.info.height) / 2),
    },
  ])
  .png({ compressionLevel: 9 })
  .toFile(outIcon);

// The tray pipeline documents its source as "white glyph on black" and crops to
// the glyph itself, so the brand square is already the right shape for it —
// only the dimensions need normalising.
await sharp(brand).resize(1024, 1024, { fit: "cover" }).png({ compressionLevel: 9 }).toFile(outTray);

const iconMeta = await sharp(outIcon).metadata();
const trayMeta = await sharp(outTray).metadata();
console.log(`wrote ${outIcon} ${iconMeta.width}x${iconMeta.height} alpha=${iconMeta.hasAlpha}`);
console.log(`wrote ${outTray} ${trayMeta.width}x${trayMeta.height} alpha=${trayMeta.hasAlpha}`);
