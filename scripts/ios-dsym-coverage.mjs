#!/usr/bin/env node
// Audit the dSYM coverage of an iOS archive's embedded binaries, and inject
// matching vendored dSYMs before the archive is exported/uploaded.
//
// Why this exists (cave-ea6dw): App Store Connect warns on every TestFlight
// upload that the vendored WebRTC.framework has no matching dSYM, so crashes
// inside WebRTC code cannot be symbolicated. The root cause is upstream: the
// Swift Package binary target pinned in apps/ios/CovenCave/project.yml
// (stasel/WebRTC at 6ed87f05368632f71dc95c89c14c051561710925, M150) downloads
// WebRTC-M150.xcframework.zip, which ships a DWARF-stripped framework with no
// dSYM anywhere in the archive, and no matching dSYM exists upstream to
// download. A dSYM cannot be recovered from a stripped binary, so the honest
// fix is:
//
//   1. verify coverage at archive time and REPORT the exact gap (this script),
//   2. inject any matching dSYM found in --vendor-dsyms into the archive's
//      dSYMs/ folder so the moment a real dSYM for the pinned revision exists
//      (vendored local build, upstream artifact, ...) releases automatically
//      start carrying it, and
//   3. never block the release on the missing vendored symbol — the warning is
//      cosmetic, the app uploads and processes fine without it (v0.2.2 shipped
//      with the warning present).
//
// See docs/ios-webrtc-dsym-symbolication.md for the full write-up.
//
// The mach-o parsing is pure Node so the decision logic is unit-testable on
// Linux CI (scripts/ios-dsym-coverage.test.mjs) — no dwarfdump dependency,
// which is macOS-only and would make the suite un-runnable off macOS.
//
// Usage:
//   node scripts/ios-dsym-coverage.mjs --archive <path.xcarchive> [options]
//   options:
//     --vendor-dsyms <dir>   search this directory for *.dSYM bundles and copy
//                            any whose UUIDs match an uncovered binary into the
//                            archive's dSYMs/ folder (the restore-coverage hook)
//     --json                 machine-readable output (single JSON document)
//     --fail-on-missing      exit non-zero when any embedded binary lacks a
//                            matching dSYM (default: warn only, never blocks)
//
// Exit codes: 0 = audit ran (missing coverage is a warning unless
// --fail-on-missing), 1 = archive unusable or --fail-on-missing found gaps,
// 2 = usage error.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const FAT_MAGIC = 0xcafebabe;
const FAT_MAGIC_64 = 0xcafebabf;
const MH_MAGIC = 0xfeedface; // 32-bit thin
const MH_MAGIC_64 = 0xfeedfacf; // 64-bit thin
const LC_UUID = 0x1b;

// Frameworks we know ship without debug info. Keyed by the framework bundle
// name so the report can say *why* a gap exists instead of leaving maintainers
// to google the App Store warning. Extend this table when a new vendored
// binary package is added.
const KNOWN_VENDORS = {
  "WebRTC.framework": {
    package: "stasel/WebRTC (Swift Package binary target)",
    pinnedRevision: "6ed87f05368632f71dc95c89c14c051561710925",
    note:
      "the published M150 xcframework is DWARF-stripped and contains no dSYM; " +
      "no matching upstream artifact exists, so WebRTC frames stay " +
      "unsymbolicated in App Store Connect crash reports until a dSYM is " +
      "vendored (see docs/ios-webrtc-dsym-symbolication.md)",
  },
};

function uuidString(bytes) {
  const hex = Buffer.from(bytes).toString("hex").toUpperCase();
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function parseThin(buffer, out, endian, bits) {
  const read32 = (o) => (endian === "LE" ? buffer.readUInt32LE(o) : buffer.readUInt32BE(o));
  const headerSize = bits === 64 ? 32 : 28;
  if (buffer.length < headerSize) return out;
  const ncmds = read32(16);
  let off = headerSize;
  for (let i = 0; i < ncmds && off + 8 <= buffer.length; i += 1) {
    const cmd = read32(off);
    const cmdsize = read32(off + 4);
    if (cmdsize < 8) break; // malformed load command — stop rather than spin
    if (cmd === LC_UUID && cmdsize >= 24 && off + 24 <= buffer.length) {
      out.push(uuidString(buffer.subarray(off + 8, off + 24)));
    }
    off += cmdsize;
  }
  return out;
}

function parseFat(buffer, out, endian, wide) {
  const read32 = (o) => (endian === "LE" ? buffer.readUInt32LE(o) : buffer.readUInt32BE(o));
  const entrySize = wide ? 32 : 20;
  if (buffer.length < 8) return out;
  const nfat = read32(4);
  let off = 8;
  // fat_arch (32-bit) and fat_arch_64 keep offset at +8 and size at +12;
  // the 64-bit variant only grows the alignment + reserved tail at +16/+20.
  for (let i = 0; i < nfat && off + entrySize <= buffer.length; i += 1) {
    const sliceOffset = read32(off + 8);
    const sliceSize = read32(off + 12);
    off += entrySize;
    if (sliceOffset + sliceSize <= buffer.length) {
      parseMachOUUIDs(buffer.subarray(sliceOffset, sliceOffset + sliceSize), out);
    }
  }
  return out;
}

/**
 * Extract the LC_UUID value(s) of a mach-o binary (fat or thin, 32/64-bit).
 * Returns an array of UUID strings in the canonical 8-4-4-4-12 uppercase form
 * — the same form `dwarfdump --uuid` prints, which is what App Store Connect
 * matches crash reports against. Empty array when the file is not a readable
 * mach-o.
 */
export function parseMachOUUIDs(buffer, out = []) {
  if (buffer.length < 4) return out;
  if (buffer.readUInt32BE(0) === FAT_MAGIC) return parseFat(buffer, out, "BE", false);
  if (buffer.readUInt32LE(0) === FAT_MAGIC) return parseFat(buffer, out, "LE", false);
  if (buffer.readUInt32BE(0) === FAT_MAGIC_64) return parseFat(buffer, out, "BE", true);
  if (buffer.readUInt32LE(0) === FAT_MAGIC_64) return parseFat(buffer, out, "LE", true);
  if (buffer.readUInt32LE(0) === MH_MAGIC_64) return parseThin(buffer, out, "LE", 64);
  if (buffer.readUInt32BE(0) === MH_MAGIC_64) return parseThin(buffer, out, "BE", 64);
  if (buffer.readUInt32LE(0) === MH_MAGIC) return parseThin(buffer, out, "LE", 32);
  if (buffer.readUInt32BE(0) === MH_MAGIC) return parseThin(buffer, out, "BE", 32);
  return out;
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function frameworkBinary(frameworkDir, stem) {
  const flat = join(frameworkDir, stem);
  if (isFile(flat)) return flat;
  const versions = join(frameworkDir, "Versions");
  if (existsSync(versions)) {
    for (const version of readdirSync(versions)) {
      const candidate = join(versions, version, stem);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Discover the app/extension binaries and embedded framework binaries inside
 * an .xcarchive. Returns [{ name, kind: "app"|"framework", binaryPath }].
 */
export function findEmbeddedBinaries(archivePath) {
  const appsRoot = join(archivePath, "Products", "Applications");
  if (!existsSync(appsRoot)) return [];
  const results = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = join(dir, entry.name);
      if (entry.name.endsWith(".app") || entry.name.endsWith(".appex")) {
        const stem = entry.name.endsWith(".appex")
          ? entry.name.slice(0, -6)
          : entry.name.slice(0, -4);
        const mainBinary = join(full, stem);
        if (isFile(mainBinary)) {
          results.push({ name: entry.name, kind: "app", binaryPath: mainBinary });
        }
        walk(full); // PlugIns + Frameworks live inside the bundle
      } else if (entry.name.endsWith(".framework")) {
        const stem = entry.name.slice(0, -".framework".length);
        const binary = frameworkBinary(full, stem);
        if (binary) {
          results.push({ name: entry.name, kind: "framework", binaryPath: binary });
        }
      } else {
        walk(full);
      }
    }
  };
  walk(appsRoot);
  return results;
}

function findDSYMBundles(root) {
  const results = [];
  if (!existsSync(root)) return results;
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = join(dir, entry.name);
      if (entry.name.endsWith(".dSYM")) {
        const dwarfDir = join(full, "Contents", "Resources", "DWARF");
        if (existsSync(dwarfDir)) {
          for (const dwarfFile of readdirSync(dwarfDir)) {
            results.push({
              name: entry.name,
              bundlePath: full,
              dwarfPath: join(dwarfDir, dwarfFile),
            });
          }
        }
      } else {
        walk(full);
      }
    }
  };
  walk(root);
  return results;
}

/**
 * Audit an archive's dSYM coverage:
 *  - every embedded binary (app, extensions, frameworks) gets its mach-o
 *    UUIDs resolved and matched against the archive's dSYMs/ folder,
 *  - matching *.dSYM bundles found in vendorDsymsDir are copied into the
 *    archive's dSYMs/ folder (restoring coverage when a real dSYM exists).
 *
 * Returns { binaries, injected } where each binary carries
 * { name, kind, binaryPath, uuids, coveredUuids, missingUuids }.
 */
export function auditCoverage(archivePath, { vendorDsymsDir } = {}) {
  const binaries = findEmbeddedBinaries(archivePath).map((binary) => ({
    ...binary,
    uuids: parseMachOUUIDs(readFileSync(binary.binaryPath)),
  }));
  const archiveDSYMs = findDSYMBundles(join(archivePath, "dSYMs")).map((dsym) => ({
    ...dsym,
    uuids: parseMachOUUIDs(readFileSync(dsym.dwarfPath)),
  }));
  const report = binaries.map((binary) => {
    const coveredUuids = binary.uuids.filter((uuid) =>
      archiveDSYMs.some((dsym) => dsym.uuids.includes(uuid)),
    );
    return {
      ...binary,
      coveredUuids,
      missingUuids: binary.uuids.filter((uuid) => !coveredUuids.includes(uuid)),
    };
  });

  const injected = [];
  if (vendorDsymsDir) {
    const vendorDSYMs = findDSYMBundles(vendorDsymsDir).map((dsym) => ({
      ...dsym,
      uuids: parseMachOUUIDs(readFileSync(dsym.dwarfPath)),
    }));
    for (const vendor of vendorDSYMs) {
      for (const binary of report) {
        if (binary.missingUuids.length === 0) continue;
        const matches = binary.missingUuids.filter((uuid) => vendor.uuids.includes(uuid));
        if (matches.length === 0) continue;
        const dsymsDir = join(archivePath, "dSYMs");
        mkdirSync(dsymsDir, { recursive: true });
        const destination = join(dsymsDir, vendor.name);
        if (!existsSync(destination)) {
          cpSync(vendor.bundlePath, destination, { recursive: true, force: true });
        }
        binary.coveredUuids.push(...matches);
        binary.missingUuids = binary.missingUuids.filter((uuid) => !matches.includes(uuid));
        injected.push({
          name: vendor.name,
          framework: binary.name,
          uuids: matches,
          source: vendor.bundlePath,
        });
      }
    }
  }
  return { binaries: report, injected };
}

function vendorHint(name) {
  return KNOWN_VENDORS[name] ?? null;
}

export function formatReport(audit, { archivePath, json = false } = {}) {
  if (json) {
    return JSON.stringify(
      {
        archive: archivePath,
        binaries: audit.binaries.map((b) => ({
          name: b.name,
          kind: b.kind,
          uuids: b.uuids,
          coveredUuids: b.coveredUuids,
          missingUuids: b.missingUuids,
        })),
        injected: audit.injected,
        missing: audit.binaries
          .filter((b) => b.missingUuids.length > 0)
          .map((b) => ({ name: b.name, missingUuids: b.missingUuids })),
      },
      null,
      2,
    ) + "\n";
  }

  const lines = [];
  lines.push("[dsym-coverage] archive: " + (archivePath ?? "(none)"));
  if (audit.binaries.length === 0) {
    lines.push("[dsym-coverage] no embedded binaries found under Products/Applications");
    return lines.join("\n") + "\n";
  }
  lines.push("[dsym-coverage] embedded binaries: " + audit.binaries.length);
  let covered = 0;
  for (const binary of audit.binaries) {
    if (binary.uuids.length === 0) {
      lines.push(
        "[dsym-coverage]   [WARN] " + binary.name +
        " — binary is not a readable mach-o; cannot verify dSYM coverage",
      );
      continue;
    }
    if (binary.missingUuids.length === 0) {
      covered += 1;
      lines.push(
        "[dsym-coverage]   [ok]   " + binary.name +
        " — " + binary.uuids.length + " UUID(s) covered by the archive's dSYMs",
      );
      continue;
    }
    const hint = vendorHint(binary.name);
    lines.push(
      "[dsym-coverage]   [WARN] " + binary.name +
      " — missing dSYM for " + binary.missingUuids.join(", "),
    );
    if (hint) {
      lines.push(
        "[dsym-coverage]          " + hint.package + " (" + hint.pinnedRevision + "): " + hint.note,
      );
    } else {
      lines.push(
        "[dsym-coverage]          no dSYM in the archive covers this binary; " +
        "crash frames from it will not symbolicate",
      );
    }
  }
  if (audit.injected.length > 0) {
    lines.push("[dsym-coverage] injected " + audit.injected.length + " vendored dSYM(s) into the archive:");
    for (const item of audit.injected) {
      lines.push(
        "[dsym-coverage]   " + item.name + " -> " + item.framework +
        " (" + item.uuids.join(", ") + ") from " + item.source,
      );
    }
  } else {
    lines.push("[dsym-coverage] no vendored dSYMs matched any uncovered binary");
  }
  const missingCount = audit.binaries.filter((b) => b.missingUuids.length > 0).length;
  lines.push(
    "[dsym-coverage] result: " + covered + "/" + audit.binaries.length +
    " binaries fully symbolicated" +
    (missingCount > 0
      ? " — " + missingCount + " missing (warn-only; does not block the upload)"
      : ""),
  );
  return lines.join("\n") + "\n";
}

function usage() {
  return [
    "Usage:",
    "  node scripts/ios-dsym-coverage.mjs --archive <path.xcarchive> [options]",
    "",
    "  --archive <path>      path to the .xcarchive to audit (required)",
    "  --vendor-dsyms <dir>  copy matching *.dSYM bundles from this directory into",
    "                        the archive's dSYMs/ folder before export",
    "  --json                machine-readable JSON output",
    "  --fail-on-missing     exit 1 when any embedded binary lacks a matching dSYM",
    "",
    "Exit codes: 0 ok (missing coverage is a warning), 1 unusable archive or",
    "--fail-on-missing gaps, 2 usage error.",
  ].join("\n");
}

export function runAudit(argv) {
  const options = { archivePath: null, vendorDsymsDir: null, json: false, failOnMissing: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--archive") {
      options.archivePath = argv[i + 1];
      i += 1;
    } else if (arg === "--vendor-dsyms") {
      options.vendorDsymsDir = argv[i + 1];
      i += 1;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--fail-on-missing") {
      options.failOnMissing = true;
    } else if (arg === "--help" || arg === "-h") {
      return { exitCode: 0, output: usage() + "\n" };
    } else {
      return { exitCode: 2, output: "error: unsupported option: " + arg + "\n\n" + usage() + "\n" };
    }
  }
  if (!options.archivePath) {
    return { exitCode: 2, output: "error: --archive is required\n\n" + usage() + "\n" };
  }
  const archivePath = resolve(options.archivePath);
  if (!existsSync(archivePath) || !statSync(archivePath).isDirectory()) {
    return {
      exitCode: 1,
      output: "error: archive does not exist: " + archivePath + "\n",
    };
  }
  const audit = auditCoverage(archivePath, {
    vendorDsymsDir: options.vendorDsymsDir ? resolve(options.vendorDsymsDir) : undefined,
  });
  const output = formatReport(audit, { archivePath, json: options.json });
  const gaps = audit.binaries.filter((b) => b.missingUuids.length > 0);
  if (options.failOnMissing && gaps.length > 0) {
    return { exitCode: 1, output };
  }
  return { exitCode: 0, output };
}

function main() {
  const { exitCode, output } = runAudit(process.argv.slice(2));
  process.stdout.write(output);
  process.exitCode = exitCode;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
