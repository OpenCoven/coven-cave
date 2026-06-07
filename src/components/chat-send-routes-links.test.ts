// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../app/api/chat/send/route.ts", import.meta.url), "utf8");

assert.match(source, /import \{ extractLinks \} from "@\/lib\/link-extractor"/,
  "chat/send imports extractLinks");
assert.match(source, /import \{ routeLinkHandler \} from "@\/app\/api\/library\/route-link\/route"/,
  "chat/send imports routeLinkHandler");
assert.match(source, /extractLinks\(\s*prompt\s*\)/,
  "chat/send extracts links from the prompt");
assert.match(source, /try\s*\{[\s\S]*?routeLinkHandler/,
  "routeLinkHandler call wrapped in try/catch");
assert.match(source, /kind: "chat"/,
  "uses chat source kind");

console.log("chat-send-routes-links: 5 assertions passed");
