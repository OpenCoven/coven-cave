import { extractAgentAttachmentMarkers } from "./chat-attachments.ts";
import { extractAutoStatusMarkers } from "./auto-status-blocks.ts";
import { extractChatAttentionMarker } from "./chat-attention-marker.ts";
import { extractChatResultMarkers } from "./chat-result-markers.ts";
import { splitReasoning } from "./chat-reasoning.ts";
import { stripGitHubMarkers } from "./github-blocks.ts";
import { stripImageMarkers } from "./image-blocks.ts";
import {
  stripIncompletePreviewMarker,
  stripPreviewMarkers,
} from "./preview-blocks.ts";
import { extractNextPaths } from "./next-paths.ts";
import { extractResearchRunMarkers, researchRunPreviewUrl, type ResearchRunMarker } from "./research-run-surface.ts";
import { extractSkillMarkers } from "./skill-blocks.ts";

export type ChatRenderedTextProjection = {
  visible: string;
  cardText: string;
  inlineReasoning: string;
  skillUpdates: ReturnType<typeof extractSkillMarkers>["updates"];
  researchRuns: ReturnType<typeof extractResearchRunMarkers>["runs"];
  autoStatusUpdate: ReturnType<typeof extractAutoStatusMarkers>["update"];
  authoredResults: ReturnType<typeof extractChatResultMarkers>["results"];
  attentionRequest: ReturnType<typeof extractChatAttentionMarker>["request"];
  nextPaths: ReturnType<typeof extractNextPaths>["suggestions"];
};

/**
 * ChatView already has a mature rich-block pipeline for local preview markers.
 * Feed research projections through that pipeline as an internal, reserved
 * local-preview descriptor so the huge transcript renderer does not need a
 * second parallel segmentation implementation. ChatPreviewCard recognizes the
 * reserved path and renders ResearchRunInlineCard instead of a web preview.
 *
 * This marker is renderer-internal. The public skill protocol remains
 * `<coven:research ... />`; providers never depend on this representation.
 */
function researchPreviewMarker(run: ResearchRunMarker): string {
  return `<coven:preview url="${researchRunPreviewUrl(run)}" title="Research run" />`;
}

/**
 * Project an assistant turn through the exact control-marker pipeline used by
 * the transcript. `visible` is prose-only; `cardText` retains GitHub, image,
 * and preview markers so the renderer can replace them with rich cards.
 * Research markers are control metadata: the projection exposes their run
 * snapshots separately and never lets raw protocol text reach prose/card text.
 */
export function extractChatRenderedText(
  text: string,
  options: { pending?: boolean } = {},
): ChatRenderedTextProjection {
  const reasoningSplit = splitReasoning(extractAgentAttachmentMarkers(text).text);
  const skillSplit = extractSkillMarkers(reasoningSplit.visible);
  const autoStatusSplit = extractAutoStatusMarkers(skillSplit.visible);
  const resultSplit = extractChatResultMarkers(autoStatusSplit.visible, {
    pending: Boolean(options.pending),
  });
  const attentionSplit = extractChatAttentionMarker(resultSplit.visible, {
    pending: Boolean(options.pending),
  });
  const nextPathSplit = extractNextPaths(attentionSplit.visible);
  const researchSplit = extractResearchRunMarkers(nextPathSplit.visible);
  const researchCards = researchSplit.runs.map(researchPreviewMarker);
  const cardSource = researchCards.length > 0
    ? `${researchSplit.visible.trimEnd()}\n${researchCards.join("\n")}`
    : researchSplit.visible;

  return {
    visible: stripPreviewMarkers(stripImageMarkers(stripGitHubMarkers(researchSplit.visible))),
    cardText: stripIncompletePreviewMarker(cardSource),
    inlineReasoning: reasoningSplit.reasoning,
    skillUpdates: skillSplit.updates,
    researchRuns: researchSplit.runs,
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
