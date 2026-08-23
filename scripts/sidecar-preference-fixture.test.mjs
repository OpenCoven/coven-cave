// Keeps the sidecar restart-regression preference fixture in step with the
// preferences schema.
//
// scripts/sidecar-runtime-smoke.mjs asserts the RESTORED preferences deep-equal
// the patch it wrote. That assertion silently rots: add a field to the schema
// and the restored object carries its default while the patch does not, so the
// deep-equal fails — but only during a release, because the smoke is a release
// job. That is exactly what happened when `appearance.reading.size` landed
// (#4736) and took the whole v0.3.8 release red on all three runners.
//
// These assertions run the same round-trip in-process, so the drift surfaces in
// ordinary CI while it is still cheap to fix.
import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPreferencesPatch,
  createDefaultPreferences,
  validatePreferencesPatch,
} from "../src/lib/preferences-schema.ts";
import {
  SIDECAR_PREFERENCE_DEEP_EQUAL_GROUPS,
  SIDECAR_PREFERENCE_PATCH,
} from "./sidecar-preference-fixture.mjs";

function readPath(source, dottedPath) {
  return dottedPath.split(".").reduce((value, key) => value?.[key], source);
}

/** What a fresh sidecar restores after the fixture is PATCHed into defaults. */
function restoreFixture() {
  const patch = validatePreferencesPatch(structuredClone(SIDECAR_PREFERENCE_PATCH));
  return applyPreferencesPatch(createDefaultPreferences(true), patch);
}

test("fixture is accepted by the strict preferences patch validator", () => {
  assert.doesNotThrow(() => validatePreferencesPatch(structuredClone(SIDECAR_PREFERENCE_PATCH)));
});

test("every deep-equal group survives a write/restore round trip", () => {
  const restored = restoreFixture();
  for (const group of SIDECAR_PREFERENCE_DEEP_EQUAL_GROUPS) {
    assert.deepEqual(
      readPath(restored, group),
      readPath(SIDECAR_PREFERENCE_PATCH, group),
      `${group} drifted: the schema has fields the sidecar fixture does not set. `
        + "Add them to scripts/sidecar-preference-fixture.mjs (with a NON-default "
        + "value) or the release-only sidecar smoke will fail after the tag is cut.",
    );
  }
});

test("deep-equal groups cover every key the schema defines for them", () => {
  const defaults = createDefaultPreferences(true);
  for (const group of SIDECAR_PREFERENCE_DEEP_EQUAL_GROUPS) {
    const schemaKeys = Object.keys(readPath(defaults, group)).sort();
    const fixtureKeys = Object.keys(readPath(SIDECAR_PREFERENCE_PATCH, group)).sort();
    assert.deepEqual(
      fixtureKeys,
      schemaKeys,
      `${group}: fixture keys must match the schema exactly (missing: `
        + `${schemaKeys.filter((k) => !fixtureKeys.includes(k)).join(", ") || "none"})`,
    );
  }
});

test("fixture values are not schema defaults, so persistence is actually proven", () => {
  const defaults = createDefaultPreferences(true);
  // A field set to its own default would deep-equal even if the sidecar dropped
  // it on restart, which would make the smoke assertion decorative.
  const sameAsDefault = [];
  for (const group of SIDECAR_PREFERENCE_DEEP_EQUAL_GROUPS) {
    const defaultGroup = readPath(defaults, group);
    const fixtureGroup = readPath(SIDECAR_PREFERENCE_PATCH, group);
    for (const [key, value] of Object.entries(fixtureGroup)) {
      if (JSON.stringify(defaultGroup[key]) === JSON.stringify(value)) {
        sameAsDefault.push(`${group}.${key}`);
      }
    }
  }
  assert.deepEqual(
    sameAsDefault,
    [],
    `these fixture fields equal the schema default, so the smoke would pass even if `
      + `they were never persisted: ${sameAsDefault.join(", ")}`,
  );
});

test("appearance.reading.size specifically round-trips", () => {
  // The exact field whose omission failed the v0.3.8 release.
  assert.equal(restoreFixture().appearance.reading.size, SIDECAR_PREFERENCE_PATCH.appearance.reading.size);
  assert.notEqual(
    SIDECAR_PREFERENCE_PATCH.appearance.reading.size,
    createDefaultPreferences(true).appearance.reading.size,
  );
});
