// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dispatchSubmissionsRequest } from "./opencoven-submissions-host.ts";
import * as absent from "./opencoven-submissions-absent.ts";

const request = () => new Request("http://cave.test/api/opencoven/submissions", { method: "POST", body: "{}" });
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

function counting(result) {
  const load = async () => {
    load.calls += 1;
    if (result instanceof Error) throw result;
    return result;
  };
  load.calls = 0;
  return load;
}

async function code(response) {
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.ok, false);
  return body.code;
}

test("disabled refuses before anything loads", async () => {
  const load = counting({ submissionsContractVersion: 1, handleSubmissionsRequest() { throw new Error("ran"); } });
  const response = await dispatchSubmissionsRequest("submissions", request(), load, { COVEN_CAVE_SUBMISSIONS_DISABLED: "1" });
  assert.equal(await code(response), "submissions-disabled");
  assert.equal(load.calls, 0);
});

test("only the exact disable value disables", async () => {
  const handled = new Response("ran");
  const load = counting({ submissionsContractVersion: 1, handleSubmissionsRequest: async () => handled });
  for (const value of [undefined, "", "0", "true"]) {
    assert.equal(await dispatchSubmissionsRequest("submissions", request(), load, { COVEN_CAVE_SUBMISSIONS_DISABLED: value }), handled);
  }
});

test("an absent build refuses with its own code and no effects", async () => {
  const response = await dispatchSubmissionsRequest("submissions", request(), async () => absent, {});
  assert.equal(await code(response), "submissions-not-installed");
  const executions = await dispatchSubmissionsRequest("executions", request(), async () => absent, {});
  assert.equal(await code(executions), "submissions-not-installed");
});

test("a failed load is one bounded refusal, with no retry or fallback", async () => {
  const load = counting(new Error("boom"));
  const warn = console.warn;
  console.warn = () => {};
  try {
    const response = await dispatchSubmissionsRequest("submissions", request(), load, {});
    assert.equal(await code(response), "submissions-load-failed");
  } finally {
    console.warn = warn;
  }
  assert.equal(load.calls, 1);
});

test("an incompatible implementation never handles the request", async () => {
  let handled = false;
  const load = counting({ submissionsContractVersion: 2, handleSubmissionsRequest: async () => { handled = true; return new Response(); } });
  const response = await dispatchSubmissionsRequest("submissions", request(), load, {});
  assert.equal(await code(response), "submissions-incompatible");
  assert.equal(handled, false);
});

test("the routes hold no implementation import", () => {
  for (const route of ["submissions", "executions"]) {
    const source = read(`../../app/api/opencoven/${route}/route.ts`);
    assert.doesNotMatch(source, /opencoven-submissions-runtime|@\/lib\/opencoven-submissions|opencoven-submission-store/);
    assert.match(source, /dispatchSubmissionsRequest\(/);
  }
  const loader = read("./opencoven-submissions-loader.ts");
  assert.match(loader, /import\("@opencoven\/submissions-runtime"\)/);
});

test("the retained path imports none of the implementation", () => {
  for (const source of [read("./opencoven-submissions-retained.ts"), read("../../app/api/opencoven/submissions/retained/route.ts")]) {
    assert.doesNotMatch(source, /opencoven-submissions-runtime|@\/lib\/opencoven-submissions"|opencoven-submission-store|submissions-loader/);
  }
});

test("startup owns no Submissions worker", () => {
  assert.doesNotMatch(read("../../instrumentation.ts"), /submission/i);
});
