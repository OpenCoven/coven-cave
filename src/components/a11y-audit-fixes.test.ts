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

test("nav count badge uses a solid accent fill (WCAG contrast)", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  // A 60%-alpha accent over the dark app background composited to ~1:1 against
  // the paired foreground; the fill must be solid so the count stays legible.
  assert.match(
    css,
    /\.menu-bar__badge\s*\{[\s\S]*?color:\s*var\(--accent-presence-foreground\)[\s\S]*?background:\s*var\(--accent-presence\);/,
  );
  assert.doesNotMatch(
    css,
    /\.menu-bar__badge\s*\{[\s\S]*?background:\s*color-mix\(in oklch, var\(--accent-presence\) 60%, transparent\)/,
  );
});

test("accent-filled buttons pair the accent with its semantic foreground", async () => {
  // White / --text-primary on --accent-presence failed AA (~2.8:1 dark). The
  // accent's paired --accent-presence-foreground adapts per mode, so route to it.
  const board = await readFile(new URL("../styles/board.css", import.meta.url), "utf8");
  assert.match(
    board,
    /\.board-new-card-btn\s*\{[^}]*background:var\(--accent-presence\)[^}]*color:var\(--accent-presence-foreground\)/,
  );
  assert.doesNotMatch(
    board,
    /\.board-new-card-btn\s*\{[^}]*background:var\(--accent-presence\)[^}]*color:var\(--text-primary\)/,
  );
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  // Both salem accent action states use the paired foreground, not hardcoded #fff.
  assert.doesNotMatch(
    css,
    /\.salem-pf__action--primary\s*\{[^}]*background:\s*var\(--accent-presence\)[^}]*color:\s*#fff/,
  );
  assert.match(
    css,
    /\.salem-pf__action--primary\s*\{[^}]*color:\s*var\(--accent-presence-foreground\)/,
  );
});
