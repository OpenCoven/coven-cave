// Pure helpers for the LLM-judge grader. The actual model call is done by the
// client run engine through the existing chat pipeline (/api/chat/send) — no
// new server-side LLM route — so these stay pure and unit-testable: build the
// judge prompt, then parse the model's verdict back into a 0..1 score.

import type { Grader } from "./eval-model.ts";

/**
 * Compose the grading prompt sent to the judge. We ask for a strict JSON
 * verdict so {@link parseJudgeVerdict} can read it deterministically, but the
 * parser also tolerates a bare "SCORE: n" / pass-fail fallback.
 */
export function buildJudgePrompt(rubric: string, input: string, output: string): string {
  return [
    "You are a strict evaluation judge. Score how well the RESPONSE satisfies the RUBRIC.",
    "Reply with ONLY a JSON object on a single line: {\"score\": <0..1>, \"pass\": <true|false>, \"reason\": \"<short>\"}.",
    "Do not include any other text.",
    "",
    `RUBRIC:\n${rubric.trim()}`,
    "",
    `PROMPT GIVEN TO THE MODEL:\n${input.trim()}`,
    "",
    `RESPONSE TO GRADE:\n${output.trim()}`,
  ].join("\n");
}

export type JudgeVerdict = {
  score: number;
  pass: boolean;
  reason: string;
};

/**
 * Parse a judge reply into a verdict. Order of attempts:
 *   1. JSON object with score/pass/reason (possibly fenced or embedded).
 *   2. "score: 0.8" / "8/10" / "85%" numeric fallback.
 *   3. bare PASS/FAIL keyword.
 * Defaults to a failing 0 when nothing parses, so an unparseable judge can't
 * silently pass a case.
 */
export function parseJudgeVerdict(reply: string): JudgeVerdict {
  const text = reply.trim();

  // 1. JSON
  const json = extractJsonObject(text);
  if (json) {
    try {
      const obj = JSON.parse(json) as Record<string, unknown>;
      if ("score" in obj || "pass" in obj) {
        const score = clamp01(toNumber(obj.score));
        const pass = typeof obj.pass === "boolean" ? obj.pass : score >= 0.5;
        const reason = typeof obj.reason === "string" ? obj.reason : "";
        return { score: "score" in obj ? score : pass ? 1 : 0, pass, reason };
      }
    } catch {
      // fall through to heuristics
    }
  }

  // 2. numeric fallbacks
  const pct = text.match(/(\d{1,3})\s*%/);
  if (pct) {
    const score = clamp01(Number(pct[1]) / 100);
    return { score, pass: score >= 0.5, reason: text.slice(0, 120) };
  }
  const frac = text.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (frac) {
    const denom = Number(frac[2]) || 1;
    const score = clamp01(Number(frac[1]) / denom);
    return { score, pass: score >= 0.5, reason: text.slice(0, 120) };
  }
  const scoreKw = text.match(/score["\s:=]+(\d+(?:\.\d+)?)/i);
  if (scoreKw) {
    let n = Number(scoreKw[1]);
    if (n > 1) n = n / (n > 10 ? 100 : 10); // tolerate 0..10 / 0..100 scales
    const score = clamp01(n);
    return { score, pass: score >= 0.5, reason: text.slice(0, 120) };
  }

  // 3. bare keyword
  if (/\bpass(ed)?\b/i.test(text) && !/\bfail/i.test(text)) {
    return { score: 1, pass: true, reason: text.slice(0, 120) };
  }
  if (/\bfail(ed)?\b/i.test(text)) {
    return { score: 0, pass: false, reason: text.slice(0, 120) };
  }

  return { score: 0, pass: false, reason: "could not parse judge verdict" };
}

/** Convenience: graders that carry an empty rubric can't be judged meaningfully. */
export function judgeRubric(g: Grader): string {
  return (g.rubric ?? g.value ?? "").trim();
}

// ---- internals -------------------------------------------------------------

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  return NaN;
}

function extractJsonObject(text: string): string | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return body.slice(start, end + 1);
}
