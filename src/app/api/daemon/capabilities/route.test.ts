// @ts-nocheck
// Cave consumes the daemon's control-plane capability catalog (served at the
// exact /api/v1/capabilities path) for feature negotiation. It must:
//  - read that exact daemon path,
//  - validate the catalog shape so an unrelated aggregate payload isn't passed
//    through as capabilities,
//  - distinguish a genuinely offline daemon from one that is up but too old to
//    expose the catalog.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /callDaemon<DaemonCapabilityCatalog>\(\{\s*path: "\/api\/v1\/capabilities"/,
  "control-plane capabilities route should fetch the daemon's exact /api/v1/capabilities path",
);

assert.match(
  source,
  /Array\.isArray\(\(data as DaemonCapabilityCatalog\)\.capabilities\)/,
  "the catalog shape must be validated before it is trusted (harness-aggregate payloads have no `capabilities` array)",
);

assert.match(
  source,
  /new Set\(\s*capabilities[\s\S]*\.flatMap\(\(c\) => c\.actions/,
  "action ids should be flattened and de-duped across capabilities",
);

assert.match(
  source,
  /\.filter\(\(c\) => c\.status === "available"\)/,
  "only available capabilities should contribute routable control actions",
);

assert.match(
  source,
  /ECONNREFUSED|ETIMEDOUT|ENOENT/,
  "connection-level failures should be classified as the daemon being offline",
);

assert.match(
  source,
  /running: false[\s\S]*error: "daemon offline"/,
  "an offline daemon should report running:false with a daemon-offline error",
);

assert.match(
  source,
  /running: true,\s*capabilities: \[\],[\s\S]*does not expose a control-plane capability catalog/,
  "a reachable daemon without the catalog should report running:true (not an outage)",
);

console.log("daemon capabilities route.test.ts: ok");
