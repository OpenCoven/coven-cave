import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";

import {
  RollbackReadinessError,
  collectBaselineArtifactProblems,
  collectManifestProblems,
  runCli,
  selectRollbackBaseline,
  verifyRollbackReadiness,
} from "./release-rollback-readiness.mjs";

const API = "https://api.github.test";
const REPOSITORY = "OpenCoven/coven-cave";
const MANIFEST_URL = "https://download.github.test/v0.3.7/latest.json";

function assets(version) {
  const download = (name) => ({
    name,
    browser_download_url: `https://download.github.test/v${version}/${name}`,
  });
  return [
    download(`CovenCave-v${version}-aarch64.app.tar.gz`),
    download(`CovenCave-v${version}-aarch64.dmg`),
    download(`CovenCave_${version}_amd64.AppImage`),
    download(`CovenCave_${version}_x64_en-US.msi`),
    download("SHA256SUMS"),
    { name: "latest.json", browser_download_url: MANIFEST_URL },
  ];
}

function release(version, overrides = {}) {
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    published_at: `2026-08-1${version.at(-1)}T00:00:00Z`,
    html_url: `https://github.test/${REPOSITORY}/releases/tag/v${version}`,
    assets: assets(version),
    ...overrides,
  };
}

function manifest(version, overrides = {}) {
  const url = (name) => `https://download.github.test/v${version}/${name}`;
  return {
    version,
    pub_date: "2026-08-19T11:53:56.963Z",
    platforms: {
      "darwin-aarch64": {
        url: url(`CovenCave-v${version}-aarch64.app.tar.gz`),
        signature: "dW50cnVzdGVk",
      },
      "windows-x86_64": {
        url: url(`CovenCave_${version}_x64_en-US.msi`),
        signature: "dW50cnVzdGVk",
      },
    },
    ...overrides,
  };
}

/** A fetch double serving one page of releases plus the baseline manifest. */
function stubFetch({ releases, manifest: body, manifestStatus = 200 }) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.startsWith(`${API}/repos/`)) {
        const page = Number(new URL(url).searchParams.get("page"));
        return { ok: true, status: 200, json: async () => (page === 1 ? releases : []) };
      }
      if (url === MANIFEST_URL) {
        return {
          ok: manifestStatus === 200,
          status: manifestStatus,
          json: async () => body,
        };
      }
      throw new Error(`unexpected request: ${url}`);
    },
  };
}

function verify(options) {
  return verifyRollbackReadiness({
    repository: REPOSITORY,
    token: "token",
    tag: "v0.3.8",
    apiUrl: API,
    ...options,
  });
}

test("the rollback target is the newest published stable release below the rollout", () => {
  const baseline = selectRollbackBaseline(
    [
      release("0.3.5"),
      release("0.3.7"),
      release("0.3.9"),
      release("0.3.6", { draft: true }),
      release("0.3.6", { prerelease: true }),
      release("0.3.6", { published_at: null }),
      release("0.3.8"),
      { tag_name: "v0.3.6-rc.1", draft: false, prerelease: false, published_at: "x" },
      { tag_name: "nightly", draft: false, prerelease: false, published_at: "x" },
      null,
    ],
    "v0.3.8",
  );

  assert.equal(baseline.tag, "v0.3.7");
  assert.equal(baseline.version, "0.3.7");
});

test("ordering is numeric, not lexicographic", () => {
  const baseline = selectRollbackBaseline([release("0.9.0"), release("0.10.0")], "v1.0.0");
  assert.equal(baseline.tag, "v0.10.0");
});

test("no stable release below the rollout leaves no baseline", () => {
  assert.equal(selectRollbackBaseline([release("0.3.9")], "v0.3.8"), null);
  assert.throws(() => selectRollbackBaseline([], "v0.3.8-rc.1"), RollbackReadinessError);
});

test("every missing rollback artifact is named", () => {
  assert.deepEqual(collectBaselineArtifactProblems(release("0.3.7")), []);
  assert.deepEqual(
    collectBaselineArtifactProblems({ assets: [] }),
    [
      "no macOS disk image (.dmg) to roll back to",
      "no Windows installer (.msi) to roll back to",
      "no Linux AppImage to roll back to",
      "no SHA256SUMS, so a rollback artifact cannot be checked before it runs",
      "no latest.json, so the updater cannot serve the rollback",
    ],
  );
});

test("rollback metadata must describe artifacts that still exist", () => {
  const baseline = { tag: "v0.3.7", version: "0.3.7", release: release("0.3.7") };
  assert.deepEqual(collectManifestProblems(manifest("0.3.7"), baseline), []);

  // A drifted manifest also names the wrong release's assets, so the version
  // mismatch is reported first and every stale url after it.
  assert.deepEqual(collectManifestProblems(manifest("0.3.6"), baseline), [
    "latest.json declares version '0.3.6', not the baseline's 0.3.7",
    "darwin-aarch64: manifest points at 'CovenCave-v0.3.6-aarch64.app.tar.gz', which is not an asset on v0.3.7",
    "windows-x86_64: manifest points at 'CovenCave_0.3.6_x64_en-US.msi', which is not an asset on v0.3.7",
  ]);
  assert.deepEqual(collectManifestProblems(manifest("0.3.7", { platforms: {} }), baseline), [
    "latest.json lists no platforms, so no install can be rolled back",
  ]);
  assert.deepEqual(
    collectManifestProblems(
      manifest("0.3.7", {
        platforms: {
          "linux-x86_64": {
            url: "https://download.github.test/v0.3.7/CovenCave_0.3.7_amd64.AppImage",
          },
        },
      }),
      baseline,
    ),
    ["linux-x86_64: manifest entry has no signature, so the updater would reject it"],
  );
  assert.deepEqual(
    collectManifestProblems(
      manifest("0.3.7", {
        platforms: {
          "linux-x86_64": {
            url: "https://download.github.test/v0.3.7/deleted.AppImage",
            signature: "dW50cnVzdGVk",
          },
        },
      }),
      baseline,
    ),
    ["linux-x86_64: manifest points at 'deleted.AppImage', which is not an asset on v0.3.7"],
  );
  assert.deepEqual(collectManifestProblems("not json", baseline), [
    "latest.json is not a JSON object",
  ]);
});

test("a complete baseline reports the platforms a rollback can reach", async () => {
  const { fetchImpl, calls } = stubFetch({
    releases: [release("0.3.7"), release("0.3.5")],
    manifest: manifest("0.3.7"),
  });

  const result = await verify({ fetchImpl });

  assert.equal(result.ready, true);
  assert.equal(result.baselineWaived, false);
  assert.equal(result.baseline.tag, "v0.3.7");
  assert.deepEqual(result.platforms, ["darwin-aarch64", "windows-x86_64"]);
  assert.ok(calls.some((url) => url === MANIFEST_URL), "the baseline manifest is actually read");
});

test("an incomplete baseline fails the rollout closed", async () => {
  const stripped = release("0.3.7");
  stripped.assets = stripped.assets.filter((asset) => asset.name !== "SHA256SUMS");

  await assert.rejects(
    verify({ fetchImpl: stubFetch({ releases: [stripped], manifest: manifest("0.3.7") }).fetchImpl }),
    /v0\.3\.7 is not a usable rollback target: no SHA256SUMS/,
  );

  await assert.rejects(
    verify({
      fetchImpl: stubFetch({
        releases: [release("0.3.7")],
        manifest: manifest("0.3.7", { platforms: {} }),
      }).fetchImpl,
    }),
    /rollback metadata is incomplete: latest\.json lists no platforms/,
  );

  await assert.rejects(
    verify({
      fetchImpl: stubFetch({
        releases: [release("0.3.7")],
        manifest: null,
        manifestStatus: 404,
      }).fetchImpl,
    }),
    /latest\.json request failed with HTTP 404/,
  );
});

test("a missing baseline is fatal unless it is explicitly waived", async () => {
  const stub = () => stubFetch({ releases: [], manifest: manifest("0.3.7") }).fetchImpl;

  await assert.rejects(
    verify({ fetchImpl: stub() }),
    /no published stable release below v0\.3\.8 to roll back to/,
  );

  const waived = await verify({ fetchImpl: stub(), allowMissingBaseline: true });
  assert.deepEqual(waived, {
    tag: "v0.3.8",
    version: "0.3.8",
    baseline: null,
    baselineWaived: true,
    platforms: [],
    ready: true,
  });
});

test("the CLI publishes the readiness record as job outputs and a summary", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "rollback-readiness-"));
  const outputPath = path.join(directory, "output");
  const summaryPath = path.join(directory, "summary");
  try {
    await runCli({
      argv: [],
      env: {
        GITHUB_REPOSITORY: REPOSITORY,
        GITHUB_TOKEN: "token",
        RELEASE_TAG: "v0.3.8",
        GITHUB_API_URL: API,
        GITHUB_OUTPUT: outputPath,
        GITHUB_STEP_SUMMARY: summaryPath,
      },
      fetchImpl: stubFetch({ releases: [release("0.3.7")], manifest: manifest("0.3.7") }).fetchImpl,
    });

    const outputs = Object.fromEntries(
      readFileSync(outputPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split(/=(.*)/s).slice(0, 2)),
    );
    assert.equal(outputs.ready, "true");
    assert.equal(outputs["baseline-tag"], "v0.3.7");
    assert.equal(outputs["baseline-version"], "0.3.7");
    assert.equal(outputs["baseline-waived"], "false");
    assert.equal(outputs["rollback-platforms"], "darwin-aarch64,windows-x86_64");
    assert.match(readFileSync(summaryPath, "utf8"), /Rollback readiness verified[\s\S]*v0\.3\.7/);

    await assert.rejects(
      runCli({ argv: ["--force"], env: {}, fetchImpl: () => {} }),
      /usage: node scripts\/release-rollback-readiness\.mjs/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rollout is gated on rollback readiness before the updater moves anyone", async () => {
  const release_ = parse(
    await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"),
  );
  const job = release_.jobs["rollback-readiness"];

  assert.equal(job.name, "Verify rollback readiness");
  assert.equal(job.needs, "authorize-release-promotion");
  assert.deepEqual(job.permissions, { contents: "read" });
  assert.match(
    job.steps.map((step) => step.run ?? "").join("\n"),
    /node scripts\/release-rollback-readiness\.mjs/,
  );
  const updater = release_.jobs["updater-manifest"];
  assert.ok(
    updater.needs.includes("rollback-readiness"),
    "the updater manifest must not publish before a rollback target is proven",
  );
  assert.match(
    updater.if,
    /needs\.rollback-readiness\.result == 'success'/,
    "`!cancelled()` waives the default needs-succeeded rule, so the gate must be named explicitly",
  );
});

console.log("release-rollback-readiness.test.mjs: ok");
