// @ts-nocheck
// Onboarding status: when the daemon is offline the familiar count is
// unknown, so the binding step must point at the daemon rather than
// blaming the user's bindings. Source-pattern assertions (the route's
// checks call the live daemon socket, so we don't execute them here).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /checkBinding\(familiarsAvailable: boolean, daemonOk: boolean\)/,
  "checkBinding receives daemon health so it can attribute the blocker correctly",
);

assert.match(
  source,
  /daemonOk\s*\?\s*"Bindings set but no familiars to bind\."\s*:\s*"Waiting for the daemon — familiars load once it starts\."/,
  "binding hint defers to the daemon when it is offline",
);

assert.match(
  source,
  /checkBinding\(familiarsRes\.count > 0, daemon\.ok\)/,
  "GET passes the daemon step result into checkBinding",
);

console.log("onboarding-status route.test.ts: ok");
