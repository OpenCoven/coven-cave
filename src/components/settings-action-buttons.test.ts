// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const shell = readFileSync(new URL("./settings-shell.tsx", import.meta.url), "utf8");
const picker = readFileSync(new URL("./settings-familiar-picker.tsx", import.meta.url), "utf8");
const controls = readFileSync(new URL("./ui/settings-controls.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const studioSources = [
  "familiar-studio-brain-tab.tsx",
  "familiar-studio-contract-tab.tsx",
  "familiar-studio-identity-tab.tsx",
  "familiar-studio-lifecycle-tab.tsx",
  "familiar-studio-look-tab.tsx",
  "familiar-studio-projects-tab.tsx",
].map((fileName) => [fileName, readFileSync(new URL(`./${fileName}`, import.meta.url), "utf8")] as const);

function rawButtons(fileName: string, source: string): Array<{ block: string; opening: string }> {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const buttons: Array<{ block: string; opening: string }> = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(sourceFile) === "button") {
      buttons.push({ block: node.getText(sourceFile), opening: node.openingElement.getText(sourceFile) });
    } else if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(sourceFile) === "button") {
      const text = node.getText(sourceFile);
      buttons.push({ block: text, opening: text });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return buttons;
}

function jsxElementBlocks(fileName: string, source: string, tagName: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const blocks: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(sourceFile) === tagName) {
      blocks.push(node.getText(sourceFile));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return blocks;
}

const reviewedSemanticControl = (button: string): boolean =>
  /goToSetting\(e\)|settings-nav__item|role="switch"|aria-pressed=|aria-label=\{`Pick \$\{label\} color`\}|aria-haspopup="dialog"|role="option"|setEnlarged\(true\)|Drag to reorder|familiar-studio-lifecycle__row-main/.test(
    button,
  );

for (const [name, source] of [
  ["settings shell", shell],
  ["settings familiar picker", picker],
  ["settings segmented control", controls],
  ...studioSources,
] as const) {
  const buttons = rawButtons(`${name}.tsx`, source);
  const unreviewed = buttons.map(({ block }) => block).filter((button) => !reviewedSemanticControl(button));
  assert.deepEqual(
    unreviewed,
    [],
    `${name} ordinary actions must render through the shared Button or IconButton primitive`,
  );

  for (const { opening } of buttons) {
    assert.doesNotMatch(
      opening,
      /\brounded-(?:md|lg|xl|full|\[5px\])(?=["`\s])|\brounded(?=["`\s])/,
      `${name} specialized controls must not hard-code a button radius`,
    );
  }
}

const saveConnectionButtons = jsxElementBlocks("settings-shell.tsx", shell, "Button").filter((block) =>
  block.includes("Save connection"),
);
assert.equal(saveConnectionButtons.length, 1, "Save connection renders through exactly one shared Button");
assert.match(
  saveConnectionButtons[0],
  /onClick=\{\(\) => void saveConnection\(\)\}/,
  "the Save connection Button invokes the connection save action",
);
assert.match(
  css,
  /\.ui-btn\s*\{[\s\S]*?border-radius:\s*var\(--radius-control\)/,
  "shared buttons follow the selected design's control radius",
);
assert.match(
  css,
  /\.ui-icon-btn--xs\s*\{[^}]*border-radius:\s*var\(--radius-control\)/,
  "shared icon buttons follow the selected design's control radius",
);
for (const selector of [
  ".familiar-studio-picker__trigger",
  ".familiar-studio-picker__option",
  ".familiar-studio-lifecycle__row",
]) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(
    css,
    new RegExp(`${escaped}\\s*\\{[^}]*border-radius:\\s*var\\(--radius-control\\)`),
    `${selector} follows the selected design's control radius`,
  );
}
assert.equal(
  (controls.match(/rounded-\[var\(--radius-control\)\]/g) ?? []).length,
  2,
  "the segmented track and each option follow the selected design's control radius",
);

console.log("settings-action-buttons.test.ts OK");
