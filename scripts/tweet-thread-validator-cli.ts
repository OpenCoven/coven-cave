import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
} from "node:fs";

import { validateThreadCandidate } from "../src/lib/tweet-thread-validation.ts";

const USAGE = "Usage: node tweet-thread-validate.mjs validate <candidate.json> [brief.json]";
const MAX_INPUT_BYTES = 8 * 1024 * 1024;

class CliContractError extends Error {
  constructor(readonly safeMessage: string) {
    super(safeMessage);
    this.name = "CliContractError";
  }
}

function readJsonFile(label: "candidate" | "brief", filename: string): unknown {
  let handle: number | undefined;
  try {
    handle = openSync(filename, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch {
    throw new CliContractError(`${label} file could not be read.`);
  }
  try {
    let stat;
    try {
      stat = fstatSync(handle);
    } catch {
      throw new CliContractError(`${label} file could not be read.`);
    }
    if (!stat.isFile()) {
      throw new CliContractError(`${label} file must be a regular file.`);
    }
    if (stat.size > MAX_INPUT_BYTES) {
      throw new CliContractError(`${label} file exceeds the portable size limit.`);
    }

    const bounded = Buffer.allocUnsafe(MAX_INPUT_BYTES + 1);
    let total = 0;
    while (total <= MAX_INPUT_BYTES) {
      let read: number;
      try {
        read = readSync(handle, bounded, total, bounded.byteLength - total, null);
      } catch {
        throw new CliContractError(`${label} file could not be read.`);
      }
      if (read === 0) break;
      total += read;
    }
    if (total > MAX_INPUT_BYTES) {
      throw new CliContractError(`${label} file exceeds the portable size limit.`);
    }
    try {
      return JSON.parse(bounded.subarray(0, total).toString("utf8"));
    } catch {
      throw new CliContractError(`${label} JSON could not be parsed.`);
    }
  } finally {
    closeSync(handle);
  }
}

function readBrief(filename: string | undefined): unknown {
  if (filename === undefined) return undefined;
  return readJsonFile("brief", filename);
}

function run(): void {
  const [command, candidatePath, briefPath, ...extra] = process.argv.slice(2);
  if (
    command !== "validate"
    || candidatePath === undefined
    || extra.length > 0
  ) {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 2;
    return;
  }

  try {
    const candidate = readJsonFile("candidate", candidatePath);
    const brief = readBrief(briefPath);
    const result = validateThreadCandidate(candidate, brief);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.accepted ? 0 : 1;
  } catch (error) {
    const message = error instanceof CliContractError
      ? error.safeMessage
      : "runtime contract error.";
    process.stderr.write(`tweet-thread-validate: ${message}\n`);
    process.exitCode = 2;
  }
}

run();
