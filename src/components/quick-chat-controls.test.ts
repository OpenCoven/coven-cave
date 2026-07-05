// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./quick-chat-controls.tsx", import.meta.url), "utf8");

assert.match(source, /StandardSelect/, "quick-chat select helper should delegate to StandardSelect");
assert.doesNotMatch(source, /PopoverBody|PopoverItem|anchorRef|useState\(false\)/, "quick-chat select helper should not maintain its own popover implementation");
assert.match(source, /renderValue=/, "quick-chat select helper should keep its compact trigger rendering through StandardSelect");

console.log("quick-chat-controls.test.ts OK");
