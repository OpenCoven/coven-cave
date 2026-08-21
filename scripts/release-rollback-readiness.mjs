#!/usr/bin/env node
// Rollback readiness gate for a staged release rollout.
//
//   node scripts/release-rollback-readiness.mjs
//
// `release-promotion.mjs` proves the release we are about to ship was
// validated. Nothing proved the release we would ship *back to* still works,
// and that is the half a rollout actually depends on: pausing a bad rollout is
// only a remedy if the previous version is still installable and the updater
// can still serve it. Phase 7's acceptance criterion is exactly that — "prior
// stable artifacts and rollback metadata are verified before rollout".
//
// So this resolves the newest published, non-draft, non-prerelease release
// strictly below the release being shipped and refuses unless that baseline is
// a complete rollback target:
//   1. installers for every supported OS (.dmg, .msi, .AppImage)
//   2. SHA256SUMS, so a rollback artifact can be checked before it is run
//   3. latest.json whose version matches the baseline, whose platforms{} is
//      non-empty, and whose every entry carries a url + signature
//   4. every latest.json url still resolving to an asset on *that* release,
//      matched by whole download path rather than filename — a manifest
//      pointing at deleted assets, or at the previous cut's identically-named
//      ones, reads healthy and rolls nobody back
//
// Fails closed. `--allow-missing-baseline` waives only case where no prior
// stable release exists at all (the genuine first release of a repository);
// every other shortfall stays fatal.
//
// One shortfall is deliberately reported rather than refused: a baseline whose
// latest.json covers some but not all of EXPECTED_ROLLBACK_PLATFORMS. Partial
// manifests are a sanctioned outcome upstream, so the gate names the platforms
// with no rollback path instead of blocking the release over them.
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseFinalTag } from "./release-promotion.mjs";

const MAX_API_PAGES = 20;
const PAGE_SIZE = 100;

/** The shape of a Tauri updater platform key, e.g. `darwin-aarch64`. */
const PLATFORM_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const CHECKSUM_ASSET = "SHA256SUMS";
export const UPDATER_MANIFEST_ASSET = "latest.json";

/**
 * The platform keys `generate-latest-json.mjs` emits, one per shipped target.
 *
 * Deliberately NOT a requirement. `updater-manifest` publishes an honest
 * partial manifest when a build leg flakes (cave-ef6f: `if: success()` used to
 * skip the job outright and ship a release with no `latest.json` at all), and
 * `verify-release-updater.mjs` carries `--allow-partial` for the same reason.
 * So a baseline covering fewer than these four is a *sanctioned* state, and
 * refusing it would block a release whose only sin is that its predecessor's
 * Linux leg flaked. What is not acceptable is that it pass *silently*: a
 * baseline covering only Windows means a macOS install cannot be auto-rolled
 * back, which contradicts what a green gate appears to promise. So the
 * shortfall is named — in the summary, in a job output, and as a run
 * annotation — and the rollout decision is made with the coverage visible.
 */
export const EXPECTED_ROLLBACK_PLATFORMS = [
  "darwin-aarch64",
  "darwin-x86_64",
  "linux-x86_64",
  "windows-x86_64",
];

/** Installers a rollback needs, one per supported desktop OS. */
export const REQUIRED_INSTALLERS = [
  { id: "macos", label: "macOS disk image (.dmg)", matches: (name) => /\.dmg$/i.test(name) },
  { id: "windows", label: "Windows installer (.msi)", matches: (name) => /\.msi$/i.test(name) },
  { id: "linux", label: "Linux AppImage", matches: (name) => /\.AppImage$/i.test(name) },
];

export class RollbackReadinessError extends Error {}

export function compareVersions(left, right) {
  return (
    left.major - right.major || left.minor - right.minor || left.patch - right.patch
  );
}

export function parseReleaseVersion(tag) {
  try {
    const { version } = parseFinalTag(tag);
    const [major, minor, patch] = version.split(".").map(Number);
    return { tag, version, major, minor, patch };
  } catch {
    return null;
  }
}

/**
 * Newest published stable release strictly below `targetTag`, or null.
 * Drafts, prereleases, unpublished rows, the target itself and anything newer
 * are never a rollback target.
 */
export function selectRollbackBaseline(releases, targetTag) {
  const target = parseReleaseVersion(targetTag);
  if (!target) throw new RollbackReadinessError(`'${String(targetTag)}' is not a final release tag`);
  const candidates = [];
  for (const release of Array.isArray(releases) ? releases : []) {
    if (!release || typeof release !== "object") continue;
    if (release.draft || release.prerelease || !release.published_at) continue;
    const parsed = parseReleaseVersion(release.tag_name);
    if (!parsed || compareVersions(parsed, target) >= 0) continue;
    candidates.push({ ...parsed, release });
  }
  candidates.sort((a, b) => compareVersions(b, a));
  return candidates[0] ?? null;
}

function assetNames(release) {
  return (Array.isArray(release.assets) ? release.assets : [])
    .map((asset) => (typeof asset?.name === "string" ? asset.name : ""))
    .filter(Boolean);
}

/** Every way the baseline release falls short of being installable, in order. */
export function collectBaselineArtifactProblems(release) {
  const names = assetNames(release);
  const problems = [];
  for (const installer of REQUIRED_INSTALLERS) {
    if (!names.some((name) => installer.matches(name))) {
      problems.push(`no ${installer.label} to roll back to`);
    }
  }
  if (!names.includes(CHECKSUM_ASSET)) {
    problems.push(`no ${CHECKSUM_ASSET}, so a rollback artifact cannot be checked before it runs`);
  }
  if (!names.includes(UPDATER_MANIFEST_ASSET)) {
    problems.push(`no ${UPDATER_MANIFEST_ASSET}, so the updater cannot serve the rollback`);
  }
  return problems;
}

/**
 * Origin plus decoded path — the identity of one release asset.
 *
 * Comparing filenames alone would accept a manifest pointing at an
 * identically-named asset on a *different* release, which is the exact shape a
 * stale manifest takes: `generate-latest-json.mjs` writes
 * `…/releases/download/<tag>/<name>`, so a manifest left over from the previous
 * cut differs from a current one only in that `<tag>` segment. Comparing the
 * whole path pins the release too. Decoding both sides means two spellings of
 * the same url still compare equal.
 */
function assetIdentity(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${decodeURIComponent(parsed.pathname)}`;
  } catch {
    return "";
  }
}

function assetIdentities(release) {
  return new Set(
    (Array.isArray(release?.assets) ? release.assets : [])
      .map((asset) => assetIdentity(asset?.browser_download_url ?? ""))
      .filter(Boolean),
  );
}

/** Every way the baseline's updater manifest fails to describe a rollback. */
export function collectManifestProblems(manifest, baseline) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return [`${UPDATER_MANIFEST_ASSET} is not a JSON object`];
  }
  const problems = [];
  if (manifest.version !== baseline.version) {
    problems.push(
      `${UPDATER_MANIFEST_ASSET} declares version '${String(manifest.version)}', not the baseline's ${baseline.version}`,
    );
  }
  const platforms =
    manifest.platforms && typeof manifest.platforms === "object" && !Array.isArray(manifest.platforms)
      ? manifest.platforms
      : {};
  const entries = Object.entries(platforms);
  if (entries.length === 0) {
    problems.push(`${UPDATER_MANIFEST_ASSET} lists no platforms, so no install can be rolled back`);
    return problems;
  }
  const identities = assetIdentities(baseline.release);
  for (const [platform, entry] of entries) {
    // Every real key `generate-latest-json.mjs` emits is of this shape
    // (`darwin-aarch64`, `windows-x86_64`, …). Checking it is worth a line
    // because these keys are the one part of this record that comes from a
    // fetched document and is written straight into GITHUB_OUTPUT: a key
    // carrying a newline would append step outputs of its own choosing.
    if (!PLATFORM_KEY.test(platform)) {
      problems.push(
        `${JSON.stringify(platform)} is not a platform key ${UPDATER_MANIFEST_ASSET} can name`,
      );
      continue;
    }
    if (!entry || typeof entry !== "object") {
      problems.push(`${platform}: manifest entry is not an object`);
      continue;
    }
    if (typeof entry.url !== "string" || !entry.url) {
      problems.push(`${platform}: manifest entry has no url`);
      continue;
    }
    if (typeof entry.signature !== "string" || !entry.signature) {
      problems.push(`${platform}: manifest entry has no signature, so the updater would reject it`);
    }
    const identity = assetIdentity(entry.url);
    // `!identity` is redundant while `assetIdentities` filters its own blanks,
    // and deliberately kept: it is what makes an unparseable url on BOTH sides
    // fail closed. Drop either half alone and nothing changes; drop both and a
    // manifest entry whose url is not a url matches a baseline asset whose url
    // is not a url, and the gate certifies a rollback target it never resolved.
    if (!identity || !identities.has(identity)) {
      problems.push(
        `${platform}: manifest points at '${entry.url}', which is not an asset on ${baseline.tag}`,
      );
    }
  }
  return problems;
}

function resolveRepository(repository) {
  const parts = typeof repository === "string" ? repository.split("/") : [];
  if (parts.length !== 2 || parts.some((part) => !part)) {
    throw new Error("repository must use the owner/repo form");
  }
  return parts;
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

/**
 * True when this request is one the API token is for. The token authenticates
 * us to `api.github.com`; a release asset is public and its download url
 * redirects off GitHub entirely, so attaching the token there would hand a
 * credential to a host that never needed it.
 */
function isApiRequest(context, url) {
  return Boolean(context.apiOrigin) && originOf(url) === context.apiOrigin;
}

/**
 * A status that means GitHub could not answer, rather than that it answered
 * "the rollback target is broken". Worth a retry; a 404 is not.
 */
function isTransportStatus(status) {
  return status === 403 || status === 429 || status >= 500;
}

const RETRY_ADVICE =
  "GitHub could not answer, which is not evidence the rollback target is broken — retry before treating the release as unshippable";

async function requestJson(context, url, description) {
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "release-rollback-readiness",
  };
  if (context.token && isApiRequest(context, url)) {
    headers.authorization = `Bearer ${context.token}`;
  }
  let response;
  try {
    response = await context.fetchImpl(url, { headers, redirect: "follow" });
  } catch (cause) {
    throw new RollbackReadinessError(
      `${description} request could not be sent (${cause?.message ?? String(cause)}); ${RETRY_ADVICE}`,
      { cause },
    );
  }
  if (!response?.ok) {
    const status = typeof response?.status === "number" ? response.status : 0;
    throw new RollbackReadinessError(
      `${description} request failed with HTTP ${response?.status ?? "unknown"}` +
        (isTransportStatus(status) ? `; ${RETRY_ADVICE}` : ""),
    );
  }
  // A 2xx whose body is not JSON is an intermediary answering, not GitHub — an
  // edge error page, a truncated CDN response, a captive proxy. Left unwrapped
  // this surfaced as a bare `SyntaxError: Unexpected token '<'`, naming neither
  // the request nor the release and carrying none of the retry advice the
  // status-code path takes care to attach. That is the one message a release
  // engineer must not have to guess at: it reads like a defect in the gate
  // rather than a GitHub that never answered.
  try {
    return await response.json();
  } catch (cause) {
    throw new RollbackReadinessError(
      `${description} did not return JSON (${cause?.message ?? String(cause)}); ${RETRY_ADVICE}`,
      { cause },
    );
  }
}

async function listReleases(context) {
  const releases = [];
  for (let page = 1; page <= MAX_API_PAGES; page += 1) {
    const url = `${context.apiUrl}${context.repositoryPath}/releases?per_page=${PAGE_SIZE}&page=${page}`;
    const body = await requestJson(context, url, "release listing");
    if (!Array.isArray(body)) {
      // JSON, but not the listing — GitHub answers a rate-limited or degraded
      // read with an object. Same reading as a 5xx: nothing was learned about
      // the rollback target, so this is a retry rather than a refusal.
      throw new RollbackReadinessError(
        `release listing did not return an array; ${RETRY_ADVICE}`,
      );
    }
    releases.push(...body);
    if (body.length < PAGE_SIZE) return releases;
  }
  // Returning the truncated list here would answer a question this function was
  // not able to ask. GitHub orders releases by creation, not by version, so the
  // newest stable release below the rollout can sit on any page — a backported
  // patch is created after the minor that supersedes it. A truncated listing
  // therefore does not merely risk a stale baseline, it can silently verify the
  // wrong release and report the rollout ready.
  throw new RollbackReadinessError(
    `release listing did not end within ${MAX_API_PAGES} pages of ${PAGE_SIZE}, so the newest stable release below the rollout cannot be identified; raise MAX_API_PAGES in scripts/release-rollback-readiness.mjs`,
  );
}

export async function verifyRollbackReadiness(options = {}) {
  // Checked after resolution, not before: the earlier form asked whether
  // `options.fetchImpl` OR `globalThis.fetch` was callable, which on every Node
  // this repository supports is always yes — so it could not fire, and the one
  // input it looked like it caught (a truthy non-function) sailed past it into
  // `requestJson`, where the call throws and is reported as a request that
  // "could not be sent … retry". That tells an operator to retry a permanent
  // defect, which is the exact misreading the retry advice exists to avoid.
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch implementation is required");
  }
  const target = parseFinalTag(options.tag);
  const [owner, repo] = resolveRepository(options.repository);
  const apiUrl = (options.apiUrl || "https://api.github.com").replace(/\/+$/, "");
  const context = {
    apiUrl,
    apiOrigin: originOf(apiUrl),
    repositoryPath: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    token: options.token || "",
    fetchImpl,
  };

  const baseline = selectRollbackBaseline(await listReleases(context), target.tag);
  if (!baseline) {
    if (!options.allowMissingBaseline) {
      throw new RollbackReadinessError(
        `no published stable release below ${target.tag} to roll back to; pass --allow-missing-baseline only for a repository's first release`,
      );
    }
    return {
      tag: target.tag,
      version: target.version,
      baseline: null,
      baselineWaived: true,
      platforms: [],
      // Empty rather than "all four are missing": there is no baseline at all
      // here, so naming platforms would report a coverage shortfall against a
      // release that does not exist. `baselineWaived` is what says so, and the
      // summary prints the waiver instead of a coverage line.
      missingPlatforms: [],
      ready: true,
    };
  }

  const problems = collectBaselineArtifactProblems(baseline.release);
  if (problems.length > 0) {
    throw new RollbackReadinessError(
      `${baseline.tag} is not a usable rollback target: ${problems.join("; ")}`,
    );
  }

  const manifestAsset = (baseline.release.assets ?? []).find(
    (asset) => asset?.name === UPDATER_MANIFEST_ASSET,
  );
  const manifestUrl = manifestAsset?.browser_download_url;
  if (typeof manifestUrl !== "string" || !manifestUrl) {
    throw new RollbackReadinessError(
      `${baseline.tag} publishes ${UPDATER_MANIFEST_ASSET} without a download url`,
    );
  }
  const manifest = await requestJson(context, manifestUrl, `${baseline.tag} ${UPDATER_MANIFEST_ASSET}`);
  const manifestProblems = collectManifestProblems(manifest, baseline);
  if (manifestProblems.length > 0) {
    throw new RollbackReadinessError(
      `${baseline.tag} rollback metadata is incomplete: ${manifestProblems.join("; ")}`,
    );
  }

  return {
    tag: target.tag,
    version: target.version,
    baseline: {
      tag: baseline.tag,
      version: baseline.version,
      publishedAt: baseline.release.published_at,
      url: baseline.release.html_url ?? "",
    },
    baselineWaived: false,
    platforms: Object.keys(manifest.platforms).sort(),
    // Reported, never fatal — see EXPECTED_ROLLBACK_PLATFORMS for why. A key
    // the manifest carries that is not in the expected set is not a shortfall
    // (a new target ships before this list learns about it), so this is a
    // one-way difference rather than a set comparison.
    missingPlatforms: EXPECTED_ROLLBACK_PLATFORMS.filter(
      (platform) => !Object.hasOwn(manifest.platforms, platform),
    ),
    ready: true,
  };
}

export async function runCli({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const allowMissingBaseline = argv.includes("--allow-missing-baseline");
  const unknown = argv.filter((argument) => argument !== "--allow-missing-baseline");
  if (unknown.length > 0) {
    throw new Error("usage: node scripts/release-rollback-readiness.mjs [--allow-missing-baseline]");
  }
  const result = await verifyRollbackReadiness({
    repository: requiredEnv(env, "GITHUB_REPOSITORY"),
    token: requiredEnv(env, "GITHUB_TOKEN"),
    tag: requiredEnv(env, "RELEASE_TAG"),
    apiUrl: env.GITHUB_API_URL || "https://api.github.com",
    allowMissingBaseline,
    fetchImpl,
  });
  writeCliResult(result, env);
  return result;
}

function writeCliResult(result, env) {
  appendFileSync(
    requiredEnv(env, "GITHUB_OUTPUT"),
    Object.entries({
      // `ready` is structurally always true — every shortfall throws before
      // this line — and that is the point: a step output is absent when the
      // step did not reach its end, so `ready=true` distinguishes "verified"
      // from "" for any reader that does not also have the job's conclusion.
      ready: result.ready,
      "baseline-tag": result.baseline?.tag ?? "",
      "baseline-version": result.baseline?.version ?? "",
      "baseline-url": result.baseline?.url ?? "",
      "baseline-waived": result.baselineWaived,
      "rollback-platforms": result.platforms.join(","),
      // The shortfall gets its own output rather than being left for a reader
      // to derive by subtracting `rollback-platforms` from a list it would
      // have to hard-code. A consumer that only reads this one field still
      // learns the answer, and "" reads as full coverage only when
      // `baseline-waived` is false — which is exactly what it means.
      "rollback-platforms-missing": result.missingPlatforms.join(","),
    })
      .map(([key, value]) => `${key}=${String(value)}`)
      .join("\n") + "\n",
  );
  const shortfall =
    result.missingPlatforms.length > 0
      ? `- ⚠️ **No rollback path for ${result.missingPlatforms.join(", ")}** — those installs cannot be auto-rolled-back to \`${result.baseline.tag}\` and would need a manual reinstall. The baseline shipped a partial \`latest.json\`, which is allowed (see docs/workflows/release-rollback-readiness.md); this is a coverage note, not a failure.\n`
      : "";
  const detail = result.baseline
    ? `- Rollback target: \`${result.baseline.tag}\` (published ${result.baseline.publishedAt})\n- Platforms the updater can roll back: ${result.platforms.join(", ")}\n${shortfall}`
    : "- Rollback target: none — waived as a first release\n";
  appendFileSync(
    requiredEnv(env, "GITHUB_STEP_SUMMARY"),
    `### Rollback readiness verified\n\n- Rolling out: \`${result.tag}\`\n${detail}`,
  );
  // Also as a run annotation, so the shortfall is visible from the checks list
  // without opening the summary — the same convention `updater-manifest` uses
  // for its own `$count/4` partial coverage.
  if (result.missingPlatforms.length > 0) {
    console.warn(
      `::warning::Rollback baseline ${result.baseline.tag} covers ${result.platforms.length}/${EXPECTED_ROLLBACK_PLATFORMS.length} updater platforms; no auto-rollback for ${result.missingPlatforms.join(", ")}.`,
    );
  }
}

function requiredEnv(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCli().catch((error) => {
    console.error(`release-rollback-readiness: ${error.message}`);
    process.exitCode = 1;
  });
}
