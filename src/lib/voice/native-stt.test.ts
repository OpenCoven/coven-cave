// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createNativeSttEars,
  nativeSttAvailable,
  STT_EVENT,
} from "./native-stt.ts";

const tick = () => new Promise((resolve) => setImmediate(resolve));

function fakeTimers() {
  let nextId = 0;
  const pending = new Map();
  return {
    setTimeout: (fn, ms) => {
      const handle = ++nextId;
      pending.set(handle, { fn, ms });
      return handle;
    },
    clearTimeout: (handle) => {
      pending.delete(handle);
    },
    /** Fire the (single) pending timer scheduled with `ms`. */
    fire(ms) {
      const entry = [...pending.entries()].find(([, t]) => t.ms === ms);
      assert.ok(entry, `no pending timer with ms=${ms}`);
      pending.delete(entry[0]);
      entry[1].fn();
    },
    countByMs(ms) {
      return [...pending.values()].filter((t) => t.ms === ms).length;
    },
    get size() {
      return pending.size;
    },
  };
}

function fakeBridge() {
  const calls = [];
  let handler = null;
  let unlistened = 0;
  return {
    calls,
    /** Commands invoked, as "cmd" strings. */
    get commands() {
      return calls.map(([cmd]) => cmd);
    },
    argsFor(cmd) {
      return calls.filter(([c]) => c === cmd).map(([, args]) => args);
    },
    emit(payload) {
      handler?.({ payload });
    },
    get unlistened() {
      return unlistened;
    },
    bridge: {
      async invoke(cmd, args) {
        calls.push([cmd, args]);
        if (cmd === "speech_stt_available") return { supported: true };
        return undefined;
      },
      async listen(event, h) {
        assert.equal(event, STT_EVENT);
        handler = h;
        return () => {
          unlistened += 1;
          handler = null;
        };
      },
    },
  };
}

function collector() {
  const partials = [];
  const finals = [];
  const errors = [];
  return {
    partials,
    finals,
    errors,
    handlers: {
      onPartial: (t) => partials.push(t),
      onFinal: (t) => finals.push(t),
      onError: (code, hint) => errors.push({ code, hint }),
    },
  };
}

function makeEars({ lang } = {}) {
  const fx = fakeBridge();
  const timers = fakeTimers();
  const got = collector();
  const ears = createNativeSttEars(fx.bridge, {
    lang,
    stabilityMs: 1_000,
    maxUtteranceMs: 9_000,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  })(got.handlers);
  return { fx, timers, got, ears };
}

test("listen starts a native session; stable partial finishes it; final restarts", async () => {
  const { fx, timers, got, ears } = makeEars({ lang: "en-US" });

  ears.listen();
  await tick();
  assert.deepEqual(fx.argsFor("speech_stt_start"), [{ session: 1, lang: "en-US" }]);

  fx.emit({ session: 1, kind: "partial", text: "open the" });
  fx.emit({ session: 1, kind: "partial", text: "open the grimoire" });
  assert.deepEqual(got.partials, ["open the", "open the grimoire"]);

  // The transcript went quiet: the stability timer ends the utterance.
  timers.fire(1_000);
  await tick();
  assert.deepEqual(fx.argsFor("speech_stt_finish"), [{ session: 1 }]);

  fx.emit({ session: 1, kind: "final", text: "open the grimoire" });
  fx.emit({ session: 1, kind: "end" });
  await tick();
  assert.deepEqual(got.finals, ["open the grimoire"]);
  // One-shot native task: a fresh session keeps the ears open.
  assert.deepEqual(fx.argsFor("speech_stt_start").at(-1), { session: 2, lang: "en-US" });
  assert.deepEqual(got.errors, []);
});

test("events from a stale session are dropped", async () => {
  const { fx, timers, got, ears } = makeEars();
  ears.listen();
  await tick();

  fx.emit({ session: 99, kind: "partial", text: "ghost" });
  fx.emit({ session: 99, kind: "final", text: "ghost" });
  assert.deepEqual(got.partials, []);
  assert.deepEqual(got.finals, []);
  assert.equal(timers.size, 0);
});

test("hush stops the native session and blocks the auto-restart", async () => {
  const { fx, got, ears } = makeEars();
  ears.listen();
  await tick();
  fx.emit({ session: 1, kind: "partial", text: "hello" });

  ears.hush();
  await tick();
  assert.deepEqual(fx.argsFor("speech_stt_stop"), [{ session: 1 }]);

  // The torn-down task's trailing end must not resurrect listening.
  fx.emit({ session: 1, kind: "end" });
  await tick();
  assert.equal(fx.argsFor("speech_stt_start").length, 1);
  assert.deepEqual(got.errors, []);

  // A fresh listen() opens a new numbered session.
  ears.listen();
  await tick();
  assert.deepEqual(fx.argsFor("speech_stt_start").at(-1), { session: 2, lang: null });
});

test("engine errors surface once and stop listening until asked again", async () => {
  const { fx, got, ears } = makeEars();
  ears.listen();
  await tick();

  fx.emit({
    session: 1,
    kind: "error",
    code: "stt_permission_denied",
    message: "Speech recognition permission is denied",
  });
  fx.emit({ session: 1, kind: "end" });
  await tick();
  assert.deepEqual(got.errors, [
    { code: "stt_permission_denied", hint: "Speech recognition permission is denied" },
  ]);
  // No auto-restart after an error — the loop owns retry UX.
  assert.equal(fx.argsFor("speech_stt_start").length, 1);
});

test("an empty final is not brained but listening continues", async () => {
  const { fx, got, ears } = makeEars();
  ears.listen();
  await tick();

  fx.emit({ session: 1, kind: "final", text: "   " });
  await tick();
  assert.deepEqual(got.finals, []);
  assert.equal(fx.argsFor("speech_stt_start").length, 2);
});

test("the utterance cap finishes a transcript that never stabilizes", async () => {
  const { fx, timers, ears } = makeEars();
  ears.listen();
  await tick();

  // A noisy room: partials keep changing, each resetting stability — but the
  // cap timer is scheduled once and survives the resets.
  fx.emit({ session: 1, kind: "partial", text: "a" });
  fx.emit({ session: 1, kind: "partial", text: "ab" });
  fx.emit({ session: 1, kind: "partial", text: "abc" });
  assert.equal(timers.countByMs(9_000), 1);

  timers.fire(9_000);
  await tick();
  assert.deepEqual(fx.argsFor("speech_stt_finish"), [{ session: 1 }]);
});

test("close tears down the session and the event channel", async () => {
  const { fx, got, ears } = makeEars();
  ears.listen();
  await tick();

  ears.close();
  await tick();
  assert.deepEqual(fx.argsFor("speech_stt_stop"), [{ session: 1 }]);
  assert.equal(fx.unlistened, 1);

  ears.listen();
  await tick();
  assert.equal(fx.argsFor("speech_stt_start").length, 1, "closed ears must not restart");
  assert.deepEqual(got.errors, []);
});

test("nativeSttAvailable reflects the probe and never throws", async () => {
  assert.equal(
    await nativeSttAvailable({
      invoke: async () => ({ supported: true }),
      listen: async () => () => {},
    }),
    true,
  );
  assert.equal(
    await nativeSttAvailable({
      invoke: async () => ({ supported: false, reason: "not macOS" }),
      listen: async () => () => {},
    }),
    false,
  );
  assert.equal(
    await nativeSttAvailable({
      invoke: async () => {
        throw new Error("no ipc");
      },
      listen: async () => () => {},
    }),
    false,
  );
});
