// Simulator selection decides whether the iOS XCTest suite runs at all, so it
// gets the same treatment as the gate it feeds: pure, and exercised on the
// runners this repo actually has rather than only on macOS (cave-ac372).
import assert from "node:assert/strict";
import test from "node:test";

import { compareVersionsDescending, parseRuntimeVersion, selectSimulator } from "./ios-select-simulator.mjs";

const runtime = (version) => `com.apple.CoreSimulator.SimRuntime.iOS-${version}`;

test("runtime keys parse into numeric components", () => {
  assert.deepEqual(parseRuntimeVersion(runtime("18-4")), [18, 4]);
  assert.deepEqual(parseRuntimeVersion(runtime("26")), [26]);
  assert.equal(parseRuntimeVersion(`com.apple.CoreSimulator.SimRuntime.watchOS-11-0`), null);
});

// The reason this is not a jq one-liner in the workflow. A lexicographic sort
// ranks "iOS-9-0" above "iOS-26-0", which silently selects the OLDEST runtime
// as soon as a two-digit major exists — and one does.
test("a two-digit major beats a one-digit major", () => {
  assert.ok(compareVersionsDescending([26, 0], [9, 0]) < 0, "26.0 must sort ahead of 9.0");
  assert.ok(compareVersionsDescending([18, 4], [18, 2]) < 0, "18.4 must sort ahead of 18.2");
  assert.equal(compareVersionsDescending([18], [18, 0]), 0, "a missing component reads as zero");
});

test("the newest available iPhone is chosen across runtimes", () => {
  const chosen = selectSimulator({
    devices: {
      [runtime("9-3")]: [{ name: "iPhone 6", udid: "OLD", isAvailable: true }],
      [runtime("26-0")]: [
        { name: "iPhone 17", udid: "NEW", isAvailable: true },
        { name: "iPhone 17 Pro", udid: "NEWPRO", isAvailable: true },
      ],
      [runtime("18-0")]: [{ name: "iPhone 16", udid: "MID", isAvailable: true }],
      "com.apple.CoreSimulator.SimRuntime.watchOS-11-0": [
        { name: "Apple Watch Series 10", udid: "WATCH", isAvailable: true },
      ],
    },
  });
  assert.ok(chosen);
  assert.equal(chosen.runtime, runtime("26-0"));
  assert.ok(["NEW", "NEWPRO"].includes(chosen.udid));
});

test("selection is deterministic when a runtime offers several iPhones", () => {
  const listing = {
    devices: {
      [runtime("18-4")]: [
        { name: "iPhone 16 Pro", udid: "PRO", isAvailable: true },
        { name: "iPhone 16", udid: "BASE", isAvailable: true },
      ],
    },
  };
  assert.equal(selectSimulator(listing).udid, selectSimulator(listing).udid);
});

test("iPads, unavailable devices and too-old runtimes are not selectable", () => {
  assert.equal(
    selectSimulator({ devices: { [runtime("18-0")]: [{ name: "iPad Pro 11-inch", udid: "PAD", isAvailable: true }] } }),
    null,
  );
  assert.equal(
    selectSimulator({ devices: { [runtime("18-0")]: [{ name: "iPhone 16", udid: "X", isAvailable: false }] } }),
    null,
  );
  // The app's deployment target is iOS 18.0; an older runtime cannot install it.
  assert.equal(
    selectSimulator({ devices: { [runtime("17-5")]: [{ name: "iPhone 15", udid: "X", isAvailable: true }] } }),
    null,
  );
});

// A runner image with no usable simulator must be a hard failure. Returning
// something falsy that the caller could shrug off would recreate the defect:
// a green iOS check over a suite that never ran.
test("an image with no usable simulator yields null rather than a guess", () => {
  for (const listing of [null, undefined, {}, { devices: {} }, { devices: "nope" }]) {
    assert.equal(selectSimulator(listing), null, `expected ${JSON.stringify(listing)} to select nothing`);
  }
});

console.log("ios-select-simulator.test.mjs: ok");
