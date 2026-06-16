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

console.log("familiar-avatar.test.ts: ok");
