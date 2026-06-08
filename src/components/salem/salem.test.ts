// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, "../../..");

// 1. SalemCat3D exists and uses Three.js
const cat3d = await readFile(path.join(root, "src/components/salem/salem-cat-3d.tsx"), "utf8");
assert.match(cat3d, /from "three"/, "salem-cat-3d must import Three.js");
assert.match(cat3d, /SalemCat3D/, "must export SalemCat3D");
assert.match(cat3d, /SphereGeometry/, "must build a sphere (head/body)");
assert.match(cat3d, /ConeGeometry/, "must build cones (ears)");
assert.match(cat3d, /TubeGeometry/, "must build a tube (tail)");
assert.match(cat3d, /idle.*happy.*thinking.*listening/s, "must handle all four moods");
assert.match(cat3d, /color:\s*0x171520/, "black cat material must retain visible contrast on dark Cave chrome");
assert.match(cat3d, /rimLight.*1\.15/s, "cat must keep a visible purple rim light");

// 2. SalemWidget exists and wires the cat + chat panel + API
const widget = await readFile(path.join(root, "src/components/salem/salem-widget.tsx"), "utf8");
assert.match(widget, /SalemCat3D/, "widget must embed SalemCat3D");
assert.match(widget, /\/api\/salem/, "widget must call /api/salem");
assert.match(widget, /perch.*open.*expanded/s, "widget must have three states");
assert.match(widget, /setState\("perch"\)/, "widget must be dismissable back to perch");
assert.match(widget, /size=\{88\}/, "perch cat must be large enough to read on dark backgrounds");
assert.doesNotMatch(widget, /salem-msg__glyph|🐱|😅/, "open Salem chat must not render emoji glyphs");

// 3. Salem preload context exists
const context = await readFile(path.join(root, "src/components/salem/salem-context.ts"), "utf8");
assert.match(context, /SALEM_PRELOAD_CONTEXT/, "must export Salem preload context");
assert.match(context, /docsCorpus/, "must preload docs corpus context");
assert.match(context, /toolLoadout/, "must preload tool loadout context");
assert.match(context, /skillLoadout/, "must preload skill loadout context");
assert.match(context, /routeContext/, "must preload Cave route context");
assert.match(context, /Ask Molty/, "must preserve Ask Molty docs-agent lineage");
assert.match(context, /Sassy male black cat/, "must preserve Salem's sassy male black cat persona");
assert.match(context, /Sabrina the Teenage Witch/, "must preserve Salem's Sabrina inspiration");
assert.match(context, /he\/him/, "must use he/him pronouns for Salem");

// 4. Salem API route exists
const route = await readFile(path.join(root, "src/app/api/salem/route.ts"), "utf8");
assert.match(route, /POST/, "must export POST handler");
assert.match(route, /GET/, "must expose preloaded context to the widget");
assert.match(route, /SALEM_PRELOAD_CONTEXT/, "must use shared preload context");
assert.match(route, /familiar|familiar/, "must know about familiars");
assert.match(route, /role|Role/, "must know about roles");
assert.match(route, /plugin|Plugin/, "must know about plugins");
assert.match(route, /sassy male black cat/, "must answer with Salem's persona");
assert.doesNotMatch(route, /🐱|😅/, "Salem API replies must stay emoji-free inside chat");

// 5. SalemWidget surfaces preload status
assert.match(widget, /preload/, "widget must load Salem preload metadata");
assert.match(widget, /salem-panel__preload/, "widget must render preload metadata");
assert.match(widget, /Docs|Tools|Skills|Context/, "widget must label loaded docs/tools/skills/context");

// 6. Layout mounts Salem
const layout = await readFile(path.join(root, "src/app/layout.tsx"), "utf8");
assert.match(layout, /SalemWidget/, "layout must mount SalemWidget");
assert.match(layout, /from "@\/components\/salem\/salem-widget"/, "layout must import from salem dir");

// 7. CSS classes present
const css = await readFile(path.join(root, "src/app/globals.css"), "utf8");
assert.match(css, /\.salem-perch/, "must have .salem-perch CSS");
assert.match(css, /\.salem-panel/, "must have .salem-panel CSS");
assert.match(css, /\.salem-msg/, "must have .salem-msg CSS");
assert.match(css, /\.salem-panel__preload/, "must style Salem preload metadata");
assert.match(css, /--background:\s*oklch\(0\.09/, "default dark app background must be lifted for black-cat contrast");
assert.match(css, /\.salem-perch::before/, "Salem perch must include a visibility halo");
assert.doesNotMatch(css, /\.salem-msg__glyph/, "open Salem chat must not keep unused emoji glyph CSS");
assert.match(css, /position:\s*fixed/, "salem perch must be position fixed");

console.log("✅  Salem guard tests passed (7 sections, 37 assertions)");
