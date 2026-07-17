import assert from "node:assert/strict";
import { test } from "node:test";
import {
  latestCheckText,
  toolFooterStatusText,
  toolStatusText,
} from "./opencoven-tools-status-display.ts";

const checkedAt = "2026-07-12T16:00:00.000Z";

test("a failed npm lookup never renders an installed tool as up to date", () => {
  const tool = {
    installed: true,
    current: "0.0.53",
    latest: null,
    outdated: false,
    compatible: true,
    latestCheck: { status: "failed" as const, checkedAt, error: "registry_error" as const },
  };

  assert.equal(toolStatusText(tool), "Couldn't verify latest version");
  assert.match(latestCheckText(tool), /Couldn't verify latest version/);
  assert.match(
    toolFooterStatusText({ tools: [tool], checking: false, error: null, stale: false }),
    /couldn't be verified/i,
  );
});

test("a local Node/npm launch failure is not presented as a registry failure", () => {
  const tool = {
    installed: true,
    current: null,
    latest: null,
    outdated: false,
    compatible: false,
    latestCheck: { status: "failed" as const, checkedAt, error: "runtime_error" as const },
  };

  assert.match(latestCheckText(tool), /local Node\/npm runtime failed/);
  assert.doesNotMatch(latestCheckText(tool), /registry lookup failed/);
});

test("a failed refresh marks retained version data stale instead of current", () => {
  const tool = {
    installed: true,
    current: "0.0.54",
    latest: "0.0.54",
    outdated: false,
    compatible: true,
    latestCheck: { status: "verified" as const, checkedAt, latest: "0.0.54" },
  };

  assert.equal(toolStatusText(tool, true), "Couldn't verify latest version");
  assert.match(latestCheckText(tool, true), /showing stale data/i);
  assert.match(
    toolFooterStatusText({ tools: [tool], checking: false, error: "network error", stale: true }),
    /stale; re-check failed/i,
  );
});

test("a verified comparison is the only path that can render up to date", () => {
  const tool = {
    installed: true,
    current: "0.0.54",
    latest: "0.0.54",
    outdated: false,
    compatible: true,
    latestCheck: { status: "verified" as const, checkedAt, latest: "0.0.54" },
  };

  assert.equal(toolStatusText(tool), "Up to date");
  assert.match(latestCheckText(tool), /verified with npm at/i);
});

test("a verified newer version remains an update state", () => {
  const tool = {
    installed: true,
    current: "0.0.53",
    latest: "0.0.54",
    outdated: true,
    compatible: true,
    latestCheck: { status: "verified" as const, checkedAt, latest: "0.0.54" },
  };

  assert.equal(toolStatusText(tool), "Update available");
});

test("a wrong package or unreadable version remains an explicit recovery state", () => {
  const base = {
    installed: true,
    latest: "0.0.54",
    outdated: false,
    compatible: false,
    latestCheck: { status: "verified" as const, checkedAt, latest: "0.0.54" },
  };

  assert.equal(
    toolStatusText({ ...base, current: "0.0.54", packageVerified: false }),
    "Unexpected executable",
  );
  assert.equal(
    toolStatusText({ ...base, current: null, packageVerified: true }),
    "Version probe failed",
  );
});
