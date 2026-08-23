// @ts-nocheck
//
// cave-lryhx — the shared keydown key guard.
//
// Every assertion here drives a REAL event through a REAL EventTarget
// listener, because the defect only exists at that boundary: the crash came
// from `new Event("keydown")` being dispatched at a handler that had been
// written against `KeyboardEvent`. A test that hand-builds `{ key: undefined }`
// object literals asserts the guard's spelling; dispatching the event asserts
// the property.
import assert from "node:assert/strict";
import { eventKey } from "./keyboard-event-key.ts";

/** Dispatch `event` at a listener that calls `fn`, returning what happened. */
function dispatch(event, fn) {
  const target = new EventTarget();
  let threw = null;
  let result = Symbol("never-ran");
  target.addEventListener("keydown", (e) => {
    try {
      result = fn(e);
    } catch (err) {
      threw = err;
    }
  });
  target.dispatchEvent(event);
  return { threw, result };
}

// ── The reported shape: dispatched as keydown, constructed as a plain Event ──
{
  const bad = new Event("keydown");
  assert.equal("key" in bad, false, "a plain Event carries no key at all");
  const { threw, result } = dispatch(bad, eventKey);
  assert.equal(threw, null, "reading the key off a keyless event must not throw");
  assert.equal(result, null, "an unreadable key reads as null");
}

// ── A well-formed KeyboardEvent with no key reports "" rather than undefined.
// `new KeyboardEvent("keydown", { metaKey: true })` produces exactly this, so
// it is a second unreadable shape and not a hypothetical one.
{
  const { threw, result } = dispatch(
    Object.assign(new Event("keydown"), { key: "", metaKey: true }),
    eventKey,
  );
  assert.equal(threw, null);
  assert.equal(result, null, 'an empty-string key is unreadable, not a key named ""');
}

// ── Non-string keys, which is what a hand-rolled synthetic tends to produce ──
for (const bad of [null, undefined, 42, {}, [], true]) {
  const { threw, result } = dispatch(
    Object.assign(new Event("keydown"), { key: bad }),
    eventKey,
  );
  assert.equal(threw, null, `key=${String(bad)} must not throw`);
  assert.equal(result, null, `key=${String(bad)} reads as null`);
}

// ── A missing event object at all ────────────────────────────────────────────
assert.equal(eventKey(null), null);
assert.equal(eventKey(undefined), null);

// ── The guard must not "pass" by refusing every key ──────────────────────────
// Without these, deleting the body and returning null unconditionally would be
// green — the failure mode that makes a guard test worthless.
{
  const { threw, result } = dispatch(
    Object.assign(new Event("keydown"), { key: "B" }),
    eventKey,
  );
  assert.equal(threw, null);
  assert.equal(result, "b", "a real key still reads, lowercased");
}
for (const [raw, want] of [
  ["b", "b"],
  ["B", "b"],
  ["Escape", "escape"],
  ["ArrowRight", "arrowright"],
  ["\\", "\\"],
  ["]", "]"],
]) {
  assert.equal(
    dispatch(Object.assign(new Event("keydown"), { key: raw }), eventKey).result,
    want,
    `key=${raw} lowercases to ${want}`,
  );
}

console.log("keyboard-event-key.test.ts: ok");
