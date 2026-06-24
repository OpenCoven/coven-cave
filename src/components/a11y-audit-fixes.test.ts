import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";

const read = (name: string) => readFile(new URL(name, import.meta.url), "utf8");

test("github library group header is keyboard-operable", async () => {
  const src = await read("./library-github-list.tsx");
  assert.match(src, /className="board-table-group-row focus-ring-inset"/);
  assert.match(src, /role="button"[\s\S]{0,200}aria-expanded=\{!collapsed\.has\(key\)\}/);
});

test("browser tabs expose an accessible name and pressed state", async () => {
  const src = await read("./browser-pane.tsx");
  assert.match(src, /aria-label=\{tabTitles\[tab\.id\] \?\? tab\.title \?\? tab\.url\}/);
  assert.match(src, /aria-pressed=\{isActive\}/);
});

test("bulk-select rows are real keyboard checkboxes in select mode", async () => {
  for (const file of [
    "./library-reading-list.tsx",
    "./library-bookmarks-list.tsx",
    "./library-github-list.tsx",
  ]) {
    const src = await read(file);
    assert.match(src, /role=\{selectMode \? "checkbox" : undefined\}/, file);
    assert.match(src, /aria-checked=\{selectMode \? selectedIds\.has\(item\.id\) : undefined\}/, file);
    assert.match(src, /tabIndex=\{selectMode \? 0 : undefined\}/, file);
  }
});

test("action-inbox checkbox row carries a focus ring in select mode", async () => {
  const src = await read("./dashboard/action-inbox.tsx");
  assert.match(src, /selectMode \? " focus-ring-inset" : ""/);
});

test("reading status radios have a label and focus ring on every option", async () => {
  const src = await read("./library-reading-list.tsx");
  assert.match(src, /role="radio"[\s\S]{0,160}aria-label=\{meta\.label\}/);
  assert.match(src, /className=\{`library-status-toggle__opt focus-ring-inset/);
});

test("workflow-library selected item reflects pressed state", async () => {
  const src = await read("./workflows/workflow-library.tsx");
  assert.match(src, /aria-pressed=\{active\}/);
});

test("calendar urgency dots carry a text alternative", async () => {
  const src = await read("./calendar-view.tsx");
  assert.match(src, /function urgencyLabel\(item: InboxItem\): string/);
  assert.match(src, /role="img" aria-label=\{urgencyLabel\(item\)\}/);
  assert.match(src, /role="img" aria-label=\{urgencyLabel\(ev\.item\)\}/);
});

test("shell exposes a skip-to-content link targeting the main landmark", async () => {
  const shell = await read("./shell.tsx");
  assert.match(shell, /<a className="skip-link" href="#shell-main-content">Skip to main content<\/a>/);
  assert.match(shell, /<main className="shell-detail" id="shell-main-content" tabIndex=\{-1\}/);
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.skip-link\s*\{[\s\S]*?position:\s*absolute/);
  // The link must reveal itself on focus, not stay permanently off-screen.
  assert.match(css, /\.skip-link:focus[\s\S]*?transform:\s*translateY\(0\)/);
});
