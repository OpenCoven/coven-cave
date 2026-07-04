// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./project-avatar.tsx", import.meta.url), "utf8");

assert.match(source, /export function ProjectAvatar/, "Must export ProjectAvatar");
assert.match(source, /useProjectImages\(\)/, "Must read the project image store");
assert.match(source, /normalizeProjectRoot/, "Image lookup must normalize the root key");
assert.match(source, /projectMonogram/, "Monogram fallback must reuse the comux helper");
assert.match(source, /projectTint/, "Tint fallback must reuse the comux helper");
assert.match(source, /onError/, "img must fall back to the monogram tile on load error");
assert.match(source, /aria-hidden/, "decorative — adjacent text carries the project name");
assert.match(source, /color \?\?/, "explicit project color must win over the root tint");

console.log("project-avatar.test.ts: ok");
