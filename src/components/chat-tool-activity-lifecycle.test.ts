// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement, useEffect, useState } from "react";
import { act, create } from "react-test-renderer";

import { ChatToolActivityLayout } from "./chat-tool-activity-layout.ts";
import { source, turnRow } from "./chat-view-polish-fixtures.ts";
import { useToolRunDisclosure } from "../lib/use-tool-run-disclosure.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const turnSegmentsSource = readFileSync(new URL("../lib/turn-segments.ts", import.meta.url), "utf8");

function ToolGroupProbe({ statuses, snapshots, lifecycle, controller }) {
  const [outerOpen, setOuterOpen] = useState(false);
  const disclosure = useToolRunDisclosure(statuses);
  controller.open = () => setOuterOpen(true);
  controller.current = outerOpen;
  snapshots.push(disclosure);
  useEffect(() => {
    lifecycle.mounts += 1;
    return () => {
      lifecycle.unmounts += 1;
    };
  }, [lifecycle]);
  return createElement("tool-group", { open: outerOpen, repeatedOpen: disclosure.open });
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

function ActivityProbe({
  pending,
  disclosureSnapshots,
  toolLifecycle,
  toolController,
  editLifecycle,
  editController,
}) {
  return createElement(ChatToolActivityLayout, {
    leading: pending ? createElement("reasoning-probe") : null,
    activity: createElement(ToolGroupProbe, {
      statuses: pending ? ["running", "running"] : ["ok", "ok"],
      snapshots: disclosureSnapshots,
      lifecycle: toolLifecycle,
      controller: toolController,
    }),
    content: pending
      ? createElement("thinking-indicator", { "data-tool-first": true })
      : createElement("message-bubble", { settled: true }),
    editCards: createElement(
      "edit-cards",
      null,
      pending ? null : createElement("review-all"),
      createElement(EditReviewProbe, {
        key: "edit-1",
        controller: editController,
        lifecycle: editLifecycle,
      }),
    ),
  });
}

test("stable activity slots preserve a focused repeated tool and open edit review through tool-first settlement", async () => {
  const disclosureSnapshots = [];
  const toolLifecycle = { mounts: 0, unmounts: 0 };
  const toolController = { open: null, current: false };
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
        toolController,
        editLifecycle,
        editController,
      }));
    });
    disclosureSnapshots.at(-1).detailsRef.current = fakeDetails;
    assert.equal(renderer.root.findAllByType("reasoning-probe").length, 1);
    assert.equal(renderer.root.findAllByType("thinking-indicator").length, 1);
    assert.equal(renderer.root.findAllByType("tool-group").length, 1);
    await act(async () => { toolController.open(); });
    assert.equal(toolController.current, true, "outer ToolGroup is user-open before settlement");
    await act(async () => { editController.open(); });
    assert.equal(editController.current, true, "edit review is open before settlement");
    await act(async () => {
      renderer.update(createElement(ActivityProbe, {
        pending: false,
        disclosureSnapshots,
        toolLifecycle,
        toolController,
        editLifecycle,
        editController,
      }));
    });
    assert.deepEqual(toolLifecycle, { mounts: 1, unmounts: 0 });
    assert.deepEqual(editLifecycle, { mounts: 1, unmounts: 0 });
    assert.equal(toolController.current, true, "outer ToolGroup disclosure survives settlement");
    assert.equal(disclosureSnapshots.at(-1).open, true, "focus defers repeated-run collapse");
    assert.equal(editController.current, true, "open edit review survives settlement");
    assert.equal(renderer.root.findAllByType("reasoning-probe").length, 0);
    assert.equal(renderer.root.findAllByType("thinking-indicator").length, 0);
    assert.equal(renderer.root.findAllByType("message-bubble").length, 1);
    assert.equal(renderer.root.findAllByType("review-all").length, 1);
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
    /const turnTools = turn\.tools \?\? \[\];\s*const indexedTurnTools = turnTools\.map\(\(tool, originalIndex\)[\s\S]*const editToolIds = new Set\([\s\S]*normalizeFileMutation\(tool\.name, tool\.input\)[\s\S]*tool\.id[\s\S]*const editCards = indexedTurnTools[\s\S]*const otherTools = indexedTurnTools[\s\S]*originalIndex/,
    "edit and non-edit tools use a pending-independent partition with original indices",
  );
  assert.match(
    turnRender,
    /<ChatToolActivityLayout[\s\S]*activity=\{otherTools\.length \? <ToolGroup tools=\{otherTools\} \/> : null\}[\s\S]*content=\{[\s\S]*indicatorVisible[\s\S]*<ThinkingIndicator[\s\S]*<MessageBubble[\s\S]*editCards=\{\s*editCards\.length/,
    "the no-text indicator/answer swap happens between stable activity and edit-card slots",
  );
  assert.match(
    turnRender,
    /toolProjectRoot[\s\S]*actionReadyMutationTargetFiles\([\s\S]*tool\.name,[\s\S]*tool\.input,[\s\S]*tool\.status,[\s\S]*toolProjectRoot/,
    "aggregate changed-file review is projected through the turn's execution root",
  );
  assert.match(
    source,
    /toolProjectRoot=\{turnProjectRoots\.get\(t\.id\) \?\? null\}/,
    "each row receives the root resolved from stable turn/session execution metadata",
  );
  assert.doesNotMatch(
    turnRender,
    /segmentTurn\(|bubbleSegments|<ToolRuns/,
    "TurnRow has no pending-only tool segmentation or duplicate ToolRuns branch",
  );
  assert.doesNotMatch(
    source,
    /InlineToolRuns|useFocusSafeToolRelocation|data-inline-tool-runs/,
    "obsolete inline relocation components and focus guards are removed",
  );
  assert.doesNotMatch(
    turnSegmentsSource,
    /\bsegmentTurn\b|TurnSegment|SegmentedTool/,
    "the dead local prose-segmentation pipeline is removed",
  );
  assert.match(
    turnSegmentsSource,
    /export function groupConsecutiveTools/,
    "the repeated-run grouping helper remains",
  );
});

console.log("chat-tool-activity-lifecycle.test.ts: ok");
