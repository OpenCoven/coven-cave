// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./flow-library.tsx", import.meta.url), "utf8");
const view = readFileSync(new URL("./flow-view.tsx", import.meta.url), "utf8");

assert.match(source, /onCreateFromPrompt: \(prompt: string\) => void/, "FlowLibrary should expose prompt-based creation");
assert.match(source, /aria-label="Create flow from prompt"/, "Prompt creation should be a visible labelled form");
assert.match(source, /placeholder="Describe a flow to create"/, "Prompt field should guide the user without hiding creation behind browser prompt");
assert.match(source, /disabled=\{promptDraft\.trim\(\)\.length === 0\}/, "Prompt submit should be disabled until text exists");
assert.match(view, /createFlowFromPrompt/, "FlowView should wire prompt-based creation into persistence");
assert.match(view, /buildPromptFlow/, "Prompt creation should use the shared prompt-to-flow builder");

console.log("flow-library.test.ts OK");
