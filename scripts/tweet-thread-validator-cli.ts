import { readFileSync } from "node:fs";

import {
  normalizeThreadBrief,
} from "../src/lib/tweet-thread-protocol.ts";
import type { ThreadBrief } from "../src/lib/tweet-thread-protocol.ts";
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
  let bytes: Buffer;
  try {
    bytes = readFileSync(filename);
  } catch {
    throw new CliContractError(`${label} file could not be read.`);
  }
  if (bytes.byteLength > MAX_INPUT_BYTES) {
    throw new CliContractError(`${label} file exceeds the portable size limit.`);
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new CliContractError(`${label} JSON could not be parsed.`);
  }
}

function readBrief(filename: string | undefined): ThreadBrief | undefined {
  if (filename === undefined) return undefined;
  try {
    return normalizeThreadBrief(readJsonFile("brief", filename));
  } catch (error) {
    if (error instanceof CliContractError) throw error;
    throw new CliContractError("brief JSON does not match the protocol contract.");
  }
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
