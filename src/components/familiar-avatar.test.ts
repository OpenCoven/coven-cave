// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./familiar-avatar.tsx", import.meta.url), "utf8");

assert.match(source, /export function FamiliarAvatar/, "Must export FamiliarAvatar");
assert.match(source, /familiar/, "Must accept a familiar prop");
assert.match(source, /size/, "Must accept a size prop");
assert.match(source, /avatarImage/, "Must consume the avatarImage field");
assert.match(source, /FamiliarGlyph/, "Must fall back to FamiliarGlyph when no image");
assert.match(source, /<img/, "Must render an <img> for image avatars");
assert.match(source, /alt=/, "img must have alt text for a11y");

// On a failed image load, fall back to the glyph instead of leaving the
// browser's broken-image placeholder (the avatar route's 404 contract relies
// on this). The <img> must carry an onError that flips to the fallback, and
// the render must be gated on that error state.
assert.match(source, /onError=\{\(\) => setErrored\(true\)\}/, "img must fall back on load error");
assert.match(source, /familiar\.avatarImage && !errored/, "render must gate the img on the not-errored state");
assert.match(source, /useEffect\(\s*\(\) => \{\s*setErrored\(false\);\s*\}, \[familiar\.avatarImage\]\)/, "error state must reset when the avatar src changes");

console.log("familiar-avatar.test.ts: ok");
