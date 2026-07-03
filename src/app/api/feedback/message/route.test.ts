// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("./route.ts", import.meta.url), "utf8");

assert.match(route, /export async function POST/, "POST handler");
assert.doesNotMatch(route, /export async function GET/, "no read endpoint (local-only traces)");
assert.match(route, /NextResponse\.json/, "returns JSON");
assert.match(route, /recordMessageFeedback\(/, "records via the local store");
assert.match(route, /invalid json/i, "guards invalid JSON");
assert.match(route, /status:\s*400/, "rejects invalid input/JSON with 400");
assert.doesNotMatch(route, /\bfetch\(|spawn\(|https?:/i, "feedback never leaves the machine");

console.log("feedback/message route test: ok");
