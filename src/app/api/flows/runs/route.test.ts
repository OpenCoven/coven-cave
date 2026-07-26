// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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

console.log("run-history-hardening route.test.ts: ok");
