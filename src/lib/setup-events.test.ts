// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";

// The module reads `window` at call time, so a bare EventTarget stands in for
// it: enough for the host count, the latch and the dispatched CustomEvents.
globalThis.window = new EventTarget();

const {
  SETUP_BACKGROUNDED_EVENT,
  SETUP_OPEN_EVENT,
  clearSetupBackgrounded,
  consumeSetupBackgrounded,
  hasSetupBackgrounded,
  hasSetupHost,
  markSetupBackgrounded,
  readSetupOpenOrigin,
  registerSetupHost,
  requestOpenSetup,
} = await import("./setup-events.ts");

test("requestOpenSetup is a no-op without a host, so a caller can fall back", () => {
  let heard = 0;
  const listener = () => { heard += 1; };
  window.addEventListener(SETUP_OPEN_EVENT, listener);
  assert.equal(hasSetupHost(), false);
  assert.equal(requestOpenSetup("settings"), false, "nobody is listening");
  assert.equal(heard, 0, "no event is dispatched into silence");
  window.removeEventListener(SETUP_OPEN_EVENT, listener);
});

test("a registered host receives the open request with its origin", () => {
  const origins = [];
  const listener = (event) => origins.push(readSetupOpenOrigin(event));
  window.addEventListener(SETUP_OPEN_EVENT, listener);
  const unregister = registerSetupHost();
  assert.equal(hasSetupHost(), true);
  assert.equal(requestOpenSetup("banner"), true);
  assert.equal(requestOpenSetup(), true, "the default origin is a surface open");
  assert.deepEqual(origins, ["banner", "surface"]);
  unregister();
  unregister();
  assert.equal(hasSetupHost(), false, "unregister is idempotent and never goes negative");
  window.removeEventListener(SETUP_OPEN_EVENT, listener);
});

test("nested hosts keep the count until the last one leaves", () => {
  const first = registerSetupHost();
  const second = registerSetupHost();
  first();
  assert.equal(hasSetupHost(), true, "one host remains");
  second();
  assert.equal(hasSetupHost(), false);
});

test("readSetupOpenOrigin treats bare and foreign events as surface opens", () => {
  assert.equal(readSetupOpenOrigin(new Event(SETUP_OPEN_EVENT)), "surface");
  assert.equal(
    readSetupOpenOrigin(new CustomEvent(SETUP_OPEN_EVENT, { detail: { origin: "elsewhere" } })),
    "surface",
  );
  assert.equal(
    readSetupOpenOrigin(new CustomEvent(SETUP_OPEN_EVENT, { detail: { origin: "settings" } })),
    "settings",
  );
});

test("the backgrounded latch is retained until consumed and announced live", () => {
  let heard = 0;
  const listener = () => { heard += 1; };
  window.addEventListener(SETUP_BACKGROUNDED_EVENT, listener);
  assert.equal(consumeSetupBackgrounded(), false, "nothing armed yet");
  markSetupBackgrounded();
  assert.equal(heard, 1, "an already-mounted trigger hears the event");
  assert.equal(hasSetupBackgrounded(), true, "a later mount still finds the latch");
  assert.equal(consumeSetupBackgrounded(), true);
  assert.equal(consumeSetupBackgrounded(), false, "consume is one-shot");
  window.removeEventListener(SETUP_BACKGROUNDED_EVENT, listener);
});

test("clearSetupBackgrounded drops an armed latch without an event", () => {
  markSetupBackgrounded();
  clearSetupBackgrounded();
  assert.equal(hasSetupBackgrounded(), false);
  assert.equal(consumeSetupBackgrounded(), false);
});
