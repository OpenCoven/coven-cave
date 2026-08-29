#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const SHA_RE = /^[0-9a-f]{40}$/i;

function validatedRef(ref) {
  const components = typeof ref === "string" ? ref.split("/") : [];
  if (
    typeof ref !== "string"
    || ref.length === 0
    || ref === "@"
    || ref.startsWith("-")
    || ref.startsWith("/")
    || ref.endsWith("/")
    || ref.endsWith(".")
    || ref.includes("..")
    || ref.includes("//")
    || ref.includes("@{")
    || /[\u0000-\u0020\u007f~^:?*[\\]/.test(ref)
    || components.some((component) => component.startsWith(".") || component.endsWith(".lock"))
  ) {
    throw new Error(`run base ref is missing or malformed (${ref ?? "unknown"})`);
  }
  return ref;
}

function validatedSnapshot(ref, sha) {
  const validatedBaseRef = validatedRef(ref);
  if (!SHA_RE.test(sha ?? "")) {
    throw new Error(`run base SHA is missing or malformed (${sha ?? "unknown"})`);
  }
  return { ref: validatedBaseRef, sha };
}

/**
 * Capture the immutable base snapshot that this CI run is validating.
 *
 * Both a pull_request event's `base.sha` and a recovery dispatch's Actions-run
 * `pull_requests[].base.sha` can remain tied to an older base after the branch
 * moves. Only the base ref is retained; its live tip at selector start is the
 * snapshot. Later jobs receive this exact pair via `needs.paths.outputs` and
 * compare it with the then-live ref.
 */
export function resolveRunBaseSnapshot(
  {
    eventName,
    eventBaseRef,
    expectedHeadSha,
    prNumber,
    refName,
  },
  { getPullRequest, getRef } = {},
) {
  if (eventName === "pull_request") {
    if (typeof getRef !== "function") {
      throw new Error("pull request base resolution is unavailable");
    }
    const baseRef = validatedRef(eventBaseRef);
    const liveRef = getRef(baseRef);
    return validatedSnapshot(baseRef, liveRef?.object?.sha);
  }

  if (eventName === "workflow_dispatch") {
    if (!/^[1-9][0-9]*$/.test(prNumber ?? "")) {
      throw new Error(`recovery PR number is missing or malformed (${prNumber ?? "unknown"})`);
    }
    if (typeof getPullRequest !== "function" || typeof getRef !== "function") {
      throw new Error("recovery base resolution is unavailable");
    }
    const pullRequest = getPullRequest(prNumber);
    const baseRef = validatedRef(pullRequest?.base?.ref);
    const liveRef = getRef(baseRef);
    return validatedSnapshot(baseRef, liveRef?.object?.sha);
  }

  if (eventName === "push") {
    return validatedSnapshot(refName, expectedHeadSha);
  }

  throw new Error(`unsupported CI event (${eventName ?? "unknown"})`);
}

function ghJson(endpoint) {
  const output = execFileSync("gh", ["api", endpoint], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  return JSON.parse(output);
}

export function main(env = process.env) {
  try {
    const snapshot = resolveRunBaseSnapshot(
      {
        eventName: env.GITHUB_EVENT_NAME,
        eventBaseRef: env.EVENT_BASE_REF,
        expectedHeadSha: env.EXPECTED_HEAD_SHA,
        prNumber: env.PR_NUMBER,
        refName: env.GITHUB_REF_NAME,
      },
      {
        getPullRequest: (number) => ghJson(`repos/${env.GITHUB_REPOSITORY}/pulls/${number}`),
        getRef: (ref) => ghJson(`repos/${env.GITHUB_REPOSITORY}/git/ref/heads/${ref}`),
      },
    );
    process.stdout.write(`run_base_ref=${snapshot.ref}\n`);
    process.stdout.write(`run_base_sha=${snapshot.sha}\n`);
  } catch (error) {
    console.error(`capture-ci-base-snapshot: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
