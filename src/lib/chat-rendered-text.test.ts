import assert from "node:assert/strict";
import test from "node:test";
import { buildReplySnippet } from "./chat-reply.ts";
import {
  chatTurnVisibleText,
  extractChatRenderedText,
} from "./chat-rendered-text.ts";
import {
  RESULT_LABEL_MAX,
  scanChatResultProtocol,
  type ChatResultProtocolScan,
} from "./chat-result-markers.ts";
import { findTranscriptHits } from "./transcript-find.ts";

const CONTROL_HEAVY_ASSISTANT_TEXT = [
  "```coven:attachment",
  '{ "path": "/workspace/report.txt" }',
  "```",
  "<thinking>private chain of thought</thinking>",
  "The ordinary visible answer remains.",
  '<coven:skill name="research" stage="done" />',
  '<coven:auto-status state="done" />',
  '<coven:attention reason="decision" />',
  "<coven:next-paths>",
  "- [reply] Hidden follow-up",
  "</coven:next-paths>",
  '<coven:github kind="issue" repo="OpenCoven/coven-cave" number="42" />',
  '<coven:image src="/api/chat/attachment?id=preview.png" />',
].join("\n");

test("rendered assistant text keeps prose while removing every non-prose control", () => {
  const result = extractChatRenderedText(CONTROL_HEAVY_ASSISTANT_TEXT);

  assert.equal(result.visible.trim(), "The ordinary visible answer remains.");
  assert.equal(result.inlineReasoning, "private chain of thought");
  assert.deepEqual(result.skillUpdates, [{ name: "research", stage: "done" }]);
  assert.deepEqual(result.autoStatusUpdate, { state: "done" });
  assert.deepEqual(result.attentionRequest, { reason: "decision" });
  assert.deepEqual(result.nextPaths, [
    { kind: "reply", label: "Hidden follow-up", prompt: "Hidden follow-up" },
  ]);
  assert.match(result.cardText, /<coven:github/);
  assert.match(result.cardText, /<coven:image/);
});

test("rendered assistant text strips result markers and records authored results", () => {
  const text = [
    "Running checks.",
    '<coven:result id="focused-tests" state="running" label="Focused tests" />',
    '<coven:result id="build" state="passed" label="Production build passed" />',
  ].join("\n");

  const result = extractChatRenderedText(text, { pending: true });

  assert.equal(result.visible, "Running checks.\n\n");
  assert.equal(result.cardText, "Running checks.\n\n");
  assert.deepEqual(result.authoredResults, [
    {
      id: "focused-tests",
      label: "Focused tests",
      state: "running",
      source: "familiar",
    },
    {
      id: "build",
      label: "Production build passed",
      state: "passed",
      source: "familiar",
    },
  ]);
});

test("result-only rendered text scans its source once per projection", () => {
  const scannedSources: string[] = [];
  const scanner = (source: string): ChatResultProtocolScan => {
    scannedSources.push(source);
    return scanChatResultProtocol(source);
  };
  const text = [
    "Running checks.",
    '<coven:result id="focused-tests" state="running" label="Focused tests" />',
  ].join("\n");

  const result = extractChatRenderedText(text, { pending: true }, scanner);

  assert.equal(result.visible, "Running checks.\n");
  assert.deepEqual(scannedSources, [text]);
});

test("rendered text scans each actually transformed source at most once", () => {
  const scannedSources: string[] = [];
  const scanner = (source: string): ChatResultProtocolScan => {
    scannedSources.push(source);
    return scanChatResultProtocol(source);
  };
  const text = [
    "```coven:attachment",
    '{ "path": "/workspace/report.txt" }',
    "```",
    "<thinking>private plan</thinking>",
    '<coven:skill name="research" stage="done" />',
    '<coven:auto-status state="done" />',
    '<coven:result id="build" state="passed" label="Build passed" />',
    "Visible answer.",
  ].join("\n");

  const result = extractChatRenderedText(text, {}, scanner);

  assert.equal(result.visible.trim(), "Visible answer.");
  assert.equal(scannedSources.length, 5);
  assert.equal(
    new Set(scannedSources).size,
    scannedSources.length,
    "the same source must never be scanned twice within one projection",
  );
});

test("malformed family candidates inside a result label share one opaque scan", () => {
  const scannedSources: string[] = [];
  const scanner = (source: string): ChatResultProtocolScan => {
    scannedSources.push(source);
    return scanChatResultProtocol(source);
  };
  const label = [
    "```coven:attachment",
    "<thinking>literal reasoning</thinking>",
    "[debug/path] literal debug line",
    "partial <coven:sk and <coven:a",
  ].join("\n");
  const text =
    `<coven:result id="candidate-label" state="passed" label="${label}" />`;

  const result = extractChatRenderedText(text, { pending: true }, scanner);

  assert.deepEqual(result.authoredResults.map(({ label: value }) => value), [label]);
  assert.deepEqual(scannedSources, [text]);
});

test("result labels keep literal attachment fences exact and inert", () => {
  const label = [
    "Literal attachment example:",
    "```coven:attachment",
    "path: /workspace/literal.png",
    "```",
    "",
    "",
    "Exact tail.",
  ].join("\n");
  const text = [
    "Before.",
    `<coven:result id="attachment-label" state="passed" label="${label}" />`,
    "After.",
  ].join("\n");

  const result = extractChatRenderedText(text);

  assert.deepEqual(result.authoredResults, [
    {
      id: "attachment-label",
      label,
      state: "passed",
      source: "familiar",
    },
  ]);
  assert.doesNotMatch(result.visible, /coven:(?:result|attachment)/);
  assert.match(result.visible, /Before\./);
  assert.match(result.visible, /After\./);
});

test("real attachment controls around a result still extract while the result parses", () => {
  const beforeAttachment = [
    "```coven:attachment",
    "path: /workspace/before.png",
    "```",
  ].join("\n");
  const afterAttachment = [
    "```coven:attachment",
    "path: /workspace/after.png",
    "```",
  ].join("\n");
  const text = [
    beforeAttachment,
    "Before result.",
    '<coven:result id="attachments-around" state="passed" label="Attachments stayed controls" />',
    "After result.",
    afterAttachment,
  ].join("\n");

  const result = extractChatRenderedText(text);

  assert.deepEqual(result.authoredResults, [
    {
      id: "attachments-around",
      label: "Attachments stayed controls",
      state: "passed",
      source: "familiar",
    },
  ]);
  assert.equal(result.visible.trim(), "Before result.\n\nAfter result.");
  assert.doesNotMatch(result.visible, /coven:attachment|workspace\/(?:before|after)/);
});

test("a result marker nested in an attachment payload stays hidden with the attachment", () => {
  const text = [
    "Visible before.",
    "```coven:attachment",
    '<coven:result id="nested-attachment" state="failed" label="Must stay hidden" />',
    "```",
    "Visible after.",
  ].join("\n");

  const result = extractChatRenderedText(text);

  assert.deepEqual(result.authoredResults, []);
  assert.equal(result.visible, "Visible before.\n\nVisible after.");
  assert.doesNotMatch(result.visible, /nested-attachment|coven:/);
});

test("raw attachment syntax counts toward result label bounds in the main projection", () => {
  const embeddedAttachment = [
    "",
    "```coven:attachment",
    "path: /workspace/oversized.png",
    "```",
    "",
  ].join("\n");
  const label = `${"x".repeat(RESULT_LABEL_MAX + 1 - embeddedAttachment.length)}${embeddedAttachment}`;
  assert.equal(label.length, RESULT_LABEL_MAX + 1);

  const result = extractChatRenderedText(
    `<coven:result id="raw-label-bound" state="passed" label="${label}" />`,
  );

  assert.deepEqual(result.authoredResults, []);
  assert.doesNotMatch(result.visible, /coven:/);
});

test("oversized complete result spans keep every embedded control inert", () => {
  const oversizedLabel = [
    "x".repeat(2_048),
    "```coven:attachment",
    '{ "path": "/workspace/must-not-run.txt" }',
    "```",
    "<thinking>hidden oversized reasoning</thinking>",
    '<coven:skill name="hidden-oversized-skill" stage="done" />',
    '<coven:auto-status state="failed" note="hidden oversized status" />',
    "Exact oversized tail.",
  ].join("\n");
  const oversizedMarker = [
    "<coven:result",
    '  id="oversized-controls"',
    '  state="passed"',
    `  label="${oversizedLabel}"`,
    "/>",
  ].join("\n");
  const text = [
    oversizedMarker,
    "<thinking>real reasoning</thinking>",
    '<coven:skill name="real-skill" stage="done" />',
    '<coven:result id="real-result" state="passed" label="Real result" />',
    "Later prose survives.",
  ].join("\n");

  const result = extractChatRenderedText(text);

  assert.equal(result.visible.trim(), "Later prose survives.");
  assert.equal(result.inlineReasoning, "real reasoning");
  assert.deepEqual(result.skillUpdates, [{ name: "real-skill", stage: "done" }]);
  assert.equal(result.autoStatusUpdate, null);
  assert.deepEqual(result.authoredResults, [
    {
      id: "real-result",
      label: "Real result",
      state: "passed",
      source: "familiar",
    },
  ]);
  assert.doesNotMatch(result.cardText, /oversized|must-not-run|hidden|coven:/);
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

test("result-label backticks cannot expose or suppress later transcript controls", () => {
  const text = [
    '<coven:result id="tests" state="passed" label="Ran `pnpm test" />',
    "<thinking>secret plan</thinking>",
    '<coven:skill name="verification-before-completion" stage="done" />',
    '<coven:auto-status state="done" />',
    "Ordinary prose.",
  ].join("\n");

  const result = extractChatRenderedText(text);

  assert.equal(result.visible.trim(), "Ordinary prose.");
  assert.doesNotMatch(result.visible, /thinking|coven:/);
  assert.equal(result.inlineReasoning, "secret plan");
  assert.deepEqual(result.skillUpdates, [
    { name: "verification-before-completion", stage: "done" },
  ]);
  assert.deepEqual(result.autoStatusUpdate, { state: "done" });
  assert.deepEqual(result.authoredResults, [
    {
      id: "tests",
      label: "Ran `pnpm test",
      state: "passed",
      source: "familiar",
    },
  ]);
});

test("a multiline fence-looking result label stays exact while later controls execute", () => {
  const label = ["Ran `pnpm test`", "```", "kept lone ` tail"].join("\n");
  const marker = [
    "<coven:result",
    '  id="fence-label"',
    '  state="passed"',
    `  label="${label}"`,
    "/>",
  ].join("\n");
  const text = [
    marker,
    "<thinking>secret plan</thinking>",
    '<coven:skill name="verification-before-completion" stage="done" />',
    '<coven:auto-status state="done" />',
    "Ordinary prose.",
  ].join("\n");

  const result = extractChatRenderedText(text);

  assert.equal(result.visible.trim(), "Ordinary prose.");
  assert.doesNotMatch(result.visible, /coven:|thinking|fence-label|label=/);
  assert.equal(result.inlineReasoning, "secret plan");
  assert.deepEqual(result.skillUpdates, [
    { name: "verification-before-completion", stage: "done" },
  ]);
  assert.deepEqual(result.autoStatusUpdate, { state: "done" });
  assert.deepEqual(result.authoredResults, [
    {
      id: "fence-label",
      label,
      state: "passed",
      source: "familiar",
    },
  ]);
});

test("result labels are opaque to earlier controls while later live controls execute", () => {
  const label = [
    "  Literal <thinking>label secret</thinking>",
    "<coven:skill name='label-skill' stage='done' />",
    "<coven:auto-status state='failed' />",
    "[debug/path] literal label line",
    "",
    "",
    "Ran `pnpm test`",
    "kept lone ` tail  ",
  ].join("\n");
  const marker = `<coven:result id="opaque-label" state="passed" label="${label}" />`;
  const text = [
    marker,
    "<thinking>real plan</thinking>",
    '<coven:skill name="real-skill" stage="done" note="real update" />',
    '<coven:auto-status state="done" note="real status" />',
    "Ordinary prose.",
  ].join("\n");

  const result = extractChatRenderedText(text);

  assert.equal(result.visible.trim(), "Ordinary prose.");
  assert.equal(result.inlineReasoning, "real plan");
  assert.deepEqual(result.skillUpdates, [
    { name: "real-skill", stage: "done", note: "real update" },
  ]);
  assert.deepEqual(result.autoStatusUpdate, { state: "done", note: "real status" });
  assert.deepEqual(result.authoredResults, [
    {
      id: "opaque-label",
      label: label.trim(),
      state: "passed",
      source: "familiar",
    },
  ]);
});

test("same-line debug cleanup preserves an opaque result and its debug-like label", () => {
  const label = "[debug/path] exact label";
  const marker =
    `<coven:result id="same-line-debug" state="passed" label="${label}" />`;
  const result = extractChatRenderedText(
    `[debug/transport] internal detail ${marker}`,
  );

  assert.equal(result.visible, "");
  assert.deepEqual(result.authoredResults, [
    {
      id: "same-line-debug",
      label,
      state: "passed",
      source: "familiar",
    },
  ]);
});

test("partial controls outside result labels hide while later controls still execute", () => {
  const label = "Literal <coven:sk and <coven:a stay exact";
  const text = [
    `<coven:result id="partial-controls" state="passed" label="${label}" />`,
    "Hidden skill prefix <coven:sk",
    '<coven:skill name="real-skill" stage="done" note="later skill" />',
    "Hidden auto prefix <coven:a",
    '<coven:auto-status state="done" note="later status" />',
    "Ordinary prose.",
  ].join("\n");

  const result = extractChatRenderedText(text, { pending: true });

  assert.equal(
    result.visible.trim(),
    "Hidden skill prefix \n\nHidden auto prefix \n\nOrdinary prose.",
  );
  assert.deepEqual(result.skillUpdates, [
    { name: "real-skill", stage: "done", note: "later skill" },
  ]);
  assert.deepEqual(result.autoStatusUpdate, {
    state: "done",
    note: "later status",
  });
  assert.deepEqual(result.authoredResults, [
    {
      id: "partial-controls",
      label,
      state: "passed",
      source: "familiar",
    },
  ]);
});

test("one true inline-code span keeps result and downstream controls literal", () => {
  const inlineExample = [
    '<coven:result id="inline" state="passed" label="Ran `pnpm test" />',
    "<thinking>literal plan</thinking>",
    '<coven:skill name="literal-skill" stage="done" />',
    '<coven:auto-status state="done" />',
  ].join(" ");
  const text = `Use \`\`${inlineExample}\`\` literally.`;

  const result = extractChatRenderedText(text);

  assert.equal(result.visible, text);
  assert.equal(result.cardText, text);
  assert.equal(result.inlineReasoning, "");
  assert.deepEqual(result.skillUpdates, []);
  assert.equal(result.autoStatusUpdate, null);
  assert.deepEqual(result.authoredResults, []);
});

test("partial multiline result protocol cannot hide later controls behind a backtick", () => {
  const text = [
    "<coven:result",
    '  label="Ran `pnpm test',
    "<thinking>secret plan</thinking>",
    '<coven:skill name="verification-before-completion" stage="done" />',
    '<coven:auto-status state="done" />',
  ].join("\n");

  const result = extractChatRenderedText(text, { pending: true });

  assert.doesNotMatch(result.visible, /thinking|coven:|label=/);
  assert.equal(result.inlineReasoning, "secret plan");
  assert.deepEqual(result.skillUpdates, [
    { name: "verification-before-completion", stage: "done" },
  ]);
  assert.deepEqual(result.autoStatusUpdate, { state: "done" });
  assert.deepEqual(result.authoredResults, []);
});

test("result markers inside reasoning or Markdown code never become authored results", () => {
  const hidden = '<coven:result id="hidden" state="failed" label="Hidden result" />';
  const inline = '<coven:result id="inline" state="failed" label="Inline result" />';
  const fenced = '<coven:result id="fenced" state="failed" label="Fenced result" />';
  const text = [
    `<thinking>${hidden}</thinking>`,
    `Keep \`${inline}\` literal.`,
    "```xml",
    fenced,
    "```",
    "Visible prose.",
  ].join("\n");

  const result = extractChatRenderedText(text);

  assert.deepEqual(result.authoredResults, []);
  assert.doesNotMatch(result.visible, /id="hidden"/);
  assert.match(result.visible, /id="inline"/);
  assert.match(result.visible, /id="fenced"/);
  assert.match(result.visible, /Visible prose\./);
});

test("a result marker nested in reasoning cannot close the outer reasoning block", () => {
  const hidden =
    '<coven:result id="hidden" state="failed" label="Literal </thinking> boundary" />';
  const text = `<thinking>Before ${hidden} after.</thinking>\nVisible prose.`;

  const result = extractChatRenderedText(text);

  assert.equal(result.inlineReasoning, `Before ${hidden} after.`);
  assert.equal(result.visible, "Visible prose.");
  assert.deepEqual(result.authoredResults, []);
});

test("result-looking code examples stay literal and do not execute embedded controls", () => {
  const inline =
    '<coven:result id="inline" state="failed" label="Literal <thinking>inline</thinking>" />';
  const fenced =
    '<coven:result id="fenced" state="failed" label="Literal <thinking>fenced</thinking>" />';
  const text = [
    `Use \`${inline}\` literally.`,
    "```xml",
    fenced,
    "```",
    "<thinking>real plan</thinking>",
  ].join("\n");

  const result = extractChatRenderedText(text);

  assert.match(result.visible, /<thinking>inline<\/thinking>/);
  assert.match(result.visible, /<thinking>fenced<\/thinking>/);
  assert.equal(result.inlineReasoning, "real plan");
  assert.deepEqual(result.authoredResults, []);
});
