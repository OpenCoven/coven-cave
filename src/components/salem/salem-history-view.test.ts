// @ts-nocheck
// The standalone Ask Salem surface is retired (#6399). What must survive: the
// saved thread stays readable, exportable and deletable, opening it costs no
// request, and contextual help stays reachable.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { isWorkspaceMode } from "../../lib/workspace-mode.ts";
import { paletteDestinations, sidebarDestinations } from "../../lib/workspace-destination-policy.ts";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const view = read("./salem-history-view.tsx");
const widget = read("./salem-widget.tsx");
const workspace = read("../workspace.tsx");
const palette = read("../command-palette.tsx");

test("the standalone assistant is gone and its mode string still resolves", () => {
  assert.equal(existsSync(new URL("./ask-salem-view.tsx", import.meta.url)), false);
  assert.ok(isWorkspaceMode("salem"), "saved links and restored surfaces stay valid");
  assert.equal(paletteDestinations().some(({ id }) => id === "salem"), false);
  assert.equal(sidebarDestinations().some(({ id }) => id === "salem"), false);
  assert.match(
    workspace,
    /mode === "salem" \? \([\s\S]{0,300}instanceId \? \(\s*<SalemChatPanel[\s\S]{0,200}<SalemHistoryView\b/,
    "a split pane asks; the main surface shows saved history",
  );
});

test("the history view is local-only: no requests, timers or subscriptions", () => {
  assert.doesNotMatch(view, /fetch\(|setInterval|setTimeout|addEventListener|useEffect|EventSource/);
  assert.match(view, /loadThread\(window\.localStorage\)/);
});

test("history stays exportable and deletable, with an accessible outcome", () => {
  assert.match(view, /threadToMarkdown\(messages\)/);
  assert.match(view, /link\.download = "ask-salem-history\.md"/);
  assert.match(view, /clearThread\(window\.localStorage\)/);
  assert.match(view, /announce\("Salem history exported\."\)/);
  assert.match(view, /announce\("Salem history deleted\."\)/);
  assert.match(view, /setConfirmingDelete\(true\)/, "deleting takes a second, explicit action");
});

test("contextual help stays: palette answers, the panel, and a route back to history", () => {
  assert.match(palette, /fetch\("\/api\/salem"/, "⌘K still answers");
  assert.match(workspace, /"cave:salem-open"/, "the side panel still opens");
  assert.match(workspace, /normalizeWorkspacePaneRequest\(nextPaneInstanceId\(\), "salem"\)/, "it opens as a split pane");
  assert.match(view, /<SalemChatPanel familiarId=\{familiarId\} model=\{model\} onShowHistory=/, "phone widths have no split panes, so the view hosts the panel");
  assert.match(widget, /aria-label="Open Salem history"/);
  assert.match(widget, /detail: \{ mode: "salem" \}/);
});
