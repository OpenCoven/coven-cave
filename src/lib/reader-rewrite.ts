// The Rewrite control in the Expand reader (Reader.dc.html frame 3a): the same
// answer in a different register.
//
// Pure: the prompt each tone asks for, and how the model's reply is recovered
// from a --stream-json run. No spawning, no fetch — so the interesting parts
// are unit-testable with bare node, and the route stays a thin shell.

/** Full is the answer as written; it is never a model call. */
export const REWRITE_TONES = ["brief", "eli5"] as const;
export type RewriteTone = (typeof REWRITE_TONES)[number];

export function isRewriteTone(value: unknown): value is RewriteTone {
  return typeof value === "string" && (REWRITE_TONES as readonly string[]).includes(value);
}

/** An answer this long is not worth a rewrite — and a very large prompt is the
 *  one way this feature could become expensive by accident. */
export const REWRITE_MAX_CHARS = 24_000;

/**
 * What to ask for. Deliberately constrains the model to REWRITING: it must not
 * answer the question again, look anything up, or add findings the original did
 * not have — a "condensed" answer that quietly invents a new claim is worse
 * than no condensation at all.
 */
export function rewritePrompt(tone: RewriteTone, answer: string): string {
  const shared = [
    "Rewrite the text below. Do not answer it, research it, or add anything it",
    "does not already say. Keep every factual claim, file path, identifier and",
    "number exactly as written. Preserve markdown structure where it survives",
    "the rewrite. Reply with the rewritten text and nothing else — no preamble,",
    "no explanation of what you changed.",
  ].join(" ");

  const instruction =
    tone === "brief"
      ? "Make it as short as it can be while keeping every finding and its verdict."
      : "Explain it so a reader outside this codebase follows it: expand jargon on "
        + "first use, prefer plain words, keep the same conclusions.";

  return `${shared}\n\n${instruction}\n\n---\n\n${answer}`;
}

/**
 * Recover the assistant's text from a `coven run --stream-json` transcript.
 *
 * The stream is JSON-per-line; the shapes vary by harness, so this reads the
 * union defensively and concatenates every assistant text chunk in order.
 * Lines that are not JSON, or carry no text, are skipped rather than throwing —
 * a partial stream should still yield whatever prose arrived.
 */
export function extractRewrite(raw: string): string {
  const parts: string[] = [];

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed[0] !== "{") continue;

    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!event || typeof event !== "object") continue;

    const record = event as Record<string, unknown>;
    // Only assistant prose. A `role` of "user" is the prompt echoed back, and
    // tool/system events carry text that is not part of the answer.
    const role = typeof record.role === "string" ? record.role : undefined;
    if (role && role !== "assistant") continue;

    const direct = typeof record.text === "string" ? record.text : undefined;
    if (direct) {
      parts.push(direct);
      continue;
    }

    // { message: { content: [ { type: "text", text } ] } } and the flatter
    // { content: "…" } both appear across harnesses.
    const message = record.message as Record<string, unknown> | undefined;
    const content = (message?.content ?? record.content) as unknown;
    if (typeof content === "string") {
      parts.push(content);
      continue;
    }
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const b = block as Record<string, unknown>;
        if (b.type && b.type !== "text") continue;
        if (typeof b.text === "string") parts.push(b.text);
      }
    }
  }

  return parts.join("").trim();
}

/** Whether a rewrite is worth showing. An empty or near-empty reply means the
 *  run failed in a way that produced no prose, and the reader must keep the
 *  original rather than blank the document. */
export function isUsableRewrite(text: string): boolean {
  return text.trim().length >= 8;
}
