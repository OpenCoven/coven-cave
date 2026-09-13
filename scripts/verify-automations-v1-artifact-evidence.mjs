#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultLockPath = resolve(
  root,
  "conformance/automations-v1-artifact-lock.json",
);
const productionApiRoot = "https://api.github.com";
const testApiEnvironment = "OPENCOVEN_AUTOMATIONS_EVIDENCE_TEST_API_URL";
const sha256Pattern = /^[0-9a-f]{64}$/u;
const commitPattern = /^[0-9a-f]{40}$/u;
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const workflowPathPattern =
  /^(?!\/)(?!.*\\)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/u;
const maxResponseBytes = 1024 * 1024;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fail(message) {
  throw new Error(message);
}

function assertRecord(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  return value;
}

function assertInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(`${label} must be a positive safe integer.`);
  }
  return value;
}

function assertString(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    fail(`${label} is invalid.`);
  }
  return value;
}

function assertExactStringArray(value, label) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => typeof entry !== "string" || entry.length === 0)
  ) {
    fail(`${label} must be a non-empty string array.`);
  }
  return value;
}

function parseLock(text, label) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    fail(
      `${label} is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const lock = assertRecord(value, label);
  const producer = assertRecord(lock.producer, `${label} producer`);
  const workflow = assertRecord(producer.workflow, `${label} producer workflow`);
  const job = assertRecord(producer.job, `${label} producer job`);
  const artifact = assertRecord(lock.artifact, `${label} artifact`);
  const bundle = assertRecord(artifact.bundle, `${label} artifact bundle`);
  const manifest = assertRecord(artifact.manifest, `${label} artifact manifest`);
  const contract = assertRecord(lock.contract, `${label} contract`);

  if (
    lock.schemaVersion !== 1 ||
    lock.issue !== "OpenCoven/sdk#80" ||
    lock.parentIssue !== "OpenCoven/coven#855"
  ) {
    fail(`${label} has the wrong schema or issue binding.`);
  }

  return {
    schemaVersion: 1,
    issue: lock.issue,
    parentIssue: lock.parentIssue,
    producer: {
      repository: assertString(
        producer.repository,
        repositoryPattern,
        `${label} producer repository`,
      ),
      repositoryId: assertInteger(
        producer.repositoryId,
        `${label} producer repository ID`,
      ),
      sourceCommit: assertString(
        producer.sourceCommit,
        commitPattern,
        `${label} producer source commit`,
      ),
      sourceTree: assertString(
        producer.sourceTree,
        commitPattern,
        `${label} producer source tree`,
      ),
      workflow: {
        id: assertInteger(workflow.id, `${label} workflow ID`),
        name: assertString(workflow.name, /^CI$/u, `${label} workflow name`),
        path: assertString(
          workflow.path,
          workflowPathPattern,
          `${label} workflow path`,
        ),
        runId: assertInteger(workflow.runId, `${label} workflow run ID`),
        runAttempt: assertInteger(
          workflow.runAttempt,
          `${label} workflow run attempt`,
        ),
        event: assertString(
          workflow.event,
          /^push$/u,
          `${label} workflow event`,
        ),
        headBranch: assertString(
          workflow.headBranch,
          /^main$/u,
          `${label} workflow branch`,
        ),
        size: assertInteger(workflow.size, `${label} workflow size`),
        sha256: assertString(
          workflow.sha256,
          sha256Pattern,
          `${label} workflow SHA-256`,
        ),
      },
      job: {
        id: assertInteger(job.id, `${label} producer job ID`),
        name: assertString(
          job.name,
          /^Automations v1 protocol bundle$/u,
          `${label} producer job name`,
        ),
        runnerLabels: assertExactStringArray(
          job.runnerLabels,
          `${label} producer runner labels`,
        ),
      },
    },
    artifact: {
      id: assertInteger(artifact.id, `${label} artifact ID`),
      name: assertString(
        artifact.name,
        /^[A-Za-z0-9._-]+$/u,
        `${label} artifact name`,
      ),
      archiveSize: assertInteger(
        artifact.archiveSize,
        `${label} artifact archive size`,
      ),
      archiveSha256: assertString(
        artifact.archiveSha256,
        sha256Pattern,
        `${label} artifact archive SHA-256`,
      ),
      bundle: {
        path: assertString(
          bundle.path,
          /^[A-Za-z0-9._-]+\.tar\.gz$/u,
          `${label} bundle path`,
        ),
        size: assertInteger(bundle.size, `${label} bundle size`),
        sha256: assertString(
          bundle.sha256,
          sha256Pattern,
          `${label} bundle SHA-256`,
        ),
      },
      manifest: {
        path: assertString(
          manifest.path,
          /^manifest\.json$/u,
          `${label} manifest path`,
        ),
        size: assertInteger(manifest.size, `${label} manifest size`),
        sha256: assertString(
          manifest.sha256,
          sha256Pattern,
          `${label} manifest SHA-256`,
        ),
      },
    },
    contract: {
      profile: assertString(
        contract.profile,
        /^coven\.automations\.v1$/u,
        `${label} contract profile`,
      ),
      contentSha256: assertString(
        contract.contentSha256,
        sha256Pattern,
        `${label} content SHA-256`,
      ),
      manifestFiles: assertInteger(
        contract.manifestFiles,
        `${label} manifest file count`,
      ),
    },
  };
}

function apiRoot(env) {
  const testRoot = env[testApiEnvironment];
  if (testRoot === undefined || testRoot.length === 0) {
    return productionApiRoot;
  }
  if (!/^http:\/\/127\.0\.0\.1:\d+$/u.test(testRoot)) {
    fail(`${testApiEnvironment} must name an HTTP loopback test server.`);
  }
  return testRoot;
}

async function readJsonResponse(response, label) {
  if (!response.ok) {
    fail(`${label} request failed with HTTP ${response.status}.`);
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maxResponseBytes) {
    fail(`${label} response exceeds ${maxResponseBytes} bytes.`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(
      `${label} response is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function fetchGitHubJson(fetchImpl, apiBase, requestPath, label, token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "OpenCoven-Cave-Automations-v1-evidence",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token === undefined || token.length === 0
      ? {}
      : { Authorization: `Bearer ${token}` }),
  };
  const response = await fetchImpl(`${apiBase}${requestPath}`, {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  return readJsonResponse(response, label);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    fail(message);
  }
}

function assertLabels(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length) {
    fail("Live producer job runner labels do not match the lock.");
  }
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  if (actualSorted.some((label, index) => label !== expectedSorted[index])) {
    fail("Live producer job runner labels do not match the lock.");
  }
}

export function parseAutomationsArtifactEvidenceArguments(argv) {
  if (argv[0] === "--") {
    argv = argv.slice(1);
  }
  if (argv.length === 0) {
    return { lockPath: defaultLockPath };
  }
  if (argv.length !== 2 || argv[0] !== "--lock" || argv[1].length === 0) {
    fail("usage: verify-automations-v1-artifact-evidence.mjs [--lock <path>]");
  }
  return { lockPath: resolve(argv[1]) };
}

export async function verifyAutomationsArtifactEvidence(
  { lockPath },
  { fetchImpl = fetch, env = process.env } = {},
) {
  const lock = parseLock(
    readFileSync(lockPath, "utf8"),
    "Automations v1 artifact lock",
  );
  const apiBase = apiRoot(env);
  const token = env.GITHUB_TOKEN;
  const repository = lock.producer.repository;
  const repositoryId = lock.producer.repositoryId;
  const workflow = lock.producer.workflow;

  const repositoryMetadata = assertRecord(
    await fetchGitHubJson(
      fetchImpl,
      apiBase,
      `/repositories/${repositoryId}`,
      "Producer repository",
      token,
    ),
    "Producer repository response",
  );
  if (
    repositoryMetadata.id !== repositoryId ||
    repositoryMetadata.full_name !== repository ||
    repositoryMetadata.private !== false ||
    repositoryMetadata.archived !== false
  ) {
    fail("Live producer repository identity does not match the lock.");
  }

  const commitMetadata = assertRecord(
    await fetchGitHubJson(
      fetchImpl,
      apiBase,
      `/repos/${repository}/git/commits/${lock.producer.sourceCommit}`,
      "Producer source commit",
      token,
    ),
    "Producer source commit response",
  );
  const commitTree = assertRecord(
    commitMetadata.tree,
    "Producer source commit tree",
  );
  if (
    commitMetadata.sha !== lock.producer.sourceCommit ||
    commitTree.sha !== lock.producer.sourceTree
  ) {
    fail("Live producer source commit and tree do not match the lock.");
  }

  const artifactMetadata = assertRecord(
    await fetchGitHubJson(
      fetchImpl,
      apiBase,
      `/repos/${repository}/actions/artifacts/${lock.artifact.id}`,
      "Producer artifact",
      token,
    ),
    "Producer artifact response",
  );
  const artifactRun = assertRecord(
    artifactMetadata.workflow_run,
    "Producer artifact workflow run",
  );
  assertEqual(
    artifactMetadata.id,
    lock.artifact.id,
    "Live artifact ID does not match the lock.",
  );
  assertEqual(
    artifactMetadata.name,
    lock.artifact.name,
    "Live artifact name does not match the lock.",
  );
  assertEqual(
    artifactMetadata.size_in_bytes,
    lock.artifact.archiveSize,
    "Live artifact archive size does not match the lock.",
  );
  assertEqual(
    artifactMetadata.digest,
    `sha256:${lock.artifact.archiveSha256}`,
    "Live artifact archive digest does not match the lock.",
  );
  assertEqual(
    artifactMetadata.expired,
    false,
    "The pinned Automations v1 artifact is expired.",
  );
  if (
    artifactRun.id !== workflow.runId ||
    artifactRun.repository_id !== repositoryId ||
    artifactRun.head_repository_id !== repositoryId ||
    artifactRun.head_branch !== workflow.headBranch ||
    artifactRun.head_sha !== lock.producer.sourceCommit
  ) {
    fail("Live artifact is not bound to the locked producer run.");
  }

  const runMetadata = assertRecord(
    await fetchGitHubJson(
      fetchImpl,
      apiBase,
      `/repos/${repository}/actions/runs/${workflow.runId}`,
      "Producer workflow run",
      token,
    ),
    "Producer workflow run response",
  );
  if (
    runMetadata.id !== workflow.runId ||
    runMetadata.workflow_id !== workflow.id ||
    runMetadata.name !== workflow.name ||
    runMetadata.path !== workflow.path ||
    runMetadata.event !== workflow.event ||
    runMetadata.status !== "completed" ||
    runMetadata.conclusion !== "success" ||
    runMetadata.head_sha !== lock.producer.sourceCommit ||
    runMetadata.head_branch !== workflow.headBranch ||
    runMetadata.run_attempt !== workflow.runAttempt
  ) {
    fail("Live producer workflow run does not match the lock.");
  }

  const jobsMetadata = assertRecord(
    await fetchGitHubJson(
      fetchImpl,
      apiBase,
      `/repos/${repository}/actions/runs/${workflow.runId}/jobs?per_page=100`,
      "Producer workflow jobs",
      token,
    ),
    "Producer workflow jobs response",
  );
  if (!Array.isArray(jobsMetadata.jobs)) {
    fail("Producer workflow jobs response is missing jobs.");
  }
  const jobMetadata = jobsMetadata.jobs.find(
    (candidate) =>
      candidate !== null &&
      typeof candidate === "object" &&
      !Array.isArray(candidate) &&
      candidate.id === lock.producer.job.id,
  );
  const liveJob = assertRecord(jobMetadata, "Producer workflow job");
  if (
    liveJob.name !== lock.producer.job.name ||
    liveJob.status !== "completed" ||
    liveJob.conclusion !== "success"
  ) {
    fail("Live producer workflow job does not match the lock.");
  }
  assertLabels(liveJob.labels, lock.producer.job.runnerLabels);

  const workflowMetadata = assertRecord(
    await fetchGitHubJson(
      fetchImpl,
      apiBase,
      `/repos/${repository}/contents/${workflow.path}?ref=${lock.producer.sourceCommit}`,
      "Producer workflow source",
      token,
    ),
    "Producer workflow source response",
  );
  if (
    workflowMetadata.type !== "file" ||
    workflowMetadata.encoding !== "base64" ||
    workflowMetadata.size !== workflow.size ||
    typeof workflowMetadata.content !== "string"
  ) {
    fail("Live producer workflow source metadata does not match the lock.");
  }
  const workflowBytes = Buffer.from(
    workflowMetadata.content.replace(/\s/gu, ""),
    "base64",
  );
  if (workflowBytes.length !== workflow.size) {
    fail("Live producer workflow size does not match the lock.");
  }
  if (sha256(workflowBytes) !== workflow.sha256) {
    fail("Live producer workflow SHA-256 does not match the lock.");
  }

  return lock;
}

async function main() {
  const lock = await verifyAutomationsArtifactEvidence(
    parseAutomationsArtifactEvidenceArguments(process.argv.slice(2)),
  );
  process.stdout.write(
    [
      "Automations v1 artifact evidence verified:",
      `artifactId=${lock.artifact.id}`,
      `sourceCommit=${lock.producer.sourceCommit}`,
      `bundleSha256=${lock.artifact.bundle.sha256}`,
      `contentSha256=${lock.contract.contentSha256}`,
      `manifestFiles=${lock.contract.manifestFiles}`,
    ].join(" ") + "\n",
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(
      `Automations v1 artifact evidence failed: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    process.exitCode = 1;
  });
}
