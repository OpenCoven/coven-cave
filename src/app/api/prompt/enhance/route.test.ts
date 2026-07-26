// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(source, /export async function POST\(req: Request\)/, "prompt enhance route should expose POST");
assert.match(source, /buildPromptEnhancement/, "route should delegate enhancement to the pure helper");
assert.match(source, /draft: body\.draft/, "route should pass the draft through unchanged to the helper");
assert.match(source, /mode: body\.mode/, "route should pass mode through to the helper");
assert.match(source, /context: body\.context/, "route should pass context through to the helper");
assert.match(source, /status: 400/, "route should reject empty drafts as a bad request");

console.log("prompt enhance route.test.ts: ok");
