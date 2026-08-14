import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const view = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");

assert.match(
  view,
  /import \{[\s\S]*?chatTurnVisibleText,[\s\S]*?extractChatRenderedText,[\s\S]*?\} from "@\/lib\/chat-rendered-text";/,
  "ChatView imports the shared rendered-text projection",
);
assert.match(
  view,
  /text: chatTurnVisibleText\(t\),/,
  "Find indexes the same visible turn text rendered by ChatView",
);
assert.equal(
  (view.match(/const source = chatTurnVisibleText\(turn\);/g) ?? []).length,
  2,
  "reply snippets and reply eligibility use the shared visible projection",
);
assert.match(
  view,
  /extractChatRenderedText\(turn\.text, \{ pending: Boolean\(turn\.pending\) \}\)/,
  "TurnRow renders through the shared projection with the correct stream state",
);
assert.match(
  view,
  /extractChatRenderedText\(last\.text\)\.nextPaths\.find\(\(path\) => path\.kind === "reply"\) \?\? null/,
  "recommended composer autofill reads reply suggestions from the shared projection",
);
assert.match(
  view,
  /const suggestions = extractChatRenderedText\(last\.text\)\.nextPaths;/,
  "follow-up cards read next-path suggestions from the shared projection",
);

console.log("chat-rendered-text-wiring.test.ts passed");
