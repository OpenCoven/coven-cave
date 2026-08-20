import { execFile } from "node:child_process";
import { appendFileSync } from "node:fs";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

export const RC_TAG_PATTERN =
  /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-rc\.([1-9][0-9]*)$/;
export const FINAL_TAG_PATTERN =
  /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
export const LEGACY_RELEASE_PUBLISHED_BEFORE = Date.parse("2026-08-17T08:21:59Z");
export const LEGACY_RELEASE_WORKFLOW_ID = 286550155;
export const LEGACY_RECOVERY_FINAL_VERSION_EXCLUSIVE = "0.2.4";

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;
const MAX_API_PAGES = 20;
const ROLLUP_JOB_NAME = "Release candidate validated";
const execFileAsync = promisify(execFile);

class InvalidEvidenceError extends Error {}

export function parseCandidateTag(tag) {
  const { rcText: _rcText, ...candidate } = parseCandidateTagParts(tag);
  return candidate;
}

function parseCandidateTagParts(tag) {
  const match = typeof tag === "string" ? RC_TAG_PATTERN.exec(tag) : null;
  if (!match) {
    throw new Error(`'${String(tag)}' is not a valid release-candidate tag`);
  }
  const [, major, minor, patch, rcText] = match;
  const rc = Number(rcText);
  // Reject unsafe integers and special values (Infinity, -Infinity, NaN)
  if (!Number.isSafeInteger(rc) || rc <= 0) {
    throw new Error(`'${String(tag)}' is not a valid release-candidate tag`);
  }
  const version = `${major}.${minor}.${patch}`;
  return { tag, baseTag: `v${version}`, version, rc, rcText };
}

export function parseFinalTag(tag) {
  const match = typeof tag === "string" ? FINAL_TAG_PATTERN.exec(tag) : null;
  if (!match) {
    throw new Error(`'${String(tag)}' is not a valid final release tag`);
  }
  const [, major, minor, patch] = match;
  return { tag, version: `${major}.${minor}.${patch}` };
}

export async function authorizeCandidate(options = {}) {
  const candidate = parseCandidateTag(options.tag);
  const context = createContext(options);
  const verifiedTag = await verifyAnnotatedTag(context, candidate.tag);
  requireEventCommit(context.eventName, context.expectedCommit, verifiedTag.commit, candidate.tag);
  await proveMainAncestry(context, candidate.tag, verifiedTag.commit);

  return {
    ...candidate,
    commit: verifiedTag.commit,
    verificationReason: verifiedTag.verificationReason,
  };
}

export async function authorizeRelease(options = {}) {
  const final = parseFinalTag(options.tag);
  const context = createContext(options);
  const verifiedFinal = await verifyAnnotatedTag(context, final.tag);
  requireEventCommit(context.eventName, context.expectedCommit, verifiedFinal.commit, final.tag);
  await proveMainAncestry(context, final.tag, verifiedFinal.commit);

  if (context.eventName === "workflow_dispatch") {
    const legacy = await findLegacyRecovery(context, final, verifiedFinal.commit);
    if (legacy) {
      return {
        finalTag: final.tag,
        version: final.version,
        commit: verifiedFinal.commit,
        legacyRecovery: true,
        candidateTag: null,
        candidateRunId: null,
        candidateRunUrl: null,
        legacyRunId: legacy.id,
        legacyRunUrl: legacy.htmlUrl,
      };
    }
  }

  const candidate = await findCandidateEvidence(context, final, verifiedFinal.commit);
  if (!candidate) {
    throw new Error(
      `no valid release-candidate validation run authorizes promotion of ${final.tag} ` +
        `(a successful signed release candidate); authorization requires a push candidate ` +
        `at the exact commit and same base version, exactly one validated rollup, and a ` +
        `current signed candidate tag`,
    );
  }

  return {
    finalTag: final.tag,
    version: final.version,
    commit: verifiedFinal.commit,
    candidateTag: candidate.tag,
    candidateRunId: candidate.runId,
    candidateRunUrl: candidate.runUrl,
    legacyRecovery: false,
    legacyRunId: null,
    legacyRunUrl: null,
  };
}

function createContext(options) {
  if (typeof options.fetchImpl !== "function" && typeof globalThis.fetch !== "function") {
    throw new Error("fetch implementation is required");
  }
  const [owner, repo] = resolveRepository(options);
  const apiUrl = (options.apiUrl || "https://api.github.com").replace(/\/+$/, "");
  const origin = new URL(apiUrl).origin;
  const webOrigin = resolveGitHubWebOrigin(apiUrl);
  const repositoryPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const eventName = options.eventName || "push";
  if (eventName !== "push" && eventName !== "workflow_dispatch") {
    throw new Error(`unsupported GitHub event '${eventName}'`);
  }
  return {
    owner,
    repo,
    apiUrl,
    origin,
    webOrigin,
    repositoryPath,
    token: options.token || "",
    eventName,
    expectedCommit: options.expectedCommit,
    fetchImpl: options.fetchImpl || globalThis.fetch,
    execFileImpl: options.execFileImpl || execFileAsync,
  };
}

function resolveGitHubWebOrigin(apiUrl) {
  const url = new URL(apiUrl);
  if (url.hostname.startsWith("api.")) {
    url.hostname = url.hostname.slice(4);
  }
  return url.origin;
}

function resolveRepository(options) {
  if (options.owner && options.repo) return [options.owner, options.repo];
  const parts = options.repository?.split("/") ?? [];
  if (parts.length !== 2 || parts.some((part) => !part)) {
    throw new Error("repository must use the owner/repo form");
  }
  return parts;
}

function requireEventCommit(eventName, expectedCommit, actualCommit, tag) {
  if (eventName !== "push") return;
  if (!isSha(expectedCommit)) {
    throw new Error("expectedCommit must be a 40-hex commit SHA for push events");
  }
  if (expectedCommit.toLowerCase() !== actualCommit) {
    throw new Error(
      `${tag} peels to ${actualCommit}, which does not match expected commit ${expectedCommit.toLowerCase()}`,
    );
  }
}

async function verifyAnnotatedTag(context, tag) {
  const encodedTag = encodeURIComponent(tag);
  const ref = await requestJson(context, `${context.repositoryPath}/git/ref/tags/${encodedTag}`);
  if (!ref || typeof ref !== "object" || ref.object?.type !== "tag") {
    throw new InvalidEvidenceError(`${tag} is not an annotated tag`);
  }
  if (!isSha(ref.object.sha)) {
    throw new InvalidEvidenceError(`${tag} has a malformed annotated tag object SHA`);
  }

  const tagObject = await requestJson(
    context,
    `${context.repositoryPath}/git/tags/${ref.object.sha.toLowerCase()}`,
  );
  if (!tagObject || typeof tagObject !== "object" || tagObject.verification?.verified !== true) {
    throw new InvalidEvidenceError(`${tag} is not a GitHub-verified annotated tag`);
  }
  if (typeof tagObject.verification.reason !== "string" || !tagObject.verification.reason) {
    throw new InvalidEvidenceError(`${tag} has malformed GitHub verification evidence`);
  }
  if (tagObject.object?.type !== "commit" || !isSha(tagObject.object?.sha)) {
    throw new InvalidEvidenceError(`${tag} does not peel to a valid commit SHA`);
  }

  return {
    commit: tagObject.object.sha.toLowerCase(),
    verificationReason: tagObject.verification.reason,
  };
}

async function proveMainAncestry(context, tag, githubCommit) {
  const releaseRef = `refs/coven-release-tags/${tag}`;
  await runGit(context, [
    "fetch",
    "--no-tags",
    "origin",
    `refs/tags/${tag}:${releaseRef}`,
  ]);
  await runGit(context, [
    "fetch",
    "--no-tags",
    "origin",
    "main:refs/remotes/origin/main",
  ]);
  const parsed = await runGit(context, ["rev-parse", `${releaseRef}^{commit}`]);
  const fetchedCommit = parsed.stdout.trim().toLowerCase();
  if (!isSha(fetchedCommit) || fetchedCommit !== githubCommit) {
    throw new Error(
      `fetched tag ${tag} does not match GitHub's peeled commit ${githubCommit}`,
    );
  }
  try {
    await runGit(context, ["merge-base", "--is-ancestor", githubCommit, "origin/main"]);
  } catch {
    throw new Error(`${githubCommit} is not contained in origin/main`);
  }
}

async function runGit(context, args) {
  const result = await context.execFileImpl("git", args, { encoding: "utf8" });
  if (typeof result === "string") return { stdout: result, stderr: "" };
  return {
    stdout: typeof result?.stdout === "string" ? result.stdout : "",
    stderr: typeof result?.stderr === "string" ? result.stderr : "",
  };
}

async function findLegacyRecovery(context, final, commit) {
  if (!isVersionBefore(final.version, LEGACY_RECOVERY_FINAL_VERSION_EXCLUSIVE)) {
    return null;
  }

  const finalTag = final.tag;
  const release = await requestJson(
    context,
    `${context.repositoryPath}/releases/tags/${encodeURIComponent(finalTag)}`,
    { allow404: true },
  );
  if (
    !release ||
    typeof release !== "object" ||
    release.draft !== false ||
    !isBeforeCutoff(release.published_at)
  ) {
    return null;
  }

  const path =
    `${context.repositoryPath}/actions/workflows/${LEGACY_RELEASE_WORKFLOW_ID}/runs` +
    `?branch=${encodeURIComponent(finalTag)}&event=push&status=success&per_page=100`;
  const runs = await collectPages(context, path, "workflow_runs");
  const match = runs.find(
    (run) =>
      run &&
      typeof run === "object" &&
      Number.isInteger(run.id) &&
      run.id > 0 &&
      validRunUrl(context, run.html_url, run.id) !== null &&
      run.event === "push" &&
      run.status === "completed" &&
      run.conclusion === "success" &&
      run.head_branch === finalTag &&
      normalizeSha(run.head_sha) === commit &&
      isBeforeCutoff(run.created_at) &&
      isBeforeCutoff(run.updated_at),
  );
  return match
    ? { id: match.id, htmlUrl: validRunUrl(context, match.html_url, match.id) }
    : null;
}

function isVersionBefore(version, threshold) {
  const versionParts = version.split(".");
  const thresholdParts = threshold.split(".");
  for (let index = 0; index < versionParts.length; index += 1) {
    const comparison = compareNumericStrings(versionParts[index], thresholdParts[index]);
    if (comparison !== 0) return comparison < 0;
  }
  return false;
}

function compareNumericStrings(left, right) {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

async function findCandidateEvidence(context, final, commit) {
  const path =
    `${context.repositoryPath}/actions/workflows/release-candidate.yml/runs` +
    "?event=push&status=success&per_page=100";
  const runs = await collectPages(context, path, "workflow_runs");
  const eligible = [];

  for (const run of runs) {
    if (!run || typeof run !== "object" || typeof run.head_branch !== "string") continue;
    let parsed;
    try {
      parsed = parseCandidateTagParts(run.head_branch);
    } catch {
      continue;
    }
    const runUrl =
      Number.isInteger(run.id) && run.id > 0
        ? validRunUrl(context, run.html_url, run.id)
        : null;
    if (
      parsed.version !== final.version ||
      run.event !== "push" ||
      run.status !== "completed" ||
      run.conclusion !== "success" ||
      normalizeSha(run.head_sha) !== commit ||
      runUrl === null
    ) {
      continue;
    }
    eligible.push({ run, parsed, runUrl });
  }

  const survivors = [];
  for (const { run, parsed, runUrl } of eligible) {
    const jobsPath =
      `${context.repositoryPath}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`;
    const jobs = await collectPages(context, jobsPath, "jobs");
    const rollups = jobs.filter(
      (job) =>
        job &&
        typeof job === "object" &&
        typeof job.name === "string" &&
        (job.name === ROLLUP_JOB_NAME || job.name.endsWith(` / ${ROLLUP_JOB_NAME}`)),
    );
    if (
      rollups.length !== 1 ||
      rollups[0].status !== "completed" ||
      rollups[0].conclusion !== "success"
    ) {
      continue;
    }

    try {
      const currentTag = await verifyAnnotatedTag(context, parsed.tag);
      if (currentTag.commit !== commit) continue;
    } catch (error) {
      if (error instanceof InvalidEvidenceError) continue;
      throw error;
    }
    survivors.push({
      rcText: parsed.rcText,
      tag: parsed.tag,
      runId: run.id,
      runUrl,
    });
  }

  survivors.sort(compareCandidateRcDescending);
  return survivors[0] ?? null;
}

function compareCandidateRcDescending(left, right) {
  if (left.rcText.length !== right.rcText.length) {
    return right.rcText.length - left.rcText.length;
  }
  if (left.rcText === right.rcText) return 0;
  return left.rcText < right.rcText ? 1 : -1;
}

async function collectPages(context, initialPath, arrayKey) {
  let next = new URL(initialPath, context.apiUrl);
  const values = [];
  for (let page = 1; page <= MAX_API_PAGES; page += 1) {
    validatePageUrl(context, next);
    const { body, response } = await requestJson(context, next, { includeResponse: true });
    if (!body || typeof body !== "object" || !Array.isArray(body[arrayKey])) {
      throw new Error(`GitHub response did not contain a valid ${arrayKey} array`);
    }
    values.push(...body[arrayKey]);
    const link = response.headers.get("link");
    const nextLink = parseNextLink(link);
    if (!nextLink) return values;
    next = new URL(nextLink, next);
    validatePageUrl(context, next);
    if (page === MAX_API_PAGES) {
      throw new Error(`GitHub pagination exceeded the ${MAX_API_PAGES}-page limit`);
    }
  }
  return values;
}

function parseNextLink(link) {
  if (!link) return null;
  for (const entry of link.split(",")) {
    const relation = /;\s*rel\s*=\s*"?([^";]+)"?/i.exec(entry);
    if (!relation?.[1].split(/\s+/).includes("next")) continue;
    const target = /^\s*<([^>]+)>/.exec(entry);
    if (!target) throw new Error("GitHub pagination next link is malformed");
    return target[1];
  }
  return null;
}

function validatePageUrl(context, url) {
  if (
    url.origin !== context.origin ||
    !url.pathname.startsWith(`${context.repositoryPath}/`)
  ) {
    throw new Error("pagination next link must be same-origin, same-repository");
  }
}

async function requestJson(context, pathOrUrl, { allow404 = false, includeResponse = false } = {}) {
  const url = pathOrUrl instanceof URL ? pathOrUrl : new URL(pathOrUrl, context.apiUrl);
  const response = await context.fetchImpl(url.href, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${context.token}`,
      "x-github-api-version": "2022-11-28",
    },
  });
  if (allow404 && response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`GitHub API request failed (HTTP ${response.status})`);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("GitHub API returned malformed JSON");
  }
  return includeResponse ? { body, response } : body;
}

function isBeforeCutoff(value) {
  const timestamp = parseStrictIsoTimestamp(value);
  return timestamp !== null && timestamp < LEGACY_RELEASE_PUBLISHED_BEFORE;
}

function parseStrictIsoTimestamp(value) {
  const match = typeof value === "string" ? ISO_TIMESTAMP_PATTERN.exec(value) : null;
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = ""] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const millisecond = Number(fraction.padEnd(3, "0"));
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, millisecond);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second ||
    date.getUTCMilliseconds() !== millisecond
  ) {
    return null;
  }
  return date.getTime();
}

function validRunUrl(context, value, runId) {
  if (typeof value !== "string" || !value.trim()) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const expectedPath =
    `/${encodeURIComponent(context.owner)}/${encodeURIComponent(context.repo)}` +
    `/actions/runs/${runId}`;
  if (
    url.origin !== context.webOrigin ||
    url.username ||
    url.password ||
    url.pathname !== expectedPath ||
    url.search ||
    url.hash
  ) {
    return null;
  }
  return url.href;
}

function isSha(value) {
  return typeof value === "string" && SHA_PATTERN.test(value);
}

function normalizeSha(value) {
  return isSha(value) ? value.toLowerCase() : null;
}

export async function runCli({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = globalThis.fetch,
  execFileImpl = execFileAsync,
} = {}) {
  if (argv.length !== 1 || !["candidate", "release"].includes(argv[0])) {
    throw new Error("usage: node scripts/release-promotion.mjs <candidate|release>");
  }
  const repository = requiredEnv(env, "GITHUB_REPOSITORY");
  const token = requiredEnv(env, "GITHUB_TOKEN");
  const tag = requiredEnv(env, "RELEASE_TAG");
  const eventName = requiredEnv(env, "GITHUB_EVENT_NAME");
  const expectedCommit =
    eventName === "push" ? requiredEnv(env, "EXPECTED_COMMIT") : env.EXPECTED_COMMIT;
  const common = {
    repository,
    token,
    tag,
    eventName,
    expectedCommit,
    apiUrl: env.GITHUB_API_URL || "https://api.github.com",
    fetchImpl,
    execFileImpl,
  };
  const result =
    argv[0] === "candidate"
      ? await authorizeCandidate(common)
      : await authorizeRelease(common);
  writeCliResult(argv[0], result, env);
  return result;
}

function writeCliResult(mode, result, env) {
  const outputPath = requiredEnv(env, "GITHUB_OUTPUT");
  const summaryPath = requiredEnv(env, "GITHUB_STEP_SUMMARY");
  const outputs =
    mode === "candidate"
      ? {
          tag: result.tag,
          "base-tag": result.baseTag,
          version: result.version,
          rc: result.rc,
          commit: result.commit,
          "verification-reason": result.verificationReason,
        }
      : {
          "final-tag": result.finalTag,
          version: result.version,
          commit: result.commit,
          "candidate-tag": result.candidateTag ?? "",
          "candidate-run-id": result.candidateRunId ?? "",
          "candidate-run-url": result.candidateRunUrl ?? "",
          "legacy-recovery": result.legacyRecovery,
          "legacy-run-id": result.legacyRunId ?? "",
          "legacy-run-url": result.legacyRunUrl ?? "",
        };
  appendFileSync(
    outputPath,
    Object.entries(outputs)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join("\n") + "\n",
  );
  const source = result.legacyRecovery
    ? `legacy workflow run ${result.legacyRunId}`
    : mode === "release"
      ? `${result.candidateTag} (run ${result.candidateRunId})`
      : `GitHub-verified annotated tag (${result.verificationReason || "reason unavailable"})`;
  appendFileSync(
    summaryPath,
    `### Release promotion authorized\n\n- Tag: \`${result.tag ?? result.finalTag}\`\n- Commit: \`${result.commit}\`\n- Evidence: ${source}\n`,
  );
}

function requiredEnv(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCli().catch((error) => {
    console.error(`release-promotion: ${error.message}`);
    process.exitCode = 1;
  });
}
