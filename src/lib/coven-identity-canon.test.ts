// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildCovenIdentityCanonBlock,
  buildPromptWithCovenIdentityCanon,
} from "./coven-identity-canon.ts";

const canon = await readFile(new URL("./coven-identity-canon.ts", import.meta.url), "utf8");
const chatRoute = await readFile(new URL("../app/api/chat/send/route.ts", import.meta.url), "utf8");
const salemContext = await readFile(new URL("../components/salem/salem-context.ts", import.meta.url), "utf8");
const salemRoute = await readFile(new URL("../app/api/salem/route.ts", import.meta.url), "utf8");

assert.match(canon, /Each familiar has a defined lane/, "canon must define per-familiar identity");
assert.match(canon, /IDENTITY\.md.*SOUL\.md|SOUL\.md.*IDENTITY\.md/, "canon must reference identity files");
assert.match(canon, /buildPromptWithCovenIdentityCanon/, "canon helper must wrap prompts");

const novaCanon = buildCovenIdentityCanonBlock(" nova ");
assert.match(novaCanon, /^Coven identity canon:/, "canon block starts with the shared header");
assert.match(novaCanon, /Current familiar: nova\./, "canon block records the selected familiar id");
assert.match(
  buildPromptWithCovenIdentityCanon("ship the docs", "nova"),
  /Current familiar: nova\.\n\nCurrent user message:\nship the docs$/,
  "prompt wrapper preserves the selected familiar before the user message",
);

assert.match(
  chatRoute,
  /buildPromptWithCovenIdentityCanon\([\s\S]*body\.familiarId[\s\S]*\)/,
  "Cave chat prompts must inject Coven identity canon for every familiar",
);

assert.match(
  salemContext,
  /courtCanon|identityCanon|COVEN_IDENTITY_CANON/,
  "Salem preload context must expose the identity canon",
);
assert.match(
  salemRoute,
  /COVEN_IDENTITY_CANON/,
  "Salem route must use the shared Coven identity canon",
);

console.log("coven-identity-canon.test.ts: ok");
