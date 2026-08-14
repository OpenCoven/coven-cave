import { extractAgentAttachmentMarkers } from "./chat-attachments.ts";
import { extractAutoStatusMarkers } from "./auto-status-blocks.ts";
import { extractChatAttentionMarker } from "./chat-attention-marker.ts";
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
  attentionRequest: ReturnType<typeof extractChatAttentionMarker>["request"];
  nextPaths: ReturnType<typeof extractNextPaths>["suggestions"];
};

/**
 * Project an assistant turn through the exact control-marker pipeline used by
 * the transcript. `visible` is prose-only; `cardText` retains GitHub and image
 * markers so the renderer can replace them with rich cards.
 */
export function extractChatRenderedText(
  text: string,
  options: { pending?: boolean } = {},
): ChatRenderedTextProjection {
  const reasoningSplit = splitReasoning(extractAgentAttachmentMarkers(text).text);
  const skillSplit = extractSkillMarkers(reasoningSplit.visible);
  const autoStatusSplit = extractAutoStatusMarkers(skillSplit.visible);
  const attentionSplit = extractChatAttentionMarker(autoStatusSplit.visible, {
    pending: Boolean(options.pending),
  });
  const nextPathSplit = extractNextPaths(attentionSplit.visible);

  return {
    visible: stripImageMarkers(stripGitHubMarkers(nextPathSplit.visible)),
    cardText: nextPathSplit.visible,
    inlineReasoning: reasoningSplit.reasoning,
    skillUpdates: skillSplit.updates,
    autoStatusUpdate: autoStatusSplit.update,
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
