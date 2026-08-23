import assert from "node:assert/strict";
import test from "node:test";
import { buildReplySnippet } from "./chat-reply.ts";
import {
  chatTurnVisibleText,
  extractChatRenderedText,
} from "./chat-rendered-text.ts";
import { findTranscriptHits } from "./transcript-find.ts";
import { slicePreviewBlocks } from "./preview-blocks.ts";
import {
  MAX_RESEARCH_RUN_STEPS,
  extractResearchRunMarkers,
  parseResearchRunPreviewUrl,
  researchMissionToRunSurface,
} from "./research-run-surface.ts";
import type { ResearchMission } from "./research-missions.ts";

const CONTROL_HEAVY_ASSISTANT_TEXT = [
  "```coven:attachment",
  '{ "path": "/workspace/report.txt" }',
  "```",
  "<thinking>private chain of thought</thinking>",
  "The ordinary visible answer remains.",
  '<coven:research run-id="research-42" title="Dependency research" status="running" activity="Reviewing incidents" step="2" total="5" reviewed="12" cited="3" />',
  '<coven:skill name="research" stage="done" />',
  '<coven:auto-status state="done" />',
  '<coven:attention reason="decision" />',
  "<coven:next-paths>",
  "- [reply] Hidden follow-up",
  "</coven:next-paths>",
  '<coven:github kind="issue" repo="OpenCoven/coven-cave" number="42" />',
  '<coven:image src="/api/chat/attachment?id=preview.png" />',
  '<coven:preview url="http://127.0.0.1:3000/demo" title="Demo" />',
].join("\n");

test("rendered assistant text keeps prose while removing every non-prose control", () => {
  const result = extractChatRenderedText(CONTROL_HEAVY_ASSISTANT_TEXT);

  assert.equal(result.visible.trim(), "The ordinary visible answer remains.");
  assert.equal(result.inlineReasoning, "private chain of thought");
  assert.equal(result.researchRuns.length, 1);
  assert.equal(result.researchRuns[0]?.runId, "research-42");
  assert.equal(result.researchRuns[0]?.activity, "Reviewing incidents");
  assert.deepEqual(result.skillUpdates, [{ name: "research", stage: "done" }]);
  assert.deepEqual(result.autoStatusUpdate, { state: "done" });
  assert.deepEqual(result.attentionRequest, { reason: "decision" });
  assert.deepEqual(result.nextPaths, [
    {
      kind: "reply",
      label: "Hidden follow-up",
      prompt: "Hidden follow-up",
      recommended: false,
    },
  ]);
  assert.match(result.cardText, /<coven:github/);
  assert.match(result.cardText, /<coven:image/);
  assert.match(result.cardText, /<coven:preview/);
  assert.match(result.cardText, /__coven\/research\/research-42/);
  assert.doesNotMatch(result.visible, /coven:research/);
  assert.doesNotMatch(result.cardText, /coven:research/);
});

test("find and reply projections cannot expose assistant control markers", () => {
  const turn = {
    id: "assistant-1",
    role: "assistant" as const,
    text: CONTROL_HEAVY_ASSISTANT_TEXT,
    pending: false,
  };
  const visible = chatTurnVisibleText(turn);

  assert.equal(findTranscriptHits([{ ...turn, text: visible }], "attention").length, 0);
  assert.equal(findTranscriptHits([{ ...turn, text: visible }], "research-42").length, 0);
  assert.equal(findTranscriptHits([{ ...turn, text: visible }], "ordinary").length, 1);
  assert.equal(buildReplySnippet(visible), "The ordinary visible answer remains.");
});

test("attention fragments use pending extraction only while a turn is streaming", () => {
  const possibleMarker = 'Visible before <coven:attention reason="decision>AFTER';

  assert.equal(
    chatTurnVisibleText({ role: "assistant", text: possibleMarker, pending: true }),
    "Visible before ",
  );
  assert.equal(
    chatTurnVisibleText({ role: "assistant", text: possibleMarker, pending: false }),
    "Visible before AFTER",
  );
  assert.equal(
    chatTurnVisibleText({
      role: "assistant",
      text: '<coven:attention" reason="decision">AFTER',
      pending: false,
    }),
    "AFTER",
  );
});

test("streaming preview fragments never enter visible assistant text", () => {
  for (const text of [
    "Visible before <coven:pre",
    'Visible before <coven:preview url="http://localhost:3000',
  ]) {
    const rendered = extractChatRenderedText(text, { pending: true });
    assert.equal(rendered.visible, "Visible before ");
    assert.equal(rendered.cardText, "Visible before ");
  }
});

test("streaming research fragments never enter visible assistant text", () => {
  const rendered = extractChatRenderedText(
    'Visible before <coven:research run-id="run-1" title="Dependency',
    { pending: true },
  );
  assert.equal(rendered.visible, "Visible before ");
  assert.equal(rendered.cardText, "Visible before ");
  assert.deepEqual(rendered.researchRuns, []);
});

test("every possible streamed research marker prefix stays hidden", () => {
  for (const fragment of ["<", "<c", "<co", "<coven:r", "<coven:research"]) {
    const rendered = extractChatRenderedText(`Visible before ${fragment}`, { pending: true });
    assert.equal(rendered.visible, "Visible before ", fragment);
    assert.equal(rendered.cardText, "Visible before ", fragment);
  }
});

test("research marker stage expansion is explicitly bounded", () => {
  const within = extractResearchRunMarkers(
    `<coven:research run-id="bounded" title="Bounded" status="running" step="1" total="${MAX_RESEARCH_RUN_STEPS}" />`,
  );
  assert.equal(within.runs[0]?.steps.length, MAX_RESEARCH_RUN_STEPS);

  const over = extractResearchRunMarkers(
    `<coven:research run-id="too-large" title="Too large" status="running" step="1" total="${MAX_RESEARCH_RUN_STEPS + 1}" />`,
  );
  assert.deepEqual(over.runs[0]?.steps, []);
});

test("research preview bridge preserves the complete provider snapshot", () => {
  const rendered = extractChatRenderedText(CONTROL_HEAVY_ASSISTANT_TEXT);
  const preview = slicePreviewBlocks(rendered.cardText).find((piece) => piece.kind === "preview" && piece.preview.url.includes("/__coven/research/"));
  assert.ok(preview && preview.kind === "preview");
  const snapshot = parseResearchRunPreviewUrl(preview.preview.url);
  assert.equal(snapshot?.runId, rendered.researchRuns[0]?.runId);
  assert.equal(snapshot?.title, rendered.researchRuns[0]?.title);
  assert.equal(snapshot?.status, rendered.researchRuns[0]?.status);
  assert.equal(snapshot?.activity, "Reviewing incidents");
  assert.equal(snapshot?.steps.length, 5);
  assert.deepEqual(snapshot?.evidence, { reviewed: 12, cited: 3 });
});

test("user and system text remains unchanged", () => {
  const text = '<coven:attention reason="decision" /> ordinary text';
  assert.equal(chatTurnVisibleText({ role: "user", text }), text);
  assert.equal(chatTurnVisibleText({ role: "system", text }), text);
});

test("fenced reasoning tags stay literal in rendered text", () => {
  const text = [
    "```xml",
    "<thinking>literal example</thinking>",
    "```",
    "<thinking>private plan</thinking>",
    "Visible answer.",
  ].join("\n");

  const result = extractChatRenderedText(text);
  assert.equal(
    result.visible,
    "```xml\n<thinking>literal example</thinking>\n```\n\nVisible answer.",
  );
  assert.equal(result.inlineReasoning, "private plan");
});

test("renderer-code fence quirks keep attention examples literal in rendered text", () => {
  const listText = [
    "- ```xml",
    "  example",
    "  ```",
    '<coven:attention reason="decision" />',
  ].join("\n");
  const listed = extractChatRenderedText(listText);
  assert.equal(listed.visible, "- ```xml\n  example\n  ```\n");
  assert.equal(listed.cardText, "- ```xml\n  example\n  ```\n");
  assert.deepEqual(listed.attentionRequest, { reason: "decision" });

  const quotedText = [
    "> ```x",
    "> ````",
    '> <coven:attention reason="approval" />',
    "> ```",
  ].join("\n");
  const quoted = extractChatRenderedText(quotedText);
  assert.equal(quoted.visible, quotedText);
  assert.equal(quoted.cardText, quotedText);
  assert.equal(quoted.attentionRequest, null);
});

test("rendered assistant text strips result markers and exposes familiar-authored results", () => {
  const text = [
    "Checks complete.",
    '<coven:result id="tests" state="passed" label="Focused tests passed" />',
  ].join("\n");

  const result = extractChatRenderedText(text);

  assert.equal(result.visible.trimEnd(), "Checks complete.");
  assert.equal(result.cardText.trimEnd(), "Checks complete.");
  assert.deepEqual(result.authoredResults, [
    { id: "tests", state: "passed", label: "Focused tests passed", source: "familiar" },
  ]);
  assert.doesNotMatch(result.visible, /coven:result/);
  assert.doesNotMatch(result.cardText, /coven:result/);
});

test("rendered assistant text keeps later authored results visible after backticks inside prior markers", () => {
  const text = [
    "Checks complete.",
    '<coven:result id="tests" state="passed" label="`" />',
    '<coven:result id="lint" state="running" label="Lint running" />',
  ].join("\n");

  const result = extractChatRenderedText(text);

  assert.equal(result.visible.trimEnd(), "Checks complete.");
  assert.equal(result.cardText.trimEnd(), "Checks complete.");
  assert.deepEqual(result.authoredResults, [
    { id: "tests", state: "passed", label: "`", source: "familiar" },
    { id: "lint", state: "running", label: "Lint running", source: "familiar" },
  ]);
  assert.doesNotMatch(result.visible, /coven:result/);
  assert.doesNotMatch(result.cardText, /coven:result/);
});

test("research missions project into truthful compact run state", () => {
  const mission = {
    id: "run-1",
    familiarId: "sage",
    title: "Dependency risk",
    mode: "paper",
    harness: "codex",
    model: "gpt-5",
    status: "running",
    sources: [
      { status: "used" },
      { status: "rejected" },
    ],
    artifacts: [{ state: "working" }],
    iterations: [{
      summary: "Reviewing incidents",
      steps: [
        { id: "scope", type: "scope", status: "succeeded" },
        { id: "gather", type: "gather", status: "running", detail: "Reviewing incidents" },
        { id: "synthesize", type: "synthesize", status: "pending" },
      ],
    }],
    createdAt: "2026-08-22T10:00:00.000Z",
    updatedAt: "2026-08-22T10:05:00.000Z",
  } as ResearchMission;

  const run = researchMissionToRunSurface(mission);
  assert.equal(run.runId, "run-1");
  assert.equal(run.status, "running");
  assert.equal(run.activity, "Reviewing incidents");
  assert.equal(run.runtime, "codex · gpt-5");
  assert.deepEqual(run.steps.map((step) => step.status), ["completed", "active", "pending"]);
  assert.deepEqual(run.evidence, {
    sources: 2,
    retained: 1,
    rejected: 1,
    artifacts: 1,
  });
});
