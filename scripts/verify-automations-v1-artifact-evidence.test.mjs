import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const lockPath = path.join(root, "conformance", "automations-v1-artifact-lock.json");
const scriptPath = path.join(root, "scripts", "verify-automations-v1-artifact-evidence.mjs");
const readmePath = path.join(root, "README.md");
const packageJsonPath = path.join(root, "package.json");
const workflowPath = path.join(root, ".github", "workflows", "ci.yml");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readLock() {
  return JSON.parse(readFileSync(lockPath, "utf8"));
}

async function withScratchLock(lock, run) {
  mkdirSync(path.join(root, ".scratch"), { recursive: true });
  const scratch = mkdtempSync(path.join(root, ".scratch", "automations-v1-evidence-spec-"));
  const scratchLockPath = path.join(scratch, "lock.json");
  writeFileSync(scratchLockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  try {
    return await run(scratchLockPath);
  } finally {
    rmSync(scratch, { force: true, recursive: true });
  }
}

async function withApiServer(lock, overrides, run) {
  const workflowBytes = Buffer.from("name: pinned producer workflow\n", "utf8");
  lock.producer.workflow.size = workflowBytes.length;
  lock.producer.workflow.sha256 = sha256(workflowBytes);

  const responses = {
    repository: {
      id: lock.producer.repositoryId,
      full_name: lock.producer.repository,
      private: false,
      archived: false,
    },
    commit: {
      sha: lock.producer.sourceCommit,
      tree: {
        sha: lock.producer.sourceTree,
      },
    },
    artifact: {
      id: lock.artifact.id,
      name: lock.artifact.name,
      size_in_bytes: lock.artifact.archiveSize,
      digest: `sha256:${lock.artifact.archiveSha256}`,
      expired: false,
      workflow_run: {
        id: lock.producer.workflow.runId,
        repository_id: lock.producer.repositoryId,
        head_repository_id: lock.producer.repositoryId,
        head_branch: lock.producer.workflow.headBranch,
        head_sha: lock.producer.sourceCommit,
      },
    },
    run: {
      id: lock.producer.workflow.runId,
      name: lock.producer.workflow.name,
      path: lock.producer.workflow.path,
      event: lock.producer.workflow.event,
      status: "completed",
      conclusion: "success",
      head_sha: lock.producer.sourceCommit,
      head_branch: lock.producer.workflow.headBranch,
      run_attempt: lock.producer.workflow.runAttempt,
      workflow_id: lock.producer.workflow.id,
    },
    jobs: {
      total_count: 1,
      jobs: [
        {
          id: lock.producer.job.id,
          name: lock.producer.job.name,
          status: "completed",
          conclusion: "success",
          labels: lock.producer.job.runnerLabels,
        },
      ],
    },
    workflow: {
      type: "file",
      encoding: "base64",
      size: workflowBytes.length,
      content: workflowBytes.toString("base64"),
    },
    ...overrides,
  };

  const routes = new Map([
    [`/repositories/${lock.producer.repositoryId}`, responses.repository],
    [
      `/repos/${lock.producer.repository}/git/commits/${lock.producer.sourceCommit}`,
      responses.commit,
    ],
    [
      `/repos/${lock.producer.repository}/actions/artifacts/${lock.artifact.id}`,
      responses.artifact,
    ],
    [
      `/repos/${lock.producer.repository}/actions/runs/${lock.producer.workflow.runId}`,
      responses.run,
    ],
    [
      `/repos/${lock.producer.repository}/actions/runs/${lock.producer.workflow.runId}/jobs?per_page=100`,
      responses.jobs,
    ],
    [
      `/repos/${lock.producer.repository}/contents/${lock.producer.workflow.path}?ref=${lock.producer.sourceCommit}`,
      responses.workflow,
    ],
  ]);

  const server = createServer((request, response) => {
    const body = routes.get(request.url ?? "");
    if (body === undefined) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end('{"message":"not found"}\n');
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(`${JSON.stringify(body)}\n`);
  });

  await new Promise((resolveListen) => {
    server.listen(0, "127.0.0.1", resolveListen);
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolveClose, rejectClose) => {
      server.close((error) => {
        if (error === undefined) {
          resolveClose();
        } else {
          rejectClose(error);
        }
      });
    });
  }
}

function runEvidence(lock, apiUrl) {
  return withScratchLock(lock, (scratchLockPath) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [scriptPath, "--lock", scratchLockPath], {
        cwd: root,
        env: {
          ...process.env,
          OPENCOVEN_AUTOMATIONS_EVIDENCE_TEST_API_URL: apiUrl,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.once("error", reject);
      child.once("close", (status) => {
        resolve({ status, stdout, stderr });
      });
    }),
  );
}

test("pins the exact automations producer run, job, artifact, and contract identities", () => {
  assert.deepEqual(readLock(), {
    schemaVersion: 1,
    issue: "OpenCoven/sdk#80",
    parentIssue: "OpenCoven/coven#855",
    producer: {
      repository: "OpenCoven/coven",
      repositoryId: 1222160568,
      sourceCommit: "8a796807b37d4ad33eaeca37498debf1ca55dd49",
      sourceTree: "bf0261a187139773ce87d97c880669b4532e53c9",
      workflow: {
        id: 267192017,
        name: "CI",
        path: ".github/workflows/ci.yml",
        runId: 33798101313,
        runAttempt: 1,
        event: "push",
        headBranch: "main",
        size: 25064,
        sha256: "c8061bd914b31e0fd77cf73f1301ae8a04a127f68783fa7fbbc41c92f92bac14",
      },
      job: {
        id: 100790644364,
        name: "Automations v1 protocol bundle",
        runnerLabels: ["ubuntu-latest"],
      },
    },
    artifact: {
      id: 9909975069,
      name: "coven-automations-v1-contract-8a796807b37d4ad33eaeca37498debf1ca55dd49",
      archiveSize: 36232,
      archiveSha256: "6f2e239a4694a1f11223a9dc72f5f31971ead0a1b94ff3137fb39b75611a95ac",
      bundle: {
        path: "coven-automations-v1-contract-8a796807b37d4ad33eaeca37498debf1ca55dd49.tar.gz",
        size: 34712,
        sha256: "512460db71d4257d7a4d33ea306578e66d9ac499d9384eb9c2b8e2b4e2e32363",
      },
      manifest: {
        path: "manifest.json",
        size: 2964,
        sha256: "449d79f0a47fd299d0c560bf4a5f63be383e9825067d3ac992cb97ce067c86d2",
      },
    },
    contract: {
      profile: "coven.automations.v1",
      contentSha256: "3c145eb92a93426ed64631f6487a8cd12903b0a49a6e752269f594ac50a779f5",
      manifestFiles: 17,
    },
  });
});

test("authenticates the live GitHub repository, workflow, run, job, and artifact metadata", async () => {
  const lock = readLock();
  await withApiServer(lock, {}, async (apiUrl) => {
    const result = await runEvidence(lock, apiUrl);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(
      result.stdout,
      /Automations v1 artifact evidence verified: artifactId=9909975069/u,
    );
    assert.match(
      result.stdout,
      /sourceCommit=8a796807b37d4ad33eaeca37498debf1ca55dd49/u,
    );
    assert.match(
      result.stdout,
      /bundleSha256=512460db71d4257d7a4d33ea306578e66d9ac499d9384eb9c2b8e2b4e2e32363/u,
    );
  });
});

test("accepts the live producer job runner labels in any order", async () => {
  const lock = readLock();
  lock.producer.job.runnerLabels = ["ubuntu-latest", "x64"];
  await withApiServer(
    lock,
    {
      jobs: {
        total_count: 1,
        jobs: [
          {
            id: lock.producer.job.id,
            name: lock.producer.job.name,
            status: "completed",
            conclusion: "success",
            labels: ["x64", "ubuntu-latest"],
          },
        ],
      },
    },
    async (apiUrl) => {
      const result = await runEvidence(lock, apiUrl);
      assert.equal(result.status, 0, result.stderr || result.stdout);
    },
  );
});

test("rejects live artifact archive digest drift", async () => {
  const lock = readLock();
  await withApiServer(
    lock,
    {
      artifact: {
        id: lock.artifact.id,
        name: lock.artifact.name,
        size_in_bytes: lock.artifact.archiveSize,
        digest: `sha256:${"0".repeat(64)}`,
        expired: false,
        workflow_run: {
          id: lock.producer.workflow.runId,
          repository_id: lock.producer.repositoryId,
          head_repository_id: lock.producer.repositoryId,
          head_branch: lock.producer.workflow.headBranch,
          head_sha: lock.producer.sourceCommit,
        },
      },
    },
    async (apiUrl) => {
      const result = await runEvidence(lock, apiUrl);
      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        /artifact archive digest does not match the lock/u,
      );
    },
  );
});

test("rejects producer workflow byte drift", async () => {
  const lock = readLock();
  await withApiServer(lock, {}, async (apiUrl) => {
    lock.producer.workflow.sha256 = "0".repeat(64);
    const result = await runEvidence(lock, apiUrl);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /producer workflow SHA-256 does not match the lock/u,
    );
  });
});

test("wires the exact-artifact evidence verifier into the operator surface", () => {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const readme = readFileSync(readmePath, "utf8");
  const workflow = readFileSync(workflowPath, "utf8");

  assert.equal(
    packageJson.scripts["verify:automations-v1-evidence"],
    "node ./scripts/verify-automations-v1-artifact-evidence.mjs",
  );
  assert.match(readme, /pnpm verify:automations-v1-evidence/u);
  assert.match(readme, /automations v1 exact-artifact canary/i);
  assert.match(
    workflow,
    /^          - name: protocol conformance\n            command: test:conformance$/m,
  );
});
