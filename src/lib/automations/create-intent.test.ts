import assert from "node:assert/strict";
import test from "node:test";
import { createWithStableIntent, type AutomationCreateSession } from "./create-intent.ts";

const input = { name: "Daily", prompt: "Reflect", rrule: "RRULE:FREQ=DAILY;BYHOUR=9", familiars: ["alba"], cwds: ["/journal"], tags: [], model: "", start: "paused" as const };
test("a lost create reply retries the same ID, timezone, body and adoption key", async () => {
  const old = globalThis.fetch;
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    if (bodies.length === 1) throw new TypeError("lost reply");
    return Response.json({ ok: true, automation: { id: bodies[0].id, status: "PAUSED" } });
  }) as typeof fetch;
  try {
    const session: AutomationCreateSession = {};
    assert.equal((await createWithStableIntent(input, session)).kind, "failed");
    assert.ok(session.pending);
    assert.equal((await createWithStableIntent(input, session)).kind, "created");
    assert.deepEqual(bodies[1], bodies[0]);
    assert.match(String(bodies[0].id), /^cron-/);
    assert.match(String(bodies[0].adoptionKey), /^cave-create:/);
    assert.equal(bodies[0].start, undefined);
    assert.equal(typeof bodies[0].timezone, "string");
    assert.equal(session.pending, undefined);
  } finally { globalThis.fetch = old; }
});

test("a partly committed creation retains its intent even on a rejection and never substitutes changed inputs", async () => {
  const old = globalThis.fetch;
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return bodies.length === 1 ? Response.json({ ok: false, uncertain: true, error: "draft exists" }, { status: 422 })
      : Response.json({ ok: true, automation: { id: bodies[0].id, status: "PAUSED" } });
  }) as typeof fetch;
  try {
    const session: AutomationCreateSession = {};
    await createWithStableIntent(input, session);
    assert.equal((await createWithStableIntent({ ...input, name: "Changed" }, session)).kind, "resolved");
    assert.equal(bodies[1].name, "Daily");
    assert.deepEqual(bodies[1], bodies[0]);
  } finally { globalThis.fetch = old; }
});
