// @ts-nocheck
// Wiring pins: skill stage visibility (cave-fpqx.11) — markers render as
// in-thread cards on BOTH streaming and settled paths, and /skill invocations
// get a deterministic card under the user turn.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const card = readFileSync(new URL("./skill-stage-card.tsx", import.meta.url), "utf8");
const renderedText = readFileSync(new URL("../lib/chat-rendered-text.ts", import.meta.url), "utf8");
const renderedTextSource = ts.createSourceFile(
  "chat-rendered-text.ts",
  renderedText,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

function assignedPipelineCall(variableName: string, calleeName: string): ts.CallExpression {
  const matches: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === variableName
      && node.initializer
    ) {
      const findCall = (child: ts.Node) => {
        if (
          ts.isCallExpression(child)
          && ts.isIdentifier(child.expression)
          && child.expression.text === calleeName
        ) {
          matches.push(child);
        }
        ts.forEachChild(child, findCall);
      };
      findCall(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(renderedTextSource);
  assert.equal(matches.length, 1, `${variableName} must be assigned exactly once from ${calleeName}`);
  return matches[0];
}

assert.match(
  chatView,
  /import \{ parseSkillInvocation \} from "@\/lib\/skill-blocks"/,
  "chat-view imports the skill-blocks lib",
);
const skillRanges = assignedPipelineCall(
  "skillRanges",
  "resultAwareRangeInputs",
);
const skillSplit = assignedPipelineCall("skillSplit", "extractSkillMarkers");
assert.deepEqual(
  skillRanges.arguments.map((argument) => argument.getText(renderedTextSource)),
  ["context", "hasSkillCandidate"],
  "skill opacity is derived lazily from the shared current-source context",
);
assert.deepEqual(
  skillSplit.arguments.map((argument) => argument.getText(renderedTextSource)),
  [
    "context.text",
    "skillRanges.markdownRangeSource",
    "skillRanges.protectedRanges",
  ],
  "skill extraction receives current text plus the context's exact result-protection outputs",
);
// Pinned as a flow, not a call site: marker extractors keep being inserted
// between the skill split and next-paths (auto-mission status was the last),
// so naming `extractNextPaths(skillSplit.visible)` goes stale every time. What
// must hold is that the skill-stripped visible feeds the rest of the chain and
// that next-paths never runs on text still carrying skill markers.
assert.equal(
  assignedPipelineCall("autoStatusSplit", "extractAutoStatusMarkers").arguments[0]?.getText(
    renderedTextSource,
  ),
  "context.text",
  "downstream text flows through the context after skill markers are stripped",
);
assert.match(
  renderedText,
  /context\.setText\(skillSplit\.visible\);[\s\S]*const hasAutoStatusCandidate/,
  "the skill-stripped source updates the context before downstream extraction",
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
