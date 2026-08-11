// @ts-nocheck
// Regression coverage (cave-zs85n): `req.json()` happily returns a top-level
// JSON string/number/boolean/null/array — none of which are the object
// `SendBody` assumes. The route used to mutate that value immediately
// (`body.runId = normalizeChatAttentionOperationId(...)`), which throws a
// bare TypeError on a primitive under strict mode (module code is always
// strict) instead of the same "invalid json body" 400 already returned for
// unparsable JSON. Every case below must reach that established 400 with no
// side effects — no session created, no conversation persisted — before the
// route ever inspects `familiarId`/`prompt`.
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import test from "node:test";

const home = await mkdtemp(path.join(homedir(), "cave-send-body-validation-"));
const caveHome = path.join(home, "cave");
process.env.COVEN_HOME = home;
process.env.COVEN_CAVE_HOME = caveHome;

const { POST } = await import("./route.ts");

function send(rawBody: string) {
  return POST(
    new Request("http://localhost/api/chat/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: rawBody,
    }),
  );
}

async function assertNo400SideEffects() {
  // The route never even touches loadState()/loadConfig() before the body
  // guard runs, so nothing should exist under COVEN_CAVE_HOME yet.
  await assert.rejects(() => readdir(caveHome), /ENOENT/);
}

const malformedBodies: ReadonlyArray<readonly [string, string]> = [
  ["a JSON string", JSON.stringify("just a string")],
  ["a JSON number", JSON.stringify(42)],
  ["a JSON boolean", JSON.stringify(true)],
  ["JSON null", "null"],
  ["a JSON array", JSON.stringify(["familiarId", "prompt"])],
];

for (const [label, raw] of malformedBodies) {
  test(`POST rejects ${label} body with the standard 400, not a thrown TypeError`, async () => {
    const response = await send(raw);
    assert.equal(response.status, 400, `expected a 400 for ${label}, got ${response.status}`);
    assert.deepEqual(await response.json(), { ok: false, error: "invalid json body" });
    await assertNo400SideEffects();
  });
}

test("unparsable JSON still gets the same 400 (no regression on the original guard)", async () => {
  const response = await send("{not json");
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { ok: false, error: "invalid json body" });
  await assertNo400SideEffects();
});

test("a well-formed object body without familiarId still gets the normal validation 400", async () => {
  const response = await send(JSON.stringify({ prompt: "hi" }));
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.error, "familiarId and prompt or attachments are required");
  await assertNo400SideEffects();
});

await rm(home, { recursive: true, force: true });
