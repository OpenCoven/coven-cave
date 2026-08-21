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
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseFinalTag } from "./release-promotion.mjs";

const MAX_API_PAGES = 20;
const PAGE_SIZE = 100;

export const CHECKSUM_ASSET = "SHA256SUMS";
export const UPDATER_MANIFEST_ASSET = "latest.json";

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
    if (!identity || !identities.has(identity)) {
      problems.push(
        `${platform}: manifest points at '${entry.url}', which is not an asset on ${baseline.tag}`,
      );
    }
  }
  return problems;
}

function resolveRepository(options) {
  if (options.owner && options.repo) return [options.owner, options.repo];
  const parts = options.repository?.split("/") ?? [];
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
  return response.json();
}

async function listReleases(context) {
  const releases = [];
  for (let page = 1; page <= MAX_API_PAGES; page += 1) {
    const url = `${context.apiUrl}${context.repositoryPath}/releases?per_page=${PAGE_SIZE}&page=${page}`;
    const body = await requestJson(context, url, "release listing");
    if (!Array.isArray(body)) {
      throw new RollbackReadinessError("release listing did not return an array");
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
  if (typeof options.fetchImpl !== "function" && typeof globalThis.fetch !== "function") {
    throw new Error("fetch implementation is required");
  }
  const target = parseFinalTag(options.tag);
  const [owner, repo] = resolveRepository(options);
  const apiUrl = (options.apiUrl || "https://api.github.com").replace(/\/+$/, "");
  const context = {
    apiUrl,
    apiOrigin: originOf(apiUrl),
    repositoryPath: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    token: options.token || "",
    fetchImpl: options.fetchImpl || globalThis.fetch,
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
      ready: result.ready,
      "baseline-tag": result.baseline?.tag ?? "",
      "baseline-version": result.baseline?.version ?? "",
      "baseline-url": result.baseline?.url ?? "",
      "baseline-waived": result.baselineWaived,
      "rollback-platforms": result.platforms.join(","),
    })
      .map(([key, value]) => `${key}=${String(value)}`)
      .join("\n") + "\n",
  );
  const detail = result.baseline
    ? `- Rollback target: \`${result.baseline.tag}\` (published ${result.baseline.publishedAt})\n- Platforms the updater can roll back: ${result.platforms.join(", ")}\n`
    : "- Rollback target: none — waived as a first release\n";
  appendFileSync(
    requiredEnv(env, "GITHUB_STEP_SUMMARY"),
    `### Rollback readiness verified\n\n- Rolling out: \`${result.tag}\`\n${detail}`,
  );
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
