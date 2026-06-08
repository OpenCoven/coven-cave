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

// 2. SalemWidget exists and wires the cat + chat panel + API
const widget = await readFile(path.join(root, "src/components/salem/salem-widget.tsx"), "utf8");
assert.match(widget, /SalemCat3D/, "widget must embed SalemCat3D");
assert.match(widget, /\/api\/salem/, "widget must call /api/salem");
assert.match(widget, /perch.*open.*expanded/s, "widget must have three states");
assert.match(widget, /setState\("perch"\)/, "widget must be dismissable back to perch");

// 3. Salem API route exists
const route = await readFile(path.join(root, "src/app/api/salem/route.ts"), "utf8");
assert.match(route, /POST/, "must export POST handler");
assert.match(route, /familiar|familiar/, "must know about familiars");
assert.match(route, /role|Role/, "must know about roles");
assert.match(route, /plugin|Plugin/, "must know about plugins");

// 4. Layout mounts Salem
const layout = await readFile(path.join(root, "src/app/layout.tsx"), "utf8");
assert.match(layout, /SalemWidget/, "layout must mount SalemWidget");
assert.match(layout, /from "@\/components\/salem\/salem-widget"/, "layout must import from salem dir");

// 5. CSS classes present
const css = await readFile(path.join(root, "src/app/globals.css"), "utf8");
assert.match(css, /\.salem-perch/, "must have .salem-perch CSS");
assert.match(css, /\.salem-panel/, "must have .salem-panel CSS");
assert.match(css, /\.salem-msg/, "must have .salem-msg CSS");
assert.match(css, /position:\s*fixed/, "salem perch must be position fixed");

console.log("✅  Salem guard tests passed (5 sections, 16 assertions)");
