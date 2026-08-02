// @ts-nocheck
import assert from "node:assert/strict";

// A minimal localStorage stand-in installed before the module loads, so the
// SSR guard (`typeof window === "undefined"`) does not short-circuit the reads.
const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  },
};

const {
  readCodeReadingPin,
  writeCodeReadingPin,
  normalizeCodeReadingPin,
  codeReadingPinKey,
  CODE_READING_PIN_KEY,
  DEFAULT_CODE_READING_PIN,
} = await import("./code-reading-pref.ts");

// Keys: shared default unscoped, suffixed per familiar.
{
  assert.equal(codeReadingPinKey(), CODE_READING_PIN_KEY);
  assert.equal(codeReadingPinKey("cody"), `${CODE_READING_PIN_KEY}:cody`);
  assert.equal(codeReadingPinKey(null), CODE_READING_PIN_KEY);
}

// Nothing stored ⇒ the default.
{
  store.clear();
  assert.equal(readCodeReadingPin(), DEFAULT_CODE_READING_PIN);
  assert.equal(readCodeReadingPin("cody"), DEFAULT_CODE_READING_PIN);
}

// A familiar's own pin wins for that familiar.
{
  store.clear();
  writeCodeReadingPin("split", "cody");
  assert.equal(readCodeReadingPin("cody"), "split");
}

// A familiar with no pin of its own inherits the last explicit choice rather
// than snapping back to auto — the house style carries across familiars.
{
  store.clear();
  writeCodeReadingPin("overlay", "cody");
  assert.equal(readCodeReadingPin("scout"), "overlay", "scout inherits the house style");
  // …until scout states its own preference, which must not disturb cody's.
  writeCodeReadingPin("split", "scout");
  assert.equal(readCodeReadingPin("scout"), "split");
  assert.equal(readCodeReadingPin("cody"), "overlay", "cody keeps its own pin");
}

// A hand-edited or stale value can never widen the type.
{
  store.clear();
  store.set(`${CODE_READING_PIN_KEY}:cody`, "modal");
  assert.equal(readCodeReadingPin("cody"), DEFAULT_CODE_READING_PIN, "modal is a resolved mode, not a pin");
  store.set(`${CODE_READING_PIN_KEY}:cody`, "{}");
  assert.equal(readCodeReadingPin("cody"), DEFAULT_CODE_READING_PIN);
}

// normalize is total.
{
  assert.equal(normalizeCodeReadingPin("split"), "split");
  assert.equal(normalizeCodeReadingPin(undefined), DEFAULT_CODE_READING_PIN);
  assert.equal(normalizeCodeReadingPin(7), DEFAULT_CODE_READING_PIN);
  assert.equal(normalizeCodeReadingPin(null), DEFAULT_CODE_READING_PIN);
}

// A throwing localStorage (private mode / quota) degrades to the default
// instead of taking the surface down.
{
  const saved = globalThis.window.localStorage;
  globalThis.window.localStorage = {
    getItem() { throw new Error("denied"); },
    setItem() { throw new Error("quota"); },
  };
  assert.equal(readCodeReadingPin("cody"), DEFAULT_CODE_READING_PIN);
  assert.doesNotThrow(() => writeCodeReadingPin("split", "cody"));
  globalThis.window.localStorage = saved;
}
