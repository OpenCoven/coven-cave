// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./familiar-avatar.tsx", import.meta.url), "utf8");

assert.match(source, /export function FamiliarAvatar/, "Must export FamiliarAvatar");
assert.match(source, /familiar/, "Must accept a familiar prop");
assert.match(source, /size/, "Must accept a size prop");
assert.match(source, /avatarImage/, "Must consume the avatarImage field");
assert.match(source, /avatarPath/, "Must consume the workspace avatarPath field");
assert.match(source, /convertFileSrc/, "Must link to the workspace file via Tauri's asset protocol");
assert.match(source, /__TAURI_INTERNALS__/, "Must guard convertFileSrc behind a Tauri-runtime check");
assert.match(source, /\/api\/familiars\/\$\{encodeURIComponent\(familiar\.id\)\}\/avatar/, "Must keep the avatar route as a universal fallback candidate");
assert.match(source, /onError=/, "Must advance to the next candidate when an avatar src fails to load");
assert.match(source, /FamiliarGlyph/, "Must fall back to FamiliarGlyph when no image");
assert.match(source, /<img/, "Must render an <img> for image avatars");
assert.match(source, /alt=/, "img must have alt text for a11y");

console.log("familiar-avatar.test.ts: ok");
