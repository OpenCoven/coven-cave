// Fixture-level conformance suite for Research Protocol v1 (Unit 0, #8).
//
// This suite is deliberately generic: it reads every `.json` fixture out of
// `schemas/research/v1/fixtures/{valid,invalid}` from disk (sorted for
// filesystem-order independence) and checks each one against BOTH layers of
// the protocol at once:
//   - the authoritative TypeBox/JSON Schema file for its `schema` string
//   - the hand-written parser reached through `parseResearchProtocolObject`
//
// New fixtures are picked up automatically; nothing needs to be listed here
// by hand. JSON Schema cannot express every cross-object revision rule the
// protocol enforces. Persistent cross-object cases live in
// `schemas/research/v1/fixtures/scenarios/*.scenario.json`; the focused sibling
// runner keeps this suite limited to agreement for individual wire objects.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
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

function readJsonFile(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function requireString(value: unknown, filePath: string, label: string): string {
  if (typeof value !== "string") {
    assert.fail(`${filePath}: ${label} must be a string`);
  }
  return value;
}

function invokeParserWithMutationGuard<T>(
  input: Record<string, unknown>,
  parser: (value: Record<string, unknown>) => T,
  label: string,
): { snapshot: Record<string, unknown>; result: T } {
  const snapshot = structuredClone(input);
  const result = parser(input);
  assert.deepEqual(input, snapshot, `${label}: parser must not mutate fixture input`);
  return { snapshot, result };
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

// `Check` (from typebox/value) expects a string-keyed schema lookup object,
// not a `Map`, for resolving `$ref`s across schemas. Build that object with a
// null prototype so it carries no inherited properties either. Standard URI
// resolution is checked below; raw-reference aliases adapt that result to
// TypeBox's context lookup without registering any additional schema ids.
const schemaCheckContext: Record<string, TSchema> = Object.create(null);
const schemaResolutionOrigin = new URL("https://research-protocol.invalid/");

type ExternalSchemaReference = {
  sourceId: string;
  path: string;
  reference: string;
  resolvedId: string;
};

function collectExternalSchemaReferences(
  sourceId: string,
  value: unknown,
  currentPath = "$",
  references: ExternalSchemaReference[] = [],
): ExternalSchemaReference[] {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      collectExternalSchemaReferences(sourceId, entry, `${currentPath}[${index}]`, references);
    });
    return references;
  }
  if (!isRecord(value)) return references;

  for (const [key, entry] of Object.entries(value)) {
    const entryPath = `${currentPath}.${key}`;
    if (key === "$ref" && typeof entry === "string" && !entry.startsWith("#")) {
      const baseUrl = new URL(sourceId, schemaResolutionOrigin);
      const resolvedUrl = new URL(entry, baseUrl);
      resolvedUrl.hash = "";
      assert.equal(
        resolvedUrl.origin,
        schemaResolutionOrigin.origin,
        `${sourceId} ${entryPath}: external $ref must remain under the schema resolution origin`,
      );
      references.push({
        sourceId,
        path: entryPath,
        reference: entry,
        resolvedId: resolvedUrl.href.slice(schemaResolutionOrigin.href.length),
      });
      continue;
    }
    collectExternalSchemaReferences(sourceId, entry, entryPath, references);
  }
  return references;
}

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
  const references = [...schemaContext.entries()].flatMap(([schemaId, schema]) =>
    collectExternalSchemaReferences(schemaId, schema)
  );
  for (const { sourceId, path: referencePath, reference, resolvedId } of references) {
    const target = schemaContext.get(resolvedId);
    assert.ok(
      target !== undefined,
      `${sourceId} ${referencePath}: ${reference} resolves to unregistered schema id ${resolvedId}`,
    );
    if (Object.hasOwn(schemaCheckContext, reference)) {
      assert.equal(
        schemaCheckContext[reference],
        target,
        `${reference}: TypeBox alias cannot resolve to multiple schema resources`,
      );
    } else {
      schemaCheckContext[reference] = target;
    }
  }
});

test("external schema references resolve by RFC3986 semantics to registered schema ids", () => {
  const registeredIds = new Set<string>(RESEARCH_PROTOCOL_SCHEMAS);
  const references = [...schemaContext.entries()]
    .flatMap(([schemaId, schema]) => collectExternalSchemaReferences(schemaId, schema))
    .sort((left, right) =>
      `${left.sourceId}\u0000${left.path}`.localeCompare(`${right.sourceId}\u0000${right.path}`)
    );

  assert.deepEqual(references, [
    {
      sourceId: "opencoven.research-run/v1",
      path: "$.properties.artifactManifest.$ref",
      reference: "../opencoven.run-manifest/v1",
      resolvedId: "opencoven.run-manifest/v1",
    },
  ]);
  for (const { sourceId, path: referencePath, reference, resolvedId } of references) {
    assert.ok(
      registeredIds.has(resolvedId),
      `${sourceId} ${referencePath}: ${reference} resolves to unregistered schema id ${resolvedId}`,
    );
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

test("fixture parser mutation guard detects mutations on success and failure", () => {
  for (const result of [
    { ok: true, value: { accepted: true } },
    { ok: false, error: { code: "invalid_value", path: "$", message: "rejected" } },
  ] as const) {
    const input = { nested: { value: "before" } };
    assert.throws(
      () =>
        invokeParserWithMutationGuard(
          input,
          (candidate) => {
            (candidate.nested as { value: string }).value = "after";
            return result;
          },
          "mutation regression",
        ),
      /must not mutate fixture input/i,
    );
  }
});

function listFixtureFiles(kind: "valid" | "invalid"): string[] {
  const dir = path.join(fixturesDir, kind);
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
}

for (const fileName of listFixtureFiles("valid")) {
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

    const { snapshot, result: parsed } = invokeParserWithMutationGuard(
      loaded,
      parseResearchProtocolObject,
      filePath,
    );
    if (!parsed.ok) {
      assert.fail(`${filePath}: expected parser to accept fixture (${parsed.error.path}: ${parsed.error.message})`);
    }

    // Every valid fixture is expected to be lossless: the parser must return
    // exactly what was on disk, including any additive fields it does not
    // itself inspect, so this compares against the original loaded JSON
    // rather than just the parser's own serialization of itself.
    assert.deepEqual(
      parsed.value,
      snapshot,
      `${filePath}: parser result must be deeply equal to the original fixture (lossless)`,
    );

    if (fileName === "model-task-result-negative-zero.json") {
      const output = (
        parsed.value as unknown as {
          output: { value: number; nested: { values: number[] } };
        }
      ).output;
      assert.equal(Object.is(output.value, -0), true, `${filePath}: top-level -0 must be preserved`);
      assert.equal(Object.is(output.nested.values[1], -0), true, `${filePath}: nested -0 must be preserved`);
    }

    const roundTripped: unknown = JSON.parse(JSON.stringify(parsed.value));
    const sourceRoundTripped: unknown = JSON.parse(JSON.stringify(snapshot));
    assert.deepEqual(
      roundTripped,
      sourceRoundTripped,
      `${filePath}: parser serialization must match source serialization`,
    );

    if (typeof snapshot.digest === "string") {
      const recomputed = digestProtocolObject(parsed.value);
      assert.equal(recomputed, snapshot.digest, `${filePath}: recomputed digest must equal fixture digest`);
    }
  });
}

for (const fileName of listFixtureFiles("invalid")) {
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

    const { result: parsed } = invokeParserWithMutationGuard(
      fixture,
      parseResearchProtocolObject,
      filePath,
    );
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
