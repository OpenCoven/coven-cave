import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relativePath: string) => {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  assert.ok(existsSync(path), `${relativePath} should exist`);
  return readFileSync(path, "utf8");
};

const source = read("./composer-linked-work-actions.tsx");

assert.match(source, /export function repoName\(p\?: string \| null\): string/);
assert.match(source, /export function githubLabel\(kind: string\): string/);
assert.match(source, /export function compactGitHubContextLabel\(item: ChatLinkedContext\["github"\]\[number\]\): string/);
assert.match(source, /export function githubIcon\(kind: string\): IconName/);
assert.match(source, /export type ComposerLinkedWorkActionsProps = \{/);
assert.match(source, /export function ComposerLinkedWorkActions\(/);
assert.match(source, /embedded\?: boolean/);
assert.match(source, /itemSemantic\?: PopoverItemSemantic/);
assert.match(source, /createSmartTaskFromChat/);
assert.match(source, /TaskLinkPicker/);
assert.match(source, /PopoverItem/);
assert.match(
  source,
  /<PopoverItem\s+semantic=\{itemSemantic\}/,
  "every reusable linked-work PopoverItem can inherit native-button semantics in a composite dialog",
);
assert.match(
  source,
  /fetch\(`\/api\/board\/\$\{encodeURIComponent\(t\.id\)\}`,[\s\S]*?method: "PATCH"[\s\S]*?lifecycle: "completed"[\s\S]*?lifecycleReason: sessionId[\s\S]*?Marked done from chat \(session \$\{sessionId\}\)/,
  "mark-done keeps the exact board PATCH lifecycle mutation path",
);
assert.match(
  source,
  /announce\(`Task "\$\{t\.title\}" marked done\.`\)/,
  "mark-done success keeps its spoken confirmation",
);
assert.match(
  source,
  /announce\(`Couldn't mark "\$\{t\.title\}" done — check your connection\.`, "assertive"\)/,
  "mark-done failure keeps its assertive spoken fallback",
);
assert.match(
  source,
  /createSmartTaskFromChat\(\{ sessionId, context: handoff \}\)/,
  "smart create keeps using the shared autofill helper",
);
assert.match(
  source,
  /if \(!result\.ok \|\| !result\.card\) throw new Error\(result\.error \?\? "Failed to create task"\);\s*onAssigned\(result\.card\);/,
  "smart-created cards still flow through the shared onAssigned path",
);
assert.match(
  source,
  /announce\(\s*`Task "\$\{result\.card\.title\}" created from this chat/,
  "smart create keeps its success announcement",
);
assert.match(
  source,
  /announce\(`Couldn't create a task from this chat — \$\{reason\}\.`, "assertive"\)/,
  "smart create keeps surfacing the specific failure reason",
);
assert.match(
  source,
  /<TaskLinkPicker[\s\S]*?embedded=\{embedded\}[\s\S]*?handoff=\{handoff\}/,
  "task linking still forwards the chat handoff context into the picker and the embedded mode flag",
);
assert.match(
  source,
  /onSelect=\{\(\) => \{\s*onCloseMenu\?\.\(\);\s*onOpenTask\?\.\(t\.id\);/,
  "opening a linked task should close the parent menu first",
);
assert.match(
  source,
  /onSelect=\{\(\) => \{\s*onCloseMenu\?\.\(\);\s*openExternalUrl\(item\.url\);/,
  "opening GitHub context should close the parent menu first",
);
assert.match(
  source,
  /No linked work yet — open a chat session to link tasks or wait for GitHub context to arrive\./,
  "the extracted menu keeps an informative empty state",
);

console.log("composer-linked-work-actions.test.ts: ok");
