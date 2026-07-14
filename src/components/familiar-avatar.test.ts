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
// The default avatar corner radius tracks the standardized control radius so
// familiar icons match the shared Button/IconButton roundedness.
assert.match(source, /rounded-\[var\(--radius-control\)\]/, "default avatar radius matches the standardized control radius");

// The avatar image is preferred over the glyph, and EVERY image source is tried
// before the glyph: a failed load advances through the source list (workspace
// avatar → Cave-local upload) and only renders the glyph once all sources fail.
assert.match(source, /avatarImageFallback/, "must consume the fallback image source");
assert.match(source, /onError=\{\(\) => setSrcIdx\(\(i\) => i \+ 1\)\}/, "img must advance to the next source on load error");
assert.match(source, /const hasImage = Boolean\(resolvedSrc\)/, "render must gate the img on a resolved authed source");
assert.match(source, /useAuthedImageState\(rawSrc\)/, "current source must resolve through the authed image state");
assert.match(source, /if \(status === "error"\) setSrcIdx\(\(i\) => i \+ 1\);/, "a failed authed fetch must advance to the next source");
assert.match(source, /useEffect\(\s*\(\) => \{\s*setSrcIdx\(0\);\s*\}, \[familiar\.avatarImage, familiar\.avatarImageFallback\]\)/, "source index must reset when either avatar src changes");

// The enlarged preview can carry footer actions (e.g. the inline card's
// "Edit profile" link) — forwarded through to the AvatarLightbox modal.
assert.match(source, /expandFooterActions\?: ReactNode/, "must accept optional expandFooterActions");
assert.match(source, /footerActions=\{expandFooterActions\}/, "must forward expandFooterActions to AvatarLightbox");

console.log("familiar-avatar.test.ts: ok");
