import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("workspace pages use a named pane root with explicit state handling", () => {
  const source = read("./workspace-pane-page.tsx");
  assert.match(source, /className="workspace-pane-page"/);
  assert.match(source, /data-pane-instance=\{instanceId\}/);
  assert.match(source, /role="status"/, "loading and unavailable states are announced");
  assert.match(source, /role="alert"/, "render failures are announced");
  assert.match(source, /WorkspacePaneErrorBoundary/, "one failed pane does not replace its sibling");
});

test("the pane root is a container that fills without generic scrolling", () => {
  const css = read("../styles/globals/surface-chat-overlays.css");
  assert.match(css, /\.workspace-pane-page \{[\s\S]*container: workspace-pane \/ inline-size/);
  assert.match(css, /\.workspace-pane-page \{[\s\S]*min-width: 0/);
  assert.match(css, /\.workspace-pane-page \{[\s\S]*min-height: 0/);
  assert.match(css, /\.workspace-pane-page \{[\s\S]*overflow: hidden/);
});
