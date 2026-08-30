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
    "e2e-agentic",
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
    full.jobs.e2e.steps.some(
      (step) =>
        step.run ===
        "pnpm exec playwright test --shard=${{ matrix.shard }}/8 --workers=1",
    ),
    "candidate E2E isolates each worker behind its own dev server",
  );
  assert.equal(full.jobs.e2e.name, "Validate candidate E2E (${{ matrix.shard }}/8)");
  assert.equal(full.jobs.e2e.strategy["fail-fast"], false);
  assert.deepEqual(full.jobs.e2e.strategy.matrix.shard, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(full.jobs.e2e["timeout-minutes"], 30);
  const agenticE2e = full.jobs["e2e-agentic"];
  assert.equal(agenticE2e.name, "Validate candidate E2E (agentic)");
  assert.equal(agenticE2e["timeout-minutes"], 30);
  assert.deepEqual(agenticE2e.env, {
    NEXT_PUBLIC_CAVE_AGENTIC_RECOMMENDATIONS: "1",
  });
  assert.ok(
    agenticE2e.steps.some(
      (step) =>
        step.run ===
        "pnpm exec playwright test tests/agentic-enhance.spec.ts tests/research-desk-tabs.spec.ts --project=desktop --workers=1 --no-deps",
    ),
    "candidate E2E retains flag-enabled agentic coverage in an isolated job",
  );
  const agenticCheckout = agenticE2e.steps.find(
    (step) =>
      typeof step.uses === "string" && step.uses.startsWith("actions/checkout@"),
  );
  assert.equal(agenticCheckout?.with?.ref, "${{ inputs.ref }}");
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
  assert.deepEqual(rollup.needs, [
    "frontend",
    "rust",
    "e2e",
    "e2e-agentic",
    "runtime",
    "windows-native",
  ]);
  assert.match(
    rollup.steps[0].run,
    /test "\$FRONTEND_RESULT" = "success"[\s\S]*test "\$E2E_AGENTIC_RESULT" = "success"[\s\S]*test "\$WINDOWS_NATIVE_RESULT" = "success"/,
    "the rollup must fail closed for failed, skipped, or cancelled dependencies",
  );
});

test("final publishing is final-tag-only and transitively promotion-authorized", async () => {
  const release = await workflow("release.yml");
  const authorization = release.jobs["authorize-release-promotion"];
  const releaseWeb = release.jobs["release-web-validation"];
  const releaseWebCore = release.jobs["release-web-core"];

  assert.deepEqual(release.on.push.tags, ["v*.*.*", "!v*.*.*-*"]);
  assert.ok(releaseWeb, "release workflow keeps the web validation gate");
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
  const releaseE2e = release.jobs["release-e2e"];
  assert.equal(releaseE2e.name, "Validate release E2E (${{ matrix.shard }}/8)");
  assert.equal(releaseE2e.strategy["fail-fast"], false);
  assert.deepEqual(releaseE2e.strategy.matrix.shard, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(
    releaseE2e.steps.some(
      (step) =>
        step.run ===
        "pnpm exec playwright test --shard=${{ matrix.shard }}/8 --workers=1",
    ),
    "final release E2E isolates each worker behind its own dev server",
  );
  const releaseAgentic = release.jobs["release-e2e-agentic"];
  assert.deepEqual(releaseAgentic.env, {
    NEXT_PUBLIC_CAVE_AGENTIC_RECOMMENDATIONS: "1",
  });
  assert.ok(
    releaseAgentic.steps.some(
      (step) =>
        step.run ===
        "pnpm exec playwright test tests/agentic-enhance.spec.ts tests/research-desk-tabs.spec.ts --project=desktop --workers=1 --no-deps",
    ),
  );
  assert.deepEqual(release.jobs["release-web-validation"].needs, [
    "release-web-core",
    "release-e2e",
    "release-e2e-agentic",
  ]);
  assert.equal(release.jobs["release-web-validation"].if, "always()");
  assert.match(
    release.jobs["release-web-validation"].steps[0].run,
    /test "\$WEB_RESULT" = "success"[\s\S]*test "\$E2E_RESULT" = "success"[\s\S]*test "\$E2E_AGENTIC_RESULT" = "success"/,
  );
  assert.equal(
    release.jobs["release-web-core"].steps.some((step) =>
      String(step.run ?? "").includes("playwright test"),
    ),
    false,
    "the web/unit/build job must not retain a second monolithic Playwright invocation",
  );
  assert.ok(release.jobs["release-ios-build"].needs.includes("release-web-validation"));
  assert.ok(release.jobs.build.needs.includes("release-web-validation"));
  assert.equal(release.jobs["daemon-package"].needs, "authorize-release-promotion");
  assert.equal(release.jobs["source-version"].needs, "authorize-release-promotion");
  assert.equal(releaseWebCore["timeout-minutes"], 90);
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

test("no release gate is silently advisory", async () => {
  const release = await workflow("release.yml");

  // Every gate in this workflow is pinned by a test that asserts the gate is
  // NAMED — that the step exists and runs the right script. Naming is not
  // consulting. `continue-on-error: true` leaves every one of those substrings
  // exactly where it is, on the job or on the step, while the check stops
  // being able to fail anything: the daemon-package gate, the signed
  // OpenCode/Grok registry gates, the X app gate, the signed-tag check in
  // source-version, promotion authorization itself. One line each, and the
  // release ships with the gate green and unverified.
  //
  // `cave-ilh1h` pinned this for `rollback-readiness` alone. This is the same
  // rule for the whole file, expressed as an inventory rather than a per-gate
  // assertion so a gate added later is covered from birth. Exactly one
  // advisory site is expected, and it is deliberate: `homebrew` re-dispatches
  // a tap bump whose own 6-hourly schedule recovers it, so an unforeseen
  // failure there must not fail the release run.
  const advisory = [];
  for (const [name, job] of Object.entries(release.jobs)) {
    if (job["continue-on-error"] !== undefined) advisory.push(name);
    for (const step of job.steps ?? []) {
      if (step["continue-on-error"] !== undefined) {
        advisory.push(`${name}: ${step.name ?? step.uses ?? step.id ?? "<step>"}`);
      }
    }
  }
  assert.deepEqual(
    advisory.sort(),
    ["homebrew"],
    "a new continue-on-error demotes a release gate to advisory — add it here deliberately, with the reason, or remove it",
  );
  assert.equal(release.jobs.homebrew["continue-on-error"], true);
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

// ---------------------------------------------------------------------------
// Pinning release gates by CONSULTING them, not by naming them.
//
// A gate can be pinned two ways and only one of them works. A regex asserting
// the gate's text appears somewhere in release.yml survives every edit that
// keeps the substring while defeating the gate — `continue-on-error: true` on
// the step, or `if: ${{ false }}`, both of which leave the step name, its env
// block and its script path exactly where the naming test looks for them. That
// is the `cave-yp21x` state: v0.2.0 shipped with BOTH compatibility guards
// skipped and nobody noticed for four days, because the only evidence was a
// grey `skipped` line in the job log.
//
// So the assertions below do not read the workflow as text. They EVALUATE the
// conditions the way Actions would, under the scenarios that matter — a tag
// push, a plain recovery dispatch, a dispatch that pulls a documented escape
// hatch, a run whose build leg failed — and assert what each condition does.
// An `if:` that cannot fail the release fails the test regardless of how it is
// spelled.
//
// What follows is a small evaluator for the subset of the Actions expression
// language this workflow uses: `||` `&&` `!` `==` `!=`, parentheses, single
// quoted strings, booleans, context paths, and the four status functions.
// `||` and `&&` return the operand rather than a boolean, as Actions does, so
// `github.event.inputs.tag || github.ref_name` yields a tag string.
// ---------------------------------------------------------------------------

const EXPRESSION_TOKEN =
  /\s*(\|\||&&|==|!=|!|\(|\)|,|'(?:[^']|'')*'|[A-Za-z_][A-Za-z0-9_.-]*|[0-9]+(?:\.[0-9]+)?)/y;

function tokenize(source) {
  const tokens = [];
  EXPRESSION_TOKEN.lastIndex = 0;
  while (EXPRESSION_TOKEN.lastIndex < source.length) {
    const start = EXPRESSION_TOKEN.lastIndex;
    const match = EXPRESSION_TOKEN.exec(source);
    if (!match) {
      if (source.slice(start).trim() === "") break;
      throw new Error(`unparsable expression at ${JSON.stringify(source.slice(start))}`);
    }
    tokens.push(match[1]);
  }
  return tokens;
}

function truthy(value) {
  return value !== false && value !== null && value !== undefined && value !== 0 && value !== "";
}

// Actions coerces across types; every comparison in this workflow is a string
// against a string or against an unset context value, so normalising absent to
// null and comparing identity matches its behaviour for the cases in play.
function looseEquals(left, right) {
  const l = left === undefined ? null : left;
  const r = right === undefined ? null : right;
  if (l === null && r === null) return true;
  if (l === null || r === null) return false;
  return l === r;
}

function evaluateExpression(source, context) {
  const tokens = tokenize(source);
  let position = 0;
  const peek = () => tokens[position];
  const take = () => tokens[position++];
  const expect = (token) => {
    if (take() !== token) throw new Error(`expected ${token} in ${JSON.stringify(source)}`);
  };

  function resolvePath(path) {
    const [rootName, ...rest] = path.split(".");
    if (!(rootName in context)) {
      throw new Error(`unknown context ${JSON.stringify(rootName)} in ${JSON.stringify(source)}`);
    }
    let value = context[rootName];
    for (const segment of rest) {
      if (value === null || value === undefined) return undefined;
      value = value[segment];
    }
    return value;
  }

  function parsePrimary() {
    const token = take();
    if (token === undefined) throw new Error(`unexpected end of ${JSON.stringify(source)}`);
    if (token === "(") {
      const value = parseOr();
      expect(")");
      return value;
    }
    if (token === "!") return !truthy(parsePrimary());
    if (token.startsWith("'")) return token.slice(1, -1).replaceAll("''", "'");
    if (token === "true") return true;
    if (token === "false") return false;
    if (token === "null") return null;
    if (/^[0-9]/.test(token)) return Number(token);
    if (peek() === "(") {
      expect("(");
      expect(")");
      switch (token) {
        case "always":
          return true;
        case "success":
          return context.__status.success;
        case "failure":
          return context.__status.failure;
        case "cancelled":
          return context.__status.cancelled;
        default:
          throw new Error(`unsupported function ${token}() in ${JSON.stringify(source)}`);
      }
    }
    return resolvePath(token);
  }

  function parseComparison() {
    let left = parsePrimary();
    while (peek() === "==" || peek() === "!=") {
      const operator = take();
      const right = parsePrimary();
      left = operator === "==" ? looseEquals(left, right) : !looseEquals(left, right);
    }
    return left;
  }

  function parseAnd() {
    let left = parseComparison();
    while (peek() === "&&") {
      take();
      const right = parseComparison();
      left = truthy(left) ? right : left;
    }
    return left;
  }

  function parseOr() {
    let left = parseAnd();
    while (peek() === "||") {
      take();
      const right = parseAnd();
      left = truthy(left) ? left : right;
    }
    return left;
  }

  const value = parseOr();
  if (position !== tokens.length) {
    throw new Error(`trailing tokens in ${JSON.stringify(source)}`);
  }
  return value;
}

// An `if:` may be written bare or wrapped in `${{ }}`; both mean the same
// thing, and a `>-` folded block arrives here as one line either way.
function evaluateCondition(raw, context) {
  if (raw === undefined || raw === null) return true;
  const text = String(raw).trim();
  const wrapped = /^\$\{\{([\s\S]*)\}\}$/.exec(text);
  return truthy(evaluateExpression(wrapped ? wrapped[1] : text, context));
}

function interpolate(template, context) {
  return String(template).replaceAll(/\$\{\{([\s\S]*?)\}\}/g, (_, expression) => {
    const value = evaluateExpression(expression, context);
    return value === undefined || value === null ? "" : String(value);
  });
}

const RELEASE_TAG = "v9.9.9";

function releaseRun({
  event = "push",
  inputs = {},
  steps = {},
  needs = {},
  matrix = {},
  success = true,
  failure = false,
  cancelled = false,
} = {}) {
  const dispatch = event === "workflow_dispatch";
  return {
    github: {
      event_name: event,
      // The whole point of item 4: these two disagree, and the release does not.
      ref: dispatch ? "refs/heads/main" : `refs/tags/${RELEASE_TAG}`,
      ref_name: dispatch ? "main" : RELEASE_TAG,
      sha: "0".repeat(40),
      event: dispatch
        ? { inputs: { tag: RELEASE_TAG, ...inputs }, repository: { default_branch: "main" } }
        : { repository: { default_branch: "main" } },
    },
    inputs: dispatch ? { tag: RELEASE_TAG, platform: "all", ...inputs } : {},
    needs,
    steps,
    matrix,
    env: {},
    vars: {},
    secrets: {},
    __status: { success, failure, cancelled },
  };
}

// Every step whose name begins with "Require" is a release gate by convention
// in this file — promotion authorization, the daemon package, the signed tag,
// tag/source agreement, the X app, the two signed schema registries. Deriving
// the set instead of listing it is what makes a gate added later covered from
// birth rather than needing its own bespoke pin.
function releaseGateSteps(release) {
  const gates = [];
  for (const [jobName, job] of Object.entries(release.jobs)) {
    for (const step of job.steps ?? []) {
      if (typeof step.name === "string" && /^Require\b/.test(step.name)) {
        gates.push({ job: jobName, jobDefinition: job, step, label: `${jobName}: ${step.name}` });
      }
    }
  }
  return gates;
}

test("no release gate can be switched off by a step-level or job-level if:", async () => {
  const release = await workflow("release.yml");
  const gates = releaseGateSteps(release);

  // The minimum inventory. This is a subset check on purpose: a gate added
  // later is covered by the behavioural assertions below without touching this
  // list, but renaming or deleting one of these is loud.
  for (const required of [
    "authorize-release-promotion: Require signed candidate promotion",
    "daemon-package: Require published @opencoven/cli release",
    "source-version: Require a verified signed tag on main",
    "source-version: Require tag/source version agreement",
    "build: Require OpenCoven X app configuration",
    "build: Require signed OpenCode compatibility registry",
    "build: Require signed Grok compatibility registry",
    "build: Require signed OpenClaw compatibility registry",
  ]) {
    assert.ok(
      gates.some((gate) => gate.label === required),
      `${required} is no longer a "Require …" gate step — was it renamed, or removed?`,
    );
  }

  const tagPush = releaseRun();
  for (const gate of gates) {
    // A gate that cannot fail is not a gate. `continue-on-error` is pinned as
    // an inventory elsewhere in this file; these two keep the gate's own step
    // and its host job honest even if that inventory is relaxed.
    assert.equal(
      gate.step["continue-on-error"],
      undefined,
      `${gate.label} is advisory — it cannot fail the release`,
    );
    assert.equal(
      gate.jobDefinition["continue-on-error"],
      undefined,
      `${gate.label} sits in an advisory job — it cannot fail the release`,
    );
    // The one that a naming regex cannot see: `if: ${{ false }}` keeps every
    // pinned substring in place and stops the check from ever running.
    assert.equal(
      evaluateCondition(gate.jobDefinition.if, tagPush),
      true,
      `${gate.label}'s job does not run on a tag push`,
    );
    assert.equal(
      evaluateCondition(gate.step.if, tagPush),
      true,
      `${gate.label} does not run on a tag push — a tag-push release must be fail-closed`,
    );
  }

  // A plain recovery dispatch — no escape-hatch flag pulled — must keep every
  // gate live too. Dispatching is not itself a waiver.
  const plainDispatch = releaseRun({ event: "workflow_dispatch" });
  for (const gate of gates) {
    assert.equal(
      evaluateCondition(gate.jobDefinition.if, plainDispatch) &&
        evaluateCondition(gate.step.if, plainDispatch),
      true,
      `${gate.label} is skipped by an ordinary recovery dispatch`,
    );
  }

  // Exactly three gates are waivable, only by the documented registry hatch, and
  // only on a dispatch. Anything else that goes quiet when every hatch input is
  // pulled is a gate that acquired an escape route nobody wrote down.
  const hatchedDispatch = releaseRun({
    event: "workflow_dispatch",
    inputs: {
      allow_unconfigured_registries: true,
      allow_unconfigured_x_app: true,
      use_current_release_tooling: true,
      windows_diagnostics_only: false,
    },
  });
  const waived = gates
    .filter(
      (gate) =>
        !(
          evaluateCondition(gate.jobDefinition.if, hatchedDispatch) &&
          evaluateCondition(gate.step.if, hatchedDispatch)
        ),
    )
    .map((gate) => gate.label)
    .sort();
  assert.deepEqual(
    waived,
    [
      "build: Require signed Grok compatibility registry",
      "build: Require signed OpenClaw compatibility registry",
      "build: Require signed OpenCode compatibility registry",
    ],
    "a release gate gained an escape hatch — document it here deliberately, with the reason",
  );

  // And the hatch that waives them is the registry flag alone: the X app flag
  // must not silently take the schema registries down with it.
  const xHatchOnly = releaseRun({
    event: "workflow_dispatch",
    inputs: { allow_unconfigured_x_app: true },
  });
  for (const gate of gates) {
    assert.equal(
      evaluateCondition(gate.step.if, xHatchOnly),
      true,
      `${gate.label} is waived by allow_unconfigured_x_app, which is not its hatch`,
    );
  }

  // The X app gate's own off switch is not an `if:` at all — it is an env var
  // the gate script reads, so a condition-shape pin cannot see it. Same
  // failure mode, different spelling: setting it unconditionally ships every
  // release with X disabled while the step stays green and every naming regex
  // in check-x-app-release.test.mjs still matches.
  const xGate = gates.find((gate) => gate.label === "build: Require OpenCoven X app configuration");
  const disabled = xGate.step.env.COVEN_CAVE_X_RELEASE_DISABLED;
  assert.equal(interpolate(disabled, tagPush), "", "a tag push must never ship X disabled");
  assert.equal(
    interpolate(disabled, plainDispatch),
    "",
    "an ordinary recovery dispatch must never ship X disabled",
  );
  assert.equal(
    interpolate(disabled, xHatchOnly),
    "1",
    "allow_unconfigured_x_app is the only thing that may disable the X gate",
  );
});

// The same family of off switch as the X gate's env above, one step further
// out. `release-notes.test.mjs` pins the CONSUMER thoroughly — only the literal
// "true" turns the banner on, "1" and "false" do not — and nothing pinned the
// PRODUCER. Replacing either expression with a constant `false`, or dropping
// the env entry, silences the banner for a cut that really did ship with the
// baseline parsers, while every check stays green and every naming regex still
// matches. That is cave-yp21x exactly: v0.2.0 shipped with both guards skipped
// and nobody noticed for four days, because the only evidence was a grey
// "skipped" line in a workflow run.
test("the release-notes guard disclosure is on exactly when its own hatch was pulled", async () => {
  const release = await workflow("release.yml");
  // Located by what it runs rather than by what it is called, so a rename
  // cannot take this pin quiet with it. Collected rather than `find`-ed
  // because a second invoker would otherwise shadow the real one and this
  // whole test would pass against a step that publishes nothing — the
  // neighbouring recovery step, which rewrites the renderer from an audited
  // blob, mentions the same script and does not run it.
  // Anchored to the start of a line, because a substring is not an invocation:
  // `# bash scripts/release-notes.sh …` leaves every character an unanchored
  // regex looks for while running nothing at all. That is the same
  // naming-not-consulting failure this section opens by describing, and it
  // applies to the publish match below just as much.
  const invokesRenderer = /^[ \t]*bash (?:\.\/)?scripts\/release-notes\.sh\b/m;
  const renderers = Object.entries(release.jobs).flatMap(([jobName, job]) =>
    (job.steps ?? [])
      .filter((candidate) => invokesRenderer.test(candidate.run ?? ""))
      .map((step) => ({ jobName, job, step })),
  );
  assert.equal(renderers.length, 1, "exactly one step renders and publishes the release body");
  const [{ jobName, job, step }] = renderers;

  // Rendering is only half the job, and the half that leaves no trace if it is
  // dropped. A step that writes the body to a temp file and never sends it
  // publishes nothing, while both env expressions below still read perfectly
  // and every assertion in this test still passes.
  //
  // The publish is matched against the file the render actually wrote, not
  // against `--notes-file` in the abstract, so pointing the upload at some
  // other path — or at a body composed by hand — fails here rather than
  // reading as a publish that happens to send the wrong bytes.
  const rendered = /^[ \t]*bash (?:\.\/)?scripts\/release-notes\.sh\b[^\n]*?>\s*(\S+)/m.exec(
    step.run,
  );
  assert.ok(rendered, `${jobName} no longer renders the release body to a file`);
  const renderedBody = rendered[1].replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  assert.match(
    step.run,
    new RegExp(String.raw`^[ \t]*gh release edit\b[^\n]*--notes-file\s+${renderedBody}(?:\s|$)`, "m"),
    `${jobName} renders the release body but no longer publishes it`,
  );

  // Each disclosure belongs to exactly one hatch. Pairing them here is what
  // makes the cross-checks below possible: a disclosure wired to the wrong
  // input reads as fine in isolation.
  const disclosures = {
    COVEN_RELEASE_REGISTRY_GUARDS_SKIPPED: "allow_unconfigured_registries",
    COVEN_RELEASE_X_GUARD_SKIPPED: "allow_unconfigured_x_app",
  };

  // A dispatch carries every declared default, so "nothing pulled" is the
  // workflow's own definition of it rather than this file's guess — and a
  // default flipped to true fails here instead of quietly disclosing on every
  // recovery run.
  const declared = release.on.workflow_dispatch.inputs;
  // Declared defaults only. An input with no `default` key — `tag`,
  // `ios_delivery_id` — would otherwise enter the run context as `undefined`
  // and overwrite the value `releaseRun` supplies, quietly unsetting the tag
  // of every dispatch scenario below.
  const defaults = Object.fromEntries(
    Object.entries(declared)
      .filter(([, spec]) => spec?.default !== undefined)
      .map(([name, spec]) => [name, spec.default]),
  );
  for (const hatch of Object.values(disclosures)) {
    assert.equal(declared[hatch].type, "boolean", `${hatch} is no longer a boolean hatch`);
    assert.equal(declared[hatch].default, false, `${hatch} defaults to pulled`);
  }

  const tagPush = releaseRun();
  const plainDispatch = releaseRun({ event: "workflow_dispatch", inputs: defaults });
  const pulls = Object.fromEntries(
    Object.values(disclosures).map((hatch) => [
      hatch,
      releaseRun({ event: "workflow_dispatch", inputs: { ...defaults, [hatch]: true } }),
    ]),
  );

  // A correct value on a step that does not run discloses nothing. Nothing
  // else in this file covers these two conditions — the gate sweep above only
  // walks steps named "Require …", and this step is not one — so an `if:` on
  // the step or on its host job that goes quiet exactly when a hatch is pulled
  // silences the banner with every assertion below still green. Same failure
  // as cave-yp21x, one spelling further out. `windows_diagnostics_only` is
  // deliberately absent: that hatch legitimately skips this job, and every
  // scenario here leaves it at its declared default.
  for (const [occasion, context] of [
    ["a tag push", tagPush],
    ["an ordinary recovery dispatch", plainDispatch],
    ...Object.entries(pulls).map(([hatch, context]) => [`a dispatch that pulled ${hatch}`, context]),
  ]) {
    assert.equal(
      evaluateCondition(job.if, context),
      true,
      `${jobName} does not run on ${occasion} — the release body, and its disclosure, go unpublished`,
    );
    assert.equal(
      evaluateCondition(step.if, context),
      true,
      `the release body is not published on ${occasion} — the disclosure goes with it`,
    );
  }

  // Actions resolves `env` step → job → workflow, and the renderer sees the
  // value from whichever of the three declares it, so all three placements are
  // a real disclosure and only absence from every one of them loses the banner.
  // Resolving in that order also keeps a step-level entry authoritative, which
  // is what Actions does: a step that shadows a correct job-level expression
  // with a constant must still fail here.
  const disclosureEnv = (name) => step.env?.[name] ?? job.env?.[name] ?? release.env?.[name];

  for (const [name, hatch] of Object.entries(disclosures)) {
    const expression = disclosureEnv(name);
    // Dropping the entry is the quietest way to lose the banner: the renderer
    // reads an unset variable as "not skipped" and says nothing.
    assert.ok(expression !== undefined, `${name} is no longer passed to the release-notes renderer`);

    assert.equal(
      interpolate(expression, tagPush),
      "false",
      `${name} discloses a skipped guard on a tag push, which cannot skip one`,
    );
    assert.equal(
      interpolate(expression, plainDispatch),
      "false",
      `${name} discloses a skipped guard on an ordinary recovery dispatch`,
    );

    // Pulling the hatch is the only thing that turns it on, and it turns on
    // only its own disclosure — an X-app recovery must not report the schema
    // registries as skipped, or the banner stops meaning anything.
    const pulled = pulls[hatch];
    assert.equal(
      interpolate(expression, pulled),
      "true",
      `${name} stays silent on a dispatch that pulled ${hatch}`,
    );
    for (const [other, otherHatch] of Object.entries(disclosures)) {
      if (other === name) continue;
      assert.equal(
        interpolate(disclosureEnv(other), pulled),
        "false",
        `${other} is disclosed by ${hatch}, which is ${otherHatch}'s hatch`,
      );
    }
  }
});

test("checksums publishes SHA256SUMS only for a wholly successful build", async () => {
  const release = await workflow("release.yml");
  assert.deepEqual(
    [...needs(release.jobs.checksums)].sort(),
    ["build", "source-version"],
    "checksums must wait for the complete build matrix and stamped source",
  );
  const condition = release.jobs.checksums.if;

  assert.equal(
    typeof condition,
    "string",
    "checksums must keep an explicit condition; the default needs-succeeded rule is not what it asserts",
  );

  assert.equal(
    evaluateCondition(condition, releaseRun()),
    true,
    "a clean tag push must publish checksums",
  );
  assert.equal(
    evaluateCondition(condition, releaseRun({ event: "workflow_dispatch" })),
    true,
    "an ordinary recovery dispatch must publish checksums",
  );

  // The mutation this pin exists for: swapping `success()` for `!cancelled()`
  // keeps the job condition present, keeps every other clause intact, and
  // publishes SHA256SUMS for a build whose macOS leg failed — checksums over a
  // partial asset set, attested and signed as if the cut were whole.
  assert.equal(
    evaluateCondition(condition, releaseRun({ success: false, failure: true })),
    false,
    "checksums must not publish for a partially failed build",
  );
  assert.equal(
    evaluateCondition(condition, releaseRun({ success: false, cancelled: true })),
    false,
    "checksums must not publish for a cancelled build",
  );

  // Windows diagnostics mode measures an MSI and deliberately edits no release
  // metadata, so it must not attach checksums either.
  assert.equal(
    evaluateCondition(
      condition,
      releaseRun({
        event: "workflow_dispatch",
        inputs: { platform: "windows", windows_diagnostics_only: true },
      }),
    ),
    false,
    "windows_diagnostics_only must not publish checksums",
  );
});

test("iOS-only recovery does not run desktop release publication", async () => {
  const release = await workflow("release.yml");
  const iosOnly = releaseRun({
    event: "workflow_dispatch",
    inputs: { platform: "ios" },
    needs: {
      build: { result: "success" },
      "rollback-readiness": { result: "success" },
    },
  });

  for (const name of ["checksums", "updater-manifest"]) {
    assert.equal(
      evaluateCondition(release.jobs[name].if, iosOnly),
      false,
      `${name} must skip when an iOS-only dispatch intentionally produces no desktop release`,
    );
  }

  assert.deepEqual(needs(release.jobs.homebrew), ["checksums"]);
  assert.equal(
    evaluateCondition(
      release.jobs.homebrew.if,
      releaseRun({ cancelled: false, needs: { checksums: { result: "skipped" } } }),
    ),
    false,
    "Homebrew notification must remain transitively skipped with desktop checksums",
  );
});

test("release-ios-build carries its platform selection once, at job level", async () => {
  const release = await workflow("release.yml");
  const ios = release.jobs["release-ios-build"];

  const selects = (inputs) =>
    evaluateCondition(ios.if, releaseRun({ event: "workflow_dispatch", inputs }));
  assert.equal(evaluateCondition(ios.if, releaseRun()), true, "a tag push builds iOS");
  assert.equal(selects({ platform: "all" }), true);
  assert.equal(selects({ platform: "ios" }), true);
  for (const platform of ["macos", "linux", "windows"]) {
    assert.equal(selects({ platform }), false, `platform: ${platform} must not run the iOS job`);
  }

  // Nothing `needs:` this job, so a job-level condition is a pure improvement
  // over 13 copies of it: no downstream job turns from "skipped steps" into
  // "skipped dependency". Assert that, so a future `needs: release-ios-build`
  // has to reconsider it.
  for (const [name, job] of Object.entries(release.jobs)) {
    assert.equal(
      needs(job).includes("release-ios-build"),
      false,
      `${name} now depends on release-ios-build, whose job-level if: skips it for non-iOS platforms`,
    );
  }

  // The selection lives in exactly one place. A step re-stating it is the
  // duplication this replaced; a step *omitting* it used to be the hazard,
  // because it would stage Apple signing material on a windows dispatch.
  for (const step of ios.steps) {
    assert.doesNotMatch(
      step.if ?? "",
      /inputs\.platform/,
      `${step.name ?? step.uses ?? step.run} re-states the job's platform selection`,
    );
  }

  // What the steps DO keep is theirs alone, and still has to work.
  const guarded = ios.steps.filter((step) => step.if !== undefined);
  assert.deepEqual(
    guarded.map((step) => step.name),
    [
      "Install iOS signing assets",
      "Archive the iOS app (signed, TestFlight)",
      "Audit embedded-framework dSYM coverage",
      "Export the iOS app to IPA",
      "Validate, upload, and confirm TestFlight processing",
      "Clean up iOS signing material",
    ],
    "only the recovery-sensitive steps and the cleanup step carry a condition",
  );
  const resuming = releaseRun({
    event: "workflow_dispatch",
    inputs: { platform: "ios", ios_delivery_id: "1234" },
    steps: { "ios-metadata": { outputs: { "resume-confirmed": "true" } } },
    success: false,
    failure: true,
  });
  const fresh = releaseRun({
    steps: { "ios-metadata": { outputs: { "resume-confirmed": "false" } } },
  });
  for (const step of guarded.slice(0, 3)) {
    assert.equal(
      evaluateCondition(step.if, fresh),
      true,
      `${step.name} must run for a fresh archive`,
    );
    assert.equal(
      evaluateCondition(step.if, resuming),
      false,
      `${step.name} must be skipped when a delivery ID resumes an existing upload`,
    );
  }
  assert.equal(
    evaluateCondition(guarded[guarded.length - 1].if, resuming),
    true,
    "signing material must be cleaned up even after a failed archive",
  );
});

test("the release concurrency group keys the release, not the trigger", async () => {
  const [release, candidate] = await Promise.all([
    workflow("release.yml"),
    workflow("release-candidate.yml"),
  ]);
  const group = release.concurrency.group;

  // `github.ref` is `refs/tags/vX.Y.Z` on a tag push but `refs/heads/main` on
  // the workflow_dispatch recovery of that same tag. Keyed on the ref, those
  // two runs sat in different groups and could execute at the same time
  // against one release, racing on `gh release upload --clobber`.
  const fromTagPush = interpolate(group, releaseRun());
  const fromRecovery = interpolate(group, releaseRun({ event: "workflow_dispatch" }));
  assert.equal(
    fromTagPush,
    fromRecovery,
    "a tag push and the recovery dispatch of that same tag must serialise in one group",
  );
  assert.match(fromTagPush, new RegExp(`${RELEASE_TAG}$`), "the group must name the release tag");
  assert.doesNotMatch(group, /github\.ref\b/, "github.ref names the trigger, not the release");

  // Different releases must still run in parallel.
  const otherRelease = interpolate(group, {
    ...releaseRun({ event: "workflow_dispatch" }),
    github: {
      ...releaseRun({ event: "workflow_dispatch" }).github,
      event: { inputs: { tag: "v8.8.8" }, repository: { default_branch: "main" } },
    },
  });
  assert.notEqual(otherRelease, fromTagPush);

  // Concurrency groups are repository-wide, not per-workflow: candidate
  // validation of a tag must not queue behind the final publish of another.
  assert.notEqual(interpolate(candidate.concurrency.group, releaseRun()), fromTagPush);

  // A run interrupted mid-upload leaves the release holding a partial asset
  // set, so the loser queues rather than being cancelled.
  assert.equal(release.concurrency["cancel-in-progress"], false);
});

console.log("release-promotion-workflow.test.mjs: ok");
