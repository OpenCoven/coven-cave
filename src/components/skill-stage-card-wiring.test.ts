// @ts-nocheck
// Wiring pins: skill stage visibility (cave-fpqx.11) — markers render as
// in-thread cards on BOTH streaming and settled paths, and /skill invocations
// get a deterministic card under the user turn.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const card = readFileSync(new URL("./skill-stage-card.tsx", import.meta.url), "utf8");
const renderedText = readFileSync(new URL("../lib/chat-rendered-text.ts", import.meta.url), "utf8");

assert.match(
  chatView,
  /import \{ parseSkillInvocation \} from "@\/lib\/skill-blocks"/,
  "chat-view imports the skill-blocks lib",
);
assert.match(
  renderedText,
  /const skillSplit = extractSkillMarkers\(reasoningSplit\.visible\);/,
  "the shared projection extracts skill markers on both streaming and settled paths",
);
// Pinned as a flow, not a call site: marker extractors keep being inserted
// between the skill split and next-paths (auto-mission status was the last),
// so naming `extractNextPaths(skillSplit.visible)` goes stale every time. What
// must hold is that the skill-stripped visible feeds the rest of the chain and
// that next-paths never runs on text still carrying skill markers.
assert.match(
  renderedText,
  /const skillSplit = extractSkillMarkers\(reasoningSplit\.visible\);[\s\S]{0,300}extractAutoStatusMarkers\(skillSplit\.visible\)/,
  "downstream text flows from the skill-stripped visible — raw markers never render",
);
assert.doesNotMatch(
  renderedText,
  /extractNextPaths\((?:text|reasoningSplit\.visible)\)/,
  "next-paths never runs on text upstream of the skill split",
);
assert.match(chatView, /<SkillStageCard key=\{u\.name\} name=\{u\.name\} stage=\{u\.stage\} note=\{u\.note\} \/>/, "assistant turns render one card per skill name");
assert.match(
  chatView,
  /const skillInvocation = turn\.role === "user" \? parseSkillInvocation\(turn\.text\) : null;/,
  "/skill invocations detect deterministically on user turns only",
);
assert.match(chatView, /stage="invoked"/, "deterministic invocation card renders in the invoked state");

// Card contract.
assert.match(card, /role="status"/, "card announces stage changes to assistive tech");
assert.match(card, /data-skill-stage=\{stage\}/, "stage is machine-readable for styling/e2e");

console.log("skill stage card wiring: ok");
