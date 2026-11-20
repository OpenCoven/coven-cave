import assert from "node:assert/strict";
import test from "node:test";

import {
  DAEMON_DIAGNOSTICS_BUNDLE_KIND,
  daemonDiagnosticsExportFilename,
  parseDaemonDiagnosticsBundle,
  serializeDaemonDiagnosticsBundle,
  type DaemonDiagnosticsBundle,
} from "./daemon-diagnostics-export.ts";

const validBundle: DaemonDiagnosticsBundle = {
  manifest: {
    schemaVersion: 1,
    kind: DAEMON_DIAGNOSTICS_BUNDLE_KIND,
    generatedAt: "2026-10-27T14:05:09.123Z",
  },
  runtime: { platform: "darwin" },
  events: [],
};

test("a bundle the route produced parses and keeps its generation time", () => {
  const parsed = parseDaemonDiagnosticsBundle(validBundle);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.generatedAt, "2026-10-27T14:05:09.123Z");
  assert.equal(parsed.bundle, validBundle);
});

test("anything that is not the redacted bundle is refused with a reason", () => {
  for (const [value, reason] of [
    [null, "not-an-object"],
    ["{}", "not-an-object"],
    [{}, "missing-manifest"],
    [{ manifest: { kind: "something-else", schemaVersion: 1, generatedAt: validBundle.manifest.generatedAt }, events: [] }, "unexpected-kind"],
    [{ manifest: { kind: DAEMON_DIAGNOSTICS_BUNDLE_KIND, schemaVersion: 2, generatedAt: validBundle.manifest.generatedAt }, events: [] }, "unsupported-schema"],
    [{ manifest: { kind: DAEMON_DIAGNOSTICS_BUNDLE_KIND, schemaVersion: 1, generatedAt: "yesterday" }, events: [] }, "invalid-generated-at"],
    [{ manifest: { kind: DAEMON_DIAGNOSTICS_BUNDLE_KIND, schemaVersion: 1, generatedAt: validBundle.manifest.generatedAt } }, "missing-events"],
  ] as const) {
    const parsed = parseDaemonDiagnosticsBundle(value);
    assert.equal(parsed.ok, false, `${JSON.stringify(value)} must not parse`);
    if (!parsed.ok) assert.equal(parsed.reason, reason);
  }
});

test("the export filename carries the generation instant in a filesystem-safe form", () => {
  assert.equal(
    daemonDiagnosticsExportFilename("2026-10-27T14:05:09.123Z"),
    "coven-cave-daemon-diagnostics-2026-10-27T14-05-09Z.json",
  );
  // A bundle whose timestamp cannot be read still exports under the stable name
  // the route advertises in its content-disposition header.
  assert.equal(daemonDiagnosticsExportFilename("not a date"), "coven-cave-daemon-diagnostics.json");
});

test("serialization is stable, indented, and ends with a newline", () => {
  const text = serializeDaemonDiagnosticsBundle(validBundle);
  assert.equal(text, `${JSON.stringify(validBundle, null, 2)}\n`);
  assert.deepEqual(JSON.parse(text), validBundle);
});
