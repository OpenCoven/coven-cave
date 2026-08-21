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
const renderedText = await readFile(
  new URL("../../../../lib/chat-rendered-text.ts", import.meta.url),
  "utf8",
);

function renderedTextAttentionPipeline() {
  const start = renderedText.indexOf(
    "const reasoningSplit = splitReasoning(extractAgentAttachmentMarkers(text).text);",
  );
  const end = renderedText.indexOf("\nexport function chatTurnVisibleText", start);
  assert.notEqual(start, -1, "expected the shared marker pipeline to start at reasoningSplit");
  assert.notEqual(end, -1, "expected the shared marker pipeline to end before the turn helper");
  return renderedText.slice(start, end);
}

test("route imports the attention marker parser", () => {
  assert.match(
    route,
    /import \{[\s\S]*extractChatAttentionMarker[\s\S]*\} from "@\/lib\/chat-attention-marker";/,
    "the send route should parse explicit attention markers through the shared lib",
  );
  assert.match(
    route,
    /import \{ splitReasoning \} from "@\/lib\/chat-reasoning";/,
    "the send route should use the same hidden-reasoning semantics as ChatView",
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
    /function prepareAttentionRequest\(args: \{\s*text: string;\s*sessionId: string;\s*turnId: string;\s*requestedAt: string;\s*incomplete\?: boolean;\s*\}\): \{\s*text: string;\s*reasoning\?: string;\s*request: ChatResponseMetadata\["attentionRequest"\] \| null;\s*\} \{/,
    "the helper accepts text/sessionId/turnId/requestedAt plus optional incomplete mode and returns cleaned visible text, optional persisted reasoning, and a nullable stamped request",
  );
  assert.match(
    route,
    /function prepareAttentionRequest\([\s\S]{0,400}const \{ visible: visibleBody, reasoning: reasoningBody \} = splitReasoning\(args\.text\);[\s\S]{0,220}args\.incomplete\s*\?\s*extractIncompleteChatAttentionMarker\(visibleBody\)\s*:\s*extractChatAttentionMarker\(visibleBody\);[\s\S]{0,320}args\.incomplete\s*\?\s*extractIncompleteChatAttentionMarker\(reasoningBody\)\s*:\s*extractChatAttentionMarker\(reasoningBody\)/,
    "the helper must parse markers only from visible text while separately scrubbing reasoning for persisted reloads; incomplete mode uses the shared pending-tail sanitizer in both places",
  );
});

test("the shared responseMetadata object is never mutated with an attentionRequest field", () => {
  assert.doesNotMatch(
    route,
    /responseMetadata\.attentionRequest\s*=/,
    "attentionRequest must be applied via a cloned copy, never assigned onto the shared object reused by SSE done events",
  );
});

test("every send transport persists the normalized client run id on its human turn and pending stub", () => {
  assert.match(
    route,
    /function attentionClearOperationForTurn\(\s*value: unknown,\s*\): Pick<ChatTurn, "attentionClearOperationId"> \{[\s\S]{0,300}normalizeChatAttentionOperationId\(value\)[\s\S]{0,200}\{ attentionClearOperationId: operationId \}/,
    "one shared helper should validate causal operation ids before they enter a transcript",
  );
  assert.match(
    route,
    /body\.runId = normalizeChatAttentionOperationId\(\s*\(body as \{ runId\?: unknown \}\)\.runId,\s*\) \?\? undefined;/,
    "the untyped request body should normalize runId once before routing or persistence",
  );
  assert.equal(
    (
      route.match(
        /\.\.\.attentionClearOperationForTurn\((?:args\.body|body)\.runId\),\s*\.\.\.persistedTurnControls\((?:args\.body|body), responseMetadata\.retryModel\)/g,
      ) ?? []
    ).length,
    6,
    "Gateway, native OpenClaw, and general Coven transports must stamp both their pending stub and authoritative human turn",
  );
});

test("the OpenClaw gateway persistence path prepares and persists the attention request", () => {
  // Anchor to the actual gateway turns.push call site (assistantTurnId +
  // gatewayAttention), not to a renamed/rearranged intermediate — a helper
  // call anywhere upstream of this exact push satisfies the flow contract.
  assert.match(
    route,
    /const assistantTurnId = crypto\.randomUUID\(\);\s*const assistantCreatedAt = new Date\(\)\.toISOString\(\);[\s\S]{0,500}const gatewayAttention = prepareAttentionRequest\(\{\s*text: gatewayAssistantText,\s*sessionId: conversationId,\s*turnId: assistantTurnId,\s*requestedAt: assistantCreatedAt,\s*incomplete: cancelledByUser \|\| isError,\s*\}\);/,
    "the gateway path should create the assistant turn id/timestamp once and derive the attention request from them",
  );
  assert.match(
    route,
    /const gatewayAttention = prepareAttentionRequest\(\{[\s\S]{0,900}text: gatewayAttention\.text\.trim\(\),[\s\S]{0,200}\.\.\.\(gatewayAttention\.reasoning \? \{ reasoning: gatewayAttention\.reasoning \} : \{\}\),\s*createdAt: assistantCreatedAt,[\s\S]{0,300}responseMetadata: gatewayAttention\.request\s*\?\s*\{ \.\.\.responseMetadata, attentionRequest: gatewayAttention\.request \}\s*:\s*responseMetadata,/,
    "the gateway persisted turn should use the cleaned text, carry persisted reasoning when present, use one stamped createdAt, and conditionally clone responseMetadata",
  );
});

test("the native OpenClaw stub/direct persistence path prepares and persists the attention request", () => {
  assert.match(
    route,
    /const reportedPrUrl = latestPrUrlFromText\(assistantText\);\s*if \(reportedPrUrl\) conv\.prUrl = reportedPrUrl;\s*const assistantCreatedAt = new Date\(\)\.toISOString\(\);\s*const nativeAttention = prepareAttentionRequest\(\{\s*text: assistantText,\s*sessionId,\s*turnId: assistantTurnId,\s*requestedAt: assistantCreatedAt,\s*incomplete: cancelledByUser \|\| isError,\s*\}\);/,
    "the native stub/direct path should derive the attention request from the actual assistant turn id and one stamped createdAt",
  );
  assert.match(
    route,
    /const nativeAttention = prepareAttentionRequest\(\{[\s\S]{0,900}text: nativeAttention\.text\.trim\(\),[\s\S]{0,200}\.\.\.\(nativeAttention\.reasoning \? \{ reasoning: nativeAttention\.reasoning \} : \{\}\),\s*createdAt: assistantCreatedAt,[\s\S]{0,300}responseMetadata: nativeAttention\.request\s*\?\s*\{ \.\.\.responseMetadata, attentionRequest: nativeAttention\.request \}\s*:\s*responseMetadata,/,
    "the native persisted turn should use the cleaned text, carry persisted reasoning when present, use one stamped createdAt, and conditionally clone responseMetadata",
  );
});

test("the general Coven transport persistence path prepares and persists the attention request", () => {
  assert.match(
    route,
    /const persistedAssistantText = persistCovenProcessFailure && !cleanedAssistantText\s*\?\s*launchFailure!\.message\s*:\s*cleanedAssistantText;\s*const assistantCreatedAt = new Date\(\)\.toISOString\(\);\s*const covenAttention = prepareAttentionRequest\(\{\s*text: persistedAssistantText,\s*sessionId: finalSessionId,\s*turnId: assistantTurnId,\s*requestedAt: assistantCreatedAt,\s*incomplete: cancelledByUser \|\| result\.is_error,\s*\}\);/,
    "the general Coven transport path should derive the attention request from the final marker-bearing text after failure-message fallback resolves",
  );
  assert.match(
    route,
    /const covenAttention = prepareAttentionRequest\(\{[\s\S]{0,600}text: covenAttention\.text,[\s\S]{0,200}\.\.\.\(covenAttention\.reasoning \? \{ reasoning: covenAttention\.reasoning \} : \{\}\),[\s\S]{0,300}createdAt: assistantCreatedAt,[\s\S]{0,900}responseMetadata: covenAttention\.request\s*\?\s*\{ \.\.\.responseMetadata, attentionRequest: covenAttention\.request \}\s*:\s*responseMetadata,/,
    "the coven transport persisted turn should use the cleaned text, carry persisted reasoning when present, use one stamped createdAt, and conditionally clone responseMetadata",
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

test("ChatView renders through the shared attention-aware text projection", () => {
  assert.match(
    chatView,
    /extractChatRenderedText,[\s\S]*from "@\/lib\/chat-rendered-text";/,
    "chat-view should use the shared rendered-text projection",
  );
  assert.match(
    renderedText,
    /import \{ extractChatAttentionMarker \} from "\.\/chat-attention-marker\.ts";/,
    "the shared projection should strip explicit attention markers",
  );
  assert.doesNotMatch(
    chatView,
    /extractChatAttentionMarker\(/,
    "ChatView must not drift into a duplicate attention pipeline",
  );
  assert.match(
    chatView,
    /const reasoning = turn\.reasoning\?\.trim\(\) \|\| inlineReasoning;/,
    "reload should prefer persisted reasoning when present so Show thinking survives marker stripping from turn.text",
  );
});

test("the shared projection extracts attention after skill/auto-status and before next-path/preview/GitHub/image stripping", () => {
  // Pinned as a flow (per the skill-stage-card-wiring precedent above this
  // file): what must hold is that autoStatusSplit's visible text feeds the
  // attention extractor, and the attention-stripped visible feeds
  // extractNextPaths — never the reverse and never skipped, so a complete OR
  // partial `<coven:attention>` tag can't flash mid-stream.
  const pipeline = renderedTextAttentionPipeline();
  const autoStatusIndex = pipeline.indexOf(
    "const autoStatusSplit = extractAutoStatusMarkers(skillSplit.visible);",
  );
  const attentionIndex = pipeline.indexOf("const attentionSplit = extractChatAttentionMarker(");
  const nextPathsIndex = pipeline.indexOf(
    "const nextPathSplit = extractNextPaths(attentionSplit.visible);",
  );
  assert.notEqual(autoStatusIndex, -1, "auto-status extraction should read skillSplit.visible");
  assert.notEqual(attentionIndex, -1, "attention extraction should remain in the pipeline");
  assert.notEqual(nextPathsIndex, -1, "next-path extraction should read attentionSplit.visible");
  assert.ok(
    autoStatusIndex < attentionIndex && attentionIndex < nextPathsIndex,
    "attention extraction must run strictly between auto-status extraction and next-path extraction",
  );
  // The contract is the ORDER, not which stage happens to sit immediately
  // upstream. Stages get inserted between these anchors legitimately — the
  // calm-streaming work added `extractChatResultMarkers` between auto-status
  // and attention — so pin that attention consumes auto-status output or
  // something derived from it, rather than the literal `autoStatusSplit.visible`
  // argument that a new intermediate stage rightly displaces.
  const attentionArg = pipeline.match(
    /const attentionSplit = extractChatAttentionMarker\(\s*([A-Za-z0-9_]+)\.visible,/,
  )?.[1];
  assert.ok(attentionArg, "attention extraction must consume a prior stage's visible text");
  assert.ok(
    pipeline.indexOf(`const ${attentionArg} = `) >= autoStatusIndex,
    `attention extraction must read a stage at or downstream of auto-status; it reads ${attentionArg}`,
  );
  // Every next-path call site must consume the attention-stripped text. Stated
  // as a universal over the call sites rather than a denylist of upstream
  // variable names, which would need a new entry each time a stage is added
  // and would silently stop protecting anything if one were forgotten.
  const nextPathCalls = renderedText.match(/extractNextPaths\([^)]*\)/g) ?? [];
  assert.ok(nextPathCalls.length > 0, "the projection must still extract next paths");
  for (const call of nextPathCalls) {
    assert.equal(
      call,
      "extractNextPaths(attentionSplit.visible)",
      "next-paths must never run on text upstream of the attention split — a raw or partial marker would flash",
    );
  }
});

test("the shared projection never strips preview/GitHub/image markers before attention extraction", () => {
  // The order test above only pins that attention sits between auto-status and
  // next-path textually — it says nothing about whether an EARLIER step (e.g.
  // a pending-turn preview/GitHub/image pre-clean feeding extractSkillMarkers) already
  // stripped markers out of the text before skill/auto-status/attention ever
  // ran. Pin the actual head of the pipeline: extractSkillMarkers must consume
  // reasoningSplit.visible directly, with no intermediate stripped variable.
  const pipeline = renderedTextAttentionPipeline();
  assert.match(
    pipeline,
    /const skillSplit = extractSkillMarkers\(reasoningSplit\.visible\);/,
    "skill markers must extract directly from reasoningSplit.visible — nothing may strip preview/GitHub/image markers out of the marker-bearing text before skill/auto-status/attention/next-path all see it",
  );
  const attentionIndex = pipeline.indexOf("const attentionSplit = extractChatAttentionMarker(");
  const stripPreviewIndex = pipeline.indexOf("stripPreviewMarkers(");
  const stripGitHubIndex = pipeline.indexOf("stripGitHubMarkers(");
  const stripImageIndex = pipeline.indexOf("stripImageMarkers(");
  assert.notEqual(attentionIndex, -1, "attention extraction should remain present in the pipeline");
  assert.notEqual(stripPreviewIndex, -1, "preview-marker stripping should still happen later in the pipeline");
  assert.notEqual(stripGitHubIndex, -1, "GitHub-marker stripping should still happen later in the pipeline");
  assert.notEqual(stripImageIndex, -1, "image-marker stripping should still happen later in the pipeline");
  assert.ok(
    attentionIndex < stripPreviewIndex
      && attentionIndex < stripGitHubIndex
      && attentionIndex < stripImageIndex,
    "marker stripping must not appear anywhere in the pipeline before extractChatAttentionMarker",
  );
});

test("the shared projection strips preview/GitHub/image markers only after next-path extraction", () => {
  // Complements the two tests above: this pins the TAIL of the pipeline.
  // Marker cleanup must consume the next-path extraction's visible output
  // output) unconditionally — not gated behind `turn.pending ? visibleWithGh :
  // strip(...)`, which would mean the settled path cleans up post-next-paths
  // while the pending path (streaming) never gets this late cleanup at all
  // because it was already (wrongly) pre-cleaned upstream of skill/auto-status.
  const pipeline = renderedTextAttentionPipeline();
  assert.match(
    pipeline,
    /const nextPathSplit = extractNextPaths\(attentionSplit\.visible\);[\s\S]*visible: stripPreviewMarkers\(stripImageMarkers\(stripGitHubMarkers\(nextPathSplit\.visible\)\)\)/,
    "preview/GitHub/image cleanup must run unconditionally after next-path extraction on both pending and settled turns",
  );
});

test("ChatView does not render an inline attention card", () => {
  // This pin used to read `doesNotMatch(chatView, /attentionRequest/)`, and its
  // own comment named the condition under which that would expire: "session
  // sidebar attention derives from `attentionRequest` in a later task". That
  // task has since landed — `src/lib/chat-attention.ts` derives the sidebar's
  // `ChatAttention` state from the persisted request and `workspace-sidebar.tsx`
  // renders it — so the mere presence of the identifier in ChatView no longer
  // signals the thing this test was written to prevent.
  //
  // The worry itself has NOT expired: the parsed request must not grow an
  // inline per-turn card in the transcript, which would double up on the
  // sidebar's signal and re-surface a marker the projection deliberately
  // strips. So pin the worry directly instead of the identifier.
  //
  // ChatView's one sanctioned use is a presence test: an attention-only turn
  // carries no visible prose, and without this signal the transcript would
  // wrongly fall back to "completed with no output". That reads the request's
  // existence and nothing else.
  assert.doesNotMatch(
    chatView,
    /<[A-Za-z]*Attention[A-Za-z]*[\s/>]/,
    "no attention-named component may be rendered in the transcript — sidebar attention is the single surface for the request",
  );
  assert.doesNotMatch(
    chatView,
    /cave-attention|attention-card/i,
    "no inline attention card class hook may appear in the transcript",
  );
  assert.doesNotMatch(
    chatView,
    /\b(?:attentionRequest|durableAttentionRequest)\s*\??\./,
    "the parsed request may be tested for presence but never destructured or field-read — reading `.reason`/`.summary` is what rendering a card requires",
  );
  assert.match(
    chatView,
    /hasAttentionRequest: durableAttentionRequest != null/,
    "the request reaches ChatView only as a presence boolean, so an attention-only turn is not mistaken for an empty response",
  );
});

console.log("chat attention persistence: ok");
