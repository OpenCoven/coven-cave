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

// ── Race safety ──────────────────────────────────────────────────────────────
assert.match(
  source,
  /const generationRef = useRef\(0\)/,
  "a generation counter makes stale completions inert",
);
assert.match(
  source,
  /if \(gen !== generationRef\.current\) return; \/\/ stale completion — inert/,
  "finish() drops completions from superseded requests",
);
assert.match(
  source,
  /settleEnhance\(baseDraft, draftRef\.current\)/,
  "completion settles against the CURRENT draft, not the one captured at request time",
);
assert.match(
  source,
  /\{ phase: "suggested", enhanced: text, offline \}/,
  "a draft edited mid-flight downgrades the rewrite to a suggestion instead of overwriting",
);
assert.match(
  source,
  /\{ phase: "applied", original: baseDraft, offline \}/,
  "the pre-enhance original only exists in the applied phase, so typing mid-flight has nothing to lose",
);
assert.match(
  source,
  /const selfEditRef = useRef\(false\)/,
  "the hook marks its own setDraft calls so the draft-watch can tell them from user typing",
);
assert.match(
  source,
  /prev\.phase === "applied" \|\| prev\.phase === "error" \? \{ phase: "idle" \} : prev/,
  "a user edit clears applied/error but leaves loading and suggested alive",
);

// ── Model call: ephemeral, hidden, cheap, abortable ──────────────────────────
assert.match(source, /origin: "enhance"/, "enhance runs carry the hidden 'enhance' session origin");
assert.doesNotMatch(source, /sessionId:/, "enhance runs are ephemeral — no session resume");
assert.match(source, /permissionMode: "read"/, "enhance runs force read-only harness permissions");
assert.match(source, /runId,/, "enhance runs include a stop-targetable run id");
assert.match(source, /reasoningEffort: "low"/, "enhance runs use low reasoning effort");
assert.match(source, /responseSpeed: "fast"/, "enhance runs request fast responses");
assert.match(source, /signal: controller\.signal/, "the stream is abortable (cancel + unmount)");
assert.match(
  source,
  /useEffect\(\(\) => \(\) => \{[\s\S]*stopEnhanceRun\(runIdRef\.current\)[\s\S]*abortRef\.current\?\.abort\(\);[\s\S]*\}, \[\]\)/,
  "unmount stops and aborts an in-flight stream",
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
  /buildPromptEnhancement\(\{ draft: baseDraft, mode, context \}\)/,
  "the local rule engine survives as the offline/failure fallback",
);
assert.match(
  source,
  /if \(!familiarId\) \{/,
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
