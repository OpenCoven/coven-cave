// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const boardView = await readFile(new URL("./board-view.tsx", import.meta.url), "utf8");
const boardInspector = await readFile(new URL("./board-inspector.tsx", import.meta.url), "utf8");

assert.match(
  workspace,
  /<BoardView[\s\S]*onOpenUrl=\{openUrlInAppBrowser\}/,
  "Workspace should route board task links to the in-app browser",
);

assert.match(
  boardView,
  /export function BoardView\(\{[\s\S]*onOpenUrl[\s\S]*\}: Props\)/,
  "BoardView should accept an embedded-browser URL opener",
);

assert.match(
  boardView,
  /<BoardInspector[\s\S]*onOpenUrl=\{onOpenUrl\}/,
  "BoardView should pass URL opening into the task inspector",
);

assert.match(
  boardInspector,
  /function LinksSection\(\{[\s\S]*onOpenUrl[\s\S]*\}: \{[\s\S]*onOpenUrl\?: \(url: string\) => void/,
  "Task inspector links should receive an in-app URL opener",
);

assert.match(
  boardInspector,
  /type="button"[\s\S]*onClick=\{\(\) => onOpenUrl\?\.\(href\)\}[\s\S]*className="link-item-anchor"/,
  "Clicking a task link should open it through the in-app browser callback",
);

assert.match(
  boardInspector,
  /function GitHubAttachSection\(\{[\s\S]*onOpenUrl[\s\S]*\}: \{[\s\S]*onOpenUrl\?: \(url: string\) => void/,
  "Attached GitHub rows should receive an in-app URL opener",
);

assert.match(
  boardInspector,
  /className="board-github-attachment-open"[\s\S]*onClick=\{\(\) => onOpenUrl\?\.\(item\.url\)\}/,
  "Clicking an attached GitHub relation should open it through the in-app browser callback",
);

assert.doesNotMatch(
  boardInspector,
  /className="link-item-anchor"[\s\S]{0,220}target="_blank"/,
  "Task link clicks should not bypass the app with a new external tab",
);

// ── Row-action visibility: keyboard-reachable, not hover-only ────────────────
// The inspector's link/step action buttons (Save to Library, Remove link,
// Delete step) reveal on hover AND keyboard focus. They must NOT carry an inline
// `opacity: 0` — inline styles outrank the CSS reveal rules, so an inline
// opacity:0 leaves the buttons permanently invisible (unreachable for keyboard
// and mouse users alike).
assert.doesNotMatch(
  boardInspector,
  /style=\{\{[^}]*opacity:\s*0[^}]*\}\}\s*className="step-actions"/,
  "step-actions span must not set inline opacity:0 (it overrides the CSS reveal)",
);
assert.doesNotMatch(
  boardInspector,
  /className="step-actions"\s*style=\{\{[^}]*opacity:\s*0/,
  "step-actions span must not set inline opacity:0 (it overrides the CSS reveal)",
);
// Both inspector sections reveal their actions on keyboard focus, not just hover.
const focusReveals = boardInspector.match(/li:focus-within \.step-actions/g) ?? [];
assert.ok(
  focusReveals.length >= 2,
  "both the links and steps sections reveal row actions on :focus-within (keyboard reachable)",
);

console.log("board-link-browser.test.ts: ok");
