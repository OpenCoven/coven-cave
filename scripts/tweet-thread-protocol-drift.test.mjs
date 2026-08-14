import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";

import {
  ThreadBriefSchema,
  ThreadCandidateSchema,
  ThreadRunManifestSchema,
  ThreadScorecardSchema,
  ThreadValidationRecordSchema,
} from "../src/lib/tweet-thread-protocol.ts";
import { BlindedThreadScorecardSchema } from "../src/lib/tweet-thread-blinding.ts";
import { Value } from "typebox/value";
import {
  checkProtocolSchemas,
  serializeProtocolSchema,
  writeProtocolSchemas,
} from "./generate-tweet-thread-protocol.mjs";

const schemaFiles = new Map([
  ["blinded-thread-scorecard.schema.json", BlindedThreadScorecardSchema],
  ["thread-brief.schema.json", ThreadBriefSchema],
  ["thread-candidate.schema.json", ThreadCandidateSchema],
  ["thread-validation-record.schema.json", ThreadValidationRecordSchema],
  ["thread-scorecard.schema.json", ThreadScorecardSchema],
  ["thread-run-manifest.schema.json", ThreadRunManifestSchema],
]);

const outputDirectory = new URL(
  "../marketplace/plugins/tweet-thread-lab/skills/tweet-thread-lab/references/schemas/",
  import.meta.url,
);
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const gitAttributes = readFileSync(new URL("../.gitattributes", import.meta.url), "utf8");
const validationCoreSource = readFileSync(
  new URL("../src/lib/tweet-thread-validation-core.ts", import.meta.url),
  "utf8",
);
const validationWrapperSource = readFileSync(
  new URL("../src/lib/tweet-thread-validation.ts", import.meta.url),
  "utf8",
);

assert.doesNotMatch(
  validationCoreSource,
  /from\s+["']\.\/tweet-thread-protocol\.ts["']/,
  "the deterministic validation core is acyclic and does not import the canonical protocol module",
);
assert.match(
  validationWrapperSource,
  /from\s+["']\.\/tweet-thread-validation-core\.ts["']/,
  "the public validator wraps the shared deterministic validation core",
);

assert.equal(
  packageJson.dependencies?.canonicalize,
  "3.0.0",
  "candidate hashing must pin the maintained RFC 8785/JCS implementation",
);
for (const rule of [
  "marketplace/plugins/tweet-thread-lab/bin/tweet-thread-validate.mjs text eol=lf",
  "marketplace/plugins/tweet-thread-lab/skills/tweet-thread-lab/SKILL.md text eol=lf",
  "marketplace/plugins/tweet-thread-lab/skills/tweet-thread-lab/references/*.md text eol=lf",
  "marketplace/plugins/tweet-thread-lab/skills/tweet-thread-lab/references/schemas/*.json text eol=lf",
  "workflows/optimize-tweet-thread.yaml text eol=lf",
  "workflows/optimize-tweet-thread.cave.json text eol=lf",
]) {
  assert.ok(gitAttributes.split(/\r?\n/u).includes(rule), `.gitattributes must include: ${rule}`);
}

function sortJsonKeys(value) {
  if (Array.isArray(value)) return value.map(sortJsonKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJsonKeys(value[key])]),
  );
}

function serializeSchema(schema) {
  return `${JSON.stringify(sortJsonKeys(schema), null, 2)}\n`;
}

assert.equal(
  serializeProtocolSchema({ z: 1, nested: { b: 2, a: 1 }, array: [{ b: 2, a: 1 }, 3] }),
  '{\n  "array": [\n    {\n      "a": 1,\n      "b": 2\n    },\n    3\n  ],\n  "nested": {\n    "a": 1,\n    "b": 2\n  },\n  "z": 1\n}\n',
  "schema serialization must sort object keys recursively without reordering arrays",
);

const scratchRoot = new URL(`.tweet-thread-protocol-test-${process.pid}/`, import.meta.url);
const missingDirectory = new URL("missing/", scratchRoot);
const generatedDirectory = new URL("generated/", scratchRoot);
const failureDirectory = new URL("failure/", scratchRoot);
const missingRollbackDirectory = new URL("missing-rollback/", scratchRoot);
const rollbackFailureDirectory = new URL("rollback-failure/", scratchRoot);

function seedSentinelSchemas(directory, filenames = [...schemaFiles.keys()]) {
  mkdirSync(directory, { recursive: true });
  return new Map(
    filenames.map((filename, index) => {
      const bytes = Buffer.from(`sentinel-${index}-${filename}\0`, "utf8");
      writeFileSync(new URL(filename, directory), bytes);
      return [filename, bytes];
    }),
  );
}

function assertSchemaBytes(directory, expectedFiles) {
  for (const [filename, expectedBytes] of expectedFiles) {
    assert.deepEqual(
      readFileSync(new URL(filename, directory)),
      expectedBytes,
      `${filename} must be restored byte-for-byte after publication fails`,
    );
  }
}

function assertNoTransactionFiles(directory) {
  assert.deepEqual(
    readdirSync(directory).filter(
      (filename) => filename.includes(".tmp-") || filename.includes(".bak-"),
    ),
    [],
    "failed generation must clean up every temporary and backup file",
  );
}

function failSecondInstall() {
  const injectedError = new Error("injected second schema install failure");
  let installedFiles = 0;
  return {
    injectedError,
    operations: {
      rename(source, destination) {
        if (source.pathname.includes(".tmp-")) {
          if (installedFiles === 1) throw injectedError;
          installedFiles += 1;
        }
        renameSync(source, destination);
      },
    },
    installedFiles: () => installedFiles,
  };
}

function failSecondInstallAndRollbackRemoval() {
  const failure = failSecondInstall();
  const rollbackError = new Error("injected rollback removal failure");
  const firstSchemaFilename = schemaFiles.keys().next().value;
  let removalFailed = false;
  return {
    ...failure,
    rollbackError,
    operations: {
      ...failure.operations,
      remove(target) {
        if (!removalFailed && target.pathname.endsWith(firstSchemaFilename)) {
          removalFailed = true;
          throw rollbackError;
        }
        rmSync(target, { recursive: true, force: true });
      },
    },
  };
}

rmSync(scratchRoot, { recursive: true, force: true });
try {
  assert.deepEqual(
    checkProtocolSchemas(missingDirectory),
    [...schemaFiles.keys()].map((filename) => ({ filename, status: "missing" })),
    "check mode must report every missing schema",
  );
  assert.equal(
    existsSync(missingDirectory),
    false,
    "check mode must not create the output directory",
  );

  writeProtocolSchemas(generatedDirectory);
  assert.deepEqual(
    checkProtocolSchemas(generatedDirectory),
    [],
    "freshly generated schemas must pass check mode",
  );
  assert.equal(
    readdirSync(generatedDirectory).some(
      (filename) => filename.includes(".tmp-") || filename.includes(".bak-"),
    ),
    false,
    "successful generation must leave no temporary or backup files",
  );

  const driftedFile = new URL("thread-scorecard.schema.json", generatedDirectory);
  writeFileSync(driftedFile, "{}\n");
  const beforeCheck = readFileSync(driftedFile, "utf8");
  assert.deepEqual(
    checkProtocolSchemas(generatedDirectory),
    [{ filename: "thread-scorecard.schema.json", status: "drifted" }],
    "check mode must identify drifted schemas by filename",
  );
  assert.equal(
    readFileSync(driftedFile, "utf8"),
    beforeCheck,
    "check mode must not rewrite drifted files",
  );

  const originalFiles = seedSentinelSchemas(failureDirectory);
  const existingFailure = failSecondInstall();
  let publicationError;
  try {
    writeProtocolSchemas(failureDirectory, existingFailure.operations);
  } catch (error) {
    publicationError = error;
  }
  assertSchemaBytes(failureDirectory, originalFiles);
  assert.equal(
    existingFailure.installedFiles(),
    1,
    "failure injection must occur after one new schema has been installed",
  );
  assert.equal(
    publicationError,
    existingFailure.injectedError,
    "generation must surface the original publication failure",
  );
  assertNoTransactionFiles(failureDirectory);

  const [missingFilename, ...existingFilenames] = schemaFiles.keys();
  const missingStateFiles = seedSentinelSchemas(
    missingRollbackDirectory,
    existingFilenames,
  );
  const missingFailure = failSecondInstall();
  assert.throws(
    () => writeProtocolSchemas(missingRollbackDirectory, missingFailure.operations),
    (error) => error === missingFailure.injectedError,
    "generation must surface a failure after installing a previously missing schema",
  );
  assert.equal(
    missingFailure.installedFiles(),
    1,
    "missing-state rollback must fail after one new schema has been installed",
  );
  assert.equal(
    existsSync(new URL(missingFilename, missingRollbackDirectory)),
    false,
    "rollback must remove a schema whose destination was missing before publication",
  );
  assertSchemaBytes(missingRollbackDirectory, missingStateFiles);
  assertNoTransactionFiles(missingRollbackDirectory);

  seedSentinelSchemas(rollbackFailureDirectory);
  const rollbackFailure = failSecondInstallAndRollbackRemoval();
  assert.throws(
    () => writeProtocolSchemas(rollbackFailureDirectory, rollbackFailure.operations),
    (error) =>
      error instanceof AggregateError &&
      error.errors.includes(rollbackFailure.injectedError) &&
      error.errors.includes(rollbackFailure.rollbackError) &&
      error.message.includes(rollbackFailure.injectedError.message) &&
      error.message.includes(rollbackFailure.rollbackError.message),
    "a rollback failure must report both the publication and rollback errors",
  );
} finally {
  rmSync(scratchRoot, { recursive: true, force: true });
}

for (const [filename, schema] of schemaFiles) {
  const fileUrl = new URL(filename, outputDirectory);
  let actual;
  try {
    actual = readFileSync(fileUrl, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      assert.fail(
        `${filename} is missing — run \`pnpm protocol:tweet-thread\` and commit the generated file.`,
      );
    }
    throw error;
  }
  assert.equal(
    actual,
    serializeSchema(schema),
    `${filename} drifted from src/lib/tweet-thread-protocol.ts — run \`pnpm protocol:tweet-thread\`.`,
  );
  assert.deepEqual(
    JSON.parse(actual),
    JSON.parse(JSON.stringify(schema)),
    `${filename} must preserve the complete standalone TypeBox schema contract.`,
  );
  assert.equal(
    actual.includes('"format": "url"'),
    false,
    `${filename} must use standards-compatible JSON Schema URI formats.`,
  );
}

const generatedBriefSchema = JSON.parse(
  readFileSync(new URL("thread-brief.schema.json", outputDirectory), "utf8"),
);
assert.equal(
  Value.Check(generatedBriefSchema, {
    protocolVersion: "opencoven.tweet-thread.v1",
    briefId: "brief-zero-weights",
    topic: "Zero weights",
    audience: "Schema reviewers",
    objectiveWeights: {
      factuality: 0,
      provenance: 0,
      accessibility: 0,
      voice: 0,
      coherence: 0,
      engagement: 0,
    },
    constraints: {
      minPosts: 1,
      maxPosts: 1,
      requiredClaimIds: [],
      bannedPhrases: [],
      requireAltText: false,
    },
  }),
  false,
  "the checked-in JSON Schema requires at least one positive objective weight",
);
