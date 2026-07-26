// @ts-nocheck
import assert from "node:assert/strict";
import { classifyAboutDaemonStatus } from "./about-status.ts";

const checkedAt = "2026-07-12T12:00:00.000Z";

assert.deepEqual(
  classifyAboutDaemonStatus({
    responseOk: true,
    checkedAt,
    payload: { running: true, covenVersion: "0.0.54" },
  }),
  { kind: "running", version: "0.0.54", checkedAt },
  "a healthy daemon reports its running version",
);

assert.equal(
  classifyAboutDaemonStatus({
    responseOk: true,
    checkedAt,
    payload: { running: false, reason: "http 0", target: { mode: "local" } },
  }).kind,
  "stopped",
  "a local daemon that Cave can query but cannot find is explicitly stopped",
);

assert.equal(
  classifyAboutDaemonStatus({
    responseOk: true,
    checkedAt,
    payload: { running: false, reason: "hub unreachable: timeout", target: { mode: "hub" } },
  }).kind,
  "unreachable",
  "remote daemon failures are not rendered as a stopped local service",
);

assert.equal(
  classifyAboutDaemonStatus({
    responseOk: false,
    checkedAt,
    payload: null,
    error: "network request failed",
  }).kind,
  "failed-to-check",
  "a failed About request does not silently become an em dash or healthy state",
);

console.log("about-status.test.ts: ok");
