// @ts-nocheck
import assert from "node:assert/strict";
import {
  ENHANCE_INTENTS,
  buildEnhanceInstruction,
  buildPromptEnhancement,
  createPromptEnhancementRecommendation,
  extractCompleteEnhancedPrompt,
  extractEnhancedPrompt,
  isPromptEnhancementRecommendationCurrent,
  normalizeEnhanceMode,
  parsePromptEnhancementRecommendationOutput,
  promptEnhancementEvidenceRefs,
  promptEnhancementLifecycleFingerprint,
  serializePromptEnhancementRecommendation,
  settleEnhance,
} from "./prompt-enhancer.ts";
import { parseAgenticRecommendationsOutput } from "./agentic-recommendations.ts";

const code = buildPromptEnhancement({
  draft: "fix login bug",
  mode: "code",
  context: {
    activeProject: { name: "Cave", root: "/repo/cave" },
    selectedFiles: ["src/auth/login.ts"],
    recentThreadTitle: "OAuth regression",
  },
});

assert.equal(code.ok, true, "code enhancement should succeed for a non-empty draft");
assert.match(code.enhanced, /fix login bug/i, "enhancement preserves the user's stated objective");
assert.match(code.enhanced, /Current project: Cave/, "code mode includes project context when provided");
assert.match(code.enhanced, /Selected files: src\/auth\/login\.ts/, "code mode includes selected files when provided");
assert.match(code.enhanced, /smallest appropriate fix/i, "code mode optimizes for implementation");
assert.match(code.enhanced, /Do not change the objective/i, "enhancement contract guards against invented work");

const image = buildPromptEnhancement({
  draft: "wizard tower at sunset",
  mode: "image",
});

assert.match(image.enhanced, /Composition:/, "image mode adds visual composition structure");
assert.match(image.enhanced, /Lighting:/, "image mode adds lighting structure");
assert.match(image.enhanced, /wizard tower at sunset/i, "image mode preserves the original image intent");

const research = buildPromptEnhancement({
  draft: "compare local llm runtimes",
  mode: "research",
});

assert.match(research.enhanced, /Primary questions:/, "research mode adds investigation questions");
assert.match(research.enhanced, /Sources and confidence:/, "research mode requests citations and confidence");

const chat = buildPromptEnhancement({
  draft: "explain docker networking",
  mode: "chat",
});

assert.match(chat.enhanced, /Explain docker networking/i, "chat mode keeps conversational phrasing");
assert.match(chat.enhanced, /Output format:/, "chat mode asks for a clearer response format");

const task = buildPromptEnhancement({
  draft: "audit stale onboarding copy",
  mode: "task",
  context: {
    activeProject: { name: "Cave", root: "/repo/cave" },
    selectedFiles: ["src/components/onboarding.tsx", "docs/onboarding.md"],
  },
});

assert.equal(task.ok, true, "task enhancement should succeed for a non-empty draft");
assert.equal(task.mode, "task", "task mode should be preserved");
assert.match(task.enhanced, /Task title:/, "task mode adds a title shape");
assert.match(task.enhanced, /Acceptance criteria:/, "task mode adds acceptance criteria");
assert.match(task.enhanced, /Subtasks:/, "task mode asks for concrete subtasks");
assert.match(task.enhanced, /Current project: Cave/, "task mode includes project context when provided");
assert.match(task.enhanced, /Selected files: src\/components\/onboarding\.tsx, docs\/onboarding\.md/, "task mode includes selected files when provided");

const empty = buildPromptEnhancement({ draft: "   ", mode: "chat" });
assert.equal(empty.ok, false, "empty drafts are rejected");
assert.equal(normalizeEnhanceMode("task"), "task", "task mode should normalize explicitly");
assert.equal(normalizeEnhanceMode("made-up"), "chat", "unknown modes fall back to chat");

// ── Model-backed protocol (cave-b6c2) ────────────────────────────────────────

// Instruction builder: a rewrite directive, never an answer request.
const instruction = buildEnhanceInstruction({
  draft: "fix login bug",
  mode: "code",
  intent: "criteria",
  context: { activeProject: { name: "Cave", root: "/repo/cave" }, selectedFiles: ["src/auth/login.ts"] },
});
assert.match(instruction, /Rewrite the user's draft prompt/, "instruction frames the model as a prompt rewriter");
assert.match(instruction, /Do not answer the prompt/, "instruction forbids answering instead of rewriting");
assert.match(instruction, /Acceptance criteria/, "the picked intent's goal rides into the instruction");
assert.match(instruction, /Code request:/, "the composer mode shapes the rewrite expectations");
assert.match(instruction, /Current project: Cave \(\/repo\/cave\)/, "composer context reuses the shared contextLines block");
assert.match(instruction, /<enhanced><\/enhanced>/, "output contract demands the tag frame");
assert.match(instruction, /fix login bug/, "the draft itself is embedded verbatim");

const autoInstruction = buildEnhanceInstruction({ draft: "x", mode: "chat", intent: "auto" });
assert.match(autoInstruction, /Improve the prompt however helps most/, "auto intent uses the smart-enhance goal");
assert.equal(ENHANCE_INTENTS[0].id, "auto", "smart enhance leads the intent menu");
assert.equal(new Set(ENHANCE_INTENTS.map((i) => i.id)).size, ENHANCE_INTENTS.length, "intent ids are unique");

// Extractor: streaming-safe framing.
assert.deepEqual(
  extractEnhancedPrompt("<enhanced>Do the thing.</enhanced>"),
  { partial: "Do the thing.", complete: true },
  "a closed tag pair extracts the body and marks completion",
);
assert.deepEqual(
  extractEnhancedPrompt("<enhanced>Do the thing"),
  { partial: "Do the thing", complete: false },
  "an unclosed tag streams the body so far",
);
assert.deepEqual(
  extractEnhancedPrompt("<enhanced>Do the thing.</enha"),
  { partial: "Do the thing.", complete: false },
  "a trailing partial closing tag is trimmed so tag noise never renders",
);
assert.deepEqual(
  extractEnhancedPrompt("<enh"),
  { partial: "", complete: false },
  "a leading partial opening tag renders nothing until it resolves",
);
assert.deepEqual(
  extractEnhancedPrompt("Do the thing."),
  { partial: "Do the thing.", complete: false },
  "a tagless response is used as-is (models occasionally ignore the wrapping)",
);
assert.deepEqual(
  extractEnhancedPrompt("```\nDo the thing.\n```"),
  { partial: "Do the thing.", complete: false },
  "stray code fences around a tagless response are stripped",
);
assert.equal(
  extractCompleteEnhancedPrompt("<enhanced>Do the thing.</enhanced>"),
  "Do the thing.",
  "settled model output requires one complete enhanced frame",
);
for (const malformed of [
  "Do the thing.",
  "<enhanced>Do the thing",
  "<enhanced></enhanced>",
  "before <enhanced>Do the thing.</enhanced> after",
  "<enhanced>One</enhanced><enhanced>Two</enhanced>",
]) {
  assert.equal(
    extractCompleteEnhancedPrompt(malformed),
    null,
    `tagless or malformed output is rejected for lifecycle retry: ${malformed}`,
  );
}

// Race rule: only a byte-identical draft applies in place.
assert.equal(settleEnhance("draft", "draft"), "apply", "an unchanged draft applies in place");
assert.equal(settleEnhance("draft", "draft edited"), "suggest", "a changed draft downgrades to a suggestion");

// Chat enhancement output is a strict, reviewable shared recommendation. Its
// metadata cites bounded existing chat context rather than carrying raw text.
{
  const recommendation = createPromptEnhancementRecommendation({
    id: "prompt-enhance-test",
    enhanced: "Investigate the login regression and summarize the focused test results.",
    mode: "code",
    intent: "clarify",
    offline: false,
    contextFingerprint: "ctx-v1-0123456789abcdef0123456789abcdef",
    evidenceRefs: [
      { id: "turn-1", kind: "message", label: "Recent chat message" },
      { id: "task-1", kind: "task", label: "Linked task" },
      { id: "tool-1", kind: "artifact", label: "Recent tool outcome" },
    ],
  });
  assert.equal(recommendation.surface, "chat", "enhancement recommendations belong to Chat");
  assert.equal(recommendation.kind, "prose", "a rewritten prompt remains a prose proposal");
  assert.equal(recommendation.payload.enhanced, "Investigate the login regression and summarize the focused test results.");
  assert.match(recommendation.rationale, /clarif/i, "the rationale names the chosen enhancement intent");
  assert.deepEqual(
    recommendation.evidenceRefs.map((evidence) => evidence.kind),
    ["message", "task", "artifact"],
    "message, task, and tool evidence stay as typed shared refs",
  );
  const parsed = parseAgenticRecommendationsOutput(serializePromptEnhancementRecommendation(recommendation));
  assert.deepEqual(parsed[0]?.payload, recommendation.payload, "the serialized enhancement survives strict shared extraction");
  assert.equal(parsed[0]?.application.mode, "review", "model-authored rewrites remain reviewable");

  const promptSpecific = parsePromptEnhancementRecommendationOutput(
    serializePromptEnhancementRecommendation({
      ...recommendation,
      payload: { ...recommendation.payload, enhanced: "long prompt ".repeat(182) },
    }),
  );
  assert.equal(
    promptSpecific[0]?.payload.enhanced.length,
    2_184,
    "prompt-specific extraction preserves composer-compatible proposals over the shared 2,000-character string limit",
  );
  const quoteAndSlashRichPrompt = '\\"'.repeat(32_768);
  const escaped = parsePromptEnhancementRecommendationOutput(
    serializePromptEnhancementRecommendation({
      ...recommendation,
      payload: { ...recommendation.payload, enhanced: quoteAndSlashRichPrompt },
    }),
  );
  assert.equal(
    escaped[0]?.payload.enhanced,
    quoteAndSlashRichPrompt,
    "a decoded 64 KiB prompt survives its larger quote-and-backslash JSON envelope",
  );
}

// A reviewed rewrite cannot be applied after meaningful composer context
// changes. Actual UUID IDs survive as evidence rather than being discarded.
{
  const uuid = "0f4d5c55-6f15-4e7c-a1f4-3462fb56e5c4";
  const base = {
    mode: "chat" as const,
    familiarId: "familiar-1",
    context: {
      selectedFiles: ["src/chat.tsx"],
      linkedTask: { id: "task-1", title: "Improve Chat" },
      modelScope: "session:model-a",
      recentMessages: [{ id: uuid, role: "assistant", text: "Review the current implementation." }],
      recentToolOutcomes: [{ id: uuid, name: "Read", status: "ok", output: "Found ChatView." }],
    },
  };
  const recommendation = createPromptEnhancementRecommendation({
    id: "prompt-enhance-freshness",
    enhanced: "Review the current implementation and summarize the focused checks.",
    offline: false,
    mode: base.mode,
    intent: "clarify",
    contextFingerprint: promptEnhancementLifecycleFingerprint(base),
    evidenceRefs: promptEnhancementEvidenceRefs(base.context),
  });
  assert.deepEqual(
    recommendation.evidenceRefs.map((evidence) => evidence.id),
    [uuid, "task-1", uuid],
    "digit-leading UUID message and tool identities remain exact typed evidence",
  );
  assert.equal(
    isPromptEnhancementRecommendationCurrent(recommendation, promptEnhancementLifecycleFingerprint({
      ...base,
      context: { ...base.context, selectedFiles: ["src/chat.tsx", "src/composer.tsx"] },
    })),
    false,
    "adding an attachment or selected file invalidates a pending suggestion",
  );
  assert.equal(
    isPromptEnhancementRecommendationCurrent(recommendation, promptEnhancementLifecycleFingerprint({
      ...base,
      context: { ...base.context, linkedTask: { id: "task-2", title: "Different task" } },
    })),
    false,
    "changing the linked task invalidates a pending suggestion",
  );
  assert.equal(
    isPromptEnhancementRecommendationCurrent(recommendation, promptEnhancementLifecycleFingerprint({
      ...base,
      context: { ...base.context, modelScope: "next-message:model-b" },
    })),
    false,
    "changing the composer-local model scope invalidates a pending suggestion",
  );
}

// ── Research idempotency (#4628) ──────────────────────────────────────────────
// Improve resends the input on every click, so a second pass re-wraps an
// already-formatted Research prompt unless the formatter recovers the question.
function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

const researchOnce = buildPromptEnhancement({ draft: "compare local llm runtimes", mode: "research" });
const researchTwice = buildPromptEnhancement({ draft: researchOnce.enhanced, mode: "research" });
assert.equal(researchTwice.ok, true, "a second research pass should still succeed");
assert.equal(
  researchTwice.enhanced,
  researchOnce.enhanced,
  "formatting twice returns the same text as formatting once",
);
for (const section of ["Primary questions:", "Method:", "Sources and confidence:", "Output format:"]) {
  assert.equal(countOccurrences(researchOnce.enhanced, section), 1, `one copy of "${section}" after the first pass`);
  assert.equal(countOccurrences(researchTwice.enhanced, section), 1, `one copy of "${section}" after the second pass`);
}
// A question that already ended with a period is reconstructed verbatim.
const dottedOnce = buildPromptEnhancement({ draft: "compare runtimes.", mode: "research" });
const dottedTwice = buildPromptEnhancement({ draft: dottedOnce.enhanced, mode: "research" });
assert.equal(dottedTwice.enhanced, dottedOnce.enhanced, "a trailing period in the question survives idempotency");

console.log("prompt-enhancer.test.ts: ok");
