// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./project-avatar.tsx", import.meta.url), "utf8");
// The tile rules moved out of globals.css into primitives.css when the shell
// CSS was consolidated (cave-ii7xi / #4758) — pin them where they live now.
const css = readFileSync(new URL("../styles/globals/primitives.css", import.meta.url), "utf8");

assert.match(source, /export function ProjectAvatar/, "Must export ProjectAvatar");
assert.match(source, /useProjectImages\(\)/, "Must read the project image store");
assert.match(source, /normalizeProjectRoot/, "Image lookup must normalize the root key");
assert.match(source, /projectMonogram/, "Monogram fallback must reuse the comux helper");
assert.match(source, /projectTint/, "Tint fallback must reuse the comux helper");
assert.match(source, /onError/, "img must fall back to the monogram tile on load error");
assert.match(source, /aria-hidden/, "decorative — adjacent text carries the project name");
assert.match(source, /color \?\?/, "explicit project color must win over the root tint");

// cave-ocy8: clicking a project avatar enlarges it. The expandable path reuses
// the shared AvatarLightbox (same focus-trapped Modal as every avatar surface)
// and only activates when an uploaded image is present — a monogram tile has
// nothing to enlarge and must stay inert.
assert.match(source, /expandable\?: boolean;/, "ProjectAvatar accepts an expandable flag");
assert.match(source, /import \{ AvatarLightbox \} from "\.\/ui\/avatar-lightbox"/, "expandable path reuses the shared lightbox primitive");
assert.match(
  source,
  /if \(expandable && hasImage\) \{[\s\S]*?<AvatarLightbox src=\{image!\.dataUrl\} label=\{name\} category="Project"/,
  "clicking an imaged project avatar opens its full-size lightbox",
);
assert.doesNotMatch(
  source,
  /AvatarLightbox[\s\S]{0,600}project-avatar__monogram/,
  "monogram fallback must not be wrapped in the lightbox — nothing to enlarge",
);
assert.match(css, /\.project-avatar\s*\{[\s\S]*?flex:\s*0 0 var\(--pa-size/, "avatar keeps a fixed flex basis");
assert.match(css, /\.project-avatar\s*\{[\s\S]*?min-width:\s*var\(--pa-size/, "avatar width does not collapse below its configured size");
assert.match(css, /\.project-avatar\s*\{[\s\S]*?max-width:\s*var\(--pa-size/, "avatar width does not expand past its configured size");

console.log("project-avatar.test.ts: ok");
