import {
  sliceGitHubBlocks,
  stripGitHubMarkers,
  stripIncompleteGitHubMarker,
  type GitHubTextPiece,
} from "./github-blocks.ts";
import {
  extractChatResultMarkersFromScan,
  hasChatResultProtocolCandidate,
  scanChatResultProtocol,
  type ChatResultProtocolScanner,
} from "./chat-result-markers.ts";
import {
  createChatResultScanContext,
  hasChatSkillCandidate,
} from "./chat-rendered-text.ts";
import { extractNextPaths } from "./next-paths.ts";
import type { NextPath } from "./next-paths.ts";
import {
  extractSkillMarkers,
  type SkillStageUpdate,
} from "./skill-blocks.ts";

export type QuickChatAssistantMessage = {
  copyText: string;
  pieces: GitHubTextPiece[];
  skillUpdates: SkillStageUpdate[];
  authoredResults: ReturnType<typeof extractChatResultMarkersFromScan>["results"];
  suggestions: NextPath[];
};

export function formatQuickChatAssistantMessage(
  text: string,
  streaming: boolean,
  scanResultProtocol: ChatResultProtocolScanner = scanChatResultProtocol,
): QuickChatAssistantMessage {
  const context = createChatResultScanContext(text, scanResultProtocol);
  const hasSkillCandidate = hasChatSkillCandidate(context.text);
  const skillResultProtocol = (
    hasSkillCandidate
    && hasChatResultProtocolCandidate(context.text)
  )
    ? context.getScan()
    : null;
  const skillSplit = hasSkillCandidate
    ? extractSkillMarkers(
        context.text,
        skillResultProtocol?.markdownRangeSource ?? context.text,
        skillResultProtocol?.protectedRanges ?? [],
      )
    : { visible: context.text, updates: [] };
  context.setText(skillSplit.visible);
  const resultSplit = hasChatResultProtocolCandidate(context.text)
    ? extractChatResultMarkersFromScan(
        context.text,
        context.getScan(),
        { pending: streaming },
      )
    : { visible: context.text, results: [] };
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

  return {
    copyText,
    pieces,
    skillUpdates: skillSplit.updates,
    authoredResults: resultSplit.results,
    suggestions: streaming ? [] : nextPaths.suggestions,
  };
}
