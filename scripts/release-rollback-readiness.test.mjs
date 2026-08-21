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
  const requests = [];
  return {
    calls,
    requests,
    fetchImpl: async (url, init) => {
      calls.push(url);
      requests.push({ url, headers: init?.headers ?? {} });
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
  // Every row that must be excluded is v0.3.7 — NEWER than the answer — so
  // dropping any one exclusion changes the result. Sharing a version with the
  // real baseline made all three filters unassertable: the newest *stable*
  // release below the rollout was v0.3.7 either way, so the draft, the
  // prerelease and the unpublished row could each have been admitted with this
  // assertion still green.
  const baseline = selectRollbackBaseline(
    [
      release("0.3.5"),
      release("0.3.6"),
      release("0.3.9"),
      release("0.3.7", { draft: true }),
      release("0.3.7", { prerelease: true }),
      release("0.3.7", { published_at: null }),
      release("0.3.8"),
      { tag_name: "v0.3.7-rc.1", draft: false, prerelease: false, published_at: "x" },
      { tag_name: "nightly", draft: false, prerelease: false, published_at: "x" },
      null,
    ],
    "v0.3.8",
  );

  assert.equal(baseline.tag, "v0.3.6");
  assert.equal(baseline.version, "0.3.6");
});

test("a draft, a prerelease and an unpublished row are never a rollback target", () => {
  // Stated on its own so a regression names the rule it broke. A draft's assets
  // are not publicly downloadable at all, so certifying one as the rollback
  // target promises a rollback that 404s for every user.
  for (const overrides of [{ draft: true }, { prerelease: true }, { published_at: null }]) {
    assert.equal(
      selectRollbackBaseline([release("0.3.5"), release("0.3.7", overrides)], "v0.3.8").tag,
      "v0.3.5",
      `${JSON.stringify(overrides)} must lose to an older release that is real`,
    );
    assert.equal(
      selectRollbackBaseline([release("0.3.7", overrides)], "v0.3.8"),
      null,
      `${JSON.stringify(overrides)} must not be the rollback target`,
    );
  }
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
    "darwin-aarch64: manifest points at 'https://download.github.test/v0.3.6/CovenCave-v0.3.6-aarch64.app.tar.gz', which is not an asset on v0.3.7",
    "windows-x86_64: manifest points at 'https://download.github.test/v0.3.6/CovenCave_0.3.6_x64_en-US.msi', which is not an asset on v0.3.7",
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
          // An empty signature is a missing signature: the updater verifies it
          // against a pinned pubkey and rejects it either way.
          "darwin-aarch64": {
            url: "https://download.github.test/v0.3.7/CovenCave-v0.3.7-aarch64.app.tar.gz",
            signature: "",
          },
        },
      }),
      baseline,
    ),
    [
      "linux-x86_64: manifest entry has no signature, so the updater would reject it",
      "darwin-aarch64: manifest entry has no signature, so the updater would reject it",
    ],
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
    [
      "linux-x86_64: manifest points at 'https://download.github.test/v0.3.7/deleted.AppImage', which is not an asset on v0.3.7",
    ],
  );
  // An entry that carries no usable url is named as such rather than reaching
  // the identity check, which would report the far less actionable "manifest
  // points at 'undefined'". Nothing pinned this half: the signature rule had a
  // case of its own, so deleting the url rule outright left the suite green.
  assert.deepEqual(
    collectManifestProblems(
      manifest("0.3.7", {
        platforms: {
          "linux-x86_64": { signature: "dW50cnVzdGVk" },
          "darwin-x86_64": { url: "", signature: "dW50cnVzdGVk" },
          "windows-x86_64": "https://download.github.test/v0.3.7/CovenCave_0.3.7_x64_en-US.msi",
        },
      }),
      baseline,
    ),
    [
      "linux-x86_64: manifest entry has no url",
      "darwin-x86_64: manifest entry has no url",
      "windows-x86_64: manifest entry is not an object",
    ],
  );
  assert.deepEqual(collectManifestProblems("not json", baseline), [
    "latest.json is not a JSON object",
  ]);
  // A JSON array is `typeof "object"` too, and a manifest that is a list has
  // no platforms to roll anyone back to however long it is.
  assert.deepEqual(collectManifestProblems([], baseline), ["latest.json is not a JSON object"]);
  assert.deepEqual(
    collectManifestProblems(
      manifest("0.3.7", {
        platforms: [
          {
            url: "https://download.github.test/v0.3.7/CovenCave_0.3.7_amd64.AppImage",
            signature: "dW50cnVzdGVk",
          },
        ],
      }),
      baseline,
    ),
    ["latest.json lists no platforms, so no install can be rolled back"],
  );
});

test("an asset name that exists on another release is not a rollback target", () => {
  const baseline = { tag: "v0.3.7", version: "0.3.7", release: release("0.3.7") };
  // The baseline really does publish an asset with this filename. What it does
  // not publish is the one at this url: a manifest left behind by the previous
  // cut points at the same names under the previous tag's path, so matching on
  // the filename alone accepts a manifest that rolls users to v0.3.6 artifacts
  // while claiming to be the v0.3.7 rollback target.
  assert.deepEqual(
    collectManifestProblems(
      {
        version: "0.3.7",
        platforms: {
          "darwin-aarch64": {
            url: "https://download.github.test/v0.3.6/CovenCave-v0.3.7-aarch64.app.tar.gz",
            signature: "dW50cnVzdGVk",
          },
        },
      },
      baseline,
    ),
    [
      "darwin-aarch64: manifest points at 'https://download.github.test/v0.3.6/CovenCave-v0.3.7-aarch64.app.tar.gz', which is not an asset on v0.3.7",
    ],
  );

  // Origin is the other half of that identity, and every url in this file's
  // fixtures shares one host — so dropping `parsed.origin` from assetIdentity
  // left the whole suite green. A look-alike host serving the baseline's exact
  // download path is an artifact GitHub never published, and certifying it as
  // the rollback target is the same failure by a different route.
  assert.deepEqual(
    collectManifestProblems(
      {
        version: "0.3.7",
        platforms: {
          "darwin-aarch64": {
            url: "https://download.github.test.look-alike.test/v0.3.7/CovenCave-v0.3.7-aarch64.app.tar.gz",
            signature: "dW50cnVzdGVk",
          },
        },
      },
      baseline,
    ),
    [
      "darwin-aarch64: manifest points at 'https://download.github.test.look-alike.test/v0.3.7/CovenCave-v0.3.7-aarch64.app.tar.gz', which is not an asset on v0.3.7",
    ],
  );

  // A percent-encoded spelling of the same asset is the same asset.
  assert.deepEqual(
    collectManifestProblems(
      {
        version: "0.3.7",
        platforms: {
          "darwin-aarch64": {
            url: "https://download.github.test/v0.3.7/CovenCave%2Dv0.3.7%2Daarch64.app.tar.gz",
            signature: "dW50cnVzdGVk",
          },
        },
      },
      baseline,
    ),
    [],
  );
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

  // A listing row can name an asset without giving a url to fetch it from.
  // Refuse by name rather than letting `fetch(undefined)` decide: the message
  // that reaches the operator otherwise is about a request, not about the
  // release, which is the same misreading the non-JSON wrapper above exists
  // to prevent.
  const urlless = release("0.3.7");
  urlless.assets = urlless.assets.map((asset) =>
    asset.name === "latest.json" ? { name: "latest.json" } : asset,
  );
  await assert.rejects(
    verify({
      fetchImpl: stubFetch({ releases: [urlless], manifest: manifest("0.3.7") }).fetchImpl,
    }),
    (error) =>
      error instanceof RollbackReadinessError &&
      error.message === "v0.3.7 publishes latest.json without a download url",
  );
});

test("a platform key that could forge a job output is refused", () => {
  const baseline = { tag: "v0.3.7", version: "0.3.7", release: release("0.3.7") };
  const forged = "darwin-aarch64\nready=false\nbaseline-tag";

  // `rollback-platforms` is written into GITHUB_OUTPUT as `key=value`, and
  // these keys are the only part of that record read out of a fetched
  // document rather than a validated tag.
  assert.deepEqual(
    collectManifestProblems(
      { version: "0.3.7", platforms: { [forged]: { url: MANIFEST_URL, signature: "x" } } },
      baseline,
    ),
    [`${JSON.stringify(forged)} is not a platform key latest.json can name`],
  );

  // The four keys generate-latest-json.mjs actually emits stay accepted.
  for (const key of ["darwin-aarch64", "darwin-x86_64", "linux-x86_64", "windows-x86_64"]) {
    assert.deepEqual(
      collectManifestProblems(
        {
          version: "0.3.7",
          platforms: {
            [key]: {
              url: "https://download.github.test/v0.3.7/CovenCave_0.3.7_amd64.AppImage",
              signature: "dW50cnVzdGVk",
            },
          },
        },
        baseline,
      ),
      [],
    );
  }
});

test("the listing is paged through, and a listing it cannot exhaust is fatal", async () => {
  // A full page means "there may be more", so the baseline on page two has to
  // be reached before the newest stable release below the rollout is known.
  const filler = Array.from({ length: 100 }, (_, index) => release(`0.2.${index}`));
  const paged = async (url) => {
    if (!url.startsWith(`${API}/repos/`)) {
      return { ok: true, status: 200, json: async () => manifest("0.3.7") };
    }
    const page = Number(new URL(url).searchParams.get("page"));
    if (page === 1) return { ok: true, status: 200, json: async () => filler };
    if (page === 2) return { ok: true, status: 200, json: async () => [release("0.3.7")] };
    return { ok: true, status: 200, json: async () => [] };
  };

  const result = await verify({ fetchImpl: paged });
  assert.equal(result.baseline.tag, "v0.3.7");

  // Never a truncated answer: GitHub orders releases by creation, not version,
  // so a baseline past the cap could be newer than anything seen so far.
  const listed = [];
  await assert.rejects(
    verify({
      fetchImpl: async (url) => {
        if (!url.startsWith(`${API}/repos/`)) {
          return { ok: true, status: 200, json: async () => manifest("0.3.7") };
        }
        listed.push(url);
        return { ok: true, status: 200, json: async () => filler };
      },
    }),
    /release listing did not end within 20 pages of 100/,
  );
  // The refusal quotes the cap, so the cap has to be what was actually tried.
  // A loop bound one page short reports having exhausted 20 pages after 19,
  // and would send an operator raising MAX_API_PAGES after a page it never
  // asked for.
  assert.equal(listed.length, 20, "the cap in the message is the cap that was reached");
  assert.match(listed.at(-1), /[?&]page=20$/);
});

test("the API token never travels to the asset host", async () => {
  const stub = stubFetch({ releases: [release("0.3.7")], manifest: manifest("0.3.7") });

  await verify({ fetchImpl: stub.fetchImpl });

  const api = stub.requests.filter((request) => request.url.startsWith(`${API}/`));
  const asset = stub.requests.filter((request) => request.url === MANIFEST_URL);
  assert.ok(api.length > 0 && asset.length > 0, "both hosts are actually reached");
  for (const request of api) {
    assert.equal(request.headers.authorization, "Bearer token");
  }
  for (const request of asset) {
    // The download url is public and redirects off GitHub entirely; the token
    // authenticates us to the API and has no business on that hop.
    assert.equal(request.headers.authorization, undefined);
  }
});

test("a GitHub that cannot answer reads as retryable, a 404 does not", async () => {
  // 5xx is the obvious one and was the only one pinned. GitHub answers a
  // secondary rate limit with 403 and a primary one with 429 — the two statuses
  // a release cut is most likely to meet, since it makes these calls right
  // after a burst of other API traffic. Both are "GitHub declined to answer",
  // not "the rollback target is broken", and the docs promise the retry advice
  // for both. 500 is here so the boundary is `>= 500`, not `> 500`.
  for (const status of [403, 429, 500, 503]) {
    await assert.rejects(
      verify({
        fetchImpl: stubFetch({
          releases: [release("0.3.7")],
          manifest: null,
          manifestStatus: status,
        }).fetchImpl,
      }),
      new RegExp(
        `HTTP ${status}; GitHub could not answer[\\s\\S]*retry before treating the release as unshippable`,
      ),
    );
  }

  await assert.rejects(
    verify({
      fetchImpl: stubFetch({
        releases: [release("0.3.7")],
        manifest: null,
        manifestStatus: 404,
      }).fetchImpl,
    }),
    (error) => error instanceof RollbackReadinessError && !/retry before/.test(error.message),
  );

  await assert.rejects(
    verify({
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    }),
    /release listing request could not be sent \(fetch failed\)[\s\S]*retry before/,
  );

  // A 2xx carrying an edge error page, a truncated body, or a captive-portal
  // interstitial. Unwrapped this reached the operator as a bare `SyntaxError:
  // Unexpected token '<'`, which names neither the request nor the retry and
  // reads as a bug in the gate rather than a GitHub that never answered.
  const html = async () => {
    throw new SyntaxError(`Unexpected token '<', "<!DOCTYPE "... is not valid JSON`);
  };
  await assert.rejects(
    verify({ fetchImpl: async () => ({ ok: true, status: 200, json: html }) }),
    (error) =>
      error instanceof RollbackReadinessError &&
      /^release listing did not return JSON \(Unexpected token/.test(error.message) &&
      /retry before treating the release as unshippable/.test(error.message),
  );
  await assert.rejects(
    verify({
      fetchImpl: async (url) =>
        url.startsWith(`${API}/repos/`)
          ? { ok: true, status: 200, json: async () => [release("0.3.7")] }
          : { ok: true, status: 200, json: html },
    }),
    (error) =>
      error instanceof RollbackReadinessError &&
      /^v0\.3\.7 latest\.json did not return JSON \(/.test(error.message) &&
      /retry before treating the release as unshippable/.test(error.message),
  );

  // JSON, but not the listing: a degraded or rate-limited read answers with an
  // object. Nothing was learned about the rollback target, so this is a retry
  // and never a refusal.
  await assert.rejects(
    verify({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ message: "API rate limit exceeded" }),
      }),
    }),
    /release listing did not return an array; GitHub could not answer[\s\S]*retry before/,
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
  const cliEnv = {
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_TOKEN: "token",
    RELEASE_TAG: "v0.3.8",
    GITHUB_API_URL: API,
  };
  try {
    await runCli({
      argv: [],
      env: { ...cliEnv, GITHUB_OUTPUT: outputPath, GITHUB_STEP_SUMMARY: summaryPath },
      fetchImpl: stubFetch({ releases: [release("0.3.7")], manifest: manifest("0.3.7") }).fetchImpl,
    });

    const outputText = readFileSync(outputPath, "utf8");
    const outputs = Object.fromEntries(
      outputText
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split(/=(.*)/s).slice(0, 2)),
    );
    // GITHUB_OUTPUT is line-oriented and appended to; an unterminated last line
    // runs into whatever is written after it.
    assert.ok(outputText.endsWith("\n"), "every output line is terminated");
    assert.equal(outputs.ready, "true");
    assert.equal(outputs["baseline-tag"], "v0.3.7");
    assert.equal(outputs["baseline-version"], "0.3.7");
    assert.equal(outputs["baseline-waived"], "false");
    assert.equal(outputs["rollback-platforms"], "darwin-aarch64,windows-x86_64");
    assert.match(readFileSync(summaryPath, "utf8"), /Rollback readiness verified[\s\S]*v0\.3\.7/);

    // The waived branch writes a different record and a different summary line,
    // and neither was reached by any test: `baseline-waived` could have been
    // hard-coded `false` and the "none — waived as a first release" line could
    // have thrown, both silently. The one run that uses this branch is a
    // repository's first release, so nobody is watching when it executes.
    const waivedOutput = path.join(directory, "waived-output");
    const waivedSummary = path.join(directory, "waived-summary");
    await runCli({
      argv: ["--allow-missing-baseline"],
      env: { ...cliEnv, GITHUB_OUTPUT: waivedOutput, GITHUB_STEP_SUMMARY: waivedSummary },
      fetchImpl: stubFetch({ releases: [], manifest: manifest("0.3.7") }).fetchImpl,
    });
    const waived = readFileSync(waivedOutput, "utf8");
    assert.match(waived, /^baseline-waived=true$/m);
    assert.match(waived, /^baseline-tag=$/m);
    assert.match(waived, /^rollback-platforms=$/m);
    assert.match(readFileSync(waivedSummary, "utf8"), /none — waived as a first release/);

    // And the other half of the same rule, which nothing pinned: that the CLI
    // honours the flag's ABSENCE. Every refusal above calls
    // verifyRollbackReadiness directly, and the CLI's own happy path has a
    // baseline, so `allowMissingBaseline` never had to be false for the suite
    // to pass — hard-coding it `true` in runCli left every test green while
    // turning the job CI actually runs into a no-op. The workflow test pins
    // that CI never PASSES the flag; this pins that not passing it works.
    await assert.rejects(
      runCli({
        argv: [],
        env: {
          ...cliEnv,
          GITHUB_OUTPUT: path.join(directory, "unwaived-output"),
          GITHUB_STEP_SUMMARY: path.join(directory, "unwaived-summary"),
        },
        fetchImpl: stubFetch({ releases: [], manifest: manifest("0.3.7") }).fetchImpl,
      }),
      /no published stable release below v0\.3\.8 to roll back to/,
    );

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
  const gateStep = job.steps.find((step) => /release-rollback-readiness\.mjs/.test(step.run ?? ""));
  assert.ok(gateStep, "the job must actually run the gate");
  assert.equal(gateStep.run.trim(), "node scripts/release-rollback-readiness.mjs");
  // The waiver asserts that no prior release exists at all. CI can never know
  // that, and it is the one flag that turns this job into a no-op, so its
  // absence from the workflow is the property worth pinning rather than
  // rechecking by eye.
  assert.doesNotMatch(
    JSON.stringify(job),
    /--allow-missing-baseline/,
    "the first-release waiver is a hand-run escape hatch, never a CI default",
  );
  assert.deepEqual(Object.keys(gateStep.env ?? {}).sort(), ["GITHUB_TOKEN", "RELEASE_TAG"]);
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
