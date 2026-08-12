import { extractAgentAttachmentMarkers } from "./chat-attachments.ts";
import { extractAutoStatusMarkers } from "./auto-status-blocks.ts";
import { extractChatAttentionMarker } from "./chat-attention-marker.ts";
import {
  extractChatResultMarkersFromScan,
  hasChatResultProtocolCandidate,
  scanChatResultProtocol,
  type ChatResultProtocolScan,
  type ChatResultProtocolScanner,
} from "./chat-result-markers.ts";
import { splitReasoning } from "./chat-reasoning.ts";
import { stripGitHubMarkers } from "./github-blocks.ts";
import { stripImageMarkers } from "./image-blocks.ts";
import { extractNextPaths } from "./next-paths.ts";
import { extractSkillMarkers } from "./skill-blocks.ts";

export type ChatRenderedTextProjection = {
  visible: string;
  cardText: string;
  inlineReasoning: string;
  skillUpdates: ReturnType<typeof extractSkillMarkers>["updates"];
  autoStatusUpdate: ReturnType<typeof extractAutoStatusMarkers>["update"];
  authoredResults: ReturnType<typeof extractChatResultMarkersFromScan>["results"];
  attentionRequest: ReturnType<typeof extractChatAttentionMarker>["request"];
  nextPaths: ReturnType<typeof extractNextPaths>["suggestions"];
};

export type ChatResultScanContext = {
  readonly text: string;
  readonly scan: ChatResultProtocolScan | undefined;
  getScan(): ChatResultProtocolScan;
  setText(text: string): void;
};

export function createChatResultScanContext(
  initialText: string,
  scanResultProtocol: ChatResultProtocolScanner = scanChatResultProtocol,
): ChatResultScanContext {
  let text = initialText;
  let scan: ChatResultProtocolScan | undefined;
  return {
    get text() {
      return text;
    },
    get scan() {
      return scan;
    },
    getScan() {
      if (!scan) {
        const nextScan = scanResultProtocol(text);
        if (
          nextScan.sourceText !== text
          || nextScan.sourceLength !== text.length
          || nextScan.markdownRangeSource.length !== text.length
        ) {
          throw new RangeError(
            "chat result scan context requires a scan of the exact current source",
          );
        }
        scan = nextScan;
      }
      return scan;
    },
    setText(nextText) {
      if (nextText === text) return;
      text = nextText;
      scan = undefined;
    },
  };
}

function hasNamedControlCandidate(
  text: string,
  candidatePrefix: string,
  markerName: string,
): boolean {
  let start = text.indexOf(candidatePrefix);
  while (start !== -1) {
    let offset = candidatePrefix.length;
    while (
      offset < markerName.length
      && start + offset < text.length
      && text[start + offset] === markerName[offset]
    ) {
      offset += 1;
    }
    const next = text[start + offset];
    if (next === undefined) return true;
    if (offset === markerName.length) {
      if (!/[A-Za-z0-9_]/.test(next)) return true;
    } else if (!/[A-Za-z0-9_.:-]/.test(next)) {
      return true;
    }
    start = text.indexOf(candidatePrefix, start + candidatePrefix.length);
  }
  return false;
}

export function hasChatSkillCandidate(text: string): boolean {
  return hasNamedControlCandidate(text, "<coven:s", "<coven:skill");
}

function hasReasoningProjectionCandidate(text: string): boolean {
  return (
    /<\/?(?:thinking|reasoning)>/i.test(text)
    || /^\[[a-z][\w-]*(?:\/[\w-]+)+\]/im.test(text)
    || /^\s/u.test(text)
    || text.includes("\n\n\n")
  );
}

function resultAwareRangeInputs(
  context: ChatResultScanContext,
  hasFamilyCandidate: boolean,
): {
  markdownRangeSource: string;
  protectedRanges: ChatResultProtocolScan["protectedRanges"];
} {
  if (
    !hasFamilyCandidate
    || !hasChatResultProtocolCandidate(context.text)
  ) {
    return { markdownRangeSource: context.text, protectedRanges: [] };
  }
  const scan = context.getScan();
  return {
    markdownRangeSource: scan.markdownRangeSource,
    protectedRanges: scan.protectedRanges,
  };
}

/**
 * Project an assistant turn through the exact control-marker pipeline used by
 * the transcript. `visible` is prose-only; `cardText` retains GitHub and image
 * markers so the renderer can replace them with rich cards.
 */
export function extractChatRenderedText(
  text: string,
  options: { pending?: boolean } = {},
  scanResultProtocol: ChatResultProtocolScanner = scanChatResultProtocol,
): ChatRenderedTextProjection {
  const context = createChatResultScanContext(text, scanResultProtocol);

  const hasAttachmentCandidate = context.text.includes("```coven:attachment");
  const attachmentRanges = resultAwareRangeInputs(
    context,
    hasAttachmentCandidate,
  );
  const attachmentSplit = hasAttachmentCandidate
    ? extractAgentAttachmentMarkers(
        context.text,
        attachmentRanges.markdownRangeSource,
        attachmentRanges.protectedRanges,
      )
    : { text: context.text, markers: [] };
  context.setText(attachmentSplit.text);

  const hasReasoningCandidate = hasReasoningProjectionCandidate(context.text);
  const reasoningRanges = resultAwareRangeInputs(context, hasReasoningCandidate);
  const reasoningSplit = hasReasoningCandidate
    ? splitReasoning(
        context.text,
        reasoningRanges.markdownRangeSource,
        reasoningRanges.protectedRanges,
      )
    : { visible: context.text, reasoning: "" };
  context.setText(reasoningSplit.visible);

  const hasSkillCandidate = hasChatSkillCandidate(context.text);
  const skillRanges = resultAwareRangeInputs(context, hasSkillCandidate);
  const skillSplit = hasSkillCandidate
    ? extractSkillMarkers(
        context.text,
        skillRanges.markdownRangeSource,
        skillRanges.protectedRanges,
      )
    : { visible: context.text, updates: [] };
  context.setText(skillSplit.visible);

  const hasAutoStatusCandidate = hasNamedControlCandidate(
    context.text,
    "<coven:a",
    "<coven:auto-status",
  );
  const autoStatusRanges = resultAwareRangeInputs(
    context,
    hasAutoStatusCandidate,
  );
  const autoStatusSplit = hasAutoStatusCandidate
    ? extractAutoStatusMarkers(
        context.text,
        autoStatusRanges.markdownRangeSource,
        autoStatusRanges.protectedRanges,
      )
    : { visible: context.text, update: null };
  context.setText(autoStatusSplit.visible);

  const resultSplit = hasChatResultProtocolCandidate(context.text)
    ? extractChatResultMarkersFromScan(
        context.text,
        context.getScan(),
        { pending: Boolean(options.pending) },
      )
    : { visible: context.text, results: [] };
  const attentionSplit = extractChatAttentionMarker(resultSplit.visible, {
    pending: Boolean(options.pending),
  });
  const nextPathSplit = extractNextPaths(attentionSplit.visible);

  return {
    visible: stripImageMarkers(stripGitHubMarkers(nextPathSplit.visible)),
    cardText: nextPathSplit.visible,
    inlineReasoning: reasoningSplit.reasoning,
    skillUpdates: skillSplit.updates,
    autoStatusUpdate: autoStatusSplit.update,
    authoredResults: resultSplit.results,
    attentionRequest: attentionSplit.request,
    nextPaths: nextPathSplit.suggestions,
  };
}

export function chatTurnVisibleText(turn: {
  role: "user" | "assistant" | "system";
  text: string;
  pending?: boolean;
}): string {
  return turn.role === "assistant"
    ? extractChatRenderedText(turn.text, { pending: Boolean(turn.pending) }).visible
    : turn.text;
}
