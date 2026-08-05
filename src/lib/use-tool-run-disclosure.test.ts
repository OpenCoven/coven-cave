// @ts-nocheck
// Behavior contract for useToolRunDisclosure — the hook that drives a repeated
// tool run group's open/closed state.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, useEffect } from "react";
import { act, create } from "react-test-renderer";

import {
  useFocusSafeToolRelocation,
  useToolRunDisclosure,
} from "./use-tool-run-disclosure.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ statuses, snapshots }) {
  const result = useToolRunDisclosure(statuses);
  snapshots.push(result);
  return createElement("span");
}

// ── 1. Opens while running; collapses when all settle ────────────────────────
test("opens while any status is running and collapses when all settle", async () => {
  const snapshots = [];
  let renderer;
  await act(async () => {
    renderer = create(createElement(Probe, { statuses: ["running", "running"], snapshots }));
  });
  assert.equal(snapshots.at(-1).open, true, "open when any call is running");

  await act(async () => {
    renderer.update(createElement(Probe, { statuses: ["ok", "ok"], snapshots }));
  });
  assert.equal(snapshots.at(-1).open, false, "collapses when all calls settle");

  await act(async () => { renderer.unmount(); });
});

// ── 2. Manual toggle works while settled ────────────────────────────────────
test("settled runs obey manual open/close toggles", async () => {
  const snapshots = [];
  let renderer;
  await act(async () => {
    renderer = create(createElement(Probe, { statuses: ["ok", "error"], snapshots }));
  });
  assert.equal(snapshots.at(-1).open, false, "starts closed when already settled");

  const first = snapshots.at(-1);
  await act(async () => { first.onToggle(true); });
  assert.equal(snapshots.at(-1).open, true, "can be manually opened");

  const second = snapshots.at(-1);
  await act(async () => { second.onToggle(false); });
  assert.equal(snapshots.at(-1).open, false, "can be manually closed");

  await act(async () => { renderer.unmount(); });
});

// ── 3. Running state refuses manual collapse ─────────────────────────────────
test("running state cannot be manually collapsed", async () => {
  const snapshots = [];
  let renderer;
  await act(async () => {
    renderer = create(createElement(Probe, { statuses: ["running"], snapshots }));
  });
  assert.equal(snapshots.at(-1).open, true, "open when running");

  const { onToggle, detailsRef } = snapshots.at(-1);
  const fakeDetails = { open: true };
  detailsRef.current = fakeDetails;

  const countBefore = snapshots.length;
  await act(async () => { onToggle(false); });
  // No state update should have occurred (no new render from this toggle).
  assert.equal(snapshots.length, countBefore, "no re-render: collapse was refused");
  assert.equal(fakeDetails.open, true, "DOM open attribute restored by the guard");

  await act(async () => { renderer.unmount(); });
});

// ── 4. Deferred collapse while focus is inside; collapses on blur ────────────
test("defers collapse while focus is inside the details; collapses on onBlurCapture", async () => {
  const snapshots = [];
  const originalDocument = globalThis.document;

  // A fake DOM subtree: innerElement is inside fakeDetails.
  const innerElement = {};
  const fakeDetails = {
    open: true,
    contains: (node) => node === innerElement,
  };

  // Stub document.activeElement so the hook sees focus inside the details.
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { activeElement: innerElement },
  });

  let renderer;
  try {
    // Mount with a running status so the hook registers prevRunning = true.
    await act(async () => {
      renderer = create(createElement(Probe, { statuses: ["running"], snapshots }));
    });
    assert.equal(snapshots.at(-1).open, true, "open while running");

    // Attach the fake details before settlement so contains() is consulted.
    snapshots.at(-1).detailsRef.current = fakeDetails;

    // Transition to settled — focus is still inside, so collapse is deferred.
    await act(async () => {
      renderer.update(createElement(Probe, { statuses: ["ok"], snapshots }));
    });
    assert.equal(
      snapshots.at(-1).open,
      true,
      "stays open while focus is inside the details",
    );

    // Fire onBlurCapture with relatedTarget outside the subtree.
    const latest = snapshots.at(-1);
    await act(async () => {
      latest.onBlurCapture({ relatedTarget: null });
    });
    assert.equal(
      snapshots.at(-1).open,
      false,
      "collapses once focus leaves the details subtree",
    );
  } finally {
    await act(async () => { renderer?.unmount(); });
    if (originalDocument === undefined) {
      delete globalThis.document;
    } else {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: originalDocument,
      });
    }
  }
});

// ── 5. Settled manual toggle clears pending collapse; blur no longer collapses ─
test("settled manual close+reopen clears pending collapse so blur does not collapse", async () => {
  const snapshots = [];
  const originalDocument = globalThis.document;

  const innerElement = {};
  const fakeDetails = {
    open: true,
    contains: (node) => node === innerElement,
  };

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { activeElement: innerElement },
  });

  let renderer;
  try {
    // Mount running with focus inside.
    await act(async () => {
      renderer = create(createElement(Probe, { statuses: ["running"], snapshots }));
    });
    snapshots.at(-1).detailsRef.current = fakeDetails;

    // Settle — focus still inside, so collapse is deferred (open stays true).
    await act(async () => {
      renderer.update(createElement(Probe, { statuses: ["ok"], snapshots }));
    });
    assert.equal(snapshots.at(-1).open, true, "stays open: pending collapse deferred");

    // Settled manual close.
    await act(async () => { snapshots.at(-1).onToggle(false); });
    assert.equal(snapshots.at(-1).open, false, "manually closed");

    // Settled manual reopen — this should clear the pending collapse.
    await act(async () => { snapshots.at(-1).onToggle(true); });
    assert.equal(snapshots.at(-1).open, true, "manually reopened");

    // Blur out — pending collapse was cleared, so group must remain open.
    await act(async () => {
      snapshots.at(-1).onBlurCapture({ relatedTarget: null });
    });
    assert.equal(
      snapshots.at(-1).open,
      true,
      "remains open after blur: pending collapse was cleared by manual toggle",
    );
  } finally {
    await act(async () => { renderer?.unmount(); });
    if (originalDocument === undefined) {
      delete globalThis.document;
    } else {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: originalDocument,
      });
    }
  }
});

// ── 6. Delayed programmatic onToggle(true) after deferred settlement does not clear pendingCollapse ─
test("delayed programmatic onToggle(true) after focus-deferred settlement preserves pendingCollapse; blur still collapses", async () => {
  const snapshots = [];
  const originalDocument = globalThis.document;

  const innerElement = {};
  const fakeDetails = {
    open: true,
    contains: (node) => node === innerElement,
  };

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { activeElement: innerElement },
  });

  let renderer;
  try {
    // Mount running with focus inside.
    await act(async () => {
      renderer = create(createElement(Probe, { statuses: ["running"], snapshots }));
    });
    snapshots.at(-1).detailsRef.current = fakeDetails;

    // Settle — focus still inside, so collapse is deferred (open stays true).
    await act(async () => {
      renderer.update(createElement(Probe, { statuses: ["ok"], snapshots }));
    });
    assert.equal(snapshots.at(-1).open, true, "stays open: pending collapse deferred");

    // A delayed programmatic onToggle(true) arrives — simulating the native
    // <details> toggle event emitted by the forced-open DOM write that happened
    // while the group was still running.  Because nextOpen === open (both true),
    // this must be treated as a redundant/programmatic event and must NOT clear
    // pendingCollapse.
    await act(async () => { snapshots.at(-1).onToggle(true); });
    assert.equal(snapshots.at(-1).open, true, "still open after spurious programmatic toggle");

    // Blur out — pendingCollapse must still be set, so the group collapses.
    await act(async () => {
      snapshots.at(-1).onBlurCapture({ relatedTarget: null });
    });
    assert.equal(
      snapshots.at(-1).open,
      false,
      "collapses on blur: pendingCollapse was preserved despite spurious toggle",
    );
  } finally {
    await act(async () => { renderer?.unmount(); });
    if (originalDocument === undefined) {
      delete globalThis.document;
    } else {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: originalDocument,
      });
    }
  }
});

function RelocationProbe({ pending, snapshots, lifecycle }) {
  const relocation = useFocusSafeToolRelocation(pending);
  snapshots.push(relocation);
  return createElement(
    "turn-body",
    {
      onFocusCapture: relocation.onFocusCapture,
      onBlurCapture: relocation.onBlurCapture,
    },
    relocation.keepToolsInline
      ? createElement("inline-tool-slot", null, createElement(RelocationTool, { lifecycle }))
      : createElement("settled-tool-slot", null, createElement(RelocationTool, { lifecycle })),
  );
}

function RelocationTool({ lifecycle }) {
  useEffect(() => {
    lifecycle.mounts += 1;
    return () => {
      lifecycle.unmounts += 1;
    };
  }, [lifecycle]);
  return createElement("button");
}

test("pending-to-settled relocation preserves focused tool content until focus leaves", async () => {
  const snapshots = [];
  const lifecycle = { mounts: 0, unmounts: 0 };
  const inlineTarget = {
    closest: (selector) => selector === "[data-inline-tool-runs]" ? inlineTarget : null,
  };
  const outsideTarget = { closest: () => null };
  let renderer;

  await act(async () => {
    renderer = create(createElement(RelocationProbe, { pending: true, snapshots, lifecycle }));
  });
  assert.deepEqual(lifecycle, { mounts: 1, unmounts: 0 }, "live tool content mounts once");

  await act(async () => {
    snapshots.at(-1).onFocusCapture({ target: inlineTarget });
  });
  await act(async () => {
    renderer.update(createElement(RelocationProbe, { pending: false, snapshots, lifecycle }));
  });
  assert.equal(snapshots.at(-1).keepToolsInline, true, "settlement retains the inline render path");
  assert.deepEqual(
    lifecycle,
    { mounts: 1, unmounts: 0 },
    "settlement does not remount focused tool content",
  );

  await act(async () => {
    snapshots.at(-1).onBlurCapture({ relatedTarget: outsideTarget });
  });
  assert.equal(snapshots.at(-1).keepToolsInline, false, "focus exit releases the settled layout");
  assert.deepEqual(
    lifecycle,
    { mounts: 2, unmounts: 1 },
    "tool content relocates only after focus leaves",
  );

  await act(async () => { renderer.unmount(); });
});

console.log("use-tool-run-disclosure.test.ts: ok");
