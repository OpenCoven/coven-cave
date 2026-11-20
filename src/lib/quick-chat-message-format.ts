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
import { sliceReadableUiBlocks, type UiReadablePiece } from "./ui-block-readable.ts";

/** Prose, GitHub cards and actions, and coven:ui blocks as readable lines (#6060). */
export type QuickChatPiece = GitHubTextPiece | UiReadablePiece;

export type QuickChatAssistantMessage = {
  copyText: string;
  visibleProse: string;
  pieces: QuickChatPiece[];
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
  // Quick Chat has no native UI tier: a coven:ui block reads as plain lines
  // once the reply settles, and stays out of the text while it streams.
  const readableText = (readable: QuickChatPiece[]) =>
    readable
      .map((piece) => piece.kind === "text" ? piece.text : piece.kind === "ui" && !streaming ? piece.lines.join("\n") : "")
      .join("");
  const copyText = readableText(sliceReadableUiBlocks(stripGitHubMarkers(markerSafeText), { streaming })).trimEnd();
  const slicedPieces = sliceGitHubBlocks(markerSafeText, {
    unfurlBareUrls: !streaming,
  });
  const pieces = slicedPieces.flatMap((piece, index): QuickChatPiece[] =>
    piece.kind === "text"
      ? sliceReadableUiBlocks(
          index === slicedPieces.length - 1
            ? stripGitHubMarkers(piece.text).trimEnd()
            : stripGitHubMarkers(piece.text),
          { streaming },
        )
      : [piece],
  );
  // A block held back while streaming can leave its blank lines at the end.
  const last = pieces[pieces.length - 1];
  if (last?.kind === "text") pieces[pieces.length - 1] = { ...last, text: last.text.trimEnd() };
  const visibleProse = readableText(pieces);

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
