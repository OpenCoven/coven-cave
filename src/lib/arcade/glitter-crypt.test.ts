// @ts-nocheck
import assert from "node:assert/strict";

import { ARCADE_TAGLINE, ARCADE_TITLE, buildArcadeSrcDoc } from "./glitter-crypt.ts";

assert.equal(typeof ARCADE_TITLE, "string");
assert.ok(ARCADE_TITLE.length > 0, "the arcade names itself");
assert.ok(ARCADE_TAGLINE.length > 0, "the arcade describes itself for surfaces that offer it");

const doc = buildArcadeSrcDoc();

assert.match(doc, /^<!doctype html>/i, "is a full document");
assert.match(doc, /<canvas id="view"/, "renders into a canvas");
assert.ok(doc.includes(ARCADE_TITLE), "the document carries the arcade title");

// The whole point of the module: one self-contained string. A network fetch or
// an external asset would defeat both the sandbox story and instant startup.
assert.doesNotMatch(doc, /<script src=/i, "loads no external script");
assert.doesNotMatch(doc, /<link /i, "loads no external stylesheet");
assert.doesNotMatch(doc, /https?:\/\//i, "references no remote origin");
assert.doesNotMatch(doc, /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource/, "makes no network call");
assert.doesNotMatch(doc, /localStorage|sessionStorage|indexedDB|document\.cookie/, "persists nothing");

// It plays OVER a live voice call, so it must never make a sound and never
// reach for the microphone.
assert.doesNotMatch(
  doc,
  /AudioContext|webkitAudioContext|new Audio|<audio|getUserMedia|speechSynthesis/,
  "never touches audio or the microphone",
);

// Reduced motion is a real switch, not decoration.
const motionOn = buildArcadeSrcDoc({ reducedMotion: false });
const motionOff = buildArcadeSrcDoc({ reducedMotion: true });
assert.match(motionOn, /__ARCADE_REDUCED_MOTION__ = false/, "motion defaults on");
assert.match(motionOff, /__ARCADE_REDUCED_MOTION__ = true/, "reduced motion is threaded into the document");
assert.match(buildArcadeSrcDoc(), /__ARCADE_REDUCED_MOTION__ = false/, "omitted options mean full motion");
assert.match(
  doc,
  /REDUCED \? 0 : Math\.round\(shake/,
  "screen shake is the first thing reduced motion drops",
);

// A raycaster with no depth buffer draws sprites through walls; keep the
// occlusion test wired to the same corrected depth the walls write.
assert.match(doc, /zbuffer\[col\] = depth/, "wall depth is recorded per column");
assert.match(doc, /if \(zbuffer\[col\] < dist \* Math\.cos\(angle\)\) continue/, "sprites test against it");

// Controls have to be discoverable: the opening veil is the only place that
// explains them.
for (const key of ["W", "A", "S", "D", "Space"]) {
  assert.ok(doc.includes(`<kbd>${key}</kbd>`), `the opening veil documents ${key}`);
}
assert.match(doc, /data-hold="fire"/, "coarse pointers get a fire control");
assert.match(doc, /@media \(pointer: coarse\)/, "touch controls stay off for mouse users");

// Accessibility: the canvas and the live HUD both have to be nameable.
assert.match(doc, /aria-label="Glitter Crypt game view"/, "the canvas is named");
assert.match(doc, /hearts remaining/, "the heart count is announced, not just glyphs");

// Spawn distance is a feel constraint with a floor AND a ceiling: too close is
// an ambush the player cannot answer, too far is dead seconds spent watching a
// wisp walk across the map. Asserted against the source because the live
// distance starts drifting the moment anything moves.
assert.match(
  doc,
  /if \(away < 4\.5 \|\| away > 9\) continue;/,
  "wisps spawn inside a bounded band — never on top of the player, never a dull walk away",
);
