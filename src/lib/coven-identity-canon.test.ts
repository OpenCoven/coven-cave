// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const canon = await readFile(new URL("./coven-identity-canon.ts", import.meta.url), "utf8");
const chatRoute = await readFile(new URL("../app/api/chat/send/route.ts", import.meta.url), "utf8");
const salemContext = await readFile(new URL("../components/salem/salem-context.ts", import.meta.url), "utf8");
const salemRoute = await readFile(new URL("../app/api/salem/route.ts", import.meta.url), "utf8");

assert.match(canon, /Valentina is the sovereign\/source/, "canon must name Valentina as sovereign/source");
assert.match(canon, /Nova is Queen\/Orchestrator/, "canon must name Nova as Queen/Orchestrator");
assert.match(canon, /binding for every Coven and Coven Cave familiar/, "canon must be categorical");
assert.match(canon, /buildPromptWithCovenIdentityCanon/, "canon helper must wrap prompts");

assert.match(
  chatRoute,
  /buildPromptWithCovenIdentityCanon\([\s\S]*body\.familiarId[\s\S]*\)/,
  "Cave chat prompts must inject Coven identity canon for every familiar",
);

assert.match(
  salemContext,
  /courtCanon/,
  "Salem preload context must expose the Coven court canon",
);
assert.match(
  salemRoute,
  /COVEN_IDENTITY_CANON/,
  "Salem route must use the shared Coven identity canon",
);
assert.match(
  salemRoute,
  /queen|Queen/,
  "Salem static replies must handle queen/court questions",
);

console.log("coven-identity-canon.test.ts: ok");
