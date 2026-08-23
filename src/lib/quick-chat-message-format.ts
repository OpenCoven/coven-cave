import {
  sliceGitHubBlocks,
  stripGitHubMarkers,
  stripIncompleteGitHubMarker,
  type GitHubTextPiece,
} from "./github/github-blocks.ts";
import { extractNextPaths } from "./projects/next-paths.ts";
import type { NextPath } from "./projects/next-paths.ts";
import {
  extractSkillMarkers,
  type SkillStageUpdate,
} from "./skills/skill-blocks.ts";

export type QuickChatAssistantMessage = {
  copyText: string;
  pieces: GitHubTextPiece[];
  skillUpdates: SkillStageUpdate[];
  suggestions: NextPath[];
};

export function formatQuickChatAssistantMessage(
  text: string,
  streaming: boolean,
): QuickChatAssistantMessage {
  const skillSplit = extractSkillMarkers(text);
  const nextPaths = extractNextPaths(skillSplit.visible);
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

  return {
    copyText,
    pieces,
    skillUpdates: skillSplit.updates,
    suggestions: streaming ? [] : nextPaths.suggestions,
  };
}
