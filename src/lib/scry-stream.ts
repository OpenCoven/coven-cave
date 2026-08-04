/**
 * scry-stream — the wire between `POST /api/scry` and the rite (cave-3rz.3).
 *
 * A scry takes 12–18 seconds against a local vision harness. One static line
 * for that long reads as a hang, so the endpoint streams instead of blocking:
 * SSE frames, shaped exactly like the chat route's (`data: <json>\n\n`), so
 * there is one wire convention in the app rather than two.
 *
 * **Every stage here is observed, never timed.** There is no scheduler in this
 * file and no synthetic tick anywhere in the endpoint: a stage is emitted at
 * the moment the endpoint actually passes through it, so a slow harness shows a
 * long stage rather than a progress bar that has moved on without it.
 *
 * What the harness actually gives us, measured against `coven run codex
 * --stream-json` on this machine (three runs, portrait JPEG):
 *
 * ```
 *   +0.12s  {"type":"system","subtype":"init",…}   → "looking"
 *   +0.13s  {"type":"user",…}                      → the image path is delivered
 *   +6.0s   {"type":"assistant",…}  prose          → "speaking" (real text)
 *   +10.3s  {"type":"assistant",…}  the JSON       → suggestions
 *   +11.3s  {"type":"result",…}                    → "done"
 * ```
 *
 * So assistant text arrives as WHOLE MESSAGES, not token deltas — `coven run`
 * has no `--include-partial-messages` equivalent (`coven run --help`). Asking
 * the harness for one message per field does produce genuinely progressive
 * field arrival, but it was measured at 18.7s end to end against 12.5s for the
 * single-JSON reply: the fast reply finishes before the split one has revealed
 * its second field. The single reply won. What streams is therefore the stage
 * sequence plus the harness's real mid-flight prose — not a fake token feed.
 */

/**
 * Ordered because the rite draws a progress rail from it. Each id names
 * something the endpoint can prove happened.
 */
export const SCRY_STAGES = [
  /** Asking `/api/harnesses` which local runtime can open an image file. */
  "picking",
  /** One answered, and its label is on the event. */
  "harness",
  /** The likeness is written to a temp path the harness can read. */
  "staged",
  /** The child process reported `system.init` and took the prompt. */
  "looking",
  /** The harness emitted its first words — real text rides along. */
  "speaking",
  /** The reply was parsed into suggestions. */
  "done",
] as const;

export type ScryStage = (typeof SCRY_STAGES)[number];

export function scryStageIndex(stage: ScryStage): number {
  return SCRY_STAGES.indexOf(stage);
}

export type ScryStreamEvent =
  /** A stage the endpoint actually reached. `detail` carries a fact (a harness
   *  label), never a description of the stage — the surface owns the wording. */
  | { kind: "stage"; stage: ScryStage; detail?: string }
  /** Verbatim assistant text, forwarded the moment the frame arrives. */
  | { kind: "text"; text: string }
  /** Terminal success. Same payload the endpoint used to return as JSON. */
  | {
      kind: "done";
      harness: string;
      harnessLabel: string;
      model: string | null;
      suggestions: unknown;
    }
  /** Terminal failure, after the stream has already opened. */
  | { kind: "error"; code: string; error: string };

/** Encode one event using the app's existing SSE convention. */
export function scrySse(event: ScryStreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

// ── Harness frame reading ────────────────────────────────────────────────────

export type ScryHarnessFrame =
  | { kind: "init" }
  | { kind: "prompt" }
  | { kind: "assistant"; text: string }
  | { kind: "result" }
  | null;

/**
 * Interpret one line of `coven run --stream-json` output.
 *
 * Returns `null` for anything that is not a recognised frame, including plain
 * text a harness printed outside the JSONL contract — the caller keeps that
 * text for `parseScryReply`, which is deliberately tolerant of it.
 */
export function readScryHarnessFrame(line: string): ScryHarnessFrame {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  let event: {
    type?: unknown;
    message?: { content?: Array<{ type?: unknown; text?: unknown }> };
  };
  try {
    event = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (event.type === "system") return { kind: "init" };
  if (event.type === "user") return { kind: "prompt" };
  if (event.type === "result") return { kind: "result" };
  if (event.type === "assistant") {
    let text = "";
    for (const block of event.message?.content ?? []) {
      if (block?.type === "text" && typeof block.text === "string") text += block.text;
    }
    return { kind: "assistant", text };
  }
  return null;
}

// ── Client-side decoding ─────────────────────────────────────────────────────

/**
 * Pull whole SSE events out of a chunk, returning the unterminated remainder.
 *
 * A `fetch` body chunk splits wherever the network felt like splitting it, so
 * the tail is carried into the next call rather than parsed early. Comment
 * lines (the heartbeat) are skipped.
 */
export function decodeScryStream(
  chunk: string,
  carry = "",
): { events: ScryStreamEvent[]; carry: string } {
  const buffer = carry + chunk;
  const parts = buffer.split("\n\n");
  const remainder = parts.pop() ?? "";
  const events: ScryStreamEvent[] = [];
  for (const part of parts) {
    for (const line of part.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        events.push(JSON.parse(payload) as ScryStreamEvent);
      } catch {
        // A truncated or malformed frame is dropped rather than failing the
        // scry: the terminal `done`/`error` event is what the caller waits on.
      }
    }
  }
  return { events, carry: remainder };
}

/**
 * Text worth showing a person, out of a harness message.
 *
 * The harness is asked for one JSON object; it usually narrates first anyway
 * ("I'm inspecting the image and will return only the requested JSON object").
 * That narration is real progress and is worth surfacing. The JSON payload is
 * not — it is the answer, and the rite renders it as fields.
 */
export function scryMurmur(text: string): string | null {
  const bare = text.trim();
  if (!bare || bare.startsWith("{") || bare.startsWith("[")) return null;
  const firstLine = bare.split(/\r?\n/).find((line) => line.trim()) ?? "";
  const cleaned = firstLine.replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.startsWith("{")) return null;
  return cleaned.length > 160 ? `${cleaned.slice(0, 159).trimEnd()}…` : cleaned;
}
