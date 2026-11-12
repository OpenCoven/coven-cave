// Field readers and write-outcome classification for upstream answers
// (#6368, #6369).
import assert from "node:assert/strict";
import test from "node:test";

import {
  ambiguousWrite,
  isAmbiguousWriteStatus,
  login,
  positiveInteger,
  resourceId,
  upstreamDrift,
  userLogin,
  writeNeverSent,
  writeThrew,
} from "./upstream-answer.ts";
import { UpstreamCooldownError } from "./upstream-fetch.ts";

const withCause = (code: string) =>
  Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(code), { code }) });

test("field readers refuse drifted values instead of defaulting them", () => {
  assert.equal(positiveInteger(42), 42);
  for (const bad of [0, -1, 1.5, "42", null, undefined, Number.MAX_SAFE_INTEGER + 1]) assert.equal(positiveInteger(bad), null);
  assert.equal(resourceId(7), "7");
  assert.equal(resourceId("PRRT_kw"), "PRRT_kw");
  for (const bad of [0, "", "  ", null, {}, 1.5]) assert.equal(resourceId(bad), null);
  assert.equal(login("octocat"), "octocat");
  for (const bad of [42, "", " ", null, { login: "x" }]) assert.equal(login(bad), null);
  assert.equal(userLogin({ login: "octocat" }), "octocat");
  assert.equal(userLogin({ login: 42 }), null);
  assert.equal(userLogin(null), null);
});

test("only a write that provably never left counts as never sent", () => {
  assert.equal(writeNeverSent(new UpstreamCooldownError("github", 5_000)), true, "a cooldown answers before sending");
  for (const code of ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"]) {
    assert.equal(writeNeverSent(withCause(code)), true, code);
  }
  assert.equal(writeNeverSent(withCause("ECONNRESET")), false, "a reset may come after the upstream acted");
  assert.equal(writeNeverSent(Object.assign(new Error("deadline"), { name: "TimeoutError" })), false);
  assert.equal(writeNeverSent(new Error("anything else")), false, "unknown is not proof of never sent");
});

test("writeThrew answers ambiguous-write unless the write never left", async () => {
  const reset = await writeThrew("GitHub", "comment", withCause("ECONNRESET"), "failed").json();
  assert.deepEqual(
    { ok: reset.ok, code: reset.code, dispatched: reset.dispatched },
    { ok: false, code: "ambiguous-write", dispatched: true },
  );
  const refused = writeThrew("GitHub", "comment", withCause("ECONNREFUSED"), "failed");
  assert.equal(refused.status, 502);
  const body = await refused.json();
  assert.equal(body.ok, false);
  assert.equal(body.code, undefined);
  assert.equal(body.error, "fetch failed");
});

test("a 5xx answer to a write is ambiguous; a 4xx is a definite refusal", () => {
  for (const status of [500, 502, 503, 504]) assert.equal(isAmbiguousWriteStatus(status), true, String(status));
  for (const status of [400, 403, 404, 409, 422, 429]) assert.equal(isAmbiguousWriteStatus(status), false, String(status));
});

test("the two answer shapes are distinct and never ok", async () => {
  const drift = await upstreamDrift("GitHub", "a login").json();
  assert.deepEqual(drift, { ok: false, code: "upstream-drift", error: "GitHub answered without a login" });
  const write = ambiguousWrite("GitHub", "review");
  assert.equal(write.status, 502);
  const body = await write.json();
  assert.equal(body.code, "ambiguous-write");
  assert.equal(body.dispatched, true);
  assert.match(body.error, /accepted the review/);
});
