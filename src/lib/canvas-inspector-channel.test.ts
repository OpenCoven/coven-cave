// @ts-nocheck
import assert from "node:assert/strict";

import * as inspector from "./canvas-inspector.ts";

const {
  CANVAS_COMPONENT_SELECTED_MESSAGE_TYPE,
  CANVAS_INSPECTOR_LOADED_MESSAGE_TYPE,
  CANVAS_INSPECTOR_MESSAGE_TYPE,
  createCanvasInspectorChannel,
} = inspector;

assert.equal(
  typeof createCanvasInspectorChannel,
  "function",
  "canvas inspector exposes a parent-owned channel lifecycle controller",
);

class FakePort {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  posted: unknown[] = [];
  closed = false;
  started = false;

  postMessage(message: unknown) {
    if (!this.closed) this.posted.push(message);
  }

  start() {
    this.started = true;
  }

  close() {
    this.closed = true;
  }

  receive(data: unknown) {
    if (!this.closed) this.onmessage?.({ data });
  }
}

const loaded: string[] = [];
const selected: unknown[] = [];
const channel = createCanvasInspectorChannel({
  onLoaded: () => loaded.push("loaded"),
  onSelection: (value) => selected.push(value),
});

const trusted = new FakePort();
const forged = new FakePort();
assert.equal(channel.acceptBootstrap(trusted), true, "the first bootstrap is accepted");
assert.equal(trusted.started, true, "the accepted port is started");
assert.equal(channel.acceptBootstrap(forged), false, "a second bootstrap is rejected");
assert.equal(forged.closed, true, "the forged second bootstrap port is closed");

channel.setEnabled(true);
assert.deepEqual(trusted.posted, [], "inspection is not enabled before the authenticated load handshake");
trusted.receive({
  type: CANVAS_COMPONENT_SELECTED_MESSAGE_TYPE,
  target: { selector: "#forged", label: "forged", excerpt: "<button>" },
});
assert.deepEqual(selected, [], "selected targets are ignored before the authenticated load handshake");

trusted.receive({ type: CANVAS_INSPECTOR_LOADED_MESSAGE_TYPE });
assert.deepEqual(loaded, ["loaded"], "the retained inspector port authenticates its load");
assert.equal(channel.loaded, true);
channel.setEnabled(true);
assert.deepEqual(
  trusted.posted,
  [{ type: CANVAS_INSPECTOR_MESSAGE_TYPE, enabled: true }],
  "comment mode is enabled only after authenticated load",
);

const selection = {
  type: CANVAS_COMPONENT_SELECTED_MESSAGE_TYPE,
  target: { selector: "#safe", label: "Safe", excerpt: "<button id=safe>" },
};
trusted.receive(selection);
assert.deepEqual(selected, [selection], "selected targets are accepted after authenticated load");
assert.equal(channel.handleFrameLoad(), "authenticated", "the matching iframe load completes normally");
assert.equal(channel.handleFrameLoad(), "unexpected", "a later iframe load is unexpected navigation");
assert.equal(trusted.closed, true, "unexpected post-load navigation closes the authenticated channel");

const stale = trusted;
channel.reset();
const replacement = new FakePort();
assert.equal(channel.acceptBootstrap(replacement), true, "srcDoc reset accepts one new bootstrap");
stale.receive({ type: CANVAS_INSPECTOR_LOADED_MESSAGE_TYPE });
assert.deepEqual(loaded, ["loaded"], "a stale closed port cannot authenticate the new generation");
assert.equal(channel.loaded, false);
replacement.receive({ type: CANVAS_INSPECTOR_LOADED_MESSAGE_TYPE });
assert.deepEqual(loaded, ["loaded", "loaded"], "the new generation authenticates independently");

channel.dispose();
assert.equal(replacement.closed, true, "unmount closes the current channel");

const navigated = createCanvasInspectorChannel({
  onLoaded: () => {
    throw new Error("an immediate navigation must not authenticate");
  },
  onSelection: () => {
    throw new Error("an immediate navigation must not select");
  },
});
const preLoadPort = new FakePort();
navigated.acceptBootstrap(preLoadPort);
assert.equal(
  navigated.handleFrameLoad(),
  "pending",
  "an iframe load waits one task for the retained-port message queued by window.load",
);
assert.equal(
  navigated.settleFrameLoad(),
  "unexpected",
  "an iframe load without the retained-port handshake is an immediate pre-load navigation",
);
assert.equal(preLoadPort.closed, true, "the navigated destination loses the channel");

const reordered = createCanvasInspectorChannel({
  onLoaded: () => undefined,
  onSelection: () => undefined,
});
const reorderedPort = new FakePort();
reordered.acceptBootstrap(reorderedPort);
assert.equal(reordered.handleFrameLoad(), "pending", "the parent iframe load may dispatch before the port message");
reorderedPort.receive({ type: CANVAS_INSPECTOR_LOADED_MESSAGE_TYPE });
assert.equal(reordered.loaded, true, "a queued authenticated load message wins before navigation classification settles");
assert.equal(reordered.handleFrameLoad(), "unexpected", "the authenticated pending load is marked complete");

console.log("canvas-inspector-channel.test.ts ✓");
