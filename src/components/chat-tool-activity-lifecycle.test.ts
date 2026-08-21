// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, useEffect, useState } from "react";
import { act, create } from "react-test-renderer";

import { ChatToolActivityLayout } from "./chat-tool-activity-layout.ts";
import { source, turnRow } from "./chat-view-polish-fixtures.ts";
import { useToolRunDisclosure } from "../lib/use-tool-run-disclosure.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
  // Both lists must come from ONE partition expression, so the edit-card slot
  // and the activity slot can never disagree about which tools exist. The
  // source is settled-only by design: a streaming turn weaves its tools into
  // the prose inline (renderSegments), and lifting them into these slots while
  // pending would render each tool twice. Matched by shape rather than by the
  // partition variable's name, which is a local and may be renamed.
  const partition = turnRender.match(
    /const (\w+) = [^;]*!turn\.pending[^;]*;\s*const editCards = (\w+)\.filter\(isEditCard\);\s*const otherTools = (\w+)\.filter\(\(t\) => !isEditCard\(t\)\);/,
  );
  assert.ok(
    partition,
    "edit and non-edit tools split once, from a single settled-only tool list",
  );
  assert.equal(partition[2], partition[1], "editCards must filter the shared partition source");
  assert.equal(partition[3], partition[1], "otherTools must filter that same source");

  // `ChatToolActivityLayout` was the old two-slot wrapper. The calm-streaming
  // work replaced it with StreamingTurnResponse, which takes the same content
  // as three named slots instead of two. The guarantee this pin exists for is
  // unchanged: the answer, the collapsed activity, and the edit cards occupy
  // separate stable slots rather than being re-segmented per render, so a
  // focused control inside one of them survives the settle.
  assert.match(
    turnRender,
    /<StreamingTurnResponse[\s\S]*?proseContent=\{proseContent\}\s*activityDetails=\{activityDetails\}\s*supplementaryContent=\{supplementaryContent\}/,
    "answer, activity, and supplementary content stay three separate slots on one response component",
  );
  assert.match(
    turnRender,
    /const activityDetails =[\s\S]*?indicatorVisible \? \([\s\S]*?<ThinkingIndicator[\s\S]*?<ToolGroup tools=\{otherTools\} \/>/,
    "the no-text thinking indicator and the collapsed non-edit tool group share the one activity slot",
  );
  assert.match(
    turnRender,
    /const supplementaryContent =[\s\S]*?editCards\.length[\s\S]*?editCards\.map\(\(tool\) => <ToolBlock/,
    "the edit cards keep their own slot, never folded into the collapsed activity rollup",
  );
  // Inline tool weaving came BACK with calm streaming: a streaming turn
  // interleaves <ToolRuns> at their chronological offsets so a reader can watch
  // the work happen. Asserting the mere absence of `segmentTurn`/`bubbleSegments`
  // now contradicts the design.
  //
  // The hazard those names stood in for is still real, and it is DOUBLE
  // rendering — the same tool appearing inline in the prose AND again in the
  // settled activity/edit slots. Two mutually exclusive branches prevent that,
  // so pin the exclusivity rather than the absence.
  assert.match(
    turnRender,
    /if \(turn\.pending\) \{[\s\S]*?renderSegments = bubbleSegments;\s*\} else \{/,
    "tool blocks weave into the prose only while the turn is pending",
  );
  assert.match(
    turnRender,
    /const proseContent =\s*!pending && renderSegments/,
    "the settled prose slot engages only after settlement, so inline blocks and the settled slots are never both live",
  );
  assert.equal(
    (turnRender.match(/<ToolRuns\b/g) ?? []).length,
    1,
    "exactly one ToolRuns call site in TurnRow — a second would be the duplicate-render branch this guard exists to forbid",
  );
  assert.doesNotMatch(
    source,
    /InlineToolRuns|useFocusSafeToolRelocation|data-inline-tool-runs/,
    "obsolete inline relocation components and focus guards are removed",
  );
});

console.log("chat-tool-activity-lifecycle.test.ts: ok");
