import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

const root = new URL("../", import.meta.url);

async function workflow(name) {
  return parse(await readFile(new URL(`.github/workflows/${name}`, root), "utf8"));
}

function pnpmCommands(job) {
  return job.steps
    .map((step) => step.run)
    .filter((run) => typeof run === "string" && run.startsWith("pnpm "));
}

function needs(job) {
  return Array.isArray(job.needs) ? job.needs : job.needs ? [job.needs] : [];
}

function dependsOn(jobs, name, prerequisite, seen = new Set()) {
  if (name === prerequisite) return true;
  if (seen.has(name)) return false;
  seen.add(name);
  return needs(jobs[name]).some((dependency) => dependsOn(jobs, dependency, prerequisite, seen));
}

test("PR checks is an always-reporting merge-ref Linux gate during migration", async () => {
  const ci = await workflow("ci.yml");
  const job = ci.jobs["pr-checks"];

  assert.deepEqual(ci.on.pull_request, { branches: ["main"] });
  assert.ok(ci.on.push, "Phase 1 retains the existing main push trigger");
  assert.equal(job.name, "PR checks");
  assert.equal(job["runs-on"], "ubuntu-latest");
  assert.match(
    job.steps.find((step) => step.uses?.startsWith("actions/checkout@")).with.ref,
    /refs\/pull\/.*merge/,
    "PR checks must test GitHub's merge ref",
  );
  assert.deepEqual(pnpmCommands(job), [
    "pnpm install --frozen-lockfile",
    "pnpm lint",
    "pnpm typecheck",
    "pnpm check:tests-wired",
    "pnpm test:app",
    "pnpm test:api",
    "pnpm test:mobile",
  ]);
  assert.doesNotMatch(
    job.steps.map((step) => step.run ?? "").join("\n"),
    /\bpnpm build\b|\bcargo\b|\bplaywright\b|conformance|sidecar|xcodebuild/i,
    "deferred validation must not consume routine PR capacity",
  );
});

test("candidate validation requires signed tag provenance and calls every deferred suite", async () => {
  const [candidate, full] = await Promise.all([
    workflow("release-candidate.yml"),
    workflow("full-validation.yml"),
  ]);

  assert.equal(candidate.name, "Release candidate");
  assert.deepEqual(candidate.on.push.tags, ["v*-rc.*"]);
  assert.equal(candidate.on.workflow_dispatch.inputs.tag.required, true);
  assert.equal(candidate.concurrency.group, "release-candidate-${{ github.event.inputs.tag || github.ref_name }}");
  assert.equal(candidate.concurrency["cancel-in-progress"], false);
  assert.deepEqual(candidate.jobs.provenance.permissions, { actions: "read", contents: "read" });
  const candidateCheckout = candidate.jobs.provenance.steps.find((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  assert.equal(
    candidateCheckout?.with?.["fetch-depth"],
    0,
    "manual candidate validation must fetch main history to prove an older tag is an ancestor",
  );
  assert.equal(candidateCheckout?.with?.["persist-credentials"], false);
  assert.match(
    candidate.jobs.provenance.steps.map((step) => step.run ?? "").join("\n"),
    /node scripts\/release-promotion\.mjs candidate/,
  );
  assert.equal(candidate.jobs["full-validation"].needs, "provenance");
  assert.equal(candidate.jobs["full-validation"].uses, "./.github/workflows/full-validation.yml");
  assert.equal(candidate.jobs["full-validation"].with.ref, "${{ needs.provenance.outputs.commit }}");

  assert.ok(full.on.workflow_call, "full validation is reusable only");
  assert.deepEqual(Object.keys(full.jobs).sort(), [
    "e2e",
    "frontend",
    "release-candidate-validated",
    "runtime",
    "rust",
    "windows-native",
  ]);
  assert.deepEqual(pnpmCommands(full.jobs.frontend), [
    "pnpm install --frozen-lockfile",
    "pnpm lint",
    "pnpm typecheck",
    "pnpm check:tests-wired",
    "pnpm test:app",
    "pnpm test:api",
    "pnpm test:mobile",
  ]);
  assert.deepEqual(full.jobs.frontend.env, {
    NEXT_PUBLIC_CAVE_CRAFTS: "1",
  });
  assert.match(
    full.jobs.frontend.steps.at(-1).run,
    /for attempt in 1 2 3; do[\s\S]*pnpm build[\s\S]*rm -rf \.next/,
    "candidate frontend validation retains the Turbopack retry",
  );
  assert.match(
    full.jobs.rust.steps.map((step) => step.run ?? "").join("\n"),
    /cargo check --locked[\s\S]*cargo test --locked --lib/,
    "Rust validation includes the persisted mobile-token library coverage",
  );
  const e2eRuns = full.jobs.e2e.steps.map((step) => step.run ?? "").join("\n");
  assert.match(
    e2eRuns,
    /playwright install --with-deps chromium webkit/,
    "candidate E2E installs both required browser engines",
  );
  assert.ok(
    full.jobs.e2e.steps.some((step) => step.run === "pnpm exec playwright test"),
    "candidate E2E retains the default Chromium and WebKit coverage",
  );
  const agenticE2e = full.jobs.e2e.steps.find(
    (step) =>
      step.run ===
      "pnpm exec playwright test tests/agentic-enhance.spec.ts tests/research-desk-tabs.spec.ts --project=desktop --workers=1 --no-deps",
  );
  assert.deepEqual(agenticE2e?.env, {
    NEXT_PUBLIC_CAVE_AGENTIC_RECOMMENDATIONS: "1",
  });
  assert.deepEqual(full.jobs.runtime.strategy.matrix.os, [
    "ubuntu-24.04",
    "windows-latest",
    "macos-15",
  ]);
  assert.match(
    full.jobs.runtime.steps.map((step) => step.run ?? "").join("\n"),
    /pnpm test:conformance[\s\S]*bash scripts\/sidecar-bundle\.sh[\s\S]*pnpm test:sidecar-runtime/,
  );
  assert.match(
    full.jobs.runtime.steps.map((step) => step.run ?? "").join("\n"),
    /cargo test --manifest-path src-tauri\/Cargo\.toml --locked sidecar_archive/,
    "Windows sidecar lifecycle coverage remains with the packaged runtime",
  );
  assert.equal(full.jobs["windows-native"]["runs-on"], "windows-latest");
  const rollup = full.jobs["release-candidate-validated"];
  assert.equal(rollup.name, "Release candidate validated");
  assert.equal(rollup.if, "always()");
  assert.deepEqual(rollup.needs, ["frontend", "rust", "e2e", "runtime", "windows-native"]);
  assert.match(
    rollup.steps[0].run,
    /test "\$FRONTEND_RESULT" = "success"[\s\S]*test "\$WINDOWS_NATIVE_RESULT" = "success"/,
    "the rollup must fail closed for failed, skipped, or cancelled dependencies",
  );
});

test("final publishing is final-tag-only and transitively promotion-authorized", async () => {
  const release = await workflow("release.yml");
  const authorization = release.jobs["authorize-release-promotion"];

  assert.deepEqual(release.on.push.tags, ["v*.*.*", "!v*.*.*-*"]);
  assert.equal(authorization.name, "Authorize release promotion");
  assert.deepEqual(authorization.permissions, { actions: "read", contents: "read" });
  const authorizationCheckout = authorization.steps.find((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  assert.equal(
    authorizationCheckout?.with?.["fetch-depth"],
    0,
    "authorization must retain full history for merge-base checks on historical manual tags",
  );
  assert.equal(authorizationCheckout?.with?.["persist-credentials"], false);
  assert.match(
    authorization.steps.map((step) => step.run ?? "").join("\n"),
    /node scripts\/release-promotion\.mjs release/,
  );
  assert.equal(release.jobs["daemon-package"].needs, "authorize-release-promotion");
  assert.equal(release.jobs["source-version"].needs, "authorize-release-promotion");
  assert.equal(
    release.jobs["source-version"].outputs["release-commit"],
    "${{ steps.release.outputs.commit }}",
  );
  for (const publishingJob of [
    "release-ios-build",
    "build",
    "checksums",
    "updater-manifest",
    "homebrew",
  ]) {
    assert.equal(
      dependsOn(release.jobs, publishingJob, "authorize-release-promotion"),
      true,
      `${publishingJob} must be transitively downstream of authorization`,
    );
  }
});

test("Phase 1 documentation preserves the live required context during migration", async () => {
  const [crossEnvironment, mergeSkill] = await Promise.all([
    readFile(new URL("docs/cross-environment.md", root), "utf8"),
    readFile(new URL(".agents/skills/branch-to-merge/SKILL.md", root), "utf8"),
  ]);

  assert.match(crossEnvironment, /requires `Frontend build`/);
  assert.match(crossEnvironment, /`PR checks`/);
  assert.match(mergeSkill, /- `Frontend build`/);
  assert.match(mergeSkill, /`PR checks` now reports in parallel/);
});

console.log("release-promotion-workflow.test.mjs: ok");
