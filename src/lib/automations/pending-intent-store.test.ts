import assert from "node:assert/strict";
import test from "node:test";
import { pendingIntentSession, pendingIntentMap } from "./pending-intent-store.ts";

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

test("pending requests survive a new component session and clear only when resolved", () => {
  const saved = storage();
  const first = pendingIntentSession<{ body: string }>("edit", () => saved);
  first.pending = { body: '{"adoptionKey":"original","expectedRevision":4}' };
  const remounted = pendingIntentSession<{ body: string }>("edit", () => saved);
  assert.deepEqual(remounted.pending, first.pending);
  delete remounted.pending;
  assert.equal(first.pending, undefined);
});

test("journal pending requests remain distinct by familiar and mutation kind", () => {
  const saved = storage();
  const saves = pendingIntentMap<{ body: string }>("journal-save", () => saved);
  saves.set("astra", { body: "astra-original" });
  saves.set("nova", { body: "nova-original" });
  assert.deepEqual(pendingIntentMap("journal-save", () => saved).get("astra"), { body: "astra-original" });
  assert.equal(pendingIntentMap("journal-activate", () => saved).get("astra"), undefined);
  saves.delete("astra");
  assert.deepEqual(saves.get("nova"), { body: "nova-original" });
});

test("unavailable or corrupt storage refuses instead of silently losing mutation identity", () => {
  const broken = pendingIntentSession("create", () => { throw new Error("denied"); });
  assert.throws(() => { broken.pending = { body: "request" }; }, /pending request/);
  const corrupt = pendingIntentSession("create", () => ({ ...storage(), getItem: () => "invalid" }));
  assert.throws(() => corrupt.pending, /pending request/);
});
