// @ts-nocheck
import assert from "node:assert/strict";
import {
  buildPromptEnhancement,
  normalizeEnhanceMode,
} from "./prompt-enhancer.ts";

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

console.log("prompt-enhancer.test.ts: ok");
