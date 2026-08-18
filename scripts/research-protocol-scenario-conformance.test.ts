// Structured cross-object conformance for Research Protocol v1.
//
// Scenario behavior lives in JSON under
// `schemas/research/v1/fixtures/scenarios/*.scenario.json`. Each corpus names a
// format/family, declares reusable objects (fixture or inline value, optional
// RFC 7396 mergePatch, optional digestTargets), then lists stable scenario ids,
// descriptions, input references, validator options, and exact expected
// code/path outcomes. This runner owns assembly and strict format validation;
// protocol behavior stays in the public parsers and composition validators.

import assert from "node:assert/strict";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { IsSchema, type TSchema } from "typebox";
import { Check } from "typebox/value";

import {
  RESEARCH_PROTOCOL_SCHEMAS,
  digestProtocolObject,
  isRecord,
  parseResearchProtocolObject,
  validateModelTaskResultV1,
  validateResearchRunContextPackV1,
  validateRunManifestDeletionEventV1,
  validateRunManifestRevision,
  type ContextPackV1,
  type ManifestRevisionOptions,
  type ModelTaskResultV1,
  type ModelTaskV1,
  type ProtocolParseResult,
  type ResearchProtocolObjectV1,
  type ResearchRunV1,
  type RunEventV1,
  type RunManifestV1,
} from "../src/lib/research-protocol/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const schemasDir = path.join(repoRoot, "schemas/research/v1");
const fixturesDir = path.join(schemasDir, "fixtures");
const scenariosDir = path.join(fixturesDir, "scenarios");

const SCENARIO_FORMAT = "opencoven.research-protocol-scenarios/v1";
const SCHEMA_ID_PATTERN = /^opencoven\.([a-z-]+)\/v1$/;
const SCENARIO_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const RETENTION_POLICIES = new Set(["run-only", "7-days", "project"]);
const PROTOCOL_ERROR_CODES = new Set([
  "invalid_type",
  "invalid_value",
  "missing_field",
  "unknown_major",
  "digest_mismatch",
  "semantic_conflict",
]);
const VALIDATORS = [
  "run-manifest-revision",
  "research-run-context-pack",
  "model-task-result",
  "run-event-deletion",
] as const;

type ValidatorKind = (typeof VALIDATORS)[number];
type ExpectedResult =
  | { ok: true }
  | {
      ok: false;
      stage: "parse" | "composition";
      input?: string;
      code: string;
      path: string;
    };

type ObjectSpec = {
  fixture?: string;
  value?: Record<string, unknown>;
  mergePatch?: Record<string, unknown>;
  digestTargets?: string[];
};

type ScenarioDefinition = {
  id: string;
  description: string;
  validator: ValidatorKind;
  inputs: Record<string, unknown>;
  options?: ManifestRevisionOptions;
  expected: ExpectedResult;
};

type ScenarioCorpus = {
  filePath: string;
  family: ValidatorKind;
  objects: Record<string, ObjectSpec>;
  scenarios: ScenarioDefinition[];
};

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function readJsonFile(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    assert.fail(
      `${filePath}: must contain valid JSON (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

function requireRecord(value: unknown, location: string): Record<string, unknown> {
  assert.ok(isRecord(value), `${location}: must be an object`);
  return value;
}

function requireString(value: unknown, location: string): string {
  if (typeof value !== "string") {
    assert.fail(`${location}: must be a string`);
  }
  assert.notEqual(value, "", `${location}: must not be empty`);
  return value;
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  location: string,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    assert.ok(allowedSet.has(key), `${location}: unknown field ${key}`);
  }
}

function requireExactInputKeys(
  inputs: Record<string, unknown>,
  expectedKeys: readonly string[],
  location: string,
): void {
  assertAllowedKeys(inputs, expectedKeys, location);
  for (const key of expectedKeys) {
    assert.ok(Object.hasOwn(inputs, key), `${location}: missing field ${key}`);
  }
}

function requireObjectReference(
  value: unknown,
  objects: Record<string, ObjectSpec>,
  location: string,
): string {
  const reference = requireString(value, location);
  assert.ok(Object.hasOwn(objects, reference), `${location}: unknown object reference ${reference}`);
  return reference;
}

function validateObjectSpec(value: unknown, location: string): ObjectSpec {
  const spec = requireRecord(value, location);
  assertAllowedKeys(spec, ["fixture", "value", "mergePatch", "digestTargets"], location);

  const hasFixture = Object.hasOwn(spec, "fixture");
  const hasValue = Object.hasOwn(spec, "value");
  assert.notEqual(hasFixture, hasValue, `${location}: exactly one of fixture or value is required`);

  const validated: ObjectSpec = {};
  if (hasFixture) {
    validated.fixture = requireString(spec.fixture, `${location}.fixture`);
  } else {
    validated.value = requireRecord(spec.value, `${location}.value`);
  }
  if (Object.hasOwn(spec, "mergePatch")) {
    validated.mergePatch = requireRecord(spec.mergePatch, `${location}.mergePatch`);
  }
  if (Object.hasOwn(spec, "digestTargets")) {
    assert.ok(Array.isArray(spec.digestTargets), `${location}.digestTargets: must be an array`);
    validated.digestTargets = spec.digestTargets.map((target, index) => {
      assert.equal(
        typeof target,
        "string",
        `${location}.digestTargets[${index}]: must be a JSON Pointer string`,
      );
      assert.ok(
        target === "" || target.startsWith("/"),
        `${location}.digestTargets[${index}]: must be an empty root pointer or start with /`,
      );
      return target;
    });
    assert.equal(
      new Set(validated.digestTargets).size,
      validated.digestTargets.length,
      `${location}.digestTargets: duplicate pointers are not allowed`,
    );
  }

  return validated;
}

function validateExpected(
  value: unknown,
  inputNames: readonly string[],
  location: string,
): ExpectedResult {
  const expected = requireRecord(value, location);
  assert.equal(typeof expected.ok, "boolean", `${location}.ok: must be a boolean`);

  if (expected.ok === true) {
    assertAllowedKeys(expected, ["ok"], location);
    return { ok: true };
  }

  assertAllowedKeys(expected, ["ok", "stage", "input", "code", "path"], location);
  assert.ok(
    expected.stage === "parse" || expected.stage === "composition",
    `${location}.stage: must be parse or composition`,
  );
  const code = requireString(expected.code, `${location}.code`);
  assert.ok(PROTOCOL_ERROR_CODES.has(code), `${location}.code: unknown protocol error code ${code}`);
  const expectedPath = requireString(expected.path, `${location}.path`);
  assert.ok(expectedPath.startsWith("$"), `${location}.path: must start with $`);

  if (expected.stage === "parse") {
    const input = requireString(expected.input, `${location}.input`);
    assert.ok(inputNames.includes(input), `${location}.input: unknown input ${input}`);
    return {
      ok: false,
      stage: "parse",
      input,
      code,
      path: expectedPath,
    };
  }

  assert.equal(expected.input, undefined, `${location}.input: is only valid for parse failures`);
  return {
    ok: false,
    stage: "composition",
    code,
    path: expectedPath,
  };
}

function scenarioInputEntries(
  scenario: Pick<ScenarioDefinition, "validator" | "inputs">,
  objects: Record<string, ObjectSpec>,
  location: string,
): Array<{ name: string; reference: string }> {
  const entries: Array<{ name: string; reference: string }> = [];

  switch (scenario.validator) {
    case "run-manifest-revision":
      requireExactInputKeys(scenario.inputs, ["previous", "next"], location);
      entries.push(
        {
          name: "previous",
          reference: requireObjectReference(scenario.inputs.previous, objects, `${location}.previous`),
        },
        {
          name: "next",
          reference: requireObjectReference(scenario.inputs.next, objects, `${location}.next`),
        },
      );
      break;
    case "research-run-context-pack":
      requireExactInputKeys(scenario.inputs, ["run", "contextPack"], location);
      entries.push(
        {
          name: "run",
          reference: requireObjectReference(scenario.inputs.run, objects, `${location}.run`),
        },
        {
          name: "contextPack",
          reference: requireObjectReference(
            scenario.inputs.contextPack,
            objects,
            `${location}.contextPack`,
          ),
        },
      );
      break;
    case "model-task-result":
      requireExactInputKeys(scenario.inputs, ["task", "result"], location);
      entries.push(
        {
          name: "task",
          reference: requireObjectReference(scenario.inputs.task, objects, `${location}.task`),
        },
        {
          name: "result",
          reference: requireObjectReference(scenario.inputs.result, objects, `${location}.result`),
        },
      );
      break;
    case "run-event-deletion": {
      requireExactInputKeys(scenario.inputs, ["run", "events"], location);
      entries.push({
        name: "run",
        reference: requireObjectReference(scenario.inputs.run, objects, `${location}.run`),
      });
      assert.ok(Array.isArray(scenario.inputs.events), `${location}.events: must be an array`);
      for (const [index, event] of scenario.inputs.events.entries()) {
        entries.push({
          name: `events[${index}]`,
          reference: requireObjectReference(event, objects, `${location}.events[${index}]`),
        });
      }
      break;
    }
  }

  return entries;
}

function validateScenario(
  value: unknown,
  family: ValidatorKind,
  objects: Record<string, ObjectSpec>,
  location: string,
): ScenarioDefinition {
  const scenario = requireRecord(value, location);
  assertAllowedKeys(
    scenario,
    ["id", "description", "validator", "inputs", "options", "expected"],
    location,
  );

  const id = requireString(scenario.id, `${location}.id`);
  assert.match(id, SCENARIO_ID_PATTERN, `${location}.id: must use lowercase dot/kebab segments`);
  const description = requireString(scenario.description, `${location}.description`);
  const validator = requireString(scenario.validator, `${location}.validator`);
  assert.ok(
    VALIDATORS.includes(validator as ValidatorKind),
    `${location}.validator: unknown validator ${validator}`,
  );
  assert.equal(validator, family, `${location}.validator: must match corpus family ${family}`);
  const inputs = requireRecord(scenario.inputs, `${location}.inputs`);
  const inputEntries = scenarioInputEntries(
    { validator: validator as ValidatorKind, inputs },
    objects,
    `${location}.inputs`,
  );

  let options: ManifestRevisionOptions | undefined;
  if (validator === "run-manifest-revision") {
    if (scenario.options !== undefined) {
      const rawOptions = requireRecord(scenario.options, `${location}.options`);
      assertAllowedKeys(rawOptions, ["contextConsent", "freshConsent"], `${location}.options`);
      if (rawOptions.contextConsent !== undefined) {
        assert.ok(
          RETENTION_POLICIES.has(rawOptions.contextConsent as string),
          `${location}.options.contextConsent: must be run-only, 7-days, or project`,
        );
      }
      if (rawOptions.freshConsent !== undefined) {
        assert.equal(
          typeof rawOptions.freshConsent,
          "boolean",
          `${location}.options.freshConsent: must be a boolean`,
        );
      }
      options = {
        ...(rawOptions.contextConsent === undefined
          ? {}
          : {
              contextConsent: rawOptions.contextConsent as ManifestRevisionOptions["contextConsent"],
            }),
        ...(rawOptions.freshConsent === undefined
          ? {}
          : { freshConsent: rawOptions.freshConsent as boolean }),
      };
    }
  } else {
    assert.equal(scenario.options, undefined, `${location}.options: is only valid for manifest revisions`);
  }

  const expected = validateExpected(
    scenario.expected,
    inputEntries.map((entry) => entry.name),
    `${location}.expected`,
  );
  return {
    id,
    description,
    validator: validator as ValidatorKind,
    inputs,
    ...(options === undefined ? {} : { options }),
    expected,
  };
}

function validateCorpus(value: unknown, filePath: string): ScenarioCorpus {
  const corpus = requireRecord(value, filePath);
  assertAllowedKeys(corpus, ["format", "family", "objects", "scenarios"], filePath);
  assert.equal(corpus.format, SCENARIO_FORMAT, `${filePath}: unsupported scenario format`);

  const family = requireString(corpus.family, `${filePath}.family`);
  assert.ok(VALIDATORS.includes(family as ValidatorKind), `${filePath}.family: unknown family ${family}`);

  const rawObjects = requireRecord(corpus.objects, `${filePath}.objects`);
  assert.ok(Object.keys(rawObjects).length > 0, `${filePath}.objects: must not be empty`);
  const objects: Record<string, ObjectSpec> = Object.create(null);
  for (const name of Object.keys(rawObjects).sort(compareCodeUnits)) {
    requireString(name, `${filePath}.objects key`);
    objects[name] = validateObjectSpec(rawObjects[name], `${filePath}.objects.${name}`);
  }

  assert.ok(Array.isArray(corpus.scenarios), `${filePath}.scenarios: must be an array`);
  assert.ok(corpus.scenarios.length > 0, `${filePath}.scenarios: must not be empty`);
  const scenarios = corpus.scenarios.map((scenario, index) =>
    validateScenario(scenario, family as ValidatorKind, objects, `${filePath}.scenarios[${index}]`),
  );

  const ids = scenarios.map((scenario) => scenario.id);
  assert.equal(new Set(ids).size, ids.length, `${filePath}: duplicate scenario id`);

  const usedObjects = new Set<string>();
  for (const scenario of scenarios) {
    for (const entry of scenarioInputEntries(
      scenario,
      objects,
      `${filePath}:${scenario.id}.inputs`,
    )) {
      usedObjects.add(entry.reference);
    }
  }
  for (const objectName of Object.keys(objects)) {
    assert.ok(
      usedObjects.has(objectName),
      `${filePath}.objects.${objectName}: object is not referenced by any scenario`,
    );
  }

  return {
    filePath,
    family: family as ValidatorKind,
    objects,
    scenarios,
  };
}

function applyMergePatch(target: unknown, patch: unknown): unknown {
  if (!isRecord(patch)) {
    return structuredClone(patch);
  }
  const merged: Record<string, unknown> = isRecord(target) ? structuredClone(target) : {};
  for (const key of Object.keys(patch)) {
    const patchValue = patch[key];
    if (patchValue === null) {
      delete merged[key];
    } else {
      merged[key] = applyMergePatch(merged[key], patchValue);
    }
  }
  return merged;
}

function decodeJsonPointer(pointer: string, location: string): string[] {
  if (pointer === "") return [];
  assert.ok(pointer.startsWith("/"), `${location}: JSON Pointer must start with /`);
  return pointer.slice(1).split("/").map((part) => {
    assert.ok(!/~(?:[^01]|$)/.test(part), `${location}: invalid JSON Pointer escape`);
    return part.replaceAll("~1", "/").replaceAll("~0", "~");
  });
}

function resolveJsonPointer(
  value: Record<string, unknown>,
  pointer: string,
  location: string,
): Record<string, unknown> {
  let current: unknown = value;
  for (const part of decodeJsonPointer(pointer, location)) {
    const record = requireRecord(current, location);
    assert.ok(Object.hasOwn(record, part), `${location}: pointer does not exist`);
    current = record[part];
  }
  return requireRecord(current, location);
}

function resolveFixturePath(relativePath: string, location: string): string {
  const resolved = path.resolve(fixturesDir, relativePath);
  const relative = path.relative(fixturesDir, resolved);
  assert.ok(
    relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative),
    `${location}: fixture path must stay beneath ${fixturesDir}`,
  );
  assert.ok(resolved.endsWith(".json"), `${location}: fixture path must end in .json`);
  assert.ok(existsSync(resolved), `${location}: fixture does not exist`);
  assert.ok(lstatSync(resolved).isFile(), `${location}: fixture path must identify a regular file`);
  return resolved;
}

function materializeObject(spec: ObjectSpec, location: string): Record<string, unknown> {
  const source =
    spec.fixture === undefined
      ? structuredClone(spec.value)
      : readJsonFile(resolveFixturePath(spec.fixture, `${location}.fixture`));
  let materialized = requireRecord(source, location);
  if (spec.mergePatch !== undefined) {
    materialized = requireRecord(applyMergePatch(materialized, spec.mergePatch), location);
  }
  for (const [index, targetPointer] of (spec.digestTargets ?? []).entries()) {
    const target = resolveJsonPointer(
      materialized,
      targetPointer,
      `${location}.digestTargets[${index}]`,
    );
    target.digest = digestProtocolObject(target);
  }
  return materialized;
}

function schemaFileNameFor(schemaId: string): string {
  const match = SCHEMA_ID_PATTERN.exec(schemaId);
  assert.ok(match, `schema id ${schemaId} does not match opencoven.<name>/v1`);
  return `${match[1]}.schema.json`;
}

const schemaContext = new Map<string, TSchema>();
const schemaCheckContext: Record<string, TSchema> = Object.create(null);
for (const schemaId of RESEARCH_PROTOCOL_SCHEMAS) {
  const schemaPath = path.join(schemasDir, schemaFileNameFor(schemaId));
  const schema = readJsonFile(schemaPath);
  assert.ok(IsSchema(schema), `${schemaPath}: must be a valid JSON Schema`);
  schemaContext.set(schemaId, schema);
  schemaCheckContext[schemaId] = schema;
}

function parseScenarioInput(
  corpus: ScenarioCorpus,
  objectName: string,
  inputName: string,
): {
  materialized: Record<string, unknown>;
  parsed: ProtocolParseResult<ResearchProtocolObjectV1>;
} {
  const location = `${corpus.filePath}.objects.${objectName} (input ${inputName})`;
  const materialized = materializeObject(corpus.objects[objectName], location);
  const schemaId = requireString(materialized.schema, `${location}.schema`);
  const schema = schemaContext.get(schemaId);
  assert.ok(schema !== undefined, `${location}: schema ${schemaId} is not an approved v1 schema`);
  assert.equal(
    Check(schemaCheckContext, schema, materialized),
    true,
    `${location}: object must pass its authoritative schema before parsing or composition`,
  );
  return {
    materialized,
    parsed: parseResearchProtocolObject(materialized),
  };
}

function requireParsedSchema<T extends ResearchProtocolObjectV1>(
  parsed: ResearchProtocolObjectV1,
  schema: T["schema"],
  location: string,
): T {
  assert.equal(parsed.schema, schema, `${location}: expected ${schema}, got ${parsed.schema}`);
  return parsed as T;
}

function executeComposition(
  scenario: ScenarioDefinition,
  parsedInputs: ReadonlyMap<string, ResearchProtocolObjectV1>,
): {
  result: ProtocolParseResult<ResearchProtocolObjectV1 | readonly RunEventV1[]>;
  expectedValue: ResearchProtocolObjectV1;
} {
  switch (scenario.validator) {
    case "run-manifest-revision": {
      const previous = requireParsedSchema<RunManifestV1>(
        parsedInputs.get("previous")!,
        "opencoven.run-manifest/v1",
        `${scenario.id}.previous`,
      );
      const next = requireParsedSchema<RunManifestV1>(
        parsedInputs.get("next")!,
        "opencoven.run-manifest/v1",
        `${scenario.id}.next`,
      );
      return {
        result: validateRunManifestRevision(previous, next, scenario.options),
        expectedValue: next,
      };
    }
    case "research-run-context-pack": {
      const run = requireParsedSchema<ResearchRunV1>(
        parsedInputs.get("run")!,
        "opencoven.research-run/v1",
        `${scenario.id}.run`,
      );
      const contextPack = requireParsedSchema<ContextPackV1>(
        parsedInputs.get("contextPack")!,
        "opencoven.context-pack/v1",
        `${scenario.id}.contextPack`,
      );
      return {
        result: validateResearchRunContextPackV1(run, contextPack),
        expectedValue: run,
      };
    }
    case "model-task-result": {
      const task = requireParsedSchema<ModelTaskV1>(
        parsedInputs.get("task")!,
        "opencoven.model-task/v1",
        `${scenario.id}.task`,
      );
      const result = requireParsedSchema<ModelTaskResultV1>(
        parsedInputs.get("result")!,
        "opencoven.model-task-result/v1",
        `${scenario.id}.result`,
      );
      return {
        result: validateModelTaskResultV1(task, result),
        expectedValue: result,
      };
    }
    case "run-event-deletion": {
      const run = requireParsedSchema<ResearchRunV1>(
        parsedInputs.get("run")!,
        "opencoven.research-run/v1",
        `${scenario.id}.run`,
      );
      const events: RunEventV1[] = [];
      const rawEvents = scenario.inputs.events as unknown[];
      for (const index of rawEvents.keys()) {
        events.push(
          requireParsedSchema<RunEventV1>(
            parsedInputs.get(`events[${index}]`)!,
            "opencoven.run-event/v1",
            `${scenario.id}.events[${index}]`,
          ),
        );
      }
      const eventsBefore = structuredClone(events);
      const result = validateRunManifestDeletionEventV1(run, events);
      assert.deepEqual(events, eventsBefore, "deletion composition must not reorder or mutate events");
      return {
        result,
        expectedValue: run,
      };
    }
  }
}

function executeScenario(corpus: ScenarioCorpus, scenario: ScenarioDefinition): void {
  const entries = scenarioInputEntries(
    scenario,
    corpus.objects,
    `${corpus.filePath}:${scenario.id}.inputs`,
  );
  const parsedInputs = new Map<string, ResearchProtocolObjectV1>();
  let expectedParseFailureSeen = false;

  for (const entry of entries) {
    const { materialized, parsed } = parseScenarioInput(corpus, entry.reference, entry.name);
    if (!parsed.ok) {
      assert.equal(
        scenario.expected.ok,
        false,
        `${entry.name}: parser rejected an input for a scenario expected to pass`,
      );
      if (scenario.expected.ok) return;
      assert.equal(scenario.expected.stage, "parse", `${entry.name}: unexpected parser failure`);
      assert.equal(scenario.expected.input, entry.name, `${entry.name}: wrong input failed parsing`);
      assert.equal(parsed.error.code, scenario.expected.code, `${entry.name}: wrong protocol error code`);
      assert.equal(parsed.error.path, scenario.expected.path, `${entry.name}: wrong protocol error path`);
      expectedParseFailureSeen = true;
      continue;
    }

    assert.deepEqual(
      parsed.value,
      materialized,
      `${entry.name}: parser must preserve all scenario protocol data losslessly`,
    );
    parsedInputs.set(entry.name, parsed.value);
  }

  if (!scenario.expected.ok && scenario.expected.stage === "parse") {
    assert.equal(expectedParseFailureSeen, true, "expected parser failure was not observed");
    return;
  }
  assert.equal(expectedParseFailureSeen, false);

  const before = structuredClone(Object.fromEntries(parsedInputs));
  const { result, expectedValue } = executeComposition(scenario, parsedInputs);
  assert.deepEqual(
    Object.fromEntries(parsedInputs),
    before,
    "composition validator must not mutate any parsed scenario input",
  );

  if (scenario.expected.ok) {
    if (!result.ok) {
      assert.fail(
        `${result.error.path}: expected composition success, got ${result.error.code}: ${result.error.message}`,
      );
    }
    assert.deepEqual(result.value, expectedValue, "successful composition must not lose protocol data");
    return;
  }

  assert.equal(scenario.expected.stage, "composition");
  assert.equal(result.ok, false, "expected composition failure");
  if (result.ok) return;
  assert.equal(result.error.code, scenario.expected.code, "wrong protocol error code");
  assert.equal(result.error.path, scenario.expected.path, "wrong protocol error path");
}

const scenarioEntries = readdirSync(scenariosDir, { withFileTypes: true });
const scenarioFileNames = scenarioEntries
  .filter((entry) => entry.isFile() && entry.name.endsWith(".scenario.json"))
  .map((entry) => entry.name)
  .sort(compareCodeUnits);
const rootJsonFileNames = scenarioEntries
  .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
  .map((entry) => entry.name)
  .sort(compareCodeUnits);
const corpora = scenarioFileNames.map((fileName) => {
  const filePath = path.join(scenariosDir, fileName);
  return validateCorpus(readJsonFile(filePath), filePath);
});

test("discovers every structured Research Protocol scenario fixture deterministically", () => {
  assert.ok(scenarioFileNames.length > 0, `${scenariosDir}: no .scenario.json fixtures found`);
  assert.deepEqual(
    rootJsonFileNames,
    scenarioFileNames,
    `${scenariosDir}: every root JSON fixture must use the .scenario.json suffix`,
  );
  assert.deepEqual(
    [...new Set(corpora.map((corpus) => corpus.family))].sort(compareCodeUnits),
    [...VALIDATORS].sort(compareCodeUnits),
    "scenario corpus must cover every public composition validator family",
  );
});

test("rejects malformed scenario definitions before protocol execution", () => {
  assert.throws(
    () =>
      validateCorpus(
        {
          format: SCENARIO_FORMAT,
          family: "model-task-result",
          objects: {
            task: { fixture: "valid/model-task.json", unexpected: true },
          },
          scenarios: [],
        },
        "malformed.scenario.json",
      ),
    /unknown field unexpected/,
  );
  assert.throws(
    () =>
      validateExpected(
        {
          ok: false,
          stage: "composition",
          code: "not_a_protocol_error",
          path: "$",
        },
        [],
        "malformed.expected",
      ),
    /unknown protocol error code/,
  );
  assert.throws(
    () =>
      validateCorpus(
        {
          format: SCENARIO_FORMAT,
          family: "model-task-result",
          objects: {
            task: { fixture: "valid/model-task.json" },
          },
          scenarios: [],
        },
        "empty-family.scenario.json",
      ),
    /scenarios: must not be empty/,
  );
  assert.throws(
    () => resolveFixturePath("valid/missing-scenario-fixture.json", "missing.fixture"),
    /missing\.fixture: fixture does not exist/,
  );
});

test("rejects unknown scenario kinds, duplicate ids, and incomplete expected errors", () => {
  const objects = {
    task: { fixture: "valid/model-task.json" },
    result: { fixture: "valid/model-task-result.json" },
  };
  const scenario = {
    id: "model.valid-pair",
    description: "A valid task and result pair.",
    validator: "model-task-result",
    inputs: { task: "task", result: "result" },
    expected: { ok: true },
  };

  assert.throws(
    () =>
      validateCorpus(
        {
          format: SCENARIO_FORMAT,
          family: "model-task-result",
          objects,
          scenarios: [scenario, { ...scenario }],
        },
        "duplicate-id.scenario.json",
      ),
    /duplicate scenario id/i,
  );

  assert.throws(
    () =>
      validateCorpus(
        {
          format: SCENARIO_FORMAT,
          family: "model-task-result",
          objects,
          scenarios: [{ ...scenario, validator: "unknown-kind" }],
        },
        "unknown-kind.scenario.json",
      ),
    /unknown validator unknown-kind/i,
  );

  assert.throws(
    () =>
      validateCorpus(
        {
          format: SCENARIO_FORMAT,
          family: "model-task-result",
          objects,
          scenarios: [
            {
              ...scenario,
              expected: {
                ok: false,
                stage: "composition",
                code: "semantic_conflict",
              },
            },
          ],
        },
        "missing-path.scenario.json",
      ),
    /expected\.path.*must be a string/i,
  );
});

test("fails when declared success, error code, or error path differs from the actual result", () => {
  const corpus = corpora.find((candidate) => candidate.family === "model-task-result");
  assert.ok(corpus);
  const success = corpus.scenarios.find((scenario) => scenario.id === "model-task.valid-pair");
  const failure = corpus.scenarios.find((scenario) => scenario.id === "model-task.wrong-task-id");
  assert.ok(success);
  assert.ok(failure && !failure.expected.ok);
  if (failure.expected.ok) assert.fail("expected a declared failure scenario");
  const expectedFailure = failure.expected;

  assert.throws(
    () =>
      executeScenario(corpus, {
        ...success,
        expected: {
          ok: false,
          stage: "composition",
          code: "semantic_conflict",
          path: "$.taskId",
        },
      }),
    /expected composition failure/i,
  );
  assert.throws(
    () =>
      executeScenario(corpus, {
        ...failure,
        expected: {
          ...expectedFailure,
          code: "digest_mismatch",
        },
      }),
    /wrong protocol error code/i,
  );
  assert.throws(
    () =>
      executeScenario(corpus, {
        ...failure,
        expected: {
          ...expectedFailure,
          path: "$.wrongPath",
        },
      }),
    /wrong protocol error path/i,
  );
});

const allScenarioIds = new Set<string>();
for (const corpus of corpora) {
  for (const scenario of corpus.scenarios) {
    assert.ok(
      !allScenarioIds.has(scenario.id),
      `${corpus.filePath}: duplicate scenario id ${scenario.id}`,
    );
    allScenarioIds.add(scenario.id);
    test(`${corpus.family}: ${scenario.id} — ${scenario.description}`, () => {
      executeScenario(corpus, scenario);
    });
  }
}

test("covers every required Unit 0 cross-object scenario", () => {
  for (const requiredId of [
    "manifest.assembling-to-final",
    "manifest.partial-usage",
    "manifest.changed-manifest-id",
    "manifest.changed-run-id",
    "manifest.broken-previous-digest",
    "manifest.gapped-revision",
    "manifest.post-final-mutation",
    "manifest.retention-ceiling",
    "manifest.policy-shortening",
    "manifest.lengthening-without-fresh-consent",
    "manifest.lengthening-with-fresh-consent",
    "manifest.partial-failure-continues",
    "manifest.completed-deletion-terminal",
    "research-run.valid-context-pack",
    "research-run.retention-ceiling",
    "research-run.embedded-manifest-retention-ceiling",
    "research-run.contextless-manifest-lengthening",
    "model-task.valid-pair",
    "model-task.wrong-task-id",
    "model-task.wrong-run-id",
    "model-task.wrong-attempt",
    "model-task.wrong-input-digest",
    "model-task.wrong-familiar-id",
    "model-task.wrong-effective-model",
    "run-deletion.valid-completed",
    "run-deletion.valid-no-manifest",
    "run-deletion.partial-failure-retryable",
    "run-deletion.partial-failure-incomplete-stream",
    "run-deletion.truncated-stream",
    "run-deletion.extra-stream",
    "run-deletion.duplicate-sequence",
    "run-deletion.gapped-sequence",
    "run-deletion.wrong-run-stream",
    "run-deletion.mixed-run-stream",
    "run-deletion.wrong-event-type",
    "run-deletion.wrong-object-count",
    "run-deletion.wrong-manifest-status",
    "run-deletion.wrong-receipt-sequence",
  ]) {
    assert.ok(allScenarioIds.has(requiredId), `missing required scenario: ${requiredId}`);
  }
});
