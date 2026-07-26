// @ts-nocheck
// Wiring pins: skill stage visibility (cave-fpqx.11) — markers render as
// in-thread cards on BOTH streaming and settled paths, and /skill invocations
// get a deterministic card under the user turn.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const card = readFileSync(new URL("./skill-stage-card.tsx", import.meta.url), "utf8");

assert.match(
  chatView,
  /import \{ extractSkillMarkers, parseSkillInvocation \} from "@\/lib\/skill-blocks"/,
  "chat-view imports the skill-blocks lib",
);
assert.match(
  chatView,
  /const skillSplit = extractSkillMarkers\(ghSafeVisible\);/,
  "skill markers extract on both streaming and settled paths (live stage while the agent works)",
);
assert.match(
  chatView,
  /extractNextPaths\(skillSplit\.visible\)/,
  "downstream text flows from the skill-stripped visible — raw markers never render",
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
