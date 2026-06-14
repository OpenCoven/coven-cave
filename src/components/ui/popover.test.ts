// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./popover.tsx", import.meta.url), "utf8");

// The popover must consume its own Escape: a capture-phase keydown listener that
// stopPropagation()s before the event reaches a parent dialog's bubble-phase
// handler (e.g. Settings, which closes itself on Escape). Without this, one Esc
// closes both the popover AND the surrounding Settings panel.
assert.match(src, /if \(e\.key === "Escape"\)/, "popover handles Escape");
assert.match(src, /e\.stopPropagation\(\)/, "popover stops Escape from propagating to parent handlers");
assert.match(src, /addEventListener\("keydown", onKey, true\)/, "popover keydown listens in the capture phase");
assert.match(src, /removeEventListener\("keydown", onKey, true\)/, "popover keydown cleanup matches the capture phase");

console.log("popover.test.ts: ok");
