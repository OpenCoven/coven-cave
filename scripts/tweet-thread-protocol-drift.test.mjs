import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";

import {
  ThreadBriefSchema,
  ThreadCandidateSchema,
  ThreadRunManifestSchema,
  ThreadScorecardSchema,
} from "../src/lib/tweet-thread-protocol.ts";
import {
  checkProtocolSchemas,
  serializeProtocolSchema,
  writeProtocolSchemas,
} from "./generate-tweet-thread-protocol.mjs";

const schemaFiles = new Map([
  ["thread-brief.schema.json", ThreadBriefSchema],
  ["thread-candidate.schema.json", ThreadCandidateSchema],
  ["thread-scorecard.schema.json", ThreadScorecardSchema],
  ["thread-run-manifest.schema.json", ThreadRunManifestSchema],
]);

const outputDirectory = new URL(
  "../marketplace/plugins/tweet-thread-lab/skills/tweet-thread-lab/references/schemas/",
  import.meta.url,
);

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
    readdirSync(generatedDirectory).some((filename) => filename.includes(".tmp-")),
    false,
    "successful generation must leave no temporary files",
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

  mkdirSync(new URL("thread-candidate.schema.json/", failureDirectory), {
    recursive: true,
  });
  assert.throws(
    () => writeProtocolSchemas(failureDirectory),
    "generation must surface an atomic rename failure",
  );
  assert.equal(
    readdirSync(failureDirectory).some((filename) => filename.includes(".tmp-")),
    false,
    "failed generation must clean up temporary files",
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
