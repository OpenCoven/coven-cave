// The live transcript a call renders while it is up.
//
// Three signals feed it, and they do not arrive in tidy turn order:
//   partial   — the ACCUMULATED text of the turn currently being transcribed
//               (ears) or streamed (brain); replaces, never appends
//   final     — the settled text of a completed turn
//   speaking  — the utterance the mouth is voicing RIGHT NOW. Loop providers
//               voice sentence chunks (speech-loop.ts), so this is a substring
//               of the assistant turn, which is exactly what lets the overlay
//               highlight the words being spoken instead of the whole reply.
//
// Everything here is pure so the highlight logic is testable without a
// microphone, a synthesizer, or a DOM.

export type CallTurnRole = "user" | "assistant";

export type CallTurn = {
  id: string;
  role: CallTurnRole;
  text: string;
  /** False while the turn is still being transcribed or streamed. */
  final: boolean;
};

export type CallTranscript = {
  turns: CallTurn[];
  /** Monotonic source for turn ids — stable React keys across updates. */
  seq: number;
  /** The utterance being voiced right now, or null when the mouth is idle. */
  speaking: string | null;
};

export const emptyTranscript: CallTranscript = { turns: [], seq: 0, speaking: null };

/** How many turns a single call keeps in view. A long call must not grow the
 *  DOM without bound; the persisted chat transcript is the durable record. */
export const MAX_CALL_TURNS = 60;

function trimToCap(turns: CallTurn[]): CallTurn[] {
  return turns.length <= MAX_CALL_TURNS ? turns : turns.slice(turns.length - MAX_CALL_TURNS);
}

/**
 * Fold in the accumulated text of an in-flight turn. A partial for the role
 * that already owns the open turn REPLACES it; anything else opens a new one,
 * which is what makes a mid-reply user interjection render as its own bubble.
 */
export function applyPartial(
  transcript: CallTranscript,
  role: CallTurnRole,
  text: string,
): CallTranscript {
  if (!text.trim()) return transcript;
  const last = transcript.turns[transcript.turns.length - 1];
  if (last && !last.final && last.role === role) {
    if (last.text === text) return transcript;
    const turns = transcript.turns.slice(0, -1);
    turns.push({ ...last, text });
    return { ...transcript, turns };
  }
  const seq = transcript.seq + 1;
  return {
    ...transcript,
    seq,
    turns: trimToCap([...transcript.turns, { id: `t${seq}`, role, text, final: false }]),
  };
}

/**
 * Settle a turn. An open turn of the same role is upgraded in place (the
 * partials that built it were the same utterance); otherwise the final lands
 * as a new turn. A final identical to the previous settled turn of that role
 * is dropped — realtime providers emit a `done` transcript for text we may
 * already have settled, and a call must not stutter.
 */
export function applyFinal(
  transcript: CallTranscript,
  role: CallTurnRole,
  text: string,
): CallTranscript {
  const settled = text.trim();
  if (!settled) return transcript;
  const turns = transcript.turns.slice();
  const last = turns[turns.length - 1];
  if (last && !last.final && last.role === role) {
    turns[turns.length - 1] = { ...last, text: settled, final: true };
    return { ...transcript, turns };
  }
  if (last && last.final && last.role === role && last.text === settled) {
    return transcript;
  }
  const seq = transcript.seq + 1;
  return {
    ...transcript,
    seq,
    turns: trimToCap([...turns, { id: `t${seq}`, role, text: settled, final: true }]),
  };
}

/** Record (or clear) the utterance the mouth is voicing. */
export function applySpeaking(
  transcript: CallTranscript,
  utterance: string | null,
): CallTranscript {
  const next = utterance && utterance.trim() ? utterance.trim() : null;
  if (next === transcript.speaking) return transcript;
  return { ...transcript, speaking: next };
}

export type SpokenSplit = {
  before: string;
  /** The spoken run, empty when this turn is not the one being voiced. */
  match: string;
  after: string;
};

/** Regex-escape, then let any whitespace run match any other. The chunker
 *  trims what it hands the mouth, and a streamed reply can rewrap, so an
 *  exact `indexOf` misses highlights it should have found. */
function spokenPattern(spoken: string): RegExp {
  const escaped = spoken
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  return new RegExp(escaped);
}

/**
 * Split a turn's text around the utterance being spoken, so the overlay can
 * wrap the middle in a highlight. Returns the whole text as `before` when the
 * utterance is absent from it — the highlight is an enhancement, never a
 * reason to drop words from the transcript.
 */
export function splitSpokenText(text: string, spoken: string | null): SpokenSplit {
  if (!spoken || !spoken.trim()) return { before: text, match: "", after: "" };
  const exact = text.indexOf(spoken);
  if (exact >= 0) {
    return {
      before: text.slice(0, exact),
      match: text.slice(exact, exact + spoken.length),
      after: text.slice(exact + spoken.length),
    };
  }
  let found: RegExpExecArray | null = null;
  try {
    found = spokenPattern(spoken).exec(text);
  } catch {
    // A pathological chunk that won't compile is simply not highlighted.
    found = null;
  }
  if (!found) return { before: text, match: "", after: "" };
  return {
    before: text.slice(0, found.index),
    match: found[0],
    after: text.slice(found.index + found[0].length),
  };
}

/**
 * Which turn the highlight belongs to: the LAST assistant turn whose text
 * contains the spoken utterance. Scanning from the end matters because a
 * familiar repeats itself across a long call, and the highlight must track the
 * reply being voiced now, not the first one that happened to match.
 */
export function speakingTurnId(transcript: CallTranscript): string | null {
  const { speaking, turns } = transcript;
  if (!speaking) return null;
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i]!;
    if (turn.role !== "assistant") continue;
    if (splitSpokenText(turn.text, speaking).match) return turn.id;
  }
  return null;
}
