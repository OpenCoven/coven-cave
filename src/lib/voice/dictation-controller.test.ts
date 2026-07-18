import test from "node:test";
import assert from "node:assert/strict";
import { createDictationController, type DictationHandlers } from "./dictation-controller.ts";
import type { SpeechEarsFactory, SpeechEarsHandlers } from "./speech-loop.ts";

function fakeEars() {
  const calls: string[] = [];
  let handlers: SpeechEarsHandlers | null = null;
  const factory: SpeechEarsFactory = (h) => {
    handlers = h;
    calls.push("create");
    return {
      listen: () => calls.push("listen"),
      hush: () => calls.push("hush"),
      close: () => calls.push("close"),
    };
  };
  return { factory, calls, fire: () => handlers! };
}

function recordingHandlers() {
  const events: Array<{ kind: string; value?: string }> = [];
  const handlers: DictationHandlers = {
    onPartial: (text) => events.push({ kind: "partial", value: text }),
    onFinal: (text) => events.push({ kind: "final", value: text }),
    onError: (code) => events.push({ kind: "error", value: code }),
    onListeningChange: (listening) => events.push({ kind: "listening", value: String(listening) }),
  };
  return { handlers, events };
}

test("unavailable ears -> null controller", async () => {
  const { handlers } = recordingHandlers();
  const controller = await createDictationController(handlers, async () => null);
  assert.equal(controller, null);
});

test("a throwing resolver is treated as unavailable", async () => {
  const { handlers } = recordingHandlers();
  const controller = await createDictationController(handlers, async () => {
    throw new Error("bridge exploded");
  });
  assert.equal(controller, null);
});

test("start() listens once and reports listening; repeat start is a no-op", async () => {
  const ears = fakeEars();
  const { handlers, events } = recordingHandlers();
  const controller = await createDictationController(handlers, async () => ears.factory);
  assert.ok(controller);
  controller.start();
  controller.start();
  assert.deepEqual(ears.calls, ["create", "listen"]);
  assert.deepEqual(events, [{ kind: "listening", value: "true" }]);
  assert.equal(controller.isListening(), true);
});

test("partials and finals forward while listening, not after stop", async () => {
  const ears = fakeEars();
  const { handlers, events } = recordingHandlers();
  const controller = await createDictationController(handlers, async () => ears.factory);
  assert.ok(controller);
  controller.start();
  ears.fire().onPartial("hel");
  ears.fire().onFinal("hello world");
  controller.stop();
  ears.fire().onFinal("ghost words after stop");
  const kinds = events.map((entry) => entry.kind);
  assert.deepEqual(kinds, ["listening", "partial", "final", "listening"]);
  assert.equal(events[2].value, "hello world");
  assert.equal(controller.isListening(), false);
});

test("stop() hushes and is idempotent", async () => {
  const ears = fakeEars();
  const { handlers } = recordingHandlers();
  const controller = await createDictationController(handlers, async () => ears.factory);
  assert.ok(controller);
  controller.start();
  controller.stop();
  controller.stop();
  assert.deepEqual(ears.calls, ["create", "listen", "hush"]);
});

test("an ears error forwards and auto-stops", async () => {
  const ears = fakeEars();
  const { handlers, events } = recordingHandlers();
  const controller = await createDictationController(handlers, async () => ears.factory);
  assert.ok(controller);
  controller.start();
  ears.fire().onError("stt_not-allowed");
  assert.deepEqual(events, [
    { kind: "listening", value: "true" },
    { kind: "error", value: "stt_not-allowed" },
    { kind: "listening", value: "false" },
  ]);
  assert.equal(controller.isListening(), false);
});

test("close() tears down; start() after close is a no-op", async () => {
  const ears = fakeEars();
  const { handlers } = recordingHandlers();
  const controller = await createDictationController(handlers, async () => ears.factory);
  assert.ok(controller);
  controller.start();
  controller.close();
  controller.start();
  assert.deepEqual(ears.calls, ["create", "listen", "close"]);
  assert.equal(controller.isListening(), false);
});
