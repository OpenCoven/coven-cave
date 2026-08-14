import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  TWEET_THREAD_PROTOCOL_VERSION,
  computeThreadCandidateSha256,
} from "../src/lib/tweet-thread-protocol.ts";
import {
  checkTweetThreadValidatorBundle,
  writeTweetThreadValidatorBundle,
} from "./build-tweet-thread-validator.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE = path.join(
  ROOT,
  "marketplace",
  "plugins",
  "tweet-thread-lab",
  "bin",
  "tweet-thread-validate.mjs",
);
const SCRATCH = path.join(ROOT, "scripts", `.tweet-thread-validator-test-${process.pid}`);
const packageJson = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));

assert.equal(
  packageJson.scripts?.["protocol:tweet-thread:validator"],
  "node scripts/build-tweet-thread-validator.mjs",
);
assert.equal(
  packageJson.scripts?.["protocol:tweet-thread:validator:check"],
  "node scripts/build-tweet-thread-validator.mjs --check",
);

function run(command, args, cwd = ROOT, timeout = undefined) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout,
    env: {
      ...process.env,
      NODE_PATH: "",
    },
  });
}

const check = run("pnpm", ["protocol:tweet-thread:validator:check"]);
assert.equal(check.status, 0, check.stderr);
const committedBundle = readFileSync(BUNDLE);

rmSync(SCRATCH, { recursive: true, force: true });
mkdirSync(SCRATCH, { recursive: true });
const scratchBundle = path.join(SCRATCH, "tweet-thread-validate.mjs");
await writeTweetThreadValidatorBundle(scratchBundle);
assert.deepEqual(
  readFileSync(scratchBundle),
  committedBundle,
  "a scratch build matches the committed validator byte-for-byte",
);
await writeTweetThreadValidatorBundle(scratchBundle);
assert.deepEqual(
  readFileSync(scratchBundle),
  committedBundle,
  "validator bundle generation is byte-deterministic",
);
writeFileSync(scratchBundle, "\n// stale\n", { flag: "a" });
assert.equal(
  await checkTweetThreadValidatorBundle(scratchBundle),
  false,
  "a stale bundle fails the same check used for the committed artifact",
);
assert.equal(
  readdirSync(path.dirname(BUNDLE)).some((name) => name.includes(".tmp-")),
  false,
  "atomic validator builds leave no temporary files",
);

function candidateContent() {
  return {
    protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
    candidateId: "candidate-portable-cli",
    brief: {
      protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
      briefId: "brief-portable-cli",
      topic: "Portable validator",
      audience: "Installed plugin users",
      objectiveWeights: {
        factuality: 1,
        provenance: 1,
        accessibility: 1,
        voice: 1,
        coherence: 1,
        engagement: 1,
      },
      constraints: {
        minPosts: 1,
        maxPosts: 2,
        requiredClaimIds: ["claim-portable-cli"],
        bannedPhrases: ["forbidden phrase"],
        requireAltText: false,
      },
    },
    voiceProfile: {
      protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
      voiceProfileId: "voice-portable-cli",
      displayName: "Portable CLI",
      tone: "Direct and exact",
      do: ["Cite the evidence"],
      dont: ["Overstate"],
    },
    evidence: [{
      protocolVersion: TWEET_THREAD_PROTOCOL_VERSION,
      evidenceId: "evidence-portable-cli",
      claimId: "claim-portable-cli",
      summary: "The checked-in bundle performs local deterministic validation.",
      sourceLabel: "Protocol contract",
      sourceUrl: "https://example.com/protocol",
      retrievedAt: "2026-08-14T12:00:00.000Z",
    }],
    posts: [{
      postId: "post-1",
      text: "The portable validator runs locally before approval.",
      claimIds: ["claim-portable-cli"],
    }],
    generatedAt: "2026-08-14T12:00:00.000Z",
  };
}

function candidate() {
  const content = candidateContent();
  return {
    ...content,
    candidateSha256: computeThreadCandidateSha256(content),
  };
}

try {
  const isolatedPlugin = path.join(SCRATCH, "tweet-thread-lab");
  const isolatedBin = path.join(isolatedPlugin, "bin");
  mkdirSync(isolatedBin, { recursive: true });
  copyFileSync(BUNDLE, path.join(isolatedBin, "tweet-thread-validate.mjs"));
  assert.equal(
    readdirSync(isolatedPlugin).includes("node_modules"),
    false,
    "the isolated plugin fixture has no dependency tree",
  );

  const acceptedPath = path.join(isolatedPlugin, "accepted.json");
  const briefPath = path.join(isolatedPlugin, "brief.json");
  writeFileSync(acceptedPath, `${JSON.stringify(candidate())}\n`);
  writeFileSync(briefPath, `${JSON.stringify(candidate().brief)}\n`);
  const accepted = run(
    process.execPath,
    ["bin/tweet-thread-validate.mjs", "validate", "accepted.json", "brief.json"],
    isolatedPlugin,
  );
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(accepted.stderr, "");
  const acceptedResult = JSON.parse(accepted.stdout);
  assert.equal(acceptedResult.accepted, true);
  assert.equal(acceptedResult.candidateSha256, candidate().candidateSha256);
  assert.equal(accepted.stdout, `${JSON.stringify(acceptedResult)}\n`);

  const whitespaceCandidate = candidate();
  whitespaceCandidate.brief.topic = "  Portable validator  ";
  whitespaceCandidate.candidateSha256 =
    computeThreadCandidateSha256(whitespaceCandidate);
  writeFileSync(
    path.join(isolatedPlugin, "whitespace-candidate.json"),
    `${JSON.stringify(whitespaceCandidate)}\n`,
  );
  writeFileSync(
    path.join(isolatedPlugin, "whitespace-brief.json"),
    `${JSON.stringify(whitespaceCandidate.brief)}\n`,
  );
  const whitespaceAccepted = run(
    process.execPath,
    [
      "bin/tweet-thread-validate.mjs",
      "validate",
      "whitespace-candidate.json",
      "whitespace-brief.json",
    ],
    isolatedPlugin,
  );
  assert.equal(whitespaceAccepted.status, 0, whitespaceAccepted.stderr);

  writeFileSync(path.join(isolatedPlugin, "false-brief.json"), "false\n");
  const falseBriefRejected = run(
    process.execPath,
    ["bin/tweet-thread-validate.mjs", "validate", "accepted.json", "false-brief.json"],
    isolatedPlugin,
  );
  assert.equal(falseBriefRejected.status, 1, falseBriefRejected.stderr);
  assert.ok(
    JSON.parse(falseBriefRejected.stdout).findings.some(
      (finding) => finding.code === "brief-mismatch",
    ),
  );

  const rejectedCandidate = candidate();
  rejectedCandidate.posts[0].text = "forbidden phrase";
  rejectedCandidate.candidateSha256 = computeThreadCandidateSha256(rejectedCandidate);
  writeFileSync(
    path.join(isolatedPlugin, "rejected.json"),
    `${JSON.stringify(rejectedCandidate)}\n`,
  );
  const rejected = run(
    process.execPath,
    ["bin/tweet-thread-validate.mjs", "validate", "rejected.json"],
    isolatedPlugin,
  );
  assert.equal(rejected.status, 1, rejected.stderr);
  assert.equal(rejected.stderr, "");
  const rejectedResult = JSON.parse(rejected.stdout);
  assert.equal(rejectedResult.accepted, false);
  assert.ok(rejectedResult.findings.some((finding) => finding.code === "banned-phrase"));

  writeFileSync(path.join(isolatedPlugin, "malformed.json"), "{not-json\n");
  const malformed = run(
    process.execPath,
    ["bin/tweet-thread-validate.mjs", "validate", "malformed.json"],
    isolatedPlugin,
  );
  assert.equal(malformed.status, 2);
  assert.equal(malformed.stdout, "");
  assert.match(malformed.stderr, /^tweet-thread-validate: candidate JSON could not be parsed\.\n$/);
  assert.equal(/SyntaxError|at file:|node_modules|malformed\.json/.test(malformed.stderr), false);

  const oversizedPath = path.join(isolatedPlugin, "oversized.json");
  const oversizedHandle = openSync(oversizedPath, "w");
  try {
    ftruncateSync(oversizedHandle, (8 * 1024 * 1024) + 1);
  } finally {
    closeSync(oversizedHandle);
  }
  const oversized = run(
    process.execPath,
    ["bin/tweet-thread-validate.mjs", "validate", "oversized.json"],
    isolatedPlugin,
  );
  assert.equal(oversized.status, 2);
  assert.match(oversized.stderr, /candidate file exceeds the portable size limit/i);

  const directoryInput = run(
    process.execPath,
    ["bin/tweet-thread-validate.mjs", "validate", "."],
    isolatedPlugin,
  );
  assert.equal(directoryInput.status, 2);
  assert.match(directoryInput.stderr, /candidate file must be a regular file/i);

  const fifoPath = path.join(isolatedPlugin, "candidate.fifo");
  const mkfifo = run("mkfifo", [fifoPath], isolatedPlugin);
  assert.equal(mkfifo.status, 0, mkfifo.stderr);
  const fifo = run(
    process.execPath,
    ["bin/tweet-thread-validate.mjs", "validate", "candidate.fifo"],
    isolatedPlugin,
    1_000,
  );
  assert.notEqual(fifo.error?.code, "ETIMEDOUT", "unsupported file types are rejected without blocking");
  assert.equal(fifo.status, 2);
  assert.match(fifo.stderr, /candidate file must be a regular file/i);

  const usage = run(process.execPath, ["bin/tweet-thread-validate.mjs"], isolatedPlugin);
  assert.equal(usage.status, 2);
  assert.equal(usage.stdout, "");
  assert.match(usage.stderr, /^Usage: node tweet-thread-validate\.mjs validate <candidate\.json> \[brief\.json\]\n$/);
} finally {
  rmSync(SCRATCH, { recursive: true, force: true });
}
