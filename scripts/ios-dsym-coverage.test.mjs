// Tests for scripts/ios-dsym-coverage.mjs (cave-ea6dw).
//
// The script audits whether every binary embedded in an iOS .xcarchive has a
// matching dSYM (the App Store Connect / TestFlight symbolication contract)
// and injects matching vendored dSYMs into the archive before export. The
// mach-o parsing is pure Node so these tests run anywhere — including the
// Linux CI runners that execute the scripts suite — using synthetic mach-o
// fixtures built in-memory.

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseMachOUUIDs,
  findEmbeddedBinaries,
  auditCoverage,
  formatReport,
  runAudit,
} from "./ios-dsym-coverage.mjs";

// ── synthetic mach-o fixtures ───────────────────────────────────────────────
const APP_UUID = "4C4C4419-5555-3144-A1D7-1C6CC95E36CE";
const WEBRTC_UUID = "4C4C44AA-5555-3144-A1D7-1C6CC95E36CE";
const OTHER_UUID = "DEADBEEF-0000-0000-0000-000000000000";

function uuidBytes(uuid) {
  return Buffer.from(uuid.replaceAll("-", ""), "hex");
}

// Thin 64-bit arm64 dylib with a single LC_UUID load command.
function thin64(uuid) {
  const buf = Buffer.alloc(56);
  buf.writeUInt32LE(0xfeedfacf, 0); // MH_MAGIC_64
  buf.writeUInt32LE(0x0100000c, 4); // CPU_TYPE_ARM64
  buf.writeUInt32LE(0, 8);
  buf.writeUInt32LE(6, 12); // MH_DYLIB
  buf.writeUInt32LE(1, 16); // ncmds
  buf.writeUInt32LE(24, 20); // sizeofcmds
  buf.writeUInt32LE(0, 24);
  buf.writeUInt32LE(0, 28);
  buf.writeUInt32LE(0x1b, 32); // LC_UUID
  buf.writeUInt32LE(24, 36);
  uuidBytes(uuid).copy(buf, 40);
  return buf;
}

// Thin 32-bit arm dylib with a single LC_UUID load command.
function thin32(uuid) {
  const buf = Buffer.alloc(52);
  buf.writeUInt32LE(0xfeedface, 0); // MH_MAGIC
  buf.writeUInt32LE(0x0100000c, 4);
  buf.writeUInt32LE(0, 8);
  buf.writeUInt32LE(6, 12);
  buf.writeUInt32LE(1, 16);
  buf.writeUInt32LE(24, 20);
  buf.writeUInt32LE(0, 24);
  buf.writeUInt32LE(0x1b, 28); // LC_UUID at 28 (no reserved field)
  buf.writeUInt32LE(24, 32);
  uuidBytes(uuid).copy(buf, 36);
  return buf;
}

function fat(slices, wide) {
  const entrySize = wide ? 32 : 20;
  const header = 8 + slices.length * entrySize;
  const total = header + slices.reduce((a, s) => a + s.length, 0);
  const buf = Buffer.alloc(total);
  buf.writeUInt32BE(wide ? 0xcafebabf : 0xcafebabe, 0);
  buf.writeUInt32BE(slices.length, 4);
  let off = 8;
  let dataOff = header;
  for (const slice of slices) {
    buf.writeUInt32BE(0x0100000c, off);
    buf.writeUInt32BE(0, off + 4);
    buf.writeUInt32BE(dataOff, off + 8);
    buf.writeUInt32BE(slice.length, off + 12);
    buf.writeUInt32BE(14, off + 16);
    if (wide) buf.writeUInt32BE(0, off + 20);
    slice.copy(buf, dataOff);
    dataOff += slice.length;
    off += entrySize;
  }
  return buf;
}

function writeDwarf(bundleDir, dwarfName, binary) {
  const dwarfDir = join(bundleDir, "Contents", "Resources", "DWARF");
  mkdirSync(dwarfDir, { recursive: true });
  writeFileSync(join(dwarfDir, dwarfName), binary);
}

// Build a realistic archive: CovenCave.app (with WebRTC.framework embedded and
// a widget extension) plus the app's own dSYM. WebRTC gets NO dSYM unless
// archiveWebRtcDsym is set — mirroring the real M150 xcframework.
function makeArchive({ archiveWebRtcDsym = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "ios-dsym-coverage-"));
  const archive = join(root, "CovenCave.xcarchive");
  const app = join(archive, "Products", "Applications", "CovenCave.app");
  const webrtcDir = join(app, "Frameworks", "WebRTC.framework");
  const widgetDir = join(app, "PlugIns", "CovenCaveWidgets.appex");
  mkdirSync(webrtcDir, { recursive: true });
  mkdirSync(widgetDir, { recursive: true });
  writeFileSync(join(app, "CovenCave"), thin64(APP_UUID));
  // The real WebRTC framework binary is a fat binary with one arm64 slice.
  writeFileSync(join(webrtcDir, "WebRTC"), fat([thin64(WEBRTC_UUID)]));
  writeFileSync(join(widgetDir, "CovenCaveWidgets"), thin64(APP_UUID));
  writeDwarf(join(archive, "dSYMs", "CovenCave.app.dSYM"), "CovenCave", thin64(APP_UUID));
  if (archiveWebRtcDsym) {
    writeDwarf(join(archive, "dSYMs", "WebRTC.framework.dSYM"), "WebRTC", thin64(WEBRTC_UUID));
  }
  return root;
}

function makeVendorDir(entries) {
  const root = mkdtempSync(join(tmpdir(), "ios-dsym-vendor-"));
  for (const [name, uuid] of Object.entries(entries)) {
    // dsymutil names the DWARF file after the binary, not the bundle:
    // WebRTC.framework.dSYM/Contents/Resources/DWARF/WebRTC
    const dwarfName = name.endsWith(".framework")
      ? name.slice(0, -".framework".length)
      : name;
    writeDwarf(join(root, name + ".dSYM"), dwarfName, thin64(uuid));
  }
  return root;
}

// ── mach-o UUID parsing ─────────────────────────────────────────────────────
assert.deepEqual(
  parseMachOUUIDs(thin64(APP_UUID)),
  [APP_UUID],
  "a thin 64-bit mach-o yields its LC_UUID",
);
assert.deepEqual(
  parseMachOUUIDs(thin32(APP_UUID)),
  [APP_UUID],
  "a thin 32-bit mach-o yields its LC_UUID",
);
assert.deepEqual(
  parseMachOUUIDs(fat([thin64(APP_UUID), thin64(WEBRTC_UUID)])),
  [APP_UUID, WEBRTC_UUID],
  "a fat 32-bit-header mach-o yields every slice's LC_UUID",
);
assert.deepEqual(
  parseMachOUUIDs(fat([thin64(APP_UUID)], true)),
  [APP_UUID],
  "a fat 64-bit-header mach-o yields every slice's LC_UUID",
);
assert.deepEqual(
  parseMachOUUIDs(Buffer.from("this is not a mach-o file at all")),
  [],
  "a non-mach-o buffer yields no UUIDs instead of throwing",
);
assert.deepEqual(
  parseMachOUUIDs(Buffer.alloc(2)),
  [],
  "a truncated buffer yields no UUIDs",
);

// ── embedded binary discovery ───────────────────────────────────────────────
{
  const root = makeArchive();
  const binaries = findEmbeddedBinaries(join(root, "CovenCave.xcarchive"));
  const byName = Object.fromEntries(binaries.map((b) => [b.name, b]));
  assert.deepEqual(
    Object.keys(byName).sort(),
    ["CovenCave.app", "CovenCaveWidgets.appex", "WebRTC.framework"],
    "the app, its widget extension and the embedded framework are discovered",
  );
  assert.equal(byName["CovenCave.app"].kind, "app");
  assert.equal(byName["WebRTC.framework"].kind, "framework");
  assert.equal(byName["CovenCaveWidgets.appex"].kind, "app");
  assert.ok(
    byName["WebRTC.framework"].binaryPath.endsWith("WebRTC.framework/WebRTC"),
    "the framework binary resolves inside the framework bundle",
  );
  rmSync(root, { recursive: true, force: true });
}

// ── coverage audit: the vendored-framework gap ─────────────────────────────
{
  const root = makeArchive();
  const audit = auditCoverage(join(root, "CovenCave.xcarchive"));
  const webrtc = audit.binaries.find((b) => b.name === "WebRTC.framework");
  const app = audit.binaries.find((b) => b.name === "CovenCave.app");
  assert.deepEqual(
    webrtc.coveredUuids,
    [],
    "the archive has no dSYM for the vendored WebRTC.framework (the real M150 xcframework ships none)",
  );
  assert.deepEqual(
    webrtc.missingUuids,
    [WEBRTC_UUID],
    "the exact embedded UUID is reported missing so it can be cross-checked against the App Store warning",
  );
  assert.deepEqual(
    app.missingUuids,
    [],
    "the app's own dSYM is present, so app-side crash frames symbolicate normally",
  );
  const human = formatReport(audit, { archivePath: "CovenCave.xcarchive" });
  assert.match(human, /stasel\/WebRTC/, "the report names the vendored package");
  assert.match(human, /warn-only; does not block the upload/, "the report says the gap does not block the release");
  const json = JSON.parse(formatReport(audit, { json: true }));
  assert.deepEqual(
    json.missing.map((m) => m.name),
    ["WebRTC.framework"],
    "JSON mode lists the missing framework for machine consumption",
  );
  rmSync(root, { recursive: true, force: true });
}

// ── vendor dSYM injection restores coverage when a matching dSYM exists ─────
{
  const root = makeArchive();
  const vendor = makeVendorDir({
    "WebRTC.framework": WEBRTC_UUID, // matching
    Wrong: OTHER_UUID, // does not match anything embedded
  });
  const audit = auditCoverage(join(root, "CovenCave.xcarchive"), { vendorDsymsDir: vendor });
  const webrtc = audit.binaries.find((b) => b.name === "WebRTC.framework");
  assert.deepEqual(
    webrtc.missingUuids,
    [],
    "a matching vendored dSYM clears the WebRTC gap",
  );
  assert.equal(audit.injected.length, 1);
  assert.equal(audit.injected[0].name, "WebRTC.framework.dSYM");
  assert.ok(
    readFileSync(join(root, "CovenCave.xcarchive", "dSYMs", "WebRTC.framework.dSYM", "Contents", "Resources", "DWARF", "WebRTC")).length > 0,
    "the matching dSYM is copied into the archive's dSYMs/ folder before export",
  );
  rmSync(root, { recursive: true, force: true });
  rmSync(vendor, { recursive: true, force: true });
}

// ── a dSYM that already lives in the archive stays put and is not re-injected
{
  const root = makeArchive({ archiveWebRtcDsym: true });
  const vendor = makeVendorDir({ "WebRTC.framework": WEBRTC_UUID });
  const audit = auditCoverage(join(root, "CovenCave.xcarchive"), { vendorDsymsDir: vendor });
  assert.equal(audit.injected.length, 0,
    "an archive that already carries the dSYM reports fully covered without re-injecting",
  );
  assert.ok(
    audit.binaries.every((b) => b.missingUuids.length === 0),
    "every embedded binary is symbolicated when the dSYM is present",
  );
  rmSync(root, { recursive: true, force: true });
  rmSync(vendor, { recursive: true, force: true });
}

// ── CLI contract ────────────────────────────────────────────────────────────
{
  const root = makeArchive();
  const archive = join(root, "CovenCave.xcarchive");

  assert.equal(
    runAudit([]).exitCode,
    2,
    "--archive is required",
  );
  assert.equal(
    runAudit(["--archive", archive, "--bogus"]).exitCode,
    2,
    "unsupported options are rejected",
  );
  assert.equal(
    runAudit(["--archive", "/tmp/definitely-not-an-archive.xcarchive"]).exitCode,
    1,
    "a missing archive is an error, not a silent pass",
  );
  assert.equal(
    runAudit(["--archive", archive]).exitCode,
    0,
    "missing vendored coverage is warn-only by default (does not block the upload)",
  );
  assert.equal(
    runAudit(["--archive", archive, "--fail-on-missing"]).exitCode,
    1,
    "--fail-on-missing turns the gap into a hard failure when explicitly requested",
  );
  const injected = runAudit(["--archive", archive, "--json"]);
  assert.equal(injected.exitCode, 0);
  const parsed = JSON.parse(injected.output);
  assert.equal(parsed.archive, archive);
  assert.ok(
    parsed.missing.some((m) => m.name === "WebRTC.framework"),
    "JSON output reports the missing framework",
  );
  rmSync(root, { recursive: true, force: true });
}

// ── CLI: full restore path through the runner ───────────────────────────────
{
  const root = makeArchive();
  const vendor = makeVendorDir({ "WebRTC.framework": WEBRTC_UUID });
  const result = runAudit(["--archive", join(root, "CovenCave.xcarchive"), "--vendor-dsyms", vendor, "--json"]);
  assert.equal(result.exitCode, 0);
  const parsed = JSON.parse(result.output);
  assert.equal(parsed.injected.length, 1);
  assert.equal(parsed.missing.length, 0);
  rmSync(root, { recursive: true, force: true });
  rmSync(vendor, { recursive: true, force: true });
}

console.log("ios-dsym-coverage.test.mjs: ok");
