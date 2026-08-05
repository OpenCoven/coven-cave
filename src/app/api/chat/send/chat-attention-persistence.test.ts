// Source-contract tests for chat sidebar attention (task 3): every
// assistant-turn persistence path in the send route must run a marker-bearing
// turn's final text through ONE shared `prepareAttentionRequest` helper
// before it lands in the transcript, so an explicit
// `<coven:attention reason="...">` marker becomes a durable
// `attentionRequest` stamp instead of leaking into saved text — and the
// helper's caller must never mutate the shared `responseMetadata` object in
// place, because the very same object is reused for the SSE `done` event
// emitted right after persistence. Matches the ios-first-turn-project-contract
// and skill-stage-card-wiring style already used against these two files:
// read the source, assert on regexes anchored to the actual call sites and
// flows, not on counting arbitrary strings.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("./route.ts", import.meta.url), "utf8");
const chatView = await readFile(
  new URL("../../../../components/chat-view.tsx", import.meta.url),
  "utf8",
);

function chatViewAttentionPipeline() {
  const start = chatView.indexOf(
    "const reasoningSplit = splitReasoning(extractAgentAttachmentMarkers(turn.text).text);",
  );
  const end = chatView.indexOf("const reasoning = turn.reasoning?.trim() || inlineReasoning;");
  assert.notEqual(start, -1, "expected the chat-view marker pipeline to start at reasoningSplit");
  assert.notEqual(end, -1, "expected the chat-view marker pipeline to end before reasoning fallback");
  return chatView.slice(start, end);
}

test("route imports the attention marker parser", () => {
  assert.match(
    route,
    /import \{ extractChatAttentionMarker \} from "@\/lib\/chat-attention-marker";/,
    "the send route should parse explicit attention markers through the shared lib",
  );
});

test("exactly one shared prepareAttentionRequest helper is defined", () => {
  const definitions = route.match(/function prepareAttentionRequest\(/g) ?? [];
  assert.equal(
    definitions.length,
    1,
    "every persistence path must call ONE shared helper, not reimplement marker handling per-path",
  );
  assert.match(
    route,
    /function prepareAttentionRequest\(args: \{\s*text: string;\s*sessionId: string;\s*turnId: string;\s*requestedAt: string;\s*\}\): \{ text: string; request: ChatResponseMetadata\["attentionRequest"\] \| null \} \{/,
    "the helper accepts text/sessionId/turnId/requestedAt and returns cleaned text plus a nullable stamped request",
  );
  assert.match(
    route,
    /function prepareAttentionRequest\([\s\S]{0,400}extractChatAttentionMarker\(args\.text\)/,
    "the helper itself is the one place that calls the marker parser",
  );
});

test("the shared responseMetadata object is never mutated with an attentionRequest field", () => {
  assert.doesNotMatch(
    route,
    /responseMetadata\.attentionRequest\s*=/,
    "attentionRequest must be applied via a cloned copy, never assigned onto the shared object reused by SSE done events",
  );
});

test("the OpenClaw gateway persistence path prepares and persists the attention request", () => {
  // Anchor to the actual gateway turns.push call site (assistantTurnId +
  // gatewayAttention), not to a renamed/rearranged intermediate — a helper
  // call anywhere upstream of this exact push satisfies the flow contract.
  assert.match(
    route,
    /const assistantTurnId = crypto\.randomUUID\(\);\s*const assistantCreatedAt = new Date\(\)\.toISOString\(\);[\s\S]{0,400}const gatewayAttention = prepareAttentionRequest\(\{\s*text: gatewayAssistantText,\s*sessionId: conversationId,\s*turnId: assistantTurnId,\s*requestedAt: assistantCreatedAt,\s*\}\);/,
    "the gateway path should create the assistant turn id/timestamp once and derive the attention request from them",
  );
  assert.match(
    route,
    /const gatewayAttention = prepareAttentionRequest\(\{[\s\S]{0,900}text: gatewayAttention\.text\.trim\(\),\s*createdAt: assistantCreatedAt,[\s\S]{0,300}responseMetadata: gatewayAttention\.request\s*\?\s*\{ \.\.\.responseMetadata, attentionRequest: gatewayAttention\.request \}\s*:\s*responseMetadata,/,
    "the gateway persisted turn should use the cleaned text, the single stamped createdAt, and a conditionally cloned responseMetadata",
  );
});

test("the native OpenClaw stub/direct persistence path prepares and persists the attention request", () => {
  assert.match(
    route,
    /const reportedPrUrl = latestPrUrlFromText\(assistantText\);\s*if \(reportedPrUrl\) conv\.prUrl = reportedPrUrl;\s*const assistantCreatedAt = new Date\(\)\.toISOString\(\);\s*const nativeAttention = prepareAttentionRequest\(\{\s*text: assistantText,\s*sessionId,\s*turnId: assistantTurnId,\s*requestedAt: assistantCreatedAt,\s*\}\);/,
    "the native stub/direct path should derive the attention request from the actual assistant turn id and one stamped createdAt",
  );
  assert.match(
    route,
    /const nativeAttention = prepareAttentionRequest\(\{[\s\S]{0,900}text: nativeAttention\.text\.trim\(\),\s*createdAt: assistantCreatedAt,[\s\S]{0,300}responseMetadata: nativeAttention\.request\s*\?\s*\{ \.\.\.responseMetadata, attentionRequest: nativeAttention\.request \}\s*:\s*responseMetadata,/,
    "the native persisted turn should use the cleaned text, the single stamped createdAt, and a conditionally cloned responseMetadata",
  );
});

test("the general Coven transport persistence path prepares and persists the attention request", () => {
  assert.match(
    route,
    /const persistedAssistantText = persistCovenProcessFailure && !cleanedAssistantText\s*\?\s*launchFailure!\.message\s*:\s*cleanedAssistantText;\s*const assistantCreatedAt = new Date\(\)\.toISOString\(\);\s*const covenAttention = prepareAttentionRequest\(\{\s*text: persistedAssistantText,\s*sessionId: finalSessionId,\s*turnId: assistantTurnId,\s*requestedAt: assistantCreatedAt,\s*\}\);/,
    "the general Coven transport path should derive the attention request from the final marker-bearing text after failure-message fallback resolves",
  );
  assert.match(
    route,
    /const covenAttention = prepareAttentionRequest\(\{[\s\S]{0,600}text: covenAttention\.text,[\s\S]{0,300}createdAt: assistantCreatedAt,[\s\S]{0,900}responseMetadata: covenAttention\.request\s*\?\s*\{ \.\.\.responseMetadata, attentionRequest: covenAttention\.request \}\s*:\s*responseMetadata,/,
    "the coven-transport persisted turn should use the cleaned text, the single stamped createdAt, and a conditionally cloned responseMetadata",
  );
});

test("existing response metadata fields are preserved through the conditional clone", () => {
  // Every clone spreads the original object first, so every pre-existing
  // field (model, harness, runtime, requestedControls, etc.) survives; the
  // attentionRequest field is added, never substituted for the rest.
  for (const varName of ["gatewayAttention", "nativeAttention", "covenAttention"]) {
    assert.match(
      route,
      new RegExp(`\\{ \\.\\.\\.responseMetadata, attentionRequest: ${varName}\\.request \\}`),
      `${varName}'s clone must spread the existing responseMetadata before adding attentionRequest`,
    );
  }
});

test("ChatView imports the attention marker parser and strips it before rendering", () => {
  assert.match(
    chatView,
    /import \{ extractChatAttentionMarker \} from "@\/lib\/chat-attention-marker";/,
    "chat-view should strip explicit attention markers the same way it strips skill/auto-status markers",
  );
});

test("ChatView extracts attention after skill/auto-status and before next-path/GitHub/image stripping", () => {
  // Pinned as a flow (per the skill-stage-card-wiring precedent above this
  // file): what must hold is that autoStatusSplit's visible text feeds the
  // attention extractor, and the attention-stripped visible feeds
  // extractNextPaths — never the reverse and never skipped, so a complete OR
  // partial `<coven:attention>` tag can't flash mid-stream.
  const pipeline = chatViewAttentionPipeline();
  const autoStatusIndex = pipeline.indexOf(
    "const autoStatusSplit = extractAutoStatusMarkers(skillSplit.visible);",
  );
  const attentionIndex = pipeline.indexOf(
    "const attentionSplit = extractChatAttentionMarker(autoStatusSplit.visible);",
  );
  const nextPathsIndex = pipeline.indexOf(
    "const { visible: visibleWithGh, suggestions: nextPaths } = extractNextPaths(attentionSplit.visible);",
  );
  assert.notEqual(autoStatusIndex, -1, "auto-status extraction should read skillSplit.visible");
  assert.notEqual(attentionIndex, -1, "attention extraction should read autoStatusSplit.visible");
  assert.notEqual(nextPathsIndex, -1, "next-path extraction should read attentionSplit.visible");
  assert.ok(
    autoStatusIndex < attentionIndex && attentionIndex < nextPathsIndex,
    "attention extraction must run strictly between auto-status extraction and next-path extraction",
  );
  assert.doesNotMatch(
    chatView,
    /extractNextPaths\((?:ghSafeVisible|turn\.text|reasoningSplit\.visible|skillSplit\.visible|autoStatusSplit\.visible)\)/,
    "next-paths must never run on text upstream of the attention split — a raw or partial marker would flash",
  );
});

test("ChatView never strips GitHub/image markers before skill/auto-status/attention extraction sees the marker-bearing text", () => {
  // The order test above only pins that attention sits between auto-status and
  // next-path textually — it says nothing about whether an EARLIER step (e.g.
  // a pending-turn GitHub/image pre-clean feeding extractSkillMarkers) already
  // stripped markers out of the text before skill/auto-status/attention ever
  // ran. Pin the actual head of the pipeline: extractSkillMarkers must consume
  // reasoningSplit.visible directly, with no intermediate stripped variable.
  const pipeline = chatViewAttentionPipeline();
  assert.match(
    pipeline,
    /const inlineReasoning = reasoningSplit\.reasoning;[\s\S]{0,700}const skillSplit = extractSkillMarkers\(reasoningSplit\.visible\);/,
    "skill markers must extract directly from reasoningSplit.visible — nothing may strip GitHub/image markers out of the marker-bearing text before skill/auto-status/attention/next-path all see it",
  );
  const attentionIndex = pipeline.indexOf(
    "const attentionSplit = extractChatAttentionMarker(autoStatusSplit.visible);",
  );
  const stripGitHubIndex = pipeline.indexOf("stripGitHubMarkers(");
  const stripImageIndex = pipeline.indexOf("stripImageMarkers(");
  assert.notEqual(attentionIndex, -1, "attention extraction should remain present in the pipeline");
  assert.notEqual(stripGitHubIndex, -1, "GitHub-marker stripping should still happen later in the pipeline");
  assert.notEqual(stripImageIndex, -1, "image-marker stripping should still happen later in the pipeline");
  assert.ok(
    attentionIndex < stripGitHubIndex && attentionIndex < stripImageIndex,
    "stripGitHubMarkers/stripImageMarkers must not appear anywhere in the pipeline before extractChatAttentionMarker",
  );
});

test("ChatView strips GitHub/image markers only after next-path extraction, unconditionally on both pending and settled turns", () => {
  // Complements the two tests above: this pins the TAIL of the pipeline.
  // GitHub/image cleanup must consume `visibleWithGh` (next-path extraction's
  // output) unconditionally — not gated behind `turn.pending ? visibleWithGh :
  // strip(...)`, which would mean the settled path cleans up post-next-paths
  // while the pending path (streaming) never gets this late cleanup at all
  // because it was already (wrongly) pre-cleaned upstream of skill/auto-status.
  const pipeline = chatViewAttentionPipeline();
  assert.match(
    pipeline,
    /const \{ visible: visibleWithGh, suggestions: nextPaths \} = extractNextPaths\(attentionSplit\.visible\);[\s\S]*const visible = stripImageMarkers\(stripGitHubMarkers\(visibleWithGh\)\);/,
    "GitHub/image cleanup must run unconditionally, immediately after next-path extraction resolves visibleWithGh, on both pending and settled turns",
  );
});

test("ChatView does not render an inline attention card yet", () => {
  // Task 3 persists the request and strips its marker from view only. Session
  // sidebar attention derives from `attentionRequest` in a later task — no
  // inline per-turn card should consume the parsed request here.
  assert.doesNotMatch(
    chatView,
    /attentionSplit\.request/,
    "the parsed request must not be consumed for rendering in this task — only the marker-stripped visible text is used",
  );
});

console.log("chat attention persistence: ok");
