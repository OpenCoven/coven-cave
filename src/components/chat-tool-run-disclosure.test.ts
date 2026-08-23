// @ts-nocheck
// Rendering contract for ChatToolRunDisclosure — one-off vs. repeated DOM
// attribute shape, CSS display-override guard, and 1→2 identity retention.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

import { ChatToolRunDisclosure } from "./chat-tool-run-disclosure.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const activityCss = readFileSync(
  new URL("../styles/cave-chat/activity.css", import.meta.url),
  "utf8",
);

function makeDisclosure(props) {
  return createElement(
    ChatToolRunDisclosure,
    {
      repeated: false,
      statuses: ["ok"],
      category: "shell",
      ariaLabel: "1 tool run",
      summary: createElement("span", null, "×1"),
      children: createElement("span", null, "body"),
      ...props,
    },
  );
}

// ── CSS guard ─────────────────────────────────────────────────────────────────

test("activity.css contains a scoped display:none rule for one-off summaries", () => {
  // The shared .cave-tool-summary rule sets display:flex, which overrides the
  // UA [hidden]{display:none}.  A narrowly scoped rule on details[data-one-off]
  // must exist so that specificity wins regardless of cascade order.
  assert.match(
    activityCss,
    /details\[data-one-off\]\s*>\s*\.cave-tool-summary\s*\{[^}]*display\s*:\s*none/,
    "details[data-one-off] > .cave-tool-summary must set display:none",
  );
});

// ── One-off rendering ─────────────────────────────────────────────────────────

test("one-off details element carries data-one-off='true' and no cave-tool-run class", async () => {
  let renderer;
  await act(async () => {
    renderer = create(makeDisclosure({ repeated: false }));
  });
  const details = renderer.toJSON();
  assert.equal(details.type, "details");
  assert.equal(details.props["data-one-off"], "true", "data-one-off must be 'true' on one-off");
  assert.equal(details.props.className, undefined, "one-off details must have no className");
  assert.equal(details.props["data-default-collapsed"], undefined);
  await act(async () => { renderer.unmount(); });
});

test("one-off summary has hidden=true and class cave-tool-summary focus-ring", async () => {
  let renderer;
  await act(async () => {
    renderer = create(makeDisclosure({ repeated: false }));
  });
  const details = renderer.toJSON();
  const summary = details.children[0];
  assert.equal(summary.type, "summary");
  assert.equal(summary.props.hidden, true, "one-off summary must be hidden");
  assert.equal(summary.props.className, "cave-tool-summary focus-ring");
  // aria props must be absent on one-off
  assert.equal(summary.props["aria-expanded"], undefined);
  assert.equal(summary.props["aria-label"], undefined);
  await act(async () => { renderer.unmount(); });
});

// ── Repeated rendering ────────────────────────────────────────────────────────

test("repeated details element has cave-tool-run class and no data-one-off", async () => {
  let renderer;
  await act(async () => {
    renderer = create(makeDisclosure({ repeated: true, statuses: ["ok", "ok"] }));
  });
  const details = renderer.toJSON();
  assert.equal(details.type, "details");
  assert.equal(details.props.className, "cave-tool-run");
  assert.equal(details.props["data-one-off"], undefined, "repeated must not have data-one-off");
  await act(async () => { renderer.unmount(); });
});

test("repeated summary is not hidden and carries aria props", async () => {
  let renderer;
  await act(async () => {
    renderer = create(makeDisclosure({ repeated: true, statuses: ["ok", "ok"] }));
  });
  const details = renderer.toJSON();
  const summary = details.children[0];
  // hidden={false} is falsy — the HTML attribute is absent; accept either false or undefined
  assert.ok(!summary.props.hidden, "repeated summary must not be hidden");
  assert.equal(summary.props["aria-label"], "1 tool run");
  await act(async () => { renderer.unmount(); });
});

// ── 1→2 identity transition ───────────────────────────────────────────────────

test("transitioning from one-off to repeated renders cave-tool-run wrapper and unhides summary", async () => {
  let renderer;
  // Start one-off
  await act(async () => {
    renderer = create(makeDisclosure({ repeated: false, statuses: ["ok"] }));
  });
  let details = renderer.toJSON();
  assert.equal(details.props["data-one-off"], "true", "starts as one-off");
  assert.equal(details.children[0].props.hidden, true, "summary hidden in one-off");

  // Promote to repeated (1→2 transition)
  await act(async () => {
    renderer.update(makeDisclosure({ repeated: true, statuses: ["ok", "ok"] }));
  });
  details = renderer.toJSON();
  assert.equal(details.props["data-one-off"], undefined, "data-one-off removed on promotion");
  assert.equal(details.props.className, "cave-tool-run", "gains cave-tool-run class");
  // hidden={false} is falsy — the HTML attribute is absent; accept either false or undefined
  assert.ok(!details.children[0].props.hidden, "summary is no longer hidden");

  // Starts collapsed after promotion (settled)
  assert.equal(details.props.open, false, "repeated starts collapsed when all statuses settled");

  await act(async () => { renderer.unmount(); });
});

console.log("chat-tool-run-disclosure.test.ts: ok");
