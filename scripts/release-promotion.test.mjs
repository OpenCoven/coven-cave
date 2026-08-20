import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  FINAL_TAG_PATTERN,
  LEGACY_RELEASE_PUBLISHED_BEFORE,
  LEGACY_RELEASE_WORKFLOW_ID,
  RC_TAG_PATTERN,
  authorizeCandidate,
  authorizeRelease,
  parseCandidateTag,
  parseFinalTag,
  runCli,
} from "./release-promotion.mjs";

const COMMIT = "1234567890abcdef1234567890abcdef12345678";
const OTHER_COMMIT = "abcdef1234567890abcdef1234567890abcdef12";
const API = "https://api.github.test";
const REPOSITORY = "OpenCoven/coven-cave";

test("exports strict tag patterns and parsing contracts", () => {
  assert.equal(
    RC_TAG_PATTERN.source,
    String.raw`^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-rc\.([1-9][0-9]*)$`,
  );
  assert.equal(
    FINAL_TAG_PATTERN.source,
    String.raw`^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`,
  );
  assert.deepEqual(parseCandidateTag("v1.2.3-rc.1"), {
    tag: "v1.2.3-rc.1",
    baseTag: "v1.2.3",
    version: "1.2.3",
    rc: 1,
  });
  assert.deepEqual(parseFinalTag("v1.2.3"), { tag: "v1.2.3", version: "1.2.3" });

  for (const tag of ["v1.2.3", "v1.2.3-rc.0", "v1.2.3-rc.01", "v1.2", "v1.2.3-beta.1"]) {
    assert.throws(() => parseCandidateTag(tag), /valid release-candidate tag/);
  }
  for (const tag of ["v1.2.3-rc.1", "v1.2.3-beta.1", "1.2.3", "v01.2.3"]) {
    assert.throws(() => parseFinalTag(tag), /valid final release tag/);
  }
});

test("authorizes a signed candidate push and proves its local main ancestry", async () => {
  const { fetchImpl, calls } = githubFixture();
  const git = gitFixture();
  const result = await authorizeCandidate(
    baseOptions({ tag: "v1.2.3-rc.1", eventName: "push", expectedCommit: COMMIT, fetchImpl, git }),
  );

  assert.deepEqual(result, {
    tag: "v1.2.3-rc.1",
    baseTag: "v1.2.3",
    version: "1.2.3",
    rc: 1,
    commit: COMMIT,
    verificationReason: "valid",
  });
  assert.deepEqual(
    calls.map((call) => new URL(call.url).pathname),
    [
      "/repos/OpenCoven/coven-cave/git/ref/tags/v1.2.3-rc.1",
      `/repos/OpenCoven/coven-cave/git/tags/${OTHER_COMMIT}`,
    ],
  );
  assert.deepEqual(git.calls, [
    ["fetch", "--no-tags", "origin", "refs/tags/v1.2.3-rc.1:refs/coven-release-tags/v1.2.3-rc.1"],
    ["fetch", "--no-tags", "origin", "main:refs/remotes/origin/main"],
    ["rev-parse", "refs/coven-release-tags/v1.2.3-rc.1^{commit}"],
    ["merge-base", "--is-ancestor", COMMIT, "origin/main"],
  ]);
});

test("manual candidate authorization derives the commit from the peeled tag", async () => {
  const { fetchImpl } = githubFixture();
  const result = await authorizeCandidate(
    baseOptions({
      tag: "v1.2.3-rc.1",
      eventName: "workflow_dispatch",
      expectedCommit: undefined,
      fetchImpl,
      git: gitFixture(),
    }),
  );
  assert.equal(result.commit, COMMIT);
});

test("candidate authorization rejects lightweight, unsigned, mismatched, and off-main tags", async (t) => {
  await t.test("lightweight", async () => {
    const { fetchImpl } = githubFixture({ lightweight: true });
    await assert.rejects(
      authorizeCandidate(baseOptions({ tag: "v1.2.3-rc.1", fetchImpl, git: gitFixture() })),
      /annotated tag/,
    );
  });
  await t.test("unsigned", async () => {
    const { fetchImpl } = githubFixture({ verified: false });
    await assert.rejects(
      authorizeCandidate(baseOptions({ tag: "v1.2.3-rc.1", fetchImpl, git: gitFixture() })),
      /GitHub-verified/,
    );
  });
  await t.test("push commit mismatch", async () => {
    const { fetchImpl } = githubFixture();
    await assert.rejects(
      authorizeCandidate(
        baseOptions({
          tag: "v1.2.3-rc.1",
          expectedCommit: OTHER_COMMIT,
          fetchImpl,
          git: gitFixture(),
        }),
      ),
      /does not match expected commit/,
    );
  });
  await t.test("local tag mismatch", async () => {
    const { fetchImpl } = githubFixture();
    await assert.rejects(
      authorizeCandidate(
        baseOptions({
          tag: "v1.2.3-rc.1",
          fetchImpl,
          git: gitFixture({ revParseCommit: OTHER_COMMIT }),
        }),
      ),
      /fetched tag .* does not match GitHub/,
    );
  });
  await t.test("off main", async () => {
    const { fetchImpl } = githubFixture();
    await assert.rejects(
      authorizeCandidate(
        baseOptions({ tag: "v1.2.3-rc.1", fetchImpl, git: gitFixture({ offMain: true }) }),
      ),
      /not contained in origin\/main/,
    );
  });
});

test("authorizes the highest valid candidate across bounded pagination", async () => {
  const firstRuns = [
    candidateRun({ id: 11, tag: "v1.2.3-rc.1" }),
    candidateRun({ id: 90, tag: "v1.2.3-rc.9", event: "workflow_dispatch" }),
    candidateRun({ id: 91, tag: "v1.2.3-rc.9", headSha: OTHER_COMMIT }),
    candidateRun({ id: 92, tag: "v9.2.3-rc.9" }),
  ];
  const secondRuns = [candidateRun({ id: 12, tag: "v1.2.3-rc.2" })];
  const { fetchImpl, calls } = githubFixture({
    routes: ({ pathname, searchParams }) => {
      if (pathname.endsWith("/actions/workflows/release-candidate.yml/runs")) {
        if (searchParams.get("page") === "2") return jsonResponse({ workflow_runs: secondRuns });
        return jsonResponse(
          { workflow_runs: firstRuns },
          {
            link: `<${API}/repos/OpenCoven/coven-cave/actions/workflows/release-candidate.yml/runs?event=push&status=success&per_page=100&page=2>; rel="next"`,
          },
        );
      }
      if (pathname.endsWith("/actions/runs/11/jobs")) {
        return jsonResponse({ jobs: [rollupJob()] });
      }
      if (pathname.endsWith("/actions/runs/12/jobs")) {
        return jsonResponse({ jobs: [{ name: "prepare", status: "completed", conclusion: "success" }, rollupJob()] });
      }
    },
  });

  const result = await authorizeRelease(
    baseOptions({ tag: "v1.2.3", fetchImpl, git: gitFixture() }),
  );
  assert.deepEqual(result, {
    finalTag: "v1.2.3",
    version: "1.2.3",
    commit: COMMIT,
    candidateTag: "v1.2.3-rc.2",
    candidateRunId: 12,
    candidateRunUrl: "https://github.test/runs/12",
    legacyRecovery: false,
    legacyRunId: null,
    legacyRunUrl: null,
  });
  assert.ok(
    calls.some((call) => call.url.includes("per_page=100&page=2")),
    "candidate search follows the next page",
  );
});

test("candidate release evidence rejects wrong run and rollup data", async (t) => {
  const cases = [
    ["wrong event", { run: { event: "workflow_dispatch" } }],
    ["wrong SHA", { run: { headSha: OTHER_COMMIT } }],
    ["wrong version", { run: { tag: "v2.2.3-rc.1" } }],
    ["substring rollup", { jobs: [{ ...rollupJob(), name: "Release candidate validated later" }] }],
    ["duplicate rollups", { jobs: [rollupJob(), rollupJob({ name: "other / Release candidate validated" })] }],
    ["cancelled rollup", { jobs: [rollupJob({ conclusion: "cancelled" })] }],
    ["missing rollup", { jobs: [{ name: "build", status: "completed", conclusion: "success" }] }],
    ["moved current ref", { currentTagCommit: OTHER_COMMIT }],
    ["unsigned current ref", { currentTagVerified: false }],
  ];
  for (const [name, fixture] of cases) {
    await t.test(name, async () => {
      const { fetchImpl } = releaseEvidenceFixture(fixture);
      await assert.rejects(
        authorizeRelease(baseOptions({ tag: "v1.2.3", fetchImpl, git: gitFixture() })),
        /no valid release-candidate validation run/,
      );
    });
  }
});

test("candidate evidence pagination refuses cross-origin links and more than 20 pages", async (t) => {
  await t.test("cross origin", async () => {
    const { fetchImpl } = githubFixture({
      routes: ({ pathname }) => {
        if (pathname.endsWith("/release-candidate.yml/runs")) {
          return jsonResponse(
            { workflow_runs: [] },
            { link: '<https://evil.test/repos/OpenCoven/coven-cave/runs?page=2>; rel="next"' },
          );
        }
      },
    });
    await assert.rejects(
      authorizeRelease(baseOptions({ tag: "v1.2.3", fetchImpl, git: gitFixture() })),
      /same-origin, same-repository/,
    );
  });
  await t.test("page cap", async () => {
    const { fetchImpl } = githubFixture({
      routes: ({ pathname, searchParams }) => {
        if (pathname.endsWith("/release-candidate.yml/runs")) {
          const page = Number(searchParams.get("page") || 1);
          return jsonResponse(
            { workflow_runs: [] },
            {
              link: `<${API}/repos/OpenCoven/coven-cave/actions/workflows/release-candidate.yml/runs?event=push&status=success&per_page=100&page=${page + 1}>; rel="next"`,
            },
          );
        }
      },
    });
    await assert.rejects(
      authorizeRelease(baseOptions({ tag: "v1.2.3", fetchImpl, git: gitFixture() })),
      /20-page limit/,
    );
  });
});

test("legacy recovery constants are pinned", () => {
  assert.equal(LEGACY_RELEASE_PUBLISHED_BEFORE, Date.parse("2026-08-17T08:21:59Z"));
  assert.equal(LEGACY_RELEASE_WORKFLOW_ID, 286550155);
});

test("manual final release authorizes matching pre-cutoff legacy evidence", async () => {
  const { fetchImpl } = legacyFixture();
  const result = await authorizeRelease(
    baseOptions({
      tag: "v1.2.3",
      eventName: "workflow_dispatch",
      expectedCommit: undefined,
      fetchImpl,
      git: gitFixture(),
    }),
  );
  assert.deepEqual(result, {
    finalTag: "v1.2.3",
    version: "1.2.3",
    commit: COMMIT,
    legacyRecovery: true,
    candidateTag: null,
    candidateRunId: null,
    candidateRunUrl: null,
    legacyRunId: 700,
    legacyRunUrl: "https://github.test/runs/700",
  });
});

test("legacy run lookup follows a same-repository next page", async () => {
  const { fetchImpl, calls } = legacyFixture({ legacyRunPage: 2 });
  const result = await authorizeRelease(
    baseOptions({
      tag: "v1.2.3",
      eventName: "workflow_dispatch",
      expectedCommit: undefined,
      fetchImpl,
      git: gitFixture(),
    }),
  );
  assert.equal(result.legacyRunId, 700);
  assert.ok(calls.some((call) => call.url.includes("page=2")));
});

test("legacy recovery requires all historical evidence and otherwise falls through closed", async (t) => {
  const cases = [
    ["missing release", { releaseStatus: 404 }],
    ["draft release", { release: { draft: true } }],
    ["push invocation", { eventName: "push" }],
    ["post-cutoff release", { release: { published_at: "2026-08-17T08:21:59Z" } }],
    ["missing publication", { release: { published_at: null } }],
    ["wrong historical event", { legacyRun: { event: "workflow_dispatch" } }],
    ["mismatched historical SHA", { legacyRun: { head_sha: OTHER_COMMIT } }],
    ["post-cutoff rerun", { legacyRun: { updated_at: "2026-08-17T08:21:59Z" } }],
  ];
  for (const [name, fixture] of cases) {
    await t.test(name, async () => {
      const { fetchImpl } = legacyFixture(fixture);
      await assert.rejects(
        authorizeRelease(
          baseOptions({
            tag: "v1.2.3",
            eventName: fixture.eventName ?? "workflow_dispatch",
            expectedCommit: fixture.eventName === "push" ? COMMIT : undefined,
            fetchImpl,
            git: gitFixture(),
          }),
        ),
        /no valid release-candidate validation run/,
      );
    });

  }
});

test("CLI writes GitHub outputs and a human summary without using real git or network", async () => {
  const outputPath = path.resolve(`.release-promotion-output-${process.pid}`);
  const summaryPath = path.resolve(`.release-promotion-summary-${process.pid}`);
  const { fetchImpl } = githubFixture();
  try {
    await runCli({
      argv: ["candidate"],
      env: {
        GITHUB_REPOSITORY: REPOSITORY,
        GITHUB_TOKEN: "never-print-this-token",
        RELEASE_TAG: "v1.2.3-rc.1",
        EXPECTED_COMMIT: COMMIT,
        GITHUB_EVENT_NAME: "push",
        GITHUB_API_URL: API,
        GITHUB_OUTPUT: outputPath,
        GITHUB_STEP_SUMMARY: summaryPath,
      },
      fetchImpl,
      execFileImpl: gitFixture().execFileImpl,
    });
    const output = readFileSync(outputPath, "utf8");
    const summary = readFileSync(summaryPath, "utf8");
    assert.match(output, /^tag=v1\.2\.3-rc\.1$/m);
    assert.match(output, /^base-tag=v1\.2\.3$/m);
    assert.match(output, new RegExp(`^commit=${COMMIT}$`, "m"));
    assert.match(summary, /Release promotion authorized/);
    assert.doesNotMatch(`${output}\n${summary}`, /never-print-this-token/);
  } finally {
    rmSync(outputPath, { force: true });
    rmSync(summaryPath, { force: true });
  }
});

function baseOptions({ tag, fetchImpl, git, eventName = "push", expectedCommit = COMMIT }) {
  return {
    repository: REPOSITORY,
    apiUrl: API,
    token: "test-token",
    tag,
    eventName,
    expectedCommit,
    fetchImpl,
    execFileImpl: git.execFileImpl,
  };
}

function githubFixture({
  lightweight = false,
  verified = true,
  peeledCommit = COMMIT,
  routes,
} = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const parsed = new URL(url);
    const routed = routes?.(parsed, options, calls);
    if (routed) return routed;

    if (parsed.pathname.includes("/git/ref/tags/")) {
      return jsonResponse({
        object: lightweight
          ? { type: "commit", sha: peeledCommit }
          : { type: "tag", sha: OTHER_COMMIT },
      });
    }
    if (parsed.pathname.endsWith(`/git/tags/${OTHER_COMMIT}`)) {
      return jsonResponse({
        verification: { verified, reason: verified ? "valid" : "unsigned" },
        object: { type: "commit", sha: peeledCommit },
      });
    }
    if (parsed.pathname.endsWith("/actions/workflows/release-candidate.yml/runs")) {
      return jsonResponse({ workflow_runs: [] });
    }
    throw new Error(`unexpected API request: ${url}`);
  };
  return { fetchImpl, calls };
}

function releaseEvidenceFixture({
  run = {},
  jobs = [rollupJob()],
  currentTagCommit = COMMIT,
  currentTagVerified = true,
} = {}) {
  let tagReads = 0;
  return githubFixture({
    routes: ({ pathname }) => {
      if (pathname.includes("/git/ref/tags/")) {
        tagReads += 1;
        return jsonResponse({ object: { type: "tag", sha: OTHER_COMMIT } });
      }
      if (pathname.endsWith(`/git/tags/${OTHER_COMMIT}`)) {
        return jsonResponse({
          verification: {
            verified: tagReads === 1 ? true : currentTagVerified,
            reason: tagReads === 1 || currentTagVerified ? "valid" : "unsigned",
          },
          object: { type: "commit", sha: tagReads === 1 ? COMMIT : currentTagCommit },
        });
      }
      if (pathname.endsWith("/actions/workflows/release-candidate.yml/runs")) {
        return jsonResponse({
          workflow_runs: [
            candidateRun({
              id: 11,
              tag: run.tag,
              event: run.event,
              headSha: run.headSha,
            }),
          ],
        });
      }
      if (pathname.endsWith("/actions/runs/11/jobs")) return jsonResponse({ jobs });
    },
  });
}

function legacyFixture({
  releaseStatus = 200,
  release = {},
  legacyRun = {},
  legacyRunPage = 1,
} = {}) {
  return githubFixture({
    routes: ({ pathname, searchParams }) => {
      if (pathname.endsWith("/releases/tags/v1.2.3")) {
        if (releaseStatus === 404) return jsonResponse({ message: "Not Found" }, {}, 404);
        return jsonResponse({
          draft: false,
          published_at: "2026-08-17T08:21:58Z",
          ...release,
        });
      }
      if (pathname.endsWith(`/actions/workflows/${LEGACY_RELEASE_WORKFLOW_ID}/runs`)) {
        if (legacyRunPage === 2 && searchParams.get("page") !== "2") {
          return jsonResponse(
            { workflow_runs: [] },
            {
              link: `<${API}/repos/OpenCoven/coven-cave/actions/workflows/${LEGACY_RELEASE_WORKFLOW_ID}/runs?branch=v1.2.3&event=push&status=success&per_page=100&page=2>; rel="next"`,
            },
          );
        }
        return jsonResponse({
          workflow_runs: [
            {
              id: 700,
              html_url: "https://github.test/runs/700",
              event: "push",
              conclusion: "success",
              head_branch: "v1.2.3",
              head_sha: COMMIT,
              created_at: "2026-08-17T08:21:57Z",
              updated_at: "2026-08-17T08:21:58Z",
              ...legacyRun,
            },
          ],
        });
      }
    },
  });
}

function candidateRun({
  id,
  tag = "v1.2.3-rc.1",
  event = "push",
  headSha = COMMIT,
} = {}) {
  return {
    id,
    html_url: `https://github.test/runs/${id}`,
    event,
    status: "completed",
    conclusion: "success",
    head_branch: tag,
    head_sha: headSha,
  };
}

function rollupJob(overrides = {}) {
  return {
    name: "full-validation / Release candidate validated",
    status: "completed",
    conclusion: "success",
    ...overrides,
  };
}

function gitFixture({ revParseCommit = COMMIT, offMain = false } = {}) {
  const calls = [];
  const execFileImpl = async (file, args) => {
    assert.equal(file, "git");
    calls.push(args);
    if (args[0] === "rev-parse") return { stdout: `${revParseCommit}\n`, stderr: "" };
    if (args[0] === "merge-base" && offMain) {
      const error = new Error("not an ancestor");
      error.code = 1;
      throw error;
    }
    return { stdout: "", stderr: "" };
  };
  return { calls, execFileImpl };
}

function jsonResponse(body, headers = {}, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}
