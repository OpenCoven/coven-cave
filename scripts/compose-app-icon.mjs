// Compose the app-icon source from the brand crown mark.
//
// The brand asset is a full-bleed white-glyph-on-black square. The app icon
// convention in this repo (src-tauri/icons/icon.png) is different and must be
// preserved: a rounded-rect black tile with TRANSPARENT corners and the glyph
// inset from the edges. Dropping the raw brand square in would put a hard-edged
// black tile in the macOS Dock and shrink the mark to ~55%.
//
// The glyph is sized by the GEOMETRIC MEAN of its bounding box, not by its
// longest side. Scaling the longest side to a fixed fraction is aspect-blind:
// the same number means "78% tall" for a portrait mark and "78% wide" for a
// landscape one, so swapping marks of different proportions silently resizes
// the icon. That is exactly what happened when the crown replaced the previous
// emblem — the portrait emblem landed 66% wide, the landscape crown 78% wide,
// and the crown lost a third of its side margin without anyone changing a
// number. The geometric mean is invariant to aspect ratio, so GLYPH_FRACTION
// means the same optical size for any mark shape.
//
// Usage: node scripts/compose-app-icon.mjs <brand.png> <out-icon.png> <out-tray-source.png>
import sharp from "sharp";

const [brand, outIcon, outTray] = process.argv.slice(2);
if (!brand || !outIcon || !outTray) {
  console.error("usage: compose-icon.mjs <brand.png> <out-icon.png> <out-tray-source.png>");
  process.exit(1);
}

const SIZE = 1024;
// Apple's squircle is ~22.37% of the side; the existing icon reads as ~180/1024.
const RADIUS = Math.round(SIZE * 0.2237);
// Geometric mean of the glyph bbox as a fraction of the canvas. 0.63 puts the
// crown at a 17.4% side margin and 16.5% ink coverage, matching the emblem it
// replaced (17.2% / 15.5%) — measured, not guessed. Raising this crowds the
// tile: the shipped 0.78-longest-side scaling read as 11.4% / 23.1%.
const GLYPH_FRACTION = 0.63;

// Trim the brand square's black field down to the glyph's own bounding box so
// the scale below is measured against the MARK, not the artwork's padding.
const glyph = await sharp(brand)
  .trim({ background: "#000000", threshold: 10 })
  .toBuffer({ resolveWithObject: true });

console.log(`glyph bbox after trim: ${glyph.info.width}x${glyph.info.height}`);

// Solve for the scale that lands sqrt(w*h) on the requested fraction of the
// canvas, then resize to those exact dimensions. `fit: "fill"` is safe here
// precisely because both sides come from one uniform scale factor, so the
// aspect ratio is preserved by construction rather than by the fit mode.
const glyphGeoMean = Math.sqrt(glyph.info.width * glyph.info.height);
const glyphScale = (SIZE * GLYPH_FRACTION) / glyphGeoMean;
const scaledWidth = Math.round(glyph.info.width * glyphScale);
const scaledHeight = Math.round(glyph.info.height * glyphScale);
const scaled = await sharp(glyph.data)
  .resize(scaledWidth, scaledHeight, { fit: "fill" })
  .toBuffer({ resolveWithObject: true });

console.log(
  `glyph scaled to ${scaled.info.width}x${scaled.info.height} ` +
    `(geometric mean ${(100 * Math.sqrt(scaled.info.width * scaled.info.height) / SIZE).toFixed(1)}% of canvas)`,
);

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
