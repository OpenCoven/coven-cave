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

// 2026-07-03 world-class pass: the rail is memoized behind stable handlers, and
// templates are discoverable past the empty state via a labeled button.
assert.match(source, /export const FlowLibrary = memo\(FlowLibraryImpl\)/, "FlowLibrary is memoized");
assert.match(source, /leadingIcon="ph:squares-four"[\s\S]{0,180}>[\s\S]{0,40}Templates/, "the template entry point is labeled, not icon-only");
assert.match(view, /onSelect=\{onSelectFlow\}/, "the rail receives stable handlers (inline lambdas would defeat the memo)");
assert.match(source, /import \{ Button \}/, "FlowLibrary actions use the shared Button primitive");
assert.match(source, /import \{ IconButton \}/, "FlowLibrary icon actions use the shared IconButton primitive");
assert.doesNotMatch(source, /<button\b/, "FlowLibrary should not hand-roll button controls");
assert.doesNotMatch(
  source,
  /rounded-md|rounded-lg|rounded(?=\s|")|rounded-\[4px\]/,
  "FlowLibrary should not hard-code rectangular radius classes",
);

console.log("flow-library.test.ts OK");
