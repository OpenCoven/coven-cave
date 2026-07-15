import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const artifactSource = await readFile(new URL("./chat-artifact-viewer.tsx", import.meta.url), "utf8");
const artifactCss = await readFile(new URL("../styles/chat-artifact.css", import.meta.url), "utf8");
const terminalSource = await readFile(new URL("./bottom-terminal.tsx", import.meta.url), "utf8");

assert.doesNotMatch(
  artifactSource,
  /#(?:e0666b|e0a44e|5bbb6b)\b/i,
  "artifact traffic-light dots must not use hardcoded hex colors",
);

for (const [klass, token] of [
  ["chat-artifact__dot--danger", "--color-danger"],
  ["chat-artifact__dot--warning", "--color-warning"],
  ["chat-artifact__dot--success", "--color-success"],
] as const) {
  assert.match(
    artifactCss,
    new RegExp(`\\.${klass}\\s*\\{[^}]*background:\\s*var\\(${token}\\)`),
    `${klass} should be backed by ${token}`,
  );
}

const searchDecorationsBlock = /function searchDecorations\(\) \{[\s\S]*?\n\}/.exec(terminalSource)?.[0] ?? "";
assert.ok(searchDecorationsBlock, "terminal searchDecorations helper should exist");

assert.doesNotMatch(
  searchDecorationsBlock,
  /#(?:5b4b8a|9a8ecd|cdbff5)\b/i,
  "terminal search decorations must not use hardcoded hex colors",
);

assert.match(
  terminalSource,
  /function searchDecorations\(\)[\s\S]*themeColorToken\("--color-warning"\)[\s\S]*themeColorToken\("--accent-presence"\)/,
  "terminal search decorations should resolve from current theme tokens",
);

assert.match(
  terminalSource,
  /decorations:\s*searchDecorations\(\)/,
  "terminal search should resolve decorations at search time so theme changes retint matches",
);

console.log("themed-chrome-tokens.test.ts: ok");
