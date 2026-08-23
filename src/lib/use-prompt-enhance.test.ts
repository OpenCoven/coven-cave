// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Source pins for the shared model-backed enhance hook (cave-b6c2). The pure
// protocol (instruction builder, extractor, race rule) is executed in
// prompt-enhancer.test.ts; these hold the hook's lifecycle mechanics — the
// generation guard, the ephemeral-run controls, and the offline fallback —
// which regressions historically snuck past (the old per-composer copies lost
// the Revert original when the user typed mid-flight).

const source = await readFile(new URL("./use-prompt-enhance.ts", import.meta.url), "utf8");

// ── Shared lifecycle + race safety ───────────────────────────────────────────
assert.match(
  source,
  /useAgenticRecommendations/,
  "Chat Enhance delegates cancellation and stale-fingerprint handling to the shared lifecycle",
);
assert.match(
  source,
  /autoGenerate: false/,
  "prompt typing updates context but never requests a recommendation by itself",
);
assert.match(
  source,
  /agentic\.refresh\(\)/,
  "an explicit Enhance action starts the shared lifecycle",
);
assert.match(
  source,
  /const baseDraft = draftOverride \?\? draftRef\.current/,
  "callers that transform a draft before Enhance can pass the exact text without waiting for a render",
);
assert.match(
  source,
  /settleEnhance\(activeRequest\.baseDraft, draftRef\.current\)/,
  "completion settles against the CURRENT draft, not the one captured at request time",
);
assert.match(
  source,
  /phase: "suggested",[\s\S]*?enhanced: recommendation\.payload\.enhanced,[\s\S]*?offline,[\s\S]*?recommendation,/,
  "a draft edited mid-flight downgrades the rewrite to a suggestion instead of overwriting",
);
assert.match(
  source,
  /original: activeRequest\.baseDraft,[\s\S]*?offline,[\s\S]*?recommendation,/,
  "the pre-enhance original only exists in the applied phase, so typing mid-flight has nothing to lose",
);
assert.match(
  source,
  /const selfEditRef = useRef\(false\)/,
  "the hook marks its own setDraft calls so the draft-watch can tell them from user typing",
);
assert.match(
  source,
  /previous\.phase === "applied" \|\| previous\.phase === "error" \? \{ phase: "idle" \} : previous/,
  "a user edit clears applied/error but leaves loading and suggested alive",
);
assert.match(
  source,
  /createPromptEnhancementRecommendation/,
  "strict enhanced text is wrapped as a shared Chat recommendation",
);
assert.match(
  source,
  /serializePromptEnhancementRecommendation/,
  "the wrapper is re-read through strict shared recommendation extraction",
);
assert.match(
  source,
  /parseOutput: parsePromptEnhancementRecommendationOutput/,
  "Chat uses its bounded prompt-specific parser without relaxing shared limits",
);
assert.match(
  source,
  /extractCompleteEnhancedPrompt\(text\)/,
  "only a complete enhanced frame becomes a recommendation; malformed output retries",
);
assert.match(
  source,
  /return enhanced \? toRecommendationOutput\(enhanced, false\) : "\{\}";/,
  "tagless or unterminated frames stay malformed for the shared one-retry path",
);
assert.match(
  source,
  /isPromptEnhancementRecommendationCurrent/,
  "stale suggestions are cleared and rejected before Apply",
);
{
  const completion = source.match(
    /const item = agentic\.state\.items\.find[\s\S]*?announce\("Enhanced prompt ready — apply or dismiss\.", "polite"\);/,
  )?.[0] ?? "";
  const freshness = completion.search(
    /isPromptEnhancementRecommendationCurrent\(\s*recommendation,\s*currentContextFingerprintRef\.current,\s*\)/,
  );
  const handled = completion.indexOf("handledRecommendationRef.current = recommendation.id");
  const settle = completion.indexOf("settleEnhance(activeRequest.baseDraft, draftRef.current)");
  assert.ok(freshness >= 0, "completion rechecks the newest context fingerprint");
  assert.ok(
    freshness < handled && freshness < settle,
    "a same-act deferred completion cannot mark or auto-apply after files, task, or model scope changed",
  );
}

// ── Model call: ephemeral, hidden, cheap, abortable ──────────────────────────
assert.match(source, /origin: "enhance"/, "enhance runs carry the hidden 'enhance' session origin");
assert.doesNotMatch(source, /sessionId:/, "enhance runs are ephemeral — no session resume");
assert.match(source, /permissionMode: "read"/, "enhance runs force read-only harness permissions");
assert.match(source, /runId: request\.runId/, "enhance runs include a stop-targetable run id");
assert.match(source, /reasoningEffort: "low"/, "enhance runs use low reasoning effort");
assert.match(source, /responseSpeed: "fast"/, "enhance runs request fast responses");
assert.match(source, /signal: controller\.signal/, "the stream is abortable through the shared lifecycle");
assert.match(
  source,
  /cancelRun: stopEnhanceRun/,
  "shared lifecycle cancellation stops the ephemeral familiar run",
);
assert.match(
  source,
  /extractEnhancedPrompt\(text\)/,
  "streaming previews and the final result run through the tag extractor",
);

// ── Fallback: local rule engine, never the dead API route ────────────────────
assert.match(
  source,
  /ENHANCE_FIRST_TOKEN_TIMEOUT_MS = 8000/,
  "no first token within 8s falls back to the local rule engine",
);
assert.match(
  source,
  /draft: activeRequest\.baseDraft,[\s\S]*?mode,[\s\S]*?context: contextRef\.current/,
  "the local rule engine survives as the offline/failure fallback",
);
assert.match(
  source,
  /if \(!familiarIdRef\.current\)/,
  "no familiar selected → immediate local fallback (no doomed stream attempt)",
);
assert.doesNotMatch(
  source,
  /fetch\(\"\/api\/prompt\/enhance/,
  "the hook never calls the dead /api/prompt/enhance route",
);

// ── Announcements ────────────────────────────────────────────────────────────
assert.match(
  source,
  /announce\(offline \? "Prompt enhanced offline\." : "Prompt enhanced\.", "polite"\)/,
  "an in-place apply is announced, with the offline path labelled",
);
assert.match(
  source,
  /announce\("Enhanced prompt ready — apply or dismiss\.", "polite"\)/,
  "a suggestion (draft changed mid-flight) is announced",
);
assert.match(
  source,
  /announce\("Prompt restored\.", "polite"\)/,
  "revert is announced",
);

console.log("use-prompt-enhance.test.ts: ok");
