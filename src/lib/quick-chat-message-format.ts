import {
  sliceGitHubBlocks,
  stripGitHubMarkers,
  stripIncompleteGitHubMarker,
  type GitHubTextPiece,
} from "./github-blocks.ts";
import { extractChatResultMarkers } from "./chat-result-markers.ts";
import { extractNextPaths } from "./next-paths.ts";
import type { NextPath } from "./next-paths.ts";
import { extractResearchRunMarkers, type ResearchRunMarker } from "./research-run-surface.ts";
import {
  extractSkillMarkers,
  type SkillStageUpdate,
} from "./skill-blocks.ts";

export type QuickChatAssistantMessage = {
  copyText: string;
  visibleProse: string;
  pieces: GitHubTextPiece[];
  skillUpdates: SkillStageUpdate[];
  researchRuns: ResearchRunMarker[];
  authoredResults: ReturnType<typeof extractChatResultMarkers>["results"];
  suggestions: NextPath[];
};

export function formatQuickChatAssistantMessage(
  text: string,
  streaming: boolean,
): QuickChatAssistantMessage {
  const researchSplit = extractResearchRunMarkers(text);
  const skillSplit = extractSkillMarkers(researchSplit.visible);
  const resultSplit = extractChatResultMarkers(skillSplit.visible, {
    pending: streaming,
  });
  const nextPaths = extractNextPaths(resultSplit.visible);
  const markerSafeText = stripIncompleteGitHubMarker(nextPaths.visible);
  const copyText = stripGitHubMarkers(markerSafeText).trimEnd();
  const slicedPieces = sliceGitHubBlocks(markerSafeText, {
    unfurlBareUrls: !streaming,
  });
  const pieces = slicedPieces.map((piece, index) =>
    piece.kind === "text"
      ? {
          ...piece,
          text: index === slicedPieces.length - 1
            ? stripGitHubMarkers(piece.text).trimEnd()
            : stripGitHubMarkers(piece.text),
        }
      : piece,
  );
  const visibleProse = pieces
    .filter((piece): piece is Extract<GitHubTextPiece, { kind: "text" }> => piece.kind === "text")
    .map((piece) => piece.text)
    .join("");

  return {
    copyText,
    visibleProse,
    pieces,
    skillUpdates: skillSplit.updates,
    researchRuns: researchSplit.runs,
    authoredResults: resultSplit.results,
    suggestions: streaming ? [] : nextPaths.suggestions,
  };
}
