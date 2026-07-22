// @ts-nocheck
import assert from "node:assert/strict";
import { SLASH_COMMANDS, matchSlash, canonicalize } from "./slash-commands.ts";

const canvas = SLASH_COMMANDS.find((c) => c.name === "/canvas");
assert.ok(canvas, "/canvas is registered");
assert.ok(canvas.argPlaceholder, "/canvas advertises an argument");
assert.ok(matchSlash("/can").some((c) => c.name === "/canvas"), "/can autocompletes to /canvas");
assert.equal(canonicalize("/canvas"), "/canvas", "/canvas canonicalizes to itself");

const image = SLASH_COMMANDS.find((c) => c.name === "/image");
assert.ok(image, "/image is registered");
assert.ok(image.argPlaceholder, "/image advertises an argument");
assert.equal(image.section, "chat", "/image lives in the chat section");
assert.ok(matchSlash("/ima").some((c) => c.name === "/image"), "/ima autocompletes to /image");
assert.equal(canonicalize("/img"), "/image", "/img aliases to /image");
assert.equal(canonicalize("/imagine"), "/image", "/imagine aliases to /image");

console.log("slash-commands /canvas: ok");
