import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
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

function defaultRemove(target) {
  rmSync(target, { recursive: true, force: true });
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function throwPublicationError(publicationError, rollbackErrors) {
  if (rollbackErrors.length === 0) throw publicationError;
  throw new AggregateError(
    [publicationError, ...rollbackErrors],
    `Tweet thread protocol schema publication failed: ${errorMessage(publicationError)}; rollback also failed: ${rollbackErrors.map(errorMessage).join("; ")}`,
    { cause: publicationError },
  );
}

export function writeProtocolSchemas(
  outputDirectory = PROTOCOL_SCHEMA_DIRECTORY,
  fileOperations = {},
) {
  const rename = fileOperations.rename ?? renameSync;
  const remove = fileOperations.remove ?? defaultRemove;
  mkdirSync(outputDirectory, { recursive: true });
  const files = [...PROTOCOL_SCHEMA_FILES].map(([filename, schema]) => ({
    backupCreated: false,
    backupUrl: new URL(
      `.${filename}.bak-${process.pid}-${randomUUID()}`,
      outputDirectory,
    ),
    destinationExisted: existsSync(new URL(filename, outputDirectory)),
    destinationUrl: new URL(filename, outputDirectory),
    installed: false,
    schema,
    temporaryUrl: new URL(
      `.${filename}.tmp-${process.pid}-${randomUUID()}`,
      outputDirectory,
    ),
  }));

  try {
    for (const file of files) {
      writeFileSync(
        file.temporaryUrl,
        serializeProtocolSchema(file.schema),
        "utf8",
      );
    }
  } catch (error) {
    const cleanupErrors = [];
    for (const file of files) {
      if (!existsSync(file.temporaryUrl)) continue;
      try {
        remove(file.temporaryUrl);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    throwPublicationError(error, cleanupErrors);
  }

  try {
    for (const file of files) {
      if (!file.destinationExisted) continue;
      rename(file.destinationUrl, file.backupUrl);
      file.backupCreated = true;
    }
    for (const file of files) {
      rename(file.temporaryUrl, file.destinationUrl);
      file.installed = true;
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const file of files.toReversed()) {
      if (!file.installed || !existsSync(file.destinationUrl)) continue;
      try {
        remove(file.destinationUrl);
        file.installed = false;
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    for (const file of files.toReversed()) {
      if (!file.backupCreated || !existsSync(file.backupUrl)) continue;
      try {
        rename(file.backupUrl, file.destinationUrl);
        file.backupCreated = false;
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    for (const file of files) {
      if (!existsSync(file.temporaryUrl)) continue;
      try {
        remove(file.temporaryUrl);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    throwPublicationError(error, rollbackErrors);
  }

  const cleanupErrors = [];
  for (const file of files) {
    if (!file.backupCreated || !existsSync(file.backupUrl)) continue;
    try {
      remove(file.backupUrl);
      file.backupCreated = false;
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      `Tweet thread protocol schemas were published, but backup cleanup failed: ${cleanupErrors.map(errorMessage).join("; ")}`,
    );
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
