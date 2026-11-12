// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { NextRequest } from "next/server.js";
import { proxy } from "../../proxy.ts";
import { dispatchSubmissionsRequest } from "./opencoven-submissions-host.ts";
import * as absent from "./opencoven-submissions-absent.ts";

const request = () => new Request("http://localhost/api/opencoven/submissions", { method: "POST", headers: { host: "localhost", "x-coven-cave-token": "synthetic-submissions-sidecar" }, body: "{}" });
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

const activation = (load, available = true) => ({ available, load });
const oldToken = process.env.COVEN_CAVE_AUTH_TOKEN;
process.env.COVEN_CAVE_AUTH_TOKEN = "synthetic-submissions-sidecar";
test.after(() => {
  if (oldToken === undefined) delete process.env.COVEN_CAVE_AUTH_TOKEN;
  else process.env.COVEN_CAVE_AUTH_TOKEN = oldToken;
});

async function code(response) {
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.ok, false);
  return body.code;
}

test("disabled refuses before anything loads", async () => {
  const load = counting({ submissionsContractVersion: 1, handleSubmissionsRequest() { throw new Error("ran"); } });
  const response = await dispatchSubmissionsRequest("submissions", request(), activation(load), { COVEN_CAVE_SUBMISSIONS_DISABLED: "1" });
  assert.equal(await code(response), "submissions-disabled");
  assert.equal(load.calls, 0);
});

test("only the exact disable value disables", async () => {
  const handled = new Response("ran");
  const load = counting({ submissionsContractVersion: 1, handleSubmissionsRequest: async () => handled });
  for (const value of [undefined, "", "0", "true"]) {
    assert.equal(await dispatchSubmissionsRequest("submissions", request(), activation(load), { COVEN_CAVE_SUBMISSIONS_DISABLED: value }), handled);
  }
});

test("an absent build refuses with its own code and no effects", async () => {
  const load = counting(absent);
  const response = await dispatchSubmissionsRequest("submissions", request(), activation(load, false), {});
  assert.equal(await code(response), "submissions-not-installed");
  const executions = await dispatchSubmissionsRequest("executions", request(), activation(load, false), {});
  assert.equal(await code(executions), "submissions-not-installed");
  assert.equal(load.calls, 0);
});

test("a failed load is one bounded refusal, with no retry or fallback", async () => {
  const load = counting(new Error("boom"));
  const warn = console.warn;
  console.warn = () => {};
  try {
    const response = await dispatchSubmissionsRequest("submissions", request(), activation(load), {});
    assert.equal(await code(response), "submissions-load-failed");
  } finally {
    console.warn = warn;
  }
  assert.equal(load.calls, 1);
});

test("an incompatible implementation never handles the request", async () => {
  let handled = false;
  const load = counting({ submissionsContractVersion: 2, handleSubmissionsRequest: async () => { handled = true; return new Response(); } });
  const response = await dispatchSubmissionsRequest("submissions", request(), activation(load), {});
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

test("absence wins over disable without loading an implementation or stub", async () => {
  const load = counting(new Error("must not load"));
  for (const route of ["submissions", "executions"]) {
    const response = await dispatchSubmissionsRequest(route, request(), activation(load, false), { COVEN_CAVE_SUBMISSIONS_DISABLED: "1" });
    assert.equal(await code(response), "submissions-not-installed");
  }
  assert.equal(load.calls, 0);
});

test("authenticated mobile ingress is refused before availability, disable, loading or effects", async () => {
  const oldAccess = process.env.COVEN_CAVE_ACCESS_TOKEN;
  const oldPasskey = process.env.COVEN_CAVE_PASSKEY_REQUIRED;
  process.env.COVEN_CAVE_ACCESS_TOKEN = "synthetic-submissions-mobile";
  delete process.env.COVEN_CAVE_PASSKEY_REQUIRED;
  try {
    for (const [route, method] of [["submissions", "GET"], ["submissions", "POST"], ["executions", "POST"]]) {
      const ingress = new NextRequest(`http://localhost/api/opencoven/${route}`, { method, headers: {
        host: "localhost", origin: "http://localhost", authorization: "Bearer synthetic-submissions-mobile",
        "content-type": "application/json",
      } });
      const admitted = await proxy(ingress);
      assert.equal(admitted.headers.get("x-middleware-next"), "1", "the actual proxy admits this authenticated ingress");
      const headers = new Headers(ingress.headers);
      for (const key of admitted.headers.get("x-middleware-override-headers").split(",")) {
        headers.set(key, admitted.headers.get(`x-middleware-request-${key}`));
      }
      assert.equal(headers.get("x-coven-cave-mobile-access"), "1");
      const forwarded = new Request(ingress.url, { method, headers });
      for (const available of [true, false]) {
        for (const disabled of ["0", "1"]) {
          let effects = 0;
          const load = counting({ submissionsContractVersion: 1, handleSubmissionsRequest: async () => { effects++; return new Response(); } });
          const response = await dispatchSubmissionsRequest(route, forwarded, activation(load, available), { COVEN_CAVE_SUBMISSIONS_DISABLED: disabled });
          assert.equal(response.status, 403);
          assert.equal(load.calls, 0);
          assert.equal(effects, 0);
        }
      }
    }
  } finally {
    if (oldAccess === undefined) delete process.env.COVEN_CAVE_ACCESS_TOKEN; else process.env.COVEN_CAVE_ACCESS_TOKEN = oldAccess;
    if (oldPasskey === undefined) delete process.env.COVEN_CAVE_PASSKEY_REQUIRED; else process.env.COVEN_CAVE_PASSKEY_REQUIRED = oldPasskey;
  }
});

test("locality checks precede even build metadata access", async () => {
  const remote = new Request("http://localhost/api/opencoven/submissions", { headers: { host: "localhost", "x-coven-cave-mobile-access": "1" } });
  const response = await dispatchSubmissionsRequest("submissions", remote, {
    get available() { throw new Error("availability read before locality"); },
    load() { throw new Error("loaded before locality"); },
  }, {});
  assert.equal(response.status, 403);
});

test("direct loopback remains supported with and without a sidecar credential", async () => {
  const token = process.env.COVEN_CAVE_AUTH_TOKEN;
  try {
    for (const sidecar of [false, true]) {
      if (sidecar) process.env.COVEN_CAVE_AUTH_TOKEN = token;
      else delete process.env.COVEN_CAVE_AUTH_TOKEN;
      const headers = { host: "localhost", ...(sidecar ? { "x-coven-cave-token": token } : {}) };
      const local = new Request("http://localhost/api/opencoven/submissions", { headers });
      const load = counting({ submissionsContractVersion: 1, handleSubmissionsRequest: async () => new Response("accepted") });
      const response = await dispatchSubmissionsRequest("submissions", local, activation(load), {});
      assert.equal(await response.text(), "accepted");
      assert.equal(load.calls, 1);
    }
  } finally {
    if (token === undefined) delete process.env.COVEN_CAVE_AUTH_TOKEN; else process.env.COVEN_CAVE_AUTH_TOKEN = token;
  }
});
