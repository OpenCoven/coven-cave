import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY_POINT = path.join(ROOT, "scripts", "tweet-thread-validator-cli.ts");
const PUNYCODE_ENTRY_POINT = createRequire(import.meta.url).resolve("punycode/");
export const VALIDATOR_BUNDLE_PATH = path.join(
  ROOT,
  "marketplace",
  "plugins",
  "tweet-thread-lab",
  "bin",
  "tweet-thread-validate.mjs",
);

export async function generateTweetThreadValidatorBundle() {
  const result = await build({
    absWorkingDir: ROOT,
    alias: {
      punycode: PUNYCODE_ENTRY_POINT,
    },
    banner: {
      js: 'import { createRequire as __tweetThreadCreateRequire } from "node:module"; const require = __tweetThreadCreateRequire(import.meta.url);',
    },
    bundle: true,
    charset: "utf8",
    entryPoints: [ENTRY_POINT],
    format: "esm",
    legalComments: "none",
    logLevel: "silent",
    minify: false,
    platform: "node",
    sourcemap: false,
    target: "node24",
    treeShaking: true,
    write: false,
  });
  if (result.outputFiles.length !== 1) {
    throw new Error("Expected esbuild to produce exactly one validator bundle.");
  }
  return Buffer.from(result.outputFiles[0].contents);
}

export async function checkTweetThreadValidatorBundle(
  outputPath = VALIDATOR_BUNDLE_PATH,
) {
  const expected = await generateTweetThreadValidatorBundle();
  let actual;
  try {
    actual = readFileSync(outputPath);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  return actual.equals(expected);
}

export async function writeTweetThreadValidatorBundle(
  outputPath = VALIDATOR_BUNDLE_PATH,
) {
  const bytes = await generateTweetThreadValidatorBundle();
  mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath)}.tmp-${process.pid}-${randomUUID()}`,
  );
  try {
    writeFileSync(temporaryPath, bytes, { flag: "wx" });
    renameSync(temporaryPath, outputPath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

async function runCli() {
  const checkOnly = process.argv.slice(2).includes("--check");
  if (checkOnly) {
    if (!await checkTweetThreadValidatorBundle()) {
      console.error(
        "Tweet thread validator bundle is missing or drifted. Run `pnpm protocol:tweet-thread:validator` and commit the result.",
      );
      process.exitCode = 1;
      return;
    }
    console.log("Tweet thread validator bundle is current.");
    return;
  }
  await writeTweetThreadValidatorBundle();
  console.log(
    "generated marketplace/plugins/tweet-thread-lab/bin/tweet-thread-validate.mjs",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
