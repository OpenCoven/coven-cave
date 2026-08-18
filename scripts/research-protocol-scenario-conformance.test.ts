// Structured cross-object conformance for Research Protocol v1.
//
// Scenario behavior lives in JSON under
// `schemas/research/v1/fixtures/scenarios/*.scenario.json`, with authoritative
// support objects directly beneath `scenarios/objects/`. Each corpus names a
// format/family, declares reusable objects (fixture or inline value, optional
// RFC 7396 mergePatch, optional digestTargets), then lists stable scenario ids,
// descriptions, input references, validator options, and exact expected
// code/path outcomes. This runner owns assembly and strict format validation;
// protocol behavior stays in the public parsers and composition validators.

import assert from "node:assert/strict";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
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
  RESEARCH_PROTOCOL_SCHEMAS,
  digestProtocolObject,
  isRecord,
  isSha256,
  isUtcTimestamp,
  parseResearchProtocolObject,
  validateManifestRetentionConsent,
  validateModelTaskResultV1,
  validateResearchRunContextPackV1,
  validateRunEventSequence,
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
// Keep this independent from the action registry so an omitted action cannot
// make the registry's own coverage assertion pass.
const PUBLIC_VALIDATOR_ENTRY_POINTS = [
  "validateManifestRetentionConsent",
  "validateModelTaskResultV1",
  "validateResearchRunContextPackV1",
  "validateRunEventSequence",
  "validateRunManifestDeletionEventV1",
  "validateRunManifestRevision",
] as const;

const VALIDATOR_ENTRY_POINT_BY_ACTION = {
  "manifest-retention-consent": "validateManifestRetentionConsent",
  "model-task-result": "validateModelTaskResultV1",
  "research-run-context-pack": "validateResearchRunContextPackV1",
  "run-event-deletion": "validateRunManifestDeletionEventV1",
  "run-event-sequence": "validateRunEventSequence",
  "run-manifest-revision": "validateRunManifestRevision",
} as const satisfies Record<string, (typeof PUBLIC_VALIDATOR_ENTRY_POINTS)[number]>;

type ValidatorKind = keyof typeof VALIDATOR_ENTRY_POINT_BY_ACTION;
const VALIDATORS = Object.keys(VALIDATOR_ENTRY_POINT_BY_ACTION) as ValidatorKind[];
const DIGEST_TARGET_SCHEMA_BY_CONTAINER: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  "opencoven.context-pack/v1": {
    "": "opencoven.context-pack/v1",
  },
  "opencoven.research-run/v1": {
    "/artifactManifest": "opencoven.run-manifest/v1",
  },
  "opencoven.run-manifest/v1": {
    "": "opencoven.run-manifest/v1",
  },
};
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

type ScenarioInputEntry = {
  name: string;
  reference: string;
  schema: ResearchProtocolObjectV1["schema"];
};

type ScenarioCorpus = {
  filePath: string;
  family: ValidatorKind;
  objects: Record<string, ObjectSpec>;
  scenarios: ScenarioDefinition[];
};

type ScenarioTreeEntryKind = "file" | "directory" | "symlink" | "other";
type ScenarioTreeClassification = "corpus" | "support" | "directory";
type ScenarioInventoryFile = {
  relativePath: string;
  filePath: string;
};
type ScenarioInventory = {
  corpusFiles: ScenarioInventoryFile[];
  supportObjectFiles: ScenarioInventoryFile[];
};

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function withTemporaryDirectory<T>(callback: (directory: string) => T): T {
  const cacheDirectory = path.join(repoRoot, "node_modules", ".cache");
  mkdirSync(cacheDirectory, { recursive: true });
  const temporaryDirectory = mkdtempSync(
    path.join(cacheDirectory, "research-protocol-scenario-conformance-"),
  );
  try {
    return callback(temporaryDirectory);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function createSymlinkOrSkip(
  context: TestContext,
  targetPath: string,
  linkPath: string,
  type: "file" | "dir",
): boolean {
  try {
    symlinkSync(
      targetPath,
      linkPath,
      process.platform === "win32" && type === "dir" ? "junction" : type,
    );
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

function classifyScenarioTreeEntry(
  relativePath: string,
  kind: ScenarioTreeEntryKind,
): ScenarioTreeClassification {
  if (kind === "symlink") {
    assert.fail(`${relativePath}: symlinks are not allowed under the scenario fixture tree`);
  }
  if (kind === "other") {
    assert.fail(`${relativePath}: must be a regular file or directory`);
  }

  const isInObjectsDirectory = relativePath.startsWith("objects/");
  const isDirectObject =
    isInObjectsDirectory && !relativePath.slice("objects/".length).includes("/");
  if (kind === "directory") {
    if (relativePath === "objects") return "directory";
    assert.fail(
      `${relativePath}: unexpected directory; only the top-level objects directory is allowed`,
    );
  }

  if (!relativePath.includes("/") && relativePath.endsWith(".scenario.json")) {
    return "corpus";
  }
  if (isDirectObject && relativePath.endsWith(".json")) {
    return "support";
  }
  if (isInObjectsDirectory && !isDirectObject) {
    assert.fail(`${relativePath}: nested support object paths are not allowed`);
  }
  if (relativePath.endsWith(".json")) {
    assert.fail(`${relativePath}: JSON file is outside the objects directory and is not a top-level corpus`);
  }
  assert.fail(
    `${relativePath}: unexpected file extension; expected a top-level .scenario.json corpus or an objects/*.json support object`,
  );
}

function inventoryScenarioTree(rootDirectory: string): ScenarioInventory {
  const rootStats = lstatSync(rootDirectory, { throwIfNoEntry: false });
  assert.ok(rootStats, `${rootDirectory}: scenario fixture root does not exist`);
  assert.ok(
    !rootStats.isSymbolicLink(),
    `${rootDirectory}: scenario fixture root must not be a symlink`,
  );
  assert.ok(rootStats.isDirectory(), `${rootDirectory}: scenario fixture root must be a directory`);

  const corpusFiles: ScenarioInventoryFile[] = [];
  const supportObjectFiles: ScenarioInventoryFile[] = [];
  let foundObjectsDirectory = false;

  function visit(directoryPath: string, relativeDirectory: string): void {
    const entryNames = readdirSync(directoryPath).sort(compareCodeUnits);
    for (const entryName of entryNames) {
      const relativePath =
        relativeDirectory === "" ? entryName : `${relativeDirectory}/${entryName}`;
      const filePath = path.join(directoryPath, entryName);
      const stats = lstatSync(filePath, { throwIfNoEntry: false });
      assert.ok(stats, `${filePath}: scenario inventory entry disappeared`);

      const kind: ScenarioTreeEntryKind = stats.isSymbolicLink()
        ? "symlink"
        : stats.isFile()
          ? "file"
          : stats.isDirectory()
            ? "directory"
            : "other";
      const classification = classifyScenarioTreeEntry(relativePath, kind);
      if (classification === "directory") {
        assert.equal(relativePath, "objects");
        foundObjectsDirectory = true;
        visit(filePath, relativePath);
      } else if (classification === "corpus") {
        corpusFiles.push({ relativePath, filePath });
      } else {
        supportObjectFiles.push({ relativePath, filePath });
      }
    }
  }

  visit(rootDirectory, "");
  assert.ok(
    foundObjectsDirectory,
    `${rootDirectory}: required objects directory is missing`,
  );
  corpusFiles.sort((left, right) => compareCodeUnits(left.relativePath, right.relativePath));
  supportObjectFiles.sort((left, right) =>
    compareCodeUnits(left.relativePath, right.relativePath),
  );
  return { corpusFiles, supportObjectFiles };
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
): ScenarioInputEntry[] {
  const entries: ScenarioInputEntry[] = [];

  switch (scenario.validator) {
    case "run-manifest-revision":
      requireExactInputKeys(scenario.inputs, ["previous", "next"], location);
      entries.push(
        {
          name: "previous",
          reference: requireObjectReference(scenario.inputs.previous, objects, `${location}.previous`),
          schema: "opencoven.run-manifest/v1",
        },
        {
          name: "next",
          reference: requireObjectReference(scenario.inputs.next, objects, `${location}.next`),
          schema: "opencoven.run-manifest/v1",
        },
      );
      break;
    case "research-run-context-pack":
      assertAllowedKeys(scenario.inputs, ["run", "contextPack"], location);
      assert.ok(Object.hasOwn(scenario.inputs, "run"), `${location}: missing field run`);
      entries.push({
        name: "run",
        reference: requireObjectReference(scenario.inputs.run, objects, `${location}.run`),
        schema: "opencoven.research-run/v1",
      });
      if (Object.hasOwn(scenario.inputs, "contextPack")) {
        entries.push({
          name: "contextPack",
          reference: requireObjectReference(
            scenario.inputs.contextPack,
            objects,
            `${location}.contextPack`,
          ),
          schema: "opencoven.context-pack/v1",
        });
      }
      break;
    case "manifest-retention-consent":
      requireExactInputKeys(scenario.inputs, ["manifest"], location);
      entries.push({
        name: "manifest",
        reference: requireObjectReference(
          scenario.inputs.manifest,
          objects,
          `${location}.manifest`,
        ),
        schema: "opencoven.run-manifest/v1",
      });
      break;
    case "model-task-result":
      requireExactInputKeys(scenario.inputs, ["task", "result"], location);
      entries.push(
        {
          name: "task",
          reference: requireObjectReference(scenario.inputs.task, objects, `${location}.task`),
          schema: "opencoven.model-task/v1",
        },
        {
          name: "result",
          reference: requireObjectReference(scenario.inputs.result, objects, `${location}.result`),
          schema: "opencoven.model-task-result/v1",
        },
      );
      break;
    case "run-event-deletion": {
      requireExactInputKeys(scenario.inputs, ["run", "events"], location);
      entries.push({
        name: "run",
        reference: requireObjectReference(scenario.inputs.run, objects, `${location}.run`),
        schema: "opencoven.research-run/v1",
      });
      assert.ok(Array.isArray(scenario.inputs.events), `${location}.events: must be an array`);
      for (const [index, event] of scenario.inputs.events.entries()) {
        entries.push({
          name: `events[${index}]`,
          reference: requireObjectReference(event, objects, `${location}.events[${index}]`),
          schema: "opencoven.run-event/v1",
        });
      }
      break;
    }
    case "run-event-sequence": {
      requireExactInputKeys(scenario.inputs, ["events"], location);
      assert.ok(Array.isArray(scenario.inputs.events), `${location}.events: must be an array`);
      for (const [index, event] of scenario.inputs.events.entries()) {
        entries.push({
          name: `events[${index}]`,
          reference: requireObjectReference(event, objects, `${location}.events[${index}]`),
          schema: "opencoven.run-event/v1",
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
  if (
    validator === "run-manifest-revision" ||
    validator === "manifest-retention-consent"
  ) {
    if (scenario.options !== undefined) {
      const rawOptions = requireRecord(scenario.options, `${location}.options`);
      assertAllowedKeys(
        rawOptions,
        validator === "run-manifest-revision"
          ? ["contextConsent", "freshConsent", "freshConsentAt"]
          : ["contextConsent"],
        `${location}.options`,
      );
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
      if (rawOptions.freshConsentAt !== undefined) {
        assert.equal(
          isUtcTimestamp(rawOptions.freshConsentAt),
          true,
          `${location}.options.freshConsentAt: must be a UTC RFC 3339 timestamp`,
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
        ...(rawOptions.freshConsentAt === undefined
          ? {}
          : { freshConsentAt: rawOptions.freshConsentAt as string }),
      };
    }
  } else {
    assert.equal(
      scenario.options,
      undefined,
      `${location}.options: is only valid for manifest retention consent or revisions`,
    );
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
    const patchValue = Object.hasOwn(patch, key) ? patch[key] : undefined;
    if (patchValue === null) {
      delete merged[key];
    } else {
      const targetValue = Object.hasOwn(merged, key) ? merged[key] : undefined;
      Object.defineProperty(merged, key, {
        configurable: true,
        enumerable: true,
        value: applyMergePatch(targetValue, patchValue),
        writable: true,
      });
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

function recomputeDigestTarget(
  value: Record<string, unknown>,
  pointer: string,
  location: string,
): void {
  const containerSchema = requireString(value.schema, `${location}.container.schema`);
  const targetSchema = DIGEST_TARGET_SCHEMA_BY_CONTAINER[containerSchema]?.[pointer];
  assert.ok(
    targetSchema !== undefined,
    `${location}: does not identify a recognized self-digest-bearing protocol object`,
  );

  const target = resolveJsonPointer(value, pointer, location);
  assert.equal(
    target.schema,
    targetSchema,
    `${location}: digest target must declare schema ${targetSchema}`,
  );
  assert.ok(
    isSha256(target.digest),
    `${location}: digest target must already contain a valid digest field`,
  );
  target.digest = digestProtocolObject(target);
  validateAuthoritativeProtocolObject(target, `${location} synthesized target`);
}

function resolveFixturePath(
  relativePath: string,
  location: string,
  fixtureRoot: string = fixturesDir,
): string {
  assert.ok(relativePath !== "", `${location}: fixture path must not be empty`);
  assert.ok(!relativePath.includes("\0"), `${location}: fixture path must not contain NUL bytes`);
  assert.ok(
    !path.posix.isAbsolute(relativePath) && !path.win32.isAbsolute(relativePath),
    `${location}: fixture path must be a repository-relative POSIX path beneath the fixture root`,
  );
  assert.ok(
    !/^[A-Za-z]:/.test(relativePath),
    `${location}: fixture path must not use platform-specific path syntax`,
  );
  assert.ok(
    !relativePath.includes("\\"),
    `${location}: fixture path must use POSIX separators, not backslashes`,
  );
  assert.ok(
    !/%[0-9A-Fa-f]{2}/.test(relativePath),
    `${location}: fixture path must not use percent-encoded path syntax`,
  );

  const segments = relativePath.split("/");
  assert.ok(
    !segments.includes(""),
    `${location}: fixture path must not contain empty segments`,
  );
  assert.ok(
    !segments.some((segment) => segment === "." || segment === ".."),
    `${location}: fixture path must not contain dot or traversal segments`,
  );
  assert.equal(
    path.posix.normalize(relativePath),
    relativePath,
    `${location}: fixture path must already be in normalized POSIX form`,
  );
  assert.ok(
    relativePath.endsWith(".json"),
    `${location}: fixture path must end in .json`,
  );

  const absoluteFixtureRoot = path.resolve(fixtureRoot);
  const rootStats = lstatSync(absoluteFixtureRoot, { throwIfNoEntry: false });
  assert.ok(rootStats, `${absoluteFixtureRoot}: fixture root does not exist`);
  assert.ok(
    !rootStats.isSymbolicLink(),
    `${absoluteFixtureRoot}: fixture root must not be a symlink`,
  );
  assert.ok(
    rootStats.isDirectory(),
    `${absoluteFixtureRoot}: fixture root must be a directory`,
  );
  const realFixtureRoot = realpathSync(absoluteFixtureRoot);

  let resolved = absoluteFixtureRoot;
  for (const [index, segment] of segments.entries()) {
    assert.ok(
      readdirSync(resolved).includes(segment),
      `${location}: fixture does not exist (${segments.slice(0, index + 1).join("/")})`,
    );
    resolved = path.join(resolved, segment);
    const stats = lstatSync(resolved, { throwIfNoEntry: false });
    const traversedPath = segments.slice(0, index + 1).join("/");
    assert.ok(stats, `${location}: fixture does not exist (${traversedPath})`);
    assert.ok(
      !stats.isSymbolicLink(),
      `${location}: fixture path component ${traversedPath} is a symlink; symlinks are not allowed`,
    );
    if (index === segments.length - 1) {
      assert.ok(stats.isFile(), `${location}: fixture path must identify a regular file`);
    } else {
      assert.ok(
        stats.isDirectory(),
        `${location}: fixture path component ${traversedPath} must be a directory`,
      );
    }
  }

  const realResolved = realpathSync(resolved);
  const relative = path.relative(realFixtureRoot, realResolved);
  assert.ok(
    relative !== "" &&
      !relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative),
    `${location}: fixture path must stay beneath ${absoluteFixtureRoot}`,
  );
  return resolved;
}

function materializeObject(spec: ObjectSpec, location: string): Record<string, unknown> {
  const source =
    spec.fixture === undefined
      ? structuredClone(spec.value)
      : readJsonFile(resolveFixturePath(spec.fixture, `${location}.fixture`));
  const rawSupportObject = requireRecord(source, `${location}.raw`);
  validateAuthoritativeProtocolObject(rawSupportObject, `${location}.raw`);

  let materialized = structuredClone(rawSupportObject);
  if (spec.mergePatch !== undefined) {
    materialized = requireRecord(applyMergePatch(materialized, spec.mergePatch), location);
  }
  for (const [index, targetPointer] of (spec.digestTargets ?? []).entries()) {
    recomputeDigestTarget(
      materialized,
      targetPointer,
      `${location}.digestTargets[${index}]`,
    );
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

function validateProtocolObjectSchema(
  value: unknown,
  location: string,
  expectedSchema?: ResearchProtocolObjectV1["schema"],
  allowSchemaInvalid = false,
): Record<string, unknown> {
  const protocolObject = requireRecord(value, location);
  const declaredSchema = requireString(protocolObject.schema, `${location}.schema`);
  if (expectedSchema !== undefined) {
    assert.equal(
      declaredSchema,
      expectedSchema,
      `${location}: input must declare expected protocol role schema ${expectedSchema}`,
    );
  }
  const schemaId = expectedSchema ?? declaredSchema;
  const schema = schemaContext.get(schemaId);
  assert.ok(schema !== undefined, `${location}: schema ${schemaId} is not an approved v1 schema`);
  if (!allowSchemaInvalid) {
    assert.equal(
      Check(schemaCheckContext, schema, protocolObject),
      true,
      expectedSchema === undefined
        ? `${location}: object must pass its authoritative schema before parsing or composition`
        : `${location}: input must pass expected protocol role schema ${expectedSchema} before parsing or composition`,
    );
  }
  return protocolObject;
}

function invokeParserWithSnapshot<T>(
  protocolObject: Record<string, unknown>,
  parser: (value: unknown) => ProtocolParseResult<T>,
  location: string,
): ProtocolParseResult<T> {
  const snapshot = structuredClone(protocolObject);
  const parsed = parser(protocolObject);
  assert.deepEqual(
    protocolObject,
    snapshot,
    `${location}: public parser must not mutate its input`,
  );
  if (parsed.ok) {
    assert.deepEqual(
      parsed.value,
      snapshot,
      `${location}: public parser must preserve protocol data losslessly`,
    );
  }
  return parsed;
}

function validateAuthoritativeProtocolObject(
  value: unknown,
  location: string,
): ResearchProtocolObjectV1 {
  const protocolObject = validateProtocolObjectSchema(value, location);
  const parsed = invokeParserWithSnapshot(
    protocolObject,
    parseResearchProtocolObject,
    location,
  );
  if (!parsed.ok) {
    assert.fail(
      `${location}: support object must pass the public parser (${parsed.error.code} at ${parsed.error.path}: ${parsed.error.message})`,
    );
  }
  return parsed.value;
}

function materializeScenarioInput(
  corpus: ScenarioCorpus,
  entry: ScenarioInputEntry,
  allowSchemaInvalid = false,
): Record<string, unknown> {
  const location = `${corpus.filePath}.objects.${entry.reference} (input ${entry.name})`;
  return validateProtocolObjectSchema(
    materializeObject(corpus.objects[entry.reference], location),
    location,
    entry.schema,
    allowSchemaInvalid,
  );
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
  expectedValue: ResearchProtocolObjectV1 | readonly RunEventV1[];
} {
  switch (scenario.validator) {
    case "manifest-retention-consent": {
      const manifest = requireParsedSchema<RunManifestV1>(
        parsedInputs.get("manifest")!,
        "opencoven.run-manifest/v1",
        `${scenario.id}.manifest`,
      );
      return {
        result: validateManifestRetentionConsent(manifest, scenario.options?.contextConsent),
        expectedValue: manifest,
      };
    }
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
      const parsedContextPack = parsedInputs.get("contextPack");
      const contextPack =
        parsedContextPack === undefined
          ? undefined
          : requireParsedSchema<ContextPackV1>(
              parsedContextPack,
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
    case "run-event-sequence": {
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
      const result = validateRunEventSequence(events);
      assert.deepEqual(events, eventsBefore, "sequence composition must not reorder or mutate events");
      return {
        result,
        expectedValue: events,
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
  const materializedInputs = entries.map((entry) => ({
    entry,
    location: `${corpus.filePath}.objects.${entry.reference} (input ${entry.name})`,
    materialized: materializeScenarioInput(
      corpus,
      entry,
      !scenario.expected.ok &&
        scenario.expected.stage === "parse" &&
        scenario.expected.input === entry.name,
    ),
  }));

  for (const { entry, location, materialized } of materializedInputs) {
    const parsed = invokeParserWithSnapshot(
      materialized,
      parseResearchProtocolObject,
      location,
    );
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

function collectFixtureReferences(
  scenarioCorpora: readonly ScenarioCorpus[],
  fixtureRoot: string = fixturesDir,
): Map<string, string[]> {
  const references = new Map<string, string[]>();
  for (const corpus of scenarioCorpora) {
    for (const objectName of Object.keys(corpus.objects).sort(compareCodeUnits)) {
      const fixture = corpus.objects[objectName].fixture;
      if (fixture === undefined) continue;

      const location = `${corpus.filePath}.objects.${objectName}.fixture`;
      resolveFixturePath(fixture, location, fixtureRoot);
      const locations = references.get(fixture) ?? [];
      locations.push(location);
      references.set(fixture, locations);
    }
  }
  return references;
}

function assertSupportObjectsReferenced(
  supportRelativePaths: readonly string[],
  fixtureReferences: ReadonlyMap<string, readonly string[]>,
  scenarioRootLocation: string,
): void {
  for (const relativePath of [...supportRelativePaths].sort(compareCodeUnits)) {
    const fixtureReference = `scenarios/${relativePath}`;
    const locations = fixtureReferences.get(fixtureReference);
    assert.ok(
      locations !== undefined && locations.length > 0,
      `${scenarioRootLocation}/${relativePath}: support object is not referenced by any corpus`,
    );
  }
}

const scenarioInventory = inventoryScenarioTree(scenariosDir);
for (const supportObject of scenarioInventory.supportObjectFiles) {
  validateAuthoritativeProtocolObject(readJsonFile(supportObject.filePath), supportObject.filePath);
}

const corpora = scenarioInventory.corpusFiles.map(({ filePath }) =>
  validateCorpus(readJsonFile(filePath), filePath),
);
const fixtureReferenceLocations = collectFixtureReferences(corpora);
assertSupportObjectsReferenced(
  scenarioInventory.supportObjectFiles.map((file) => file.relativePath),
  fixtureReferenceLocations,
  scenariosDir,
);

test("discovers every structured Research Protocol scenario fixture deterministically", () => {
  const corpusRelativePaths = scenarioInventory.corpusFiles.map((file) => file.relativePath);
  const supportRelativePaths = scenarioInventory.supportObjectFiles.map((file) => file.relativePath);
  assert.ok(corpusRelativePaths.length > 0, `${scenariosDir}: no .scenario.json fixtures found`);
  assert.ok(supportRelativePaths.length > 0, `${scenariosDir}: no support object fixtures found`);
  assert.deepEqual(
    corpusRelativePaths,
    [...corpusRelativePaths].sort(compareCodeUnits),
    `${scenariosDir}: corpus inventory must use code-unit ordering`,
  );
  assert.deepEqual(
    supportRelativePaths,
    [...supportRelativePaths].sort(compareCodeUnits),
    `${scenariosDir}: support object inventory must use code-unit ordering`,
  );
  assert.deepEqual(
    [...new Set(corpora.map((corpus) => corpus.family))].sort(compareCodeUnits),
    [...VALIDATORS].sort(compareCodeUnits),
    "scenario corpus must cover every public composition validator family",
  );
});

test("maps actions onto the complete intended public validator surface", () => {
  assert.deepEqual(
    [...new Set(Object.values(VALIDATOR_ENTRY_POINT_BY_ACTION))].sort(compareCodeUnits),
    [...PUBLIC_VALIDATOR_ENTRY_POINTS].sort(compareCodeUnits),
    "scenario action registry must cover every intended public cross-object/stream validator",
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

test("preserves own __proto__ keys through nested RFC 7396 merge patches", () => {
  const target = requireRecord(
    JSON.parse(
      '{"nested":{"retained":true,"__proto__":{"retainedOwnProto":true}}}',
    ),
    "merge target",
  );
  const patch = requireRecord(
    JSON.parse(
      '{"__proto__":{"topLevelPolluted":true},"nested":{"__proto__":{"nestedPolluted":true},"added":true}}',
    ),
    "merge patch",
  );

  const merged = requireRecord(applyMergePatch(target, patch), "merged result");
  const nested = requireRecord(merged.nested, "merged result.nested");
  const topLevelProtoValue = requireRecord(merged["__proto__"], "merged result.__proto__");
  const nestedProtoValue = requireRecord(nested["__proto__"], "merged result.nested.__proto__");

  assert.deepEqual(
    merged,
    JSON.parse(
      '{"nested":{"retained":true,"__proto__":{"retainedOwnProto":true,"nestedPolluted":true},"added":true},"__proto__":{"topLevelPolluted":true}}',
    ),
  );
  assert.ok(Object.hasOwn(merged, "__proto__"));
  assert.ok(Object.hasOwn(nested, "__proto__"));
  assert.equal(Object.getPrototypeOf(merged), Object.prototype);
  assert.equal(Object.getPrototypeOf(nested), Object.prototype);
  assert.equal(Object.getPrototypeOf(topLevelProtoValue), Object.prototype);
  assert.equal(Object.getPrototypeOf(nestedProtoValue), Object.prototype);
  assert.equal(({} as Record<string, unknown>).topLevelPolluted, undefined);
  assert.equal(({} as Record<string, unknown>).nestedPolluted, undefined);
});

test("detects public parser mutation on every result and data loss on success", () => {
  for (const outcome of ["success", "failure"] as const) {
    const input = {
      schema: "opencoven.injected/v1",
      nested: { retained: true },
    };

    assert.throws(
      () =>
        invokeParserWithSnapshot(
          input,
          (value) => {
            const record = requireRecord(value, `${outcome} parser input`);
            const nested = requireRecord(record.nested, `${outcome} parser input.nested`);
            nested.mutated = true;
            if (outcome === "success") {
              return { ok: true, value: structuredClone(record) } as const;
            }
            return {
              ok: false,
              error: {
                code: "invalid_value",
                path: "$",
                message: "Injected parser failure",
              },
            } as const;
          },
          `${outcome} parser`,
        ),
      /public parser must not mutate its input/,
    );
  }

  const losslessInput = {
    schema: "opencoven.injected/v1",
    retained: true,
  };
  assert.throws(
    () =>
      invokeParserWithSnapshot(
        losslessInput,
        () => ({
          ok: true,
          value: { schema: "opencoven.injected/v1" },
        }),
        "lossy success parser",
      ),
    /public parser must preserve protocol data losslessly/,
  );
});

test("validates raw support objects through the authoritative schema and public parser", () => {
  const filePath = path.join(scenariosDir, "objects/context-bound-extended-run.json");
  const supportObject = requireRecord(readJsonFile(filePath), filePath);
  assert.deepEqual(validateAuthoritativeProtocolObject(supportObject, filePath), supportObject);

  const parserInvalid = structuredClone(supportObject);
  const manifest = requireRecord(parserInvalid.artifactManifest, `${filePath}.artifactManifest`);
  manifest.digest = "0".repeat(64);
  assert.throws(
    () => validateAuthoritativeProtocolObject(parserInvalid, "parser-invalid-support.json"),
    /public parser.*digest_mismatch.*\$\.artifactManifest\.digest/,
  );
});

test("rejects an invalid raw digest before declarative recomputation can repair it", () => {
  const filePath = path.join(fixturesDir, "valid/run-manifest-final-local.json");
  const invalidManifest = requireRecord(readJsonFile(filePath), filePath);
  invalidManifest.digest = "0".repeat(64);

  assert.throws(
    () =>
      materializeObject(
        {
          value: invalidManifest,
          mergePatch: {
            retention: {
              effectivePolicy: "run-only",
            },
          },
          digestTargets: [""],
        },
        "invalid-raw-digest",
      ),
    /support object must pass the public parser.*digest_mismatch.*\$\.digest/,
  );
});

test("restricts digest targets to recognized self-digest-bearing protocol records", () => {
  const runPath = path.join(fixturesDir, "valid/research-run.json");
  const run = requireRecord(readJsonFile(runPath), runPath);
  assert.throws(
    () => materializeObject({ value: run, digestTargets: [""] }, "research-run-root"),
    /digestTargets\[0\].*does not identify a recognized self-digest-bearing protocol object/,
  );

  const manifestPath = path.join(fixturesDir, "valid/run-manifest-final-local.json");
  const manifest = requireRecord(readJsonFile(manifestPath), manifestPath);
  assert.throws(
    () =>
      materializeObject(
        {
          value: manifest,
          mergePatch: {
            retention: {
              digest: "0".repeat(64),
            },
          },
          digestTargets: ["/retention"],
        },
        "manifest-retention-record",
      ),
    /digestTargets\[0\].*does not identify a recognized self-digest-bearing protocol object/,
  );
  assert.throws(
    () =>
      materializeObject(
        {
          value: manifest,
          mergePatch: {
            digest: "not-a-digest",
          },
          digestTargets: [""],
        },
        "invalid-target-digest",
      ),
    /digestTargets\[0\].*must already contain a valid digest field/,
  );
  assert.throws(
    () =>
      materializeObject(
        {
          value: manifest,
          mergePatch: {
            digest: null,
          },
          digestTargets: [""],
        },
        "missing-target-digest",
      ),
    /digestTargets\[0\].*must already contain a valid digest field/,
  );
});

test("classifies only top-level corpora and direct JSON support objects under objects", () => {
  assert.equal(classifyScenarioTreeEntry("model-task-result.scenario.json", "file"), "corpus");
  assert.equal(classifyScenarioTreeEntry("objects", "directory"), "directory");
  assert.equal(classifyScenarioTreeEntry("objects/base.json", "file"), "support");

  assert.throws(
    () => classifyScenarioTreeEntry("nested/base.json", "file"),
    /JSON file is outside the objects directory/,
  );
  assert.throws(
    () => classifyScenarioTreeEntry("notes.txt", "file"),
    /unexpected file extension/,
  );
  assert.throws(
    () => classifyScenarioTreeEntry("extra", "directory"),
    /unexpected directory/,
  );
  assert.throws(
    () => classifyScenarioTreeEntry("objects/nested", "directory"),
    /unexpected directory/,
  );
  assert.throws(
    () => classifyScenarioTreeEntry("objects/nested/base.json", "file"),
    /nested support object/,
  );
  assert.throws(
    () => classifyScenarioTreeEntry("objects/link.json", "symlink"),
    /symlinks are not allowed/,
  );
  assert.throws(
    () => classifyScenarioTreeEntry("objects/socket.json", "other"),
    /must be a regular file or directory/,
  );
});

test("rejects nested directories, unexpected files, and a missing objects directory", () => {
  withTemporaryDirectory((temporaryDirectory) => {
    const scenarioRoot = path.join(temporaryDirectory, "scenarios");
    mkdirSync(path.join(scenarioRoot, "objects"), { recursive: true });
    mkdirSync(path.join(scenarioRoot, "nested"), { recursive: true });
    writeFileSync(path.join(scenarioRoot, "nested", "hidden.scenario.json"), "{}\n");
    assert.throws(() => inventoryScenarioTree(scenarioRoot), /nested: unexpected directory/);
  });

  withTemporaryDirectory((temporaryDirectory) => {
    const scenarioRoot = path.join(temporaryDirectory, "scenarios");
    mkdirSync(path.join(scenarioRoot, "objects", "nested"), { recursive: true });
    writeFileSync(path.join(scenarioRoot, "objects", "nested", "hidden.json"), "{}\n");
    assert.throws(
      () => inventoryScenarioTree(scenarioRoot),
      /objects\/nested: unexpected directory/,
    );
  });

  withTemporaryDirectory((temporaryDirectory) => {
    const scenarioRoot = path.join(temporaryDirectory, "scenarios");
    mkdirSync(path.join(scenarioRoot, "objects"), { recursive: true });
    writeFileSync(path.join(scenarioRoot, "unexpected.json"), "{}\n");
    assert.throws(
      () => inventoryScenarioTree(scenarioRoot),
      /unexpected\.json: JSON file is outside the objects directory/,
    );
  });

  withTemporaryDirectory((temporaryDirectory) => {
    const scenarioRoot = path.join(temporaryDirectory, "scenarios");
    mkdirSync(scenarioRoot, { recursive: true });
    writeFileSync(path.join(scenarioRoot, "only.scenario.json"), "{}\n");
    assert.throws(() => inventoryScenarioTree(scenarioRoot), /required objects directory/);
  });
});

test("rejects symlink entries in isolated scenario trees", (context) => {
  withTemporaryDirectory((temporaryDirectory) => {
    const scenarioRoot = path.join(temporaryDirectory, "scenarios");
    const targetPath = path.join(temporaryDirectory, "target.json");
    mkdirSync(path.join(scenarioRoot, "objects"), { recursive: true });
    writeFileSync(targetPath, "{}\n");
    if (
      !createSymlinkOrSkip(
        context,
        targetPath,
        path.join(scenarioRoot, "objects", "linked.json"),
        "file",
      )
    ) {
      return;
    }
    assert.throws(() => inventoryScenarioTree(scenarioRoot), /symlinks are not allowed/);
  });
});

test("rejects non-portable fixture references before filesystem lookup", () => {
  for (const [fixture, expected] of [
    [path.join(fixturesDir, "valid/model-task.json"), /relative POSIX path/],
    ["C:/checkout/model-task.json", /relative POSIX path/],
    ["C:checkout/model-task.json", /platform-specific path syntax/],
    ["valid\\model-task.json", /POSIX separators/],
    ["./valid/model-task.json", /dot or traversal segments/],
    ["valid/../valid/model-task.json", /dot or traversal segments/],
    ["valid//model-task.json", /empty segments/],
    ["valid/model-task.json/", /empty segments/],
    ["%2e%2e/valid/model-task.json", /percent-encoded path syntax/],
    ["valid%2fmodel-task.json", /percent-encoded path syntax/],
    ["valid%5Cmodel-task.json", /percent-encoded path syntax/],
    ["valid/model-task.json\0", /NUL bytes/],
    ["valid/model-task.txt", /end in \.json/],
  ] as const) {
    assert.throws(
      () => resolveFixturePath(fixture, `fixture ${JSON.stringify(fixture)}`),
      expected,
    );
  }

  assert.equal(
    resolveFixturePath("valid/model-task.json", "portable.fixture"),
    path.join(fixturesDir, "valid/model-task.json"),
  );
  assert.equal(
    resolveFixturePath(
      "scenarios/objects/completed-deletion-run.json",
      "shared-object.fixture",
    ),
    path.join(fixturesDir, "scenarios/objects/completed-deletion-run.json"),
  );

  withTemporaryDirectory((temporaryDirectory) => {
    const isolatedFixtures = path.join(temporaryDirectory, "fixtures");
    mkdirSync(path.join(isolatedFixtures, "valid"), { recursive: true });
    writeFileSync(path.join(isolatedFixtures, "valid", "model-task.json"), "{}\n");
    assert.equal(
      resolveFixturePath("valid/model-task.json", "isolated.fixture", isolatedFixtures),
      path.join(isolatedFixtures, "valid", "model-task.json"),
    );
  });
});

test("rejects an inventoried support object not referenced by any corpus", () => {
  withTemporaryDirectory((temporaryDirectory) => {
    const isolatedFixtures = path.join(temporaryDirectory, "fixtures");
    const scenarioRoot = path.join(isolatedFixtures, "scenarios");
    const objectsDirectory = path.join(scenarioRoot, "objects");
    mkdirSync(objectsDirectory, { recursive: true });
    writeFileSync(path.join(scenarioRoot, "corpus.scenario.json"), "{}\n");
    writeFileSync(path.join(objectsDirectory, "used.json"), "{}\n");
    writeFileSync(path.join(objectsDirectory, "orphan.json"), "{}\n");

    const inventory = inventoryScenarioTree(scenarioRoot);
    const corpus: ScenarioCorpus = {
      filePath: path.join(scenarioRoot, "corpus.scenario.json"),
      family: "model-task-result",
      objects: {
        used: { fixture: "scenarios/objects/used.json" },
      },
      scenarios: [],
    };
    const references = collectFixtureReferences([corpus], isolatedFixtures);
    assert.throws(
      () =>
        assertSupportObjectsReferenced(
          inventory.supportObjectFiles.map((file) => file.relativePath),
          references,
          scenarioRoot,
        ),
      /objects\/orphan\.json: support object is not referenced by any corpus/,
    );
  });
});

test("rejects an intermediate fixture symlink escape", (context) => {
  withTemporaryDirectory((temporaryDirectory) => {
    const isolatedFixtures = path.join(temporaryDirectory, "fixtures");
    const outsideDirectory = path.join(temporaryDirectory, "outside");
    mkdirSync(isolatedFixtures, { recursive: true });
    mkdirSync(outsideDirectory, { recursive: true });
    writeFileSync(path.join(outsideDirectory, "escaped.json"), "{}\n");
    if (
      !createSymlinkOrSkip(
        context,
        outsideDirectory,
        path.join(isolatedFixtures, "escape"),
        "dir",
      )
    ) {
      return;
    }
    assert.throws(
      () => resolveFixturePath("escape/escaped.json", "escaped.fixture", isolatedFixtures),
      /fixture path component escape is a symlink/,
    );
  });
});

test("rejects a final fixture file symlink", (context) => {
  withTemporaryDirectory((temporaryDirectory) => {
    const isolatedFixtures = path.join(temporaryDirectory, "fixtures");
    const targetPath = path.join(temporaryDirectory, "target.json");
    mkdirSync(isolatedFixtures, { recursive: true });
    writeFileSync(targetPath, "{}\n");
    if (
      !createSymlinkOrSkip(
        context,
        targetPath,
        path.join(isolatedFixtures, "linked.json"),
        "file",
      )
    ) {
      return;
    }
    assert.throws(
      () => resolveFixturePath("linked.json", "linked.fixture", isolatedFixtures),
      /fixture path component linked\.json is a symlink/,
    );
  });
});

test("rejects a fixture root symlink", (context) => {
  withTemporaryDirectory((temporaryDirectory) => {
    const actualFixtures = path.join(temporaryDirectory, "actual-fixtures");
    const linkedFixtures = path.join(temporaryDirectory, "linked-fixtures");
    mkdirSync(actualFixtures, { recursive: true });
    writeFileSync(path.join(actualFixtures, "fixture.json"), "{}\n");
    if (!createSymlinkOrSkip(context, actualFixtures, linkedFixtures, "dir")) {
      return;
    }
    assert.throws(
      () => resolveFixturePath("fixture.json", "root-link.fixture", linkedFixtures),
      /fixture root must not be a symlink/,
    );
  });
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

test("validates optional and event-array input roles before honoring a parse failure", () => {
  const corpus = corpora.find(
    (candidate) => candidate.family === "research-run-context-pack",
  );
  assert.ok(corpus);
  const scenario = corpus.scenarios.find(
    (candidate) => candidate.id === "research-run.contextless-manifest-lengthening",
  );
  assert.ok(scenario && !scenario.expected.ok && scenario.expected.stage === "parse");

  assert.throws(
    () =>
      executeScenario(corpus, {
        ...scenario,
        inputs: {
          ...scenario.inputs,
          contextPack: "matching-run",
        },
      }),
    /input contextPack.*opencoven\.context-pack\/v1/i,
  );

  const eventCorpus = corpora.find(
    (candidate) => candidate.family === "run-event-deletion",
  );
  const parseFailingRun = corpus.objects["contextless-lengthened-run"];
  assert.ok(eventCorpus);
  assert.ok(parseFailingRun);
  const malformedEventCorpus: ScenarioCorpus = {
    ...eventCorpus,
    objects: {
      ...eventCorpus.objects,
      "parse-failing-run": parseFailingRun,
    },
  };
  assert.throws(
    () =>
      executeScenario(malformedEventCorpus, {
        id: "run-deletion.malformed-event-role",
        description: "An expected run parse failure must not hide a malformed event role.",
        validator: "run-event-deletion",
        inputs: {
          run: "parse-failing-run",
          events: ["completed-deletion-run"],
        },
        expected: scenario.expected,
      }),
    /input events\[0\].*opencoven\.run-event\/v1/i,
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
    "manifest.active-shortening",
    "manifest.lengthening-without-fresh-consent",
    "manifest.lengthening-with-fresh-consent",
    "manifest.contextless-lengthening-with-fresh-context-consent",
    "manifest.scheduled-project-restoration-with-fresh-consent",
    "manifest.scheduled-project-restoration-without-fresh-consent",
    "manifest.scheduled-project-restoration-with-stale-consent",
    "manifest.scheduled-project-restoration-above-consent",
    "manifest.pending-project-restoration-with-fresh-consent",
    "manifest.partial-failure-continues",
    "manifest.deadline-2099",
    "manifest.deadline-cleared",
    "manifest.deletion-cancellation",
    "manifest.deadline-shortening",
    "manifest.deadline-extension-without-fresh-consent",
    "manifest.deadline-extension-with-stale-consent",
    "manifest.deadline-extension-with-fresh-consent",
    "manifest.deadline-extension-exceeds-fresh-ceiling",
    "manifest.completed-deletion-terminal",
    "manifest-consent.valid-context-consent",
    "manifest-consent.missing-context-consent",
    "manifest-consent.retention-above-consent",
    "manifest-consent.contextless-without-consent",
    "research-run.valid-context-pack",
    "research-run.missing-context-pack",
    "research-run.contextless-without-pack",
    "research-run.contextless-with-pack",
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
    "run-events.valid-sequence",
    "run-events.empty-sequence",
    "run-events.gapped-sequence",
    "run-events.mixed-run-sequence",
  ]) {
    assert.ok(allScenarioIds.has(requiredId), `missing required scenario: ${requiredId}`);
  }
});
