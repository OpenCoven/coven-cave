import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import {
  ThreadBriefSchema,
  ThreadCandidateSchema,
  ThreadRunManifestSchema,
  ThreadScorecardSchema,
} from "../src/lib/tweet-thread-protocol.ts";

export const PROTOCOL_SCHEMA_FILES = new Map([
  ["thread-brief.schema.json", ThreadBriefSchema],
  ["thread-candidate.schema.json", ThreadCandidateSchema],
  ["thread-scorecard.schema.json", ThreadScorecardSchema],
  ["thread-run-manifest.schema.json", ThreadRunManifestSchema],
]);

export const PROTOCOL_SCHEMA_DIRECTORY = new URL(
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

export function serializeProtocolSchema(schema) {
  return `${JSON.stringify(sortJsonKeys(schema), null, 2)}\n`;
}

export function checkProtocolSchemas(outputDirectory = PROTOCOL_SCHEMA_DIRECTORY) {
  const problems = [];
  for (const [filename, schema] of PROTOCOL_SCHEMA_FILES) {
    const fileUrl = new URL(filename, outputDirectory);
    let actual;
    try {
      actual = readFileSync(fileUrl, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") {
        problems.push({ filename, status: "missing" });
        continue;
      }
      throw error;
    }
    if (actual !== serializeProtocolSchema(schema)) {
      problems.push({ filename, status: "drifted" });
    }
  }
  return problems;
}

export function writeProtocolSchemas(outputDirectory = PROTOCOL_SCHEMA_DIRECTORY) {
  mkdirSync(outputDirectory, { recursive: true });
  const temporaryFiles = [];
  try {
    for (const [filename, schema] of PROTOCOL_SCHEMA_FILES) {
      const destinationUrl = new URL(filename, outputDirectory);
      const temporaryUrl = new URL(`.${filename}.tmp-${process.pid}-${randomUUID()}`, outputDirectory);
      temporaryFiles.push(temporaryUrl);
      writeFileSync(temporaryUrl, serializeProtocolSchema(schema), "utf8");
      renameSync(temporaryUrl, destinationUrl);
    }
  } catch (error) {
    for (const temporaryUrl of temporaryFiles) {
      if (existsSync(temporaryUrl)) unlinkSync(temporaryUrl);
    }
    throw error;
  }
}

function outputPath(filename) {
  return `marketplace/plugins/tweet-thread-lab/skills/tweet-thread-lab/references/schemas/${filename}`;
}

function runCli() {
  const checkOnly = process.argv.slice(2).includes("--check");
  if (checkOnly) {
    const problems = checkProtocolSchemas();
    if (problems.length > 0) {
      console.error("Tweet thread protocol schemas are missing or drifted:");
      for (const problem of problems) {
        console.error(`  ${problem.status}: ${outputPath(problem.filename)}`);
      }
      console.error("Run `pnpm protocol:tweet-thread` and commit the generated files.");
      process.exitCode = 1;
      return;
    }
    console.log("Tweet thread protocol schemas are current.");
    return;
  }

  writeProtocolSchemas();
  for (const filename of PROTOCOL_SCHEMA_FILES.keys()) {
    console.log(`generated ${outputPath(filename)}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
