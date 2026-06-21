import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildQuestionsPrompt,
  buildManifestPrompt,
  parseQuestionsResponse,
  parseManifestResponse,
  WorkflowGenerateError,
} from "./workflow-generate.ts";

test("buildQuestionsPrompt embeds the goal and asks for 2-3 fenced JSON questions", () => {
  const prompt = buildQuestionsPrompt("triage inbound bug reports");
  assert.match(prompt, /triage inbound bug reports/);
  assert.match(prompt, /2-3/);
  assert.match(prompt, /```json/);
  assert.match(prompt, /input/i);
  assert.match(prompt, /output|artifact/i);
});

test("buildManifestPrompt embeds goal, answers, familiar, and asks for fenced yaml", () => {
  const prompt = buildManifestPrompt({
    goal: "triage bugs",
    answers: [{ id: "q1", question: "What triggers it?", answer: "a new GitHub issue" }],
    familiarId: "salem",
    suggestedName: "Bug triage",
  });
  assert.match(prompt, /triage bugs/);
  assert.match(prompt, /What triggers it\?/);
  assert.match(prompt, /a new GitHub issue/);
  assert.match(prompt, /salem/);
  assert.match(prompt, /```yaml/);
  assert.match(prompt, /human-gate/);
});

test("parseQuestionsResponse extracts a fenced JSON block and clamps to 3", () => {
  const text = [
    "Sure — a few questions:",
    "```json",
    JSON.stringify({
      questions: [
        { id: "q1", question: "What triggers it?", hint: "e.g. a new issue" },
        { id: "q2", question: "What should it produce?" },
        { id: "q3", question: "Any tools it must use?" },
        { id: "q4", question: "Extra one to drop" },
      ],
    }),
    "```",
  ].join("\n");
  const questions = parseQuestionsResponse(text);
  assert.equal(questions.length, 3);
  assert.equal(questions[0].id, "q1");
  assert.equal(questions[0].hint, "e.g. a new issue");
});

test("parseQuestionsResponse parses bare JSON with no fence", () => {
  const text = JSON.stringify({ questions: [{ id: "q1", question: "Goal?" }] });
  assert.equal(parseQuestionsResponse(text).length, 1);
});

test("parseQuestionsResponse throws on malformed output", () => {
  assert.throws(() => parseQuestionsResponse("no questions here"), WorkflowGenerateError);
  assert.throws(() => parseQuestionsResponse("```json\n{\"questions\":[]}\n```"), WorkflowGenerateError);
});

test("parseManifestResponse extracts a fenced yaml manifest object", () => {
  const text = [
    "Here's the workflow:",
    "```yaml",
    "id: triage",
    "version: 0.1.0",
    "pattern: classify-and-act",
    "steps:",
    "  - id: input",
    "    kind: input",
    "  - id: output",
    "    kind: output",
    "```",
  ].join("\n");
  const manifest = parseManifestResponse(text);
  assert.equal((manifest.steps as unknown[]).length, 2);
  assert.equal(manifest.pattern, "classify-and-act");
});

test("parseManifestResponse throws when steps are missing or it isn't an object", () => {
  assert.throws(() => parseManifestResponse("```yaml\nid: x\nversion: 0.1.0\n```"), WorkflowGenerateError);
  assert.throws(() => parseManifestResponse("```yaml\n- 1\n- 2\n```"), WorkflowGenerateError);
  assert.throws(() => parseManifestResponse("nothing fenced here"), WorkflowGenerateError);
});
