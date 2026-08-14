// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../app/api/chat/send/route.ts", import.meta.url), "utf8");

assert.doesNotMatch(source, /@\/lib\/link-extractor|extractLinks\(/,
  "chat/send should not scan chat text for Library saves while Library is on feature/library");
assert.doesNotMatch(source, /@\/app\/api\/library\/route-link\/route|routeLinkHandler|api\/library\/route-link/,
  "chat/send should not import or call Library route-link while Library is isolated");
assert.doesNotMatch(source, /scheduleLinkRoute|route them to the library|routeLink failed/,
  "integrated chat send should not retain Library side-effect routing");

console.log("chat-send-routes-links: ok");
