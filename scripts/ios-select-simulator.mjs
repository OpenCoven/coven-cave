#!/usr/bin/env node
// Pick the simulator the `iOS build` job runs XCTests against.
//
// The test action needs a CONCRETE destination — `generic/platform=iOS
// Simulator` builds but cannot run — and the device names and iOS versions on
// a hosted runner image change without notice. Hardcoding `name=iPhone 16 Pro`
// therefore turns an image bump into a red iOS job that reads exactly like a
// product regression, which is the worst kind of false signal to add while
// closing a false-signal bug (cave-ac372).
//
// So the destination is discovered from `xcrun simctl list devices available
// -j`. This lives in JS rather than a jq one-liner in the workflow for one
// reason worth stating: runtime keys must be compared NUMERICALLY. A jq
// `sort_by(.key)` — or any lexicographic sort — ranks
// `SimRuntime.iOS-9-0` above `SimRuntime.iOS-26-0`, so it would pick the
// oldest runtime the moment a two-digit major exists, which is now. Comparing
// version components makes that testable on any runner, including the Windows
// and Linux ones this repo actually has.
//
// Usage (prints the UDID, or exits 1 with the device list on stderr):
//   xcrun simctl list devices available -j | node scripts/ios-select-simulator.mjs

const RUNTIME_KEY = /SimRuntime\.iOS-([0-9]+(?:-[0-9]+)*)$/;

/** Parse `com.apple.CoreSimulator.SimRuntime.iOS-18-4` into `[18, 4]`. */
export function parseRuntimeVersion(key) {
  const match = RUNTIME_KEY.exec(String(key));
  if (!match) return null;
  return match[1].split("-").map((part) => Number.parseInt(part, 10));
}

/** Compare two version component arrays; newest sorts first. */
export function compareVersionsDescending(a, b) {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return right - left;
  }
  return 0;
}

/**
 * Choose the newest available iPhone simulator.
 *
 * `listing` is the object `xcrun simctl list devices available -j` emits.
 * Returns `{ udid, name, runtime }`, or `null` when the image has none — the
 * caller must treat that as a hard failure rather than skipping the tests,
 * because "no simulator, so nothing ran" is precisely the silent-green shape
 * this whole change exists to remove.
 */
export function selectSimulator(listing, { minimumMajor = 18 } = {}) {
  const devices = listing?.devices;
  if (!devices || typeof devices !== "object") return null;

  const candidates = [];
  for (const [key, entries] of Object.entries(devices)) {
    const version = parseRuntimeVersion(key);
    if (!version || version[0] < minimumMajor) continue;
    for (const device of Array.isArray(entries) ? entries : []) {
      if (typeof device?.name !== "string" || !device.name.startsWith("iPhone")) continue;
      if (typeof device.udid !== "string" || device.udid.length === 0) continue;
      // `-j` on `list devices available` already filters, but an explicit
      // false must never be trusted through.
      if (device.isAvailable === false) continue;
      candidates.push({ udid: device.udid, name: device.name, runtime: key, version });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) => compareVersionsDescending(a.version, b.version) || a.name.localeCompare(b.name),
  );
  const [chosen] = candidates;
  return { udid: chosen.udid, name: chosen.name, runtime: chosen.runtime };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const raw = await readStdin();
  let listing;
  try {
    listing = JSON.parse(raw);
  } catch (error) {
    console.error(`ios-select-simulator: could not parse simctl JSON: ${error.message}`);
    process.exit(1);
    return;
  }

  const chosen = selectSimulator(listing);
  if (!chosen) {
    console.error(
      "ios-select-simulator: no available iPhone simulator on iOS 18 or newer. " +
        "The XCTest suite cannot run, and a skipped suite must never read as a pass (cave-ac372).",
    );
    process.exit(1);
    return;
  }

  console.error(`ios-select-simulator: ${chosen.name} (${chosen.runtime})`);
  process.stdout.write(chosen.udid);
}

if (process.argv[1] && process.argv[1].endsWith("ios-select-simulator.mjs")) {
  await main();
}
