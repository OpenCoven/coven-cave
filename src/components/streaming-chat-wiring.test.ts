import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const main = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const quick = readFileSync(new URL("./quick-chat-thread.tsx", import.meta.url), "utf8");

for (const [name, source, requiredNow] of [
  ["Main Chat", main, true],
  ["Quick Chat", quick, true],
] as const) {
  const derivesSharedModel = /createStreamingTurnViewModel/.test(source);
  const rendersSharedResponse = /<StreamingTurnResponse/.test(source);

  assert.equal(
    derivesSharedModel,
    rendersSharedResponse,
    `${name} must adopt the shared model and renderer together`,
  );
  if (requiredNow) {
    assert.equal(derivesSharedModel, true, `${name} derives the shared model`);
    assert.equal(rendersSharedResponse, true, `${name} renders the shared composition`);
  }
  assert.doesNotMatch(
    source,
    /function deriveStreamingTurnStatus/,
    `${name} does not fork status derivation`,
  );
}

assert.match(
  main,
  /verificationEvidenceFromTools\(turn\.tools\)/,
  "Main Chat supplies normalized evidence",
);
assert.match(
  main,
  /useStreamingPresentationSource\(\s*rawText,\s*pending,\s*\{ sourceMode: "replaceable" \},?\s*\)/,
  "Main Chat buffers raw assistant source in replacement-safe mode",
);
assert.match(
  main,
  /case "assistant_replace"[\s\S]*replaceAssistantText/,
  "Main Chat's stream protocol supports authoritative text replacement",
);
assert.match(
  main,
  /const presentedProjection = extractChatRenderedText\(\s*presentedRawText,/,
  "Main Chat projects protocol markers only after buffering raw source",
);
assert.match(
  main,
  /visibleText: pending \? presentedProjection\.visible : visible/,
  "the shared model uses buffered visible prose live and exact visible prose settled",
);
assert.match(
  main,
  /cancelSend\?: \(\) => void/,
  "the latest transcript handlers expose the existing stop path",
);
assert.match(
  main,
  /transcriptHandlersRef\.current\.cancelSend = cancelSend/,
  "the latest handler ref is refreshed with cancelSend",
);
assert.match(
  main,
  /onStop=\{pending \? \(\) => handlersRef\.current\.cancelSend\?\.\(\) : undefined\}/,
  "live Main Chat routes Stop through the latest cancelSend handler",
);
assert.match(
  main,
  /abortRef\.current\?\.abort\(\);\s*announce\("Response stopped\.", "polite"\);/,
  "stopping announces after the existing server stop and local abort begin",
);
assert.match(
  main,
  /const activityDetails =[\s\S]*?<ReasoningBlock[\s\S]*?<ProgressGroup[\s\S]*?<ToolGroup/,
  "activityDetails preserves reasoning, progress, and non-edit tool details",
);
assert.match(
  main,
  /const proseContent =[\s\S]*?!pending && renderSegments[\s\S]*?renderSegments\.map[\s\S]*?segment\.kind === "text"[\s\S]*?<ProgressiveMarkdownBlock[\s\S]*?text=\{segment\.text\}[\s\S]*?<div key=\{segment\.key\} className="my-2">\{segment\.node\}<\/div>/,
  "settled rich turns render every prose and card segment in sequence through the real Markdown path",
);
const supplementary = main.match(
  /const supplementaryContent = \([\s\S]*?\n  \);\n\n  return \(/,
)?.[0] ?? "";
assert.doesNotMatch(
  supplementary,
  /renderSegments|segment\.node/,
  "supplementaryContent does not duplicate inline splitter blocks",
);
assert.match(
  supplementary,
  /<ResponseModelStatus[\s\S]*?<ResponseControlStatus[\s\S]*?<InlineImageAttachments[\s\S]*?<SkillStageCard[\s\S]*?<AutoStatusCard[\s\S]*?editCards\.map[\s\S]*?<ArtifactComments/,
  "supplementaryContent preserves metadata, attachments, skill status, edits, and comments",
);
assert.match(
  main,
  /const durableAttentionRequest = attentionRequest \?\? turn\.responseMetadata\?\.attentionRequest \?\? null;[\s\S]*const showEmptySuccessfulFallback = shouldUseEmptySuccessfulFallback\(\{[\s\S]*visibleProse: visible,[\s\S]*hasRichBlocks: renderSegments\?\.some\(\(segment\) => segment\.kind === "block"\) \?\? false,[\s\S]*resultCount: streamingModel\.results\.length,[\s\S]*attachmentCount: turn\.attachments\?\.length \?\? 0,[\s\S]*skillUpdateCount: skillUpdates\.length,[\s\S]*hasAutoStatusUpdate: autoStatusUpdate != null,[\s\S]*editCardCount: editCards\.length,[\s\S]*followUpCount: nextPaths\.length,[\s\S]*hasAttentionRequest: durableAttentionRequest != null,[\s\S]*\}\);/,
  "Main Chat derives the empty-success fallback from prose plus meaningful structured output owned by the turn",
);
assert.match(
  main,
  /isError=\{showEmptySuccessfulFallback\}[\s\S]*?assistantBody=\{\s*showEmptySuccessfulFallback\s*\?\s*\([\s\S]*?\{supplementaryContent\}[\s\S]*?\{activityDetails\}[\s\S]*?:\s*\(\s*<StreamingTurnResponse/,
  "only a truly empty successful response uses MessageBubble's explicit empty-response treatment",
);
assert.match(main, /activityDetails=\{activityDetails\}/, "Main Chat supplies the activity slot");
assert.match(
  main,
  /supplementaryContent=\{supplementaryContent\}/,
  "Main Chat supplies the supplementary slot",
);
assert.match(
  main,
  /proseContent=\{proseContent\}/,
  "Main Chat supplies ordered rich prose without replacing the default streaming path",
);
assert.match(
  main,
  /followUp\.suggestions\.length > 0[\s\S]*?<FollowUpCards paths=\{followUp\.suggestions\} onActivate=\{handleFollowUp\}/,
  "ephemeral follow-up cards remain on their existing composer-owned action path",
);
assert.match(
  main,
  /onRetry=\{turn\.error \? onRegenerate : undefined\}/,
  "only failed turns expose shared Retry",
);
assert.match(main, /canContinue=\{false\}/, "Main Chat does not claim unsupported continuation");
assert.match(
  main,
  /pending && streamingModel\.committedText[\s\S]*copyText\(streamingModel\.committedText\)/,
  "live copy is absent until committed text exists and copies only committed text",
);
assert.match(
  main,
  /content=\{visible \|\| \(turn\.pending \? "…" : ""\)\}/,
  "MessageBubble retains the exact current projection for durable actions",
);
assert.match(
  main,
  /handlersRef=\{handlersRef\}/,
  "rows receive the stable latest-handler ref rather than a fresh cancel callback",
);

assert.match(
  quick,
  /useStreamingPresentationSource\(\s*message\.role === "assistant" \? message\.text : "",\s*streaming,\s*\{ sourceMode: "replaceable" \},?\s*\)/,
  "Quick Chat buffers raw assistant source in replacement-safe mode",
);
assert.match(
  quick,
  /const presentedProjection = formatQuickChatAssistantMessage\(\s*presentedRawText,\s*streaming,\s*\)/,
  "Quick Chat projects protocol markers only after buffering raw source",
);
assert.doesNotMatch(
  quick,
  /useStreamingPresentationSource\([\s\S]{0,120}(?:copyText|visible)[\s\S]{0,120}sourceMode: "append-only"/,
  "Quick Chat never labels marker-projected visible text append-only",
);
assert.match(
  quick,
  /createStreamingTurnViewModel\(\{[\s\S]*turnId: message\.id,[\s\S]*visibleText: presentedVisible,[\s\S]*pending: streaming,[\s\S]*lifecycle: message\.lifecycle,[\s\S]*failed: Boolean\(message\.error\),[\s\S]*authoredResults,[\s\S]*\}\)/,
  "Quick Chat supplies lifecycle, marker-safe prose, and authored results without inferred tool evidence",
);
assert.doesNotMatch(
  quick,
  /verifiedResults:/,
  "Quick Chat does not fabricate trusted results without structured tool evidence",
);
assert.match(
  quick,
  /shouldUseEmptySuccessfulFallback\(\{[\s\S]*emptySuccessful: streamingModel\.emptySuccessful,[\s\S]*visibleProse: visible,[\s\S]*hasRichBlocks:[\s\S]*resultCount: streamingModel\.results\.length,[\s\S]*skillUpdateCount: skillUpdates\.length,[\s\S]*followUpCount: suggestions\.length/,
  "Quick Chat distinguishes a truly empty success from structured-only output through the shared helper",
);

console.log("streaming-chat-wiring.test.ts: ok");
