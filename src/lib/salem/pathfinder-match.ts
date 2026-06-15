// Deterministic intent → happy-path matcher. Pure, no IO, no model. Scores the
// user's message against each registry path's intents/audiences/title, filtered
// by the requested mode's surface, and returns the best path plus confidence and
// a few clarifying assumptions. v0 generation is registry-grounded (design's
// sanctioned "model unavailable → deterministic fallback").

import { HAPPY_PATHS, type HappyPath } from "./happy-paths.ts";
import type { SalemPathfinderRequest, SalemPathfinderResult } from "./pathfinder-types.ts";

const STOPWORDS = new Set([
  "i", "a", "an", "the", "to", "want", "need", "would", "like", "my", "me", "on",
  "of", "for", "with", "and", "or", "is", "it", "this", "that", "get", "have",
  "do", "can", "you", "please", "help", "im", "am", "in", "into", "up", "set",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function surfaceAllows(path: HappyPath, mode: "setup" | "home"): boolean {
  return path.surface === "both" || path.surface === mode;
}

function scorePath(messageTokens: string[], path: HappyPath): number {
  if (messageTokens.length === 0) return 0;
  const haystack = new Set(
    tokenize([path.title, path.audiences.join(" "), path.intents.join(" ")].join(" ")),
  );
  let score = 0;
  for (const t of messageTokens) if (haystack.has(t)) score += 1;
  // Phrase bonus: a path intent fully contained in the message is a strong signal.
  const msg = messageTokens.join(" ");
  for (const intent of path.intents) {
    const it = tokenize(intent).join(" ");
    if (it && msg.includes(it)) score += 3;
  }
  return score;
}

function buildAssumptions(req: SalemPathfinderRequest, confidence: string): string[] {
  const out: string[] = [];
  const ms = req.machineState;
  if (ms?.covenCli === "missing") out.push("Assuming you still need to install the Coven CLI.");
  else if (ms?.daemon === "stopped" || ms?.daemon === "unhealthy") out.push("Assuming the Coven daemon needs to be started or repaired.");
  else if (ms?.platform && ms.platform !== "unknown") out.push(`Assuming you're on ${ms.platform}.`);
  if (confidence === "low" && out.length === 0) {
    out.push("I wasn't sure which path fits — here's the closest one. Tell me more to refine it.");
  }
  // Keep low-confidence guidance to a single clarifying line.
  return confidence === "low" ? out.slice(0, 1) : out;
}

export function matchPath(req: SalemPathfinderRequest): SalemPathfinderResult {
  const candidates = HAPPY_PATHS.filter((p) => surfaceAllows(p, req.mode));
  const pool = candidates.length > 0 ? candidates : HAPPY_PATHS;
  const tokens = tokenize(req.userMessage ?? "");

  const scored = pool
    .map((p) => ({ p, score: scorePath(tokens, p) }))
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  const second = scored[1];

  let confidence: SalemPathfinderResult["confidence"];
  if (!top || top.score === 0) confidence = "low";
  else if (!second || top.score >= second.score + 3 || top.score >= second.score * 2) confidence = "high";
  else confidence = "medium";

  // Low confidence falls back to the most onboarding-appropriate path in the pool.
  const fallback =
    pool.find((p) => p.id === "first-familiar-cave") ?? pool[0] ?? HAPPY_PATHS[0];
  const chosen = confidence === "low" ? fallback : top.p;

  return {
    pathId: chosen.id,
    confidence,
    assumptions: buildAssumptions(req, confidence),
  };
}
