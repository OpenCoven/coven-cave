#!/usr/bin/env python3
"""Regenerate the menu-bar/tray logo from the 1024px app-icon source.

Extracts the white Coven fox-and-trident mark from
src-tauri/icons/icon-source-1024.png (white glyph on black), crops it to its
bounding box, and renders a 36x36 (18pt @2x — macOS scales tray icons to an
18pt logical height) white+alpha mark:

- src-tauri/icons/tray-icon-36.rgba      raw RGBA embedded via include_bytes!
                                         in coven_tray_icon() (src-tauri/src/lib.rs)
- src-tauri/icons/tray-icon-macos@2x.png the same pixels as a viewable PNG

Requires Pillow: python3 -m pip install Pillow
"""

from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "src-tauri" / "icons"
SIZE = 36

src = Image.open(ICONS / "icon-source-1024.png").convert("RGBA")
# White glyph on black: luminance gated by alpha becomes the mask.
mask = ImageChops.multiply(src.convert("L"), src.getchannel("A"))
# Kill faint compression noise while keeping anti-aliased glyph edges.
mask = mask.point(lambda p: 0 if p < 96 else p)
glyph = mask.crop(mask.getbbox())

w, h = glyph.size
side = max(w, h)
pad = int(side * 0.04)
canvas = Image.new("L", (side + 2 * pad, side + 2 * pad), 0)
canvas.paste(glyph, ((canvas.width - w) // 2, (canvas.height - h) // 2))
alpha = canvas.resize((SIZE, SIZE), Image.LANCZOS)

# White fill + glyph alpha: macOS treats it as a template image (alpha only);
# the white fill keeps dark Windows/Linux trays legible.
out = Image.new("RGBA", (SIZE, SIZE), (255, 255, 255, 0))
out.putalpha(alpha)

(ICONS / "tray-icon-36.rgba").write_bytes(out.tobytes())
out.save(ICONS / "tray-icon-macos@2x.png", optimize=True)
print(f"wrote tray-icon-36.rgba ({SIZE * SIZE * 4} bytes) and tray-icon-macos@2x.png")
