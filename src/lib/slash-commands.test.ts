// @ts-nocheck
import assert from "node:assert/strict";
import { SLASH_COMMANDS, matchSlash, canonicalize } from "./slash-commands.ts";

const canvas = SLASH_COMMANDS.find((c) => c.name === "/canvas");
assert.ok(canvas, "/canvas is registered");
assert.ok(canvas.argPlaceholder, "/canvas advertises an argument");
assert.ok(matchSlash("/can").some((c) => c.name === "/canvas"), "/can autocompletes to /canvas");
assert.equal(canonicalize("/canvas"), "/canvas", "/canvas canonicalizes to itself");

console.log("slash-commands /canvas: ok");
