// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, useEffect, useState } from "react";
import { act, create } from "react-test-renderer";

import { ChatToolActivityLayout } from "./chat-tool-activity-layout.ts";
import { source, turnRow } from "./chat-view-polish-fixtures.ts";
import { useToolRunDisclosure } from "../lib/use-tool-run-disclosure.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function RepeatedToolProbe({ statuses, snapshots, lifecycle }) {
  const disclosure = useToolRunDisclosure(statuses);
  snapshots.push(disclosure);
  useEffect(() => {
    lifecycle.mounts += 1;
    return () => {
      lifecycle.unmounts += 1;
    };
  }, [lifecycle]);
  return createElement("repeated-tool", { open: disclosure.open });
}

function EditReviewProbe({ controller, lifecycle }) {
  const [open, setOpen] = useState(false);
  controller.open = () => setOpen(true);
  controller.current = open;
  useEffect(() => {
    lifecycle.mounts += 1;
    return () => {
      lifecycle.unmounts += 1;
    };
  }, [lifecycle]);
  return createElement("edit-review", { open });
}

function ActivityProbe({ pending, disclosureSnapshots, toolLifecycle, editLifecycle, editController }) {
  return createElement(ChatToolActivityLayout, {
    leading: null,
    activity: createElement(RepeatedToolProbe, {
      statuses: pending ? ["running", "running"] : ["ok", "ok"],
      snapshots: disclosureSnapshots,
      lifecycle: toolLifecycle,
    }),
    content: pending
      ? createElement("thinking-indicator", { "data-tool-first": true })
      : createElement("message-bubble", { settled: true }),
    editCards: createElement(EditReviewProbe, { controller: editController, lifecycle: editLifecycle }),
  });
}

test("stable activity slots preserve a focused repeated tool and open edit review through tool-first settlement", async () => {
  const disclosureSnapshots = [];
  const toolLifecycle = { mounts: 0, unmounts: 0 };
  const editLifecycle = { mounts: 0, unmounts: 0 };
  const editController = { open: null, current: false };
  const inside = {};
  const outside = {};
  const fakeDetails = { open: true, contains: (node) => node === inside };
  const originalDocument = globalThis.document;
  let renderer;
  Object.defineProperty(globalThis, "document", { configurable: true, value: { activeElement: inside } });
  try {
    await act(async () => {
      renderer = create(createElement(ActivityProbe, {
        pending: true,
        disclosureSnapshots,
        toolLifecycle,
        editLifecycle,
        editController,
      }));
    });
    disclosureSnapshots.at(-1).detailsRef.current = fakeDetails;
    assert.equal(renderer.root.findAllByType("thinking-indicator").length, 1);
    assert.equal(renderer.root.findAllByType("repeated-tool").length, 1);
    await act(async () => { editController.open(); });
    assert.equal(editController.current, true, "edit review is open before settlement");
    await act(async () => {
      renderer.update(createElement(ActivityProbe, {
        pending: false,
        disclosureSnapshots,
        toolLifecycle,
        editLifecycle,
        editController,
      }));
    });
    assert.deepEqual(toolLifecycle, { mounts: 1, unmounts: 0 });
    assert.deepEqual(editLifecycle, { mounts: 1, unmounts: 0 });
    assert.equal(disclosureSnapshots.at(-1).open, true, "focus defers repeated-run collapse");
    assert.equal(editController.current, true, "open edit review survives settlement");
    assert.equal(renderer.root.findAllByType("thinking-indicator").length, 0);
    assert.equal(renderer.root.findAllByType("message-bubble").length, 1);
    await act(async () => { disclosureSnapshots.at(-1).onBlurCapture({ relatedTarget: outside }); });
    assert.equal(disclosureSnapshots.at(-1).open, false, "the repeated run collapses after focus leaves");
  } finally {
    await act(async () => { renderer?.unmount(); });
    if (originalDocument === undefined) delete globalThis.document;
    else Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
  }
});

test("TurnRow gives tools stable activity and edit-card slots instead of streaming render branches", () => {
  const turnRender = turnRow.match(/function TurnRowImpl[\s\S]*?\n}\n\nfunction ReasoningBlock/)?.[0] ?? "";
  assert.match(
    turnRender,
    /const settledTools = turn\.tools \?\? \[\];\s*const editCards = settledTools\.filter\(isEditCard\);\s*const otherTools = settledTools\.filter\(\(t\) => !isEditCard\(t\)\);/,
    "edit and non-edit tools are partitioned independently of pending state",
  );
  assert.match(
    turnRender,
    /<ChatToolActivityLayout[\s\S]*activity=\{otherTools\.length \? <ToolGroup tools=\{otherTools\} \/> : null\}[\s\S]*content=\{[\s\S]*indicatorVisible[\s\S]*<ThinkingIndicator[\s\S]*<MessageBubble[\s\S]*editCards=\{\s*editCards\.length/,
    "the no-text indicator/answer swap happens between stable activity and edit-card slots",
  );
  assert.doesNotMatch(turnRender, /<ToolRuns/, "TurnRow never duplicates or relocates ToolRuns through streaming branches");
  assert.doesNotMatch(source, /useFocusSafeToolRelocation|data-inline-tool-runs/, "focus-derived relocation state is removed");
});

console.log("chat-tool-activity-lifecycle.test.ts: ok");
