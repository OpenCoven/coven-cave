// Fixture-level conformance suite for Research Protocol v1 (Unit 0, #8).
//
// This suite is deliberately generic: it reads every `.json` fixture out of
// `schemas/research/v1/fixtures/{valid,invalid}` from disk (sorted for
// filesystem-order independence) and checks each one against BOTH layers of
// the protocol at once:
//   - the authoritative TypeBox/JSON Schema file for its `schema` string
//   - the hand-written parser reached through `parseResearchProtocolObject`
//
// Standalone fixture filenames are intentionally ratcheted below. Any addition,
// deletion, or rename must update that inventory explicitly. JSON Schema cannot
// express every cross-object revision rule the protocol enforces. Persistent
// cross-object cases live in
// `schemas/research/v1/fixtures/scenarios/*.scenario.json`; the focused sibling
// runner keeps this suite limited to agreement for individual wire objects.

import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  lstatSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { test, type TestContext } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { IsSchema, type TSchema } from "typebox";
import { Check } from "typebox/value";

import {
  isRecord,
  UTC_TIMESTAMP_PATTERN,
} from "../src/lib/research-protocol/common.ts";
import { digestProtocolObject } from "../src/lib/research-protocol/digest.ts";
import {
  RESEARCH_PROTOCOL_SCHEMAS,
  parseResearchProtocolObject,
} from "../src/lib/research-protocol/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const schemasDir = path.join(repoRoot, "schemas/research/v1");
const fixturesDir = path.join(schemasDir, "fixtures");

const EXPECTED_VALID_STANDALONE_FIXTURES = [
  "context-pack.json",
  "model-task-result.json",
  "model-task.json",
  "research-run-embedded-retention-7-days-provisional.json",
  "research-run-embedded-retention-run-only-provisional.json",
  "research-run-hosted-without-tenant.json",
  "research-run-hosted.json",
  "research-run-paused.json",
  "research-run.json",
  "run-event-deletion-benign-extension.json",
  "run-event-leap-second-historical.json",
  "run-event-leap-second.json",
  "run-event-unicode-extension.json",
  "run-event.json",
  "run-manifest-assembling.json",
  "run-manifest-chronology-boundaries.json",
  "run-manifest-extension-boundaries.json",
  "run-manifest-final-cloud.json",
  "run-manifest-final-local.json",
  "run-manifest-nested-benign-extension.json",
  "run-manifest-retention-7-days-boundary.json",
  "run-manifest-retention-7-days-leap-boundary.json",
  "run-manifest-retention-run-only-boundary.json",
  "run-manifest-retention-run-only-leap-boundary.json",
  "run-manifest-retention-update.json",
  "run-manifest-unicode-extension.json",
  "topic-discovery-job-seven.json",
  "topic-discovery-job.json",
  "topic-proposal.json",
] as const;

const EXPECTED_INVALID_STANDALONE_FIXTURES = [
  "context-pack-pdf-selector.json",
  "context-pack-retention.json",
  "model-task-policy.json",
  "model-task-result-usage.json",
  "research-run-checkpoint-queued.json",
  "research-run-local-tenant.json",
  "research-run-waiting-phase.json",
  "run-event-deleted-content-payload.json",
  "run-event-invalid-future-leap-second.json",
  "run-event-invalid-leap-second-date.json",
  "run-event-invalid-leap-second-placement.json",
  "run-event-non-ascii-deletion-extension.json",
  "run-event-sequence.json",
  "run-event-split-object-store-key.json",
  "run-event-unicode-sensitive-extension.json",
  "run-manifest-artifact-after-finalized.json",
  "run-manifest-artifact-before-created.json",
  "run-manifest-content-expires-before-created.json",
  "run-manifest-content-expires-before-finalized.json",
  "run-manifest-deleted-content-payload.json",
  "run-manifest-deletion-event.json",
  "run-manifest-deletion-pair.json",
  "run-manifest-finalized-before-created.json",
  "run-manifest-model-raw-prompt.json",
  "run-manifest-nested-privacy-storage-keys.json",
  "run-manifest-nested-private-extension.json",
  "run-manifest-private-title.json",
  "run-manifest-public-url-empty.json",
  "run-manifest-public-url-file.json",
  "run-manifest-public-url-localhost.json",
  "run-manifest-public-url-malformed-authority.json",
  "run-manifest-public-url-userinfo.json",
  "run-manifest-retention-7-days-leap-overflow.json",
  "run-manifest-retention-7-days-overflow.json",
  "run-manifest-retention-before-created.json",
  "run-manifest-retention-before-finalized.json",
  "run-manifest-retention-run-only-leap-overflow.json",
  "run-manifest-retention-run-only-overflow.json",
  "run-manifest-root-private-excerpts.json",
  "run-manifest-scheduled-null-expiry.json",
  "run-manifest-source-after-finalized.json",
  "run-manifest-source-before-created.json",
  "run-manifest-split-object-store-key.json",
  "run-manifest-unicode-sensitive-extension.json",
  "topic-discovery-job-eight.json",
  "topic-discovery-job-one.json",
  "topic-discovery-job-two.json",
  "topic-proposal-score.json",
  "unknown-major.json",
] as const;

function readJsonFile(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function requireString(value: unknown, filePath: string, label: string): string {
  if (typeof value !== "string") {
    assert.fail(`${filePath}: ${label} must be a string`);
  }
  return value;
}

// Every approved schema id follows `opencoven.<name>/v1`, and its
// authoritative file lives right beside this suite as `<name>.schema.json`.
// The mapping is derived from `RESEARCH_PROTOCOL_SCHEMAS` (the dispatcher's
// own source of truth) rather than hand-listed, so a renamed file or a 9th
// schema fails loudly here instead of silently going unchecked.
const SCHEMA_ID_PATTERN = /^opencoven\.([a-z-]+)\/v1$/;

function schemaFileNameFor(schemaId: string): string {
  const match = SCHEMA_ID_PATTERN.exec(schemaId);
  assert.ok(match, `schema id ${schemaId} does not match the opencoven.<name>/v1 pattern`);
  const [, name] = match;
  return `${name}.schema.json`;
}

// Populated by the "loads and validates" test below, then read by every
// fixture test that follows. `node:test` registers callbacks and runs them
// only after this module's synchronous top level finishes, so the load test
// (added first) always completes before any fixture test body runs.
//
// A `Map` is used (rather than a plain object plus `in`/property lookups) so
// that an attacker-controlled or coincidental schema id equal to an inherited
// `Object.prototype` name (e.g. `toString`, `constructor`, `hasOwnProperty`)
// can never be mistaken for a registered schema.
const schemaContext = new Map<string, TSchema>();

// `Check` (from typebox/value) expects a schema-id -> schema lookup object,
// not a `Map`, for resolving `$ref`s across schemas. Build that object with a
// null prototype so it carries no inherited properties either.
const schemaCheckContext: Record<string, TSchema> = Object.create(null);

test("loads and validates all eight authoritative Research Protocol v1 schema files", () => {
  assert.equal(RESEARCH_PROTOCOL_SCHEMAS.length, 8);
  for (const schemaId of RESEARCH_PROTOCOL_SCHEMAS) {
    const fileName = schemaFileNameFor(schemaId);
    const filePath = path.join(schemasDir, fileName);
    const loaded: unknown = readJsonFile(filePath);
    assert.ok(isRecord(loaded), `${filePath}: schema file root must be an object`);
    assert.ok(IsSchema(loaded), `${filePath}: schema file must be a valid JSON Schema object`);
    assert.equal(loaded.$id, schemaId, `${filePath}: $id must equal ${schemaId}`);
    assert.ok(isRecord(loaded.$defs), `${filePath}: $defs must be an object`);
    assert.ok(
      isRecord(loaded.$defs.utcTimestamp),
      `${filePath}: $defs.utcTimestamp must be an object`,
    );
    assert.equal(
      loaded.$defs.utcTimestamp.pattern,
      UTC_TIMESTAMP_PATTERN,
      `${filePath}: UTC timestamp pattern must match the shared protocol convention`,
    );
    schemaContext.set(schemaId, loaded);
    schemaCheckContext[schemaId] = loaded;
  }
});

test("schema lookup does not resolve inherited Object.prototype names as registered schemas", () => {
  for (const name of ["toString", "constructor", "hasOwnProperty", "__proto__", "valueOf"]) {
    assert.equal(
      schemaContext.has(name),
      false,
      `${name} must not resolve as a registered schema id`,
    );
    assert.equal(
      schemaContext.get(name),
      undefined,
      `${name} must not resolve to a schema value`,
    );
  }
});

function listFixtureFiles(
  kind: "valid" | "invalid",
  rootDirectory = fixturesDir,
): string[] {
  const dir = path.join(rootDirectory, kind);
  const directoryStats = lstatSync(dir, { throwIfNoEntry: false });
  assert.ok(directoryStats, `${dir}: standalone fixture directory is missing`);
  assert.ok(
    !directoryStats.isSymbolicLink() && directoryStats.isDirectory(),
    `${dir}: standalone fixture root must be a real directory`,
  );

  const files: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const filePath = path.join(dir, name);
    const stats = lstatSync(filePath, { throwIfNoEntry: false });
    assert.ok(stats, `${filePath}: standalone fixture entry disappeared`);
    assert.ok(
      !stats.isSymbolicLink() &&
        stats.isFile() &&
        /^[a-z0-9]+(?:-[a-z0-9]+)*\.json$/.test(name),
      `${filePath}: every standalone fixture entry must be a regular JSON file with a lowercase kebab-case name`,
    );
    files.push(name);
  }
  return files;
}

function assertStandaloneFixtureInventory(
  kind: "valid" | "invalid",
  expected: readonly string[],
  rootDirectory = fixturesDir,
): string[] {
  assert.equal(
    new Set(expected).size,
    expected.length,
    `${kind} standalone fixture ratchet must not contain duplicates`,
  );
  const discovered = listFixtureFiles(kind, rootDirectory);
  assert.deepEqual(
    discovered,
    [...expected],
    `${kind} standalone fixture inventory must exactly match its ratchet`,
  );
  return discovered;
}

const validFixtureFiles = assertStandaloneFixtureInventory(
  "valid",
  EXPECTED_VALID_STANDALONE_FIXTURES,
);
const invalidFixtureFiles = assertStandaloneFixtureInventory(
  "invalid",
  EXPECTED_INVALID_STANDALONE_FIXTURES,
);

test("standalone fixture inventories are exact and duplicate-free", () => {
  assert.equal(EXPECTED_VALID_STANDALONE_FIXTURES.length, 29);
  assert.equal(EXPECTED_INVALID_STANDALONE_FIXTURES.length, 49);
  assert.deepEqual(validFixtureFiles, [...EXPECTED_VALID_STANDALONE_FIXTURES]);
  assert.deepEqual(invalidFixtureFiles, [...EXPECTED_INVALID_STANDALONE_FIXTURES]);
});

function withTemporaryFixtureTree<T>(
  callback: (rootDirectory: string) => T,
): T {
  const cacheDirectory = path.join(repoRoot, "node_modules", ".cache");
  mkdirSync(cacheDirectory, { recursive: true });
  const rootDirectory = mkdtempSync(
    path.join(cacheDirectory, "research-protocol-standalone-fixtures-"),
  );
  mkdirSync(path.join(rootDirectory, "valid"));
  mkdirSync(path.join(rootDirectory, "invalid"));
  try {
    return callback(rootDirectory);
  } finally {
    rmSync(rootDirectory, { recursive: true, force: true });
  }
}

function createSymlinkOrSkip(
  context: TestContext,
  targetPath: string,
  linkPath: string,
): boolean {
  try {
    symlinkSync(targetPath, linkPath, "file");
    return true;
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "unknown";
    if (["EACCES", "ENOSYS", "ENOTSUP", "EOPNOTSUPP", "EPERM"].includes(code)) {
      context.skip(`symlink creation is unavailable (${code})`);
      return false;
    }
    throw error;
  }
}

test("standalone fixture inventory rejects directories and non-JSON files", () => {
  withTemporaryFixtureTree((rootDirectory) => {
    mkdirSync(path.join(rootDirectory, "valid", "nested"));
    assert.throws(
      () => assertStandaloneFixtureInventory("valid", [], rootDirectory),
      /regular JSON file/i,
    );
  });
  withTemporaryFixtureTree((rootDirectory) => {
    writeFileSync(path.join(rootDirectory, "invalid", "notes.txt"), "not JSON");
    assert.throws(
      () => assertStandaloneFixtureInventory("invalid", [], rootDirectory),
      /regular JSON file/i,
    );
  });
});

test("standalone fixture inventory rejects symlinks", (context) => {
  withTemporaryFixtureTree((rootDirectory) => {
    const targetPath = path.join(rootDirectory, "target.json");
    writeFileSync(targetPath, "{}");
    if (
      !createSymlinkOrSkip(
        context,
        targetPath,
        path.join(rootDirectory, "valid", "linked.json"),
      )
    ) {
      return;
    }
    assert.throws(
      () => assertStandaloneFixtureInventory("valid", [], rootDirectory),
      /regular JSON file/i,
    );
  });
});

test("standalone fixture inventory rejects unexpected JSON names", () => {
  withTemporaryFixtureTree((rootDirectory) => {
    writeFileSync(path.join(rootDirectory, "valid", "unexpected.json"), "{}");
    assert.throws(
      () => assertStandaloneFixtureInventory("valid", [], rootDirectory),
      /exactly match its ratchet/i,
    );
  });
});

for (const fileName of validFixtureFiles) {
  const filePath = path.join(fixturesDir, "valid", fileName);

  test(`valid fixture ${filePath} passes schema and parser`, () => {
    const loaded: unknown = readJsonFile(filePath);
    assert.ok(isRecord(loaded), `${filePath}: fixture root must be an object`);

    const schemaId = requireString(loaded.schema, filePath, "$.schema");
    const schema = schemaContext.get(schemaId);
    assert.ok(
      schema !== undefined,
      `${filePath}: schema ${schemaId} is not one of the eight approved schemas`,
    );
    assert.equal(
      Check(schemaCheckContext, schema, loaded),
      true,
      `${filePath}: expected schema validation to pass`,
    );

    const parsed = parseResearchProtocolObject(loaded);
    if (!parsed.ok) {
      assert.fail(`${filePath}: expected parser to accept fixture (${parsed.error.path}: ${parsed.error.message})`);
    }

    // Every valid fixture is expected to be lossless: the parser must return
    // exactly what was on disk, including any additive fields it does not
    // itself inspect, so this compares against the original loaded JSON
    // rather than just the parser's own serialization of itself.
    assert.deepEqual(
      parsed.value,
      loaded,
      `${filePath}: parser result must be deeply equal to the original fixture (lossless)`,
    );

    const roundTripped: unknown = JSON.parse(JSON.stringify(parsed.value));
    assert.deepEqual(roundTripped, parsed.value, `${filePath}: parser result must round-trip through JSON`);

    if (typeof loaded.digest === "string") {
      const recomputed = digestProtocolObject(parsed.value);
      assert.equal(recomputed, loaded.digest, `${filePath}: recomputed digest must equal fixture digest`);
    }
  });
}

for (const fileName of invalidFixtureFiles) {
  const filePath = path.join(fixturesDir, "invalid", fileName);

  test(`invalid fixture ${filePath} is rejected by the parser`, () => {
    const loaded: unknown = readJsonFile(filePath);
    assert.ok(isRecord(loaded), `${filePath}: fixture root must be an object`);

    // Strip the root `expectedSchemaValid` marker before validating: it is a
    // conformance-suite instruction, not part of the protocol object, and
    // must not reach the schema check or the parser.
    const { expectedSchemaValid: marker, ...fixture } = loaded;
    let expectedSchemaValid = false;
    if (marker !== undefined) {
      assert.equal(
        typeof marker,
        "boolean",
        `${filePath}: expectedSchemaValid marker must be a boolean when present`,
      );
      expectedSchemaValid = marker === true;
    }

    const schemaId = requireString(fixture.schema, filePath, "$.schema");
    const schema = schemaContext.get(schemaId);

    if (schema === undefined) {
      // No registered schema for this family/major (e.g. the unknown-major
      // fixture's `opencoven.run-event/v2`): the dispatcher must reject it
      // outright, without this suite ever attempting schema validation.
      assert.equal(
        expectedSchemaValid,
        false,
        `${filePath}: an unregistered schema id must not claim expectedSchemaValid`,
      );
    } else {
      const schemaValid = Check(schemaCheckContext, schema, fixture);
      assert.equal(
        schemaValid,
        expectedSchemaValid,
        `${filePath}: expected schema validity ${expectedSchemaValid}, got ${schemaValid}`,
      );
    }

    const parsed = parseResearchProtocolObject(fixture);
    assert.equal(parsed.ok, false, `${filePath}: expected parser to reject fixture`);
    if (schema === undefined && !parsed.ok) {
      assert.equal(
        parsed.error.code,
        "unknown_major",
        `${filePath}: dispatcher must reject an unregistered schema as unknown_major without trying schema validation`,
      );
    }
  });
}
