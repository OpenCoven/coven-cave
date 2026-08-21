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
const DOWNLOAD_HOST = "https://download.github.test";
const manifestUrlFor = (version) => `${DOWNLOAD_HOST}/v${version}/latest.json`;
const MANIFEST_URL = manifestUrlFor("0.3.7");

/**
 * The asset list a real cut publishes, mirrored from v0.3.7 — every signed
 * artifact ships beside its detached `.sig`, and the `.dmg` ships without one.
 * That detail is load-bearing: it is the only fixture shape that can tell an
 * anchored extension match from a substring one, and the only one that can
 * tell an exact asset-name lookup from a substring lookup.
 */
function assets(version) {
  const download = (name) => ({
    name,
    browser_download_url: `${DOWNLOAD_HOST}/v${version}/${name}`,
  });
  return [
    download(`CovenCave-v${version}-aarch64.app.tar.gz`),
    download(`CovenCave-v${version}-aarch64.app.tar.gz.sig`),
    download(`CovenCave-v${version}-aarch64.dmg`),
    download(`CovenCave-v${version}-x86_64.app.tar.gz`),
    download(`CovenCave-v${version}-x86_64.app.tar.gz.sig`),
    download(`CovenCave-v${version}-x86_64.dmg`),
    download(`CovenCave_${version}_amd64.AppImage`),
    download(`CovenCave_${version}_amd64.AppImage.sig`),
    download(`CovenCave_${version}_x64_en-US.msi`),
    download(`CovenCave_${version}_x64_en-US.msi.sig`),
    download("SHA256SUMS"),
    // Version-derived like every other asset. Pinning this to one constant
    // gave every release in the file the SAME manifest url, so no fixture
    // could distinguish the baseline's manifest from another release's.
    download("latest.json"),
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
  const url = (name) => `${DOWNLOAD_HOST}/v${version}/${name}`;
  return {
    version,
    pub_date: "2026-08-19T11:53:56.963Z",
    // Declared windows-first, deliberately. `rollback-platforms` is sorted, and
    // a fixture whose declaration order is already sorted cannot tell the sort
    // from an echo of Object.keys — dropping it changed nothing.
    platforms: {
      "windows-x86_64": {
        url: url(`CovenCave_${version}_x64_en-US.msi`),
        signature: "dW50cnVzdGVk",
      },
      "darwin-aarch64": {
        url: url(`CovenCave-v${version}-aarch64.app.tar.gz`),
        signature: "dW50cnVzdGVk",
      },
    },
    ...overrides,
  };
}

/** A fetch double serving one page of releases plus the baseline manifest. */
function stubFetch({ releases, manifest: body, manifestStatus = 200, manifestUrl = MANIFEST_URL }) {
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
      if (url === manifestUrl) {
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

test("a signature file is not the artifact it signs", () => {
  // Every real cut publishes a `.sig` beside each signed artifact, and each
  // one is a separate `gh release upload` — so a release keeping the signature
  // while losing the artifact is a shape this gate will actually meet, not a
  // hypothetical. Nothing pinned it: the two fixtures above are all-assets and
  // no-assets, and neither holds a name that CONTAINS a required one without
  // being it. Unanchoring `.dmg`, `.msi` or `.AppImage`, or relaxing either
  // exact-name lookup to a substring, therefore left the whole suite green
  // while certifying a rollback target with nothing installable on it.
  const signaturesOnly = {
    assets: [
      "CovenCave-v0.3.7-aarch64.dmg.sig",
      "CovenCave_0.3.7_x64_en-US.msi.sig",
      "CovenCave_0.3.7_amd64.AppImage.sig",
      "SHA256SUMS.sig",
      "latest.json.sig",
    ].map((name) => ({ name, browser_download_url: `${DOWNLOAD_HOST}/v0.3.7/${name}` })),
  };

  assert.deepEqual(collectBaselineArtifactProblems(signaturesOnly), [
    "no macOS disk image (.dmg) to roll back to",
    "no Windows installer (.msi) to roll back to",
    "no Linux AppImage to roll back to",
    "no SHA256SUMS, so a rollback artifact cannot be checked before it runs",
    "no latest.json, so the updater cannot serve the rollback",
  ]);
});

test("each required installer is named on its own when only that one is gone", () => {
  // The all-or-nothing fixtures cannot tell the three matchers apart either:
  // replacing every one of them with the same predicate kept both green. Each
  // case below removes exactly one installer and leaves its `.sig` behind, so
  // the matcher under test has to be both specific and anchored.
  for (const [extension, problem] of [
    [/\.dmg$/i, "no macOS disk image (.dmg) to roll back to"],
    [/\.msi$/i, "no Windows installer (.msi) to roll back to"],
    [/\.AppImage$/i, "no Linux AppImage to roll back to"],
  ]) {
    const pruned = {
      assets: release("0.3.7").assets.filter((asset) => !extension.test(asset.name)),
    };
    assert.deepEqual(collectBaselineArtifactProblems(pruned), [problem], `${extension} only`);
  }
});

test("rollback metadata must describe artifacts that still exist", () => {
  const baseline = { tag: "v0.3.7", version: "0.3.7", release: release("0.3.7") };
  assert.deepEqual(collectManifestProblems(manifest("0.3.7"), baseline), []);

  // A drifted manifest also names the wrong release's assets, so the version
  // mismatch is reported first and every stale url after it.
  assert.deepEqual(collectManifestProblems(manifest("0.3.6"), baseline), [
    "latest.json declares version '0.3.6', not the baseline's 0.3.7",
    "windows-x86_64: manifest points at 'https://download.github.test/v0.3.6/CovenCave_0.3.6_x64_en-US.msi', which is not an asset on v0.3.7",
    "darwin-aarch64: manifest points at 'https://download.github.test/v0.3.6/CovenCave-v0.3.6-aarch64.app.tar.gz', which is not an asset on v0.3.7",
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
  // Both shortfalls on one entry are reported, not just the first. The entry
  // rules fall through on purpose so a single run names everything an operator
  // has to repair — and every fixture above pairs a bad signature with a GOOD
  // url, so making the signature rule `continue` past the identity check was
  // invisible to the suite.
  assert.deepEqual(
    collectManifestProblems(
      manifest("0.3.7", {
        platforms: {
          "linux-x86_64": {
            url: `${DOWNLOAD_HOST}/v0.3.6/CovenCave_0.3.6_amd64.AppImage`,
            signature: "",
          },
        },
      }),
      baseline,
    ),
    [
      "linux-x86_64: manifest entry has no signature, so the updater would reject it",
      "linux-x86_64: manifest points at 'https://download.github.test/v0.3.6/CovenCave_0.3.6_amd64.AppImage', which is not an asset on v0.3.7",
    ],
  );
  // A url neither side can parse is not a match. `assetIdentities` drops its
  // own blanks and the entry rule rejects a blank identity; either half alone
  // is redundant, which is why each survives removal on its own. Together they
  // are what stops an unresolvable manifest url matching an unresolvable
  // baseline asset and certifying a rollback nothing ever located.
  assert.deepEqual(
    collectManifestProblems(
      { version: "0.3.7", platforms: { "linux-x86_64": { url: "not a url", signature: "sig" } } },
      {
        tag: "v0.3.7",
        version: "0.3.7",
        release: { assets: [{ name: "broken", browser_download_url: "not a url" }] },
      },
    ),
    ["linux-x86_64: manifest points at 'not a url', which is not an asset on v0.3.7"],
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
  // Sorted, not echoed: the fixture declares windows-x86_64 first.
  assert.deepEqual(result.platforms, ["darwin-aarch64", "windows-x86_64"]);
  assert.ok(calls.some((url) => url === MANIFEST_URL), "the baseline manifest is actually read");

  // The manifest asset is found by exact name, and no fixture could tell that
  // from a substring match: nothing in a release's asset list CONTAINS
  // "latest.json" without being it. A decoy that does — a stray `.sig`, a
  // `.bak` left by a repair — is picked first by a substring `find`, and the
  // gate then verifies a document that is not the manifest the updater serves.
  const decoyUrl = `${DOWNLOAD_HOST}/v0.3.7/latest.json.sig`;
  const decoyed = release("0.3.7");
  decoyed.assets = [{ name: "latest.json.sig", browser_download_url: decoyUrl }, ...decoyed.assets];
  const exact = stubFetch({ releases: [decoyed], manifest: manifest("0.3.7") });

  await verify({ fetchImpl: exact.fetchImpl });

  assert.ok(exact.calls.includes(MANIFEST_URL), "the manifest itself is read");
  assert.ok(!exact.calls.includes(decoyUrl), "and the decoy beside it is not");
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

  // The api origin is compared whole, never as a prefix. Every asset url in
  // this file until now differed from the API origin at the first label, which
  // is the one shape that cannot tell `originOf(url) === apiOrigin` from a
  // `url.startsWith(apiOrigin)` written in its place — and `api.github.test`
  // is a prefix of `api.github.test.look-alike.test`, so that spelling hands
  // the token to a host chosen by whoever wrote the download url.
  const lookAlike = `${API}.look-alike.test/v0.3.7/latest.json`;
  const rehosted = release("0.3.7");
  rehosted.assets = rehosted.assets.map((asset) =>
    asset.name === "latest.json" ? { ...asset, browser_download_url: lookAlike } : asset,
  );
  const prefixed = stubFetch({
    releases: [rehosted],
    manifest: manifest("0.3.7"),
    manifestUrl: lookAlike,
  });

  await verify({ fetchImpl: prefixed.fetchImpl });

  const hops = prefixed.requests.filter((request) => request.url === lookAlike);
  assert.equal(hops.length, 1, "the look-alike host is actually reached");
  assert.equal(hops[0].headers.authorization, undefined);
});

test("a caller that cannot make a request is told so, not told to retry", async () => {
  // Both of these guards were unreachable as written. The fetch check asked
  // whether the injected impl OR the global was callable, which on every Node
  // this repository supports is always yes — so a truthy non-function sailed
  // past it into requestJson, where the failed call is reported as a request
  // that "could not be sent … retry before treating the release as
  // unshippable". That advises a retry for a permanent defect, which is the
  // exact misreading the retry advice exists to prevent.
  await assert.rejects(
    verify({ fetchImpl: "https://example.test" }),
    (error) =>
      !(error instanceof RollbackReadinessError) &&
      error.message === "fetch implementation is required",
  );

  // resolveRepository carried an owner/repo branch no caller used, and its
  // surviving half was reached by no test at all.
  for (const repository of ["", "OpenCoven", "OpenCoven/coven-cave/nested", "/coven-cave"]) {
    await assert.rejects(
      verify({
        repository,
        fetchImpl: stubFetch({ releases: [], manifest: null }).fetchImpl,
      }),
      /^Error: repository must use the owner\/repo form$/,
      `${JSON.stringify(repository)} is not owner/repo`,
    );
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

    // A misconfigured job names the variable it is missing. Nothing reached
    // requiredEnv's refusal: the usage check above short-circuits before any
    // env is read, and every other CLI run passes a complete environment, so
    // dropping the throw outright left the suite green and left an operator
    // reading "repository must use the owner/repo form" for an unset secret.
    for (const missing of ["GITHUB_REPOSITORY", "GITHUB_TOKEN", "RELEASE_TAG", "GITHUB_OUTPUT"]) {
      const env = {
        ...cliEnv,
        GITHUB_OUTPUT: path.join(directory, "missing-output"),
        GITHUB_STEP_SUMMARY: path.join(directory, "missing-summary"),
      };
      delete env[missing];
      await assert.rejects(
        runCli({
          argv: [],
          env,
          fetchImpl: stubFetch({ releases: [release("0.3.7")], manifest: manifest("0.3.7") })
            .fetchImpl,
        }),
        new RegExp(`^Error: ${missing} is required$`),
        `${missing} must be named when it is unset`,
      );
    }
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
  // A gate is a gate only while it can fail its own job. `continue-on-error`
  // on the job or on the step, or an `if:` on the step, each leave
  // `needs.rollback-readiness.result == 'success'` true with the check never
  // having run — one line, and the updater publishes onto an unprovable
  // rollback target while every test here stays green. Nothing pinned any of
  // the three; the job's own `if:` is pinned too, in the other direction, so
  // the gate cannot quietly stop applying to some releases.
  assert.equal(job["continue-on-error"], undefined, "the gate must be able to fail its job");
  assert.equal(job.if, undefined, "the gate runs on every authorized release, unconditionally");
  for (const step of job.steps) {
    const label = step.name ?? step.uses ?? step.id;
    assert.equal(step["continue-on-error"], undefined, `${label}: no step here may be advisory`);
    assert.equal(step.if, undefined, `${label}: no step here may be conditional`);
  }
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
