import type { Turn } from "./chat-turn-state";

export type TranscriptVoiceGroup = { kind: "call"; callId: string; turns: Turn[]; durationSec: number };
export type TranscriptSingleItem = { kind: "single"; turn: Turn };
export type TranscriptGroup = TranscriptVoiceGroup | TranscriptSingleItem;

/** Count actual turns excluded when the transcript mounts only its newest groups. */
export function countHiddenTranscriptTurns(groups: readonly TranscriptGroup[], renderCap: number): number {
  const hiddenGroupCount = Math.max(0, groups.length - Math.max(0, renderCap));
  return groups.slice(0, hiddenGroupCount).reduce(
    (count, group) => count + (group.kind === "call" ? group.turns.length : 1),
    0,
  );
}

/** Build the visible transcript's voice-call groups and stable row index map. */
export function groupTranscriptTurns(activePath: Turn[]): {
  groupedTurns: TranscriptGroup[];
  turnIndexMap: Map<string, number>;
} {
  const groupedTurns: TranscriptGroup[] = [];
  for (const turn of activePath) {
    if (!turn.voiceCallId) {
      groupedTurns.push({ kind: "single", turn });
      continue;
    }
    const last = groupedTurns[groupedTurns.length - 1];
    if (last?.kind === "call" && last.callId === turn.voiceCallId) {
      last.turns.push(turn);
      const firstAt = Date.parse(last.turns[0].createdAt);
      const lastAt = Date.parse(turn.createdAt);
      last.durationSec = Math.max(0, Math.floor((lastAt - firstAt) / 1000));
    } else {
      groupedTurns.push({ kind: "call", callId: turn.voiceCallId, turns: [turn], durationSec: 0 });
    }
  }
  return {
    groupedTurns,
    turnIndexMap: new Map(activePath.map((turn, index) => [turn.id, index])),
  };
}
