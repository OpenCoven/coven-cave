// @ts-nocheck
import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

const flowRoute = await readFile(new URL("./route.ts", import.meta.url), "utf8");
const workflowRoute = await readFile(
  new URL("../../workflows/runs/route.ts", import.meta.url),
  "utf8",
);
const guards = await readFile(
  new URL("../../../../lib/server/run-history-guards.ts", import.meta.url),
  "utf8",
);

// Shared guard module exists with the forge-resistance primitives.
assert.match(guards, /export function validateSteps</, "guards expose step validation");
assert.match(guards, /export function resolveRunSource\(/, "guards expose source resolution");
assert.match(guards, /export function resolveWipe\(/, "guards expose wipe resolution");
assert.match(guards, /MAX_RUN_STEPS\b/, "guards define a step count cap");
assert.match(guards, /MAX_RUN_STEPS_BYTES\b/, "guards define a step byte cap");

// Parity: both route families import and apply the same guards.
for (const [name, route] of [
  ["flows/runs", flowRoute],
  ["workflows/runs", workflowRoute],
]) {
  assert.match(
    route,
    /import \{ isLocalOrigin \} from "@\/lib\/server\/local-origin";/,
    `${name} imports the desktop-only origin guard`,
  );
  assert.match(
    route,
    /from "@\/lib\/server\/run-history-guards"/,
    `${name} imports the shared run-history guards`,
  );
  // POST is loopback-gated.
  assert.match(
    route,
    /export async function POST\(req: Request\) \{\s*if \(!isLocalOrigin\(req\)\) return forbidden\(\);/,
    `${name} POST rejects non-loopback requests`,
  );
  // DELETE is loopback-gated and wipe-safe.
  assert.match(
    route,
    /export async function DELETE\(req: Request\) \{\s*if \(!isLocalOrigin\(req\)\) return forbidden\(\);/,
    `${name} DELETE rejects non-loopback requests`,
  );
  assert.match(route, /resolveWipe\(/, `${name} DELETE routes through the safe-wipe guard`);
  // Steps are bounded on write.
  assert.match(route, /validateSteps</, `${name} POST bounds the steps array`);
  assert.match(route, /status: 413/, `${name} returns 413 on oversized steps`);
  // Source provenance cannot be forged from the body.
  assert.match(
    route,
    /source: resolveRunSource\(req, body\.source\)/,
    `${name} derives source via the guard instead of trusting the body`,
  );
  // The old forgeable pattern is gone.
  assert.doesNotMatch(
    route,
    /source: body\.source === "daemon" \? "daemon" : "cave"/,
    `${name} no longer trusts a client-claimed daemon source`,
  );
  assert.doesNotMatch(
    route,
    /steps: Array\.isArray\(body\.steps\) \? body\.steps : \[\]/,
    `${name} no longer persists an unbounded steps array`,
  );
}

// Flow PATCH (which workflow lacks a store for) is also guarded + bounded.
assert.match(
  flowRoute,
  /export async function PATCH\(req: Request\) \{\s*if \(!isLocalOrigin\(req\)\) return forbidden\(\);/,
  "flows PATCH rejects non-loopback requests",
);

const root = path.join(process.cwd(), `.flow-run-api-${process.pid}`);
const savedEnv = { ...process.env };
try {
  await mkdir(root, { recursive: true });
  process.env.COVEN_HOME = root;
  process.env.COVEN_CAVE_HOME = path.join(root, "cave");
  delete process.env.COVEN_FLOW_RUNS_PATH;
  delete process.env.COVEN_CAVE_AUTH_TOKEN;
  const { POST, PATCH } = await import("./route.ts");
  const { loadInbox } = await import("../../../../lib/cave-inbox.ts");
  const request = (method, body) => new Request("http://localhost/api/flows/runs", {
    method, headers: { "content-type": "application/json", host: "localhost" },
    body: JSON.stringify(body),
  });
  const missionResponse = await POST(request("POST", {
    flowId: "mission-flow", status: "running", steps: [], missionId: "mission", iteration: 2, sessionId: "mission-session",
  }));
  assert.equal(missionResponse.status, 200);
  const missionRun = (await missionResponse.json()).run;
  assert.equal(missionRun.missionId, "mission");
  assert.equal(missionRun.iteration, 2);
  for (const provenance of [{ missionId: " " }, { missionId: 42 }, { iteration: 0 }, { iteration: 1.5 }]) {
    assert.equal((await POST(request("POST", { flowId: "bad", status: "running", steps: [], ...provenance }))).status, 400);
  }
  const response = await POST(request("POST", { flowId: "engine", status: "succeeded", steps: [] }));
  assert.equal(response.status, 200);
  const { run } = await response.json();
  assert.equal((await loadInbox()).items.length, 0, "successful engine runs stay quiet");
  for (let repeat = 0; repeat < 2; repeat += 1) {
    assert.equal((await PATCH(request("PATCH", { id: run.id, status: "failed" }))).status, 200);
  }
  let items = (await loadInbox()).items;
  assert.equal(items.length, 1, "repeated terminal PATCH produces one actionable parent item");
  assert.equal(new URL(items[0].link.ref, "http://localhost").searchParams.get("flowRun"), run.id);
  await PATCH(request("PATCH", { id: run.id, status: "succeeded" }));
  assert.equal((await loadInbox()).items[0].status, "done", "success resolves stale attention quietly");
  await POST(request("POST", { flowId: "failed-engine", status: "failed", steps: [] }));
  items = (await loadInbox()).items;
  assert.equal(items.filter((item) => item.status === "fired").length, 1,
    "terminal POST follows the same parent notification policy");
} finally {
  for (const key of ["COVEN_HOME", "COVEN_CAVE_HOME", "COVEN_FLOW_RUNS_PATH", "COVEN_CAVE_AUTH_TOKEN"]) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await rm(root, { recursive: true, force: true });
}

console.log("run-history-hardening route.test.ts: ok");
