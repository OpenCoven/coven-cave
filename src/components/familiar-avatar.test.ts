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

// The avatar image is preferred over the glyph, and EVERY image source is tried
// before the glyph: a failed load advances through the source list (workspace
// avatar → Cave-local upload) and only renders the glyph once all sources fail.
assert.match(source, /avatarImageFallback/, "must consume the fallback image source");
assert.match(source, /onError=\{\(\) => setSrcIdx\(\(i\) => i \+ 1\)\}/, "img must advance to the next source on load error");
assert.match(source, /const hasImage = Boolean\(currentSrc\)/, "render must gate the img on a resolvable current source");
assert.match(source, /useEffect\(\s*\(\) => \{\s*setSrcIdx\(0\);\s*\}, \[familiar\.avatarImage, familiar\.avatarImageFallback\]\)/, "source index must reset when either avatar src changes");

console.log("familiar-avatar.test.ts: ok");
