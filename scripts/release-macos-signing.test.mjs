import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const releaseScript = readFileSync(
  fileURLToPath(new URL("./release.sh", import.meta.url)),
  "utf8",
);
const releaseWorkflow = readFileSync(
  fileURLToPath(new URL("../.github/workflows/release.yml", import.meta.url)),
  "utf8",
);
const sidecarScript = readFileSync(
  fileURLToPath(new URL("./sidecar-bundle.sh", import.meta.url)),
  "utf8",
);
const sidecarTargetModule = readFileSync(
  fileURLToPath(new URL("./sidecar-target.mjs", import.meta.url)),
  "utf8",
);

function getWorkflowJob(name) {
  const lines = releaseWorkflow.split(/\r?\n/);
  const marker = `  ${name}:`;
  const start = lines.findIndex((line) => line === marker);
  assert.notEqual(start, -1, `release workflow must define the ${name} job`);

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z0-9_-]+:\s*$/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

test("macOS release signing includes native files without executable mode", () => {
  assert.match(
    releaseScript,
    /-name "\*\.node" -o -name "spawn-helper" -o -name "espeak-ng" -o -perm \+111/,
  );
  const nativeSigning = releaseScript.slice(
    releaseScript.indexOf('echo "==> Signing every native binary inside the bundle"'),
    releaseScript.indexOf('echo "==> Sealing the .app envelope"'),
  );
  assert.match(nativeSigning, /! retry 3 10 codesign[\s\S]*exit 1/);
  assert.doesNotMatch(
    nativeSigning,
    /failed to sign[\s\S]*\n\s*\}/,
    "a nested signing failure must not be downgraded to a warning",
  );
});

test("sidecar bundle restores executable mode for node-pty spawn-helper", () => {
  assert.match(sidecarScript, /fix_node_pty_spawn_helpers\(\)/);
  assert.match(sidecarScript, /find "\$prebuilds" -path "\*\/darwin-\*\/spawn-helper"/);
  assert.match(sidecarScript, /chmod 755 "\$helper"/);
  assert.match(sidecarScript, /fix_node_pty_spawn_helpers "\$PNPM_STAGE\/node_modules"/);
  assert.match(sidecarScript, /fix_node_pty_spawn_helpers "\$DEST\/node_modules"/);
});

test("Apple ID notarization avoids putting the app password in process arguments", () => {
  assert.match(releaseScript, /setup_notary_keychain_profile\(\)/);
  assert.match(releaseScript, /printf '%s\\n' "\$NOTARY_APPLE_PASSWORD" \| xcrun notarytool store-credentials/);
  assert.match(releaseScript, /retry 3 10 store_notary_credentials/);
  assert.match(releaseScript, /NOTARY_KEYCHAIN_DIR="\$\(mktemp -d -t covencave-notary-keychain\)"/);
  assert.match(releaseScript, /--keychain-profile "\$NOTARY_KEYCHAIN_PROFILE"/);
  assert.match(releaseScript, /security delete-keychain "\$NOTARY_KEYCHAIN_PATH"/);
  assert.match(releaseScript, /rm -rf "\$NOTARY_KEYCHAIN_DIR"/);

  const cleanupFunction = releaseScript.slice(
    releaseScript.indexOf("cleanup_release_artifacts()"),
    releaseScript.indexOf("trap cleanup_release_artifacts EXIT"),
  );
  const setupFunctions = releaseScript.slice(
    releaseScript.indexOf("store_notary_credentials()"),
    releaseScript.indexOf("print_notary_log()"),
  );
  const logFunction = releaseScript.slice(
    releaseScript.indexOf("print_notary_log()"),
    releaseScript.indexOf("run_notary_submit()"),
  );
  const submitFunction = releaseScript.slice(
    releaseScript.indexOf("run_notary_submit()"),
    releaseScript.indexOf("cleanup_dmg_artifacts()"),
  );

  assert.match(cleanupFunction, /local exit_status=\$\?/);
  assert.match(cleanupFunction, /rm -rf "\$NOTARY_KEYCHAIN_DIR" \|\| true/);
  assert.match(cleanupFunction, /rm -rf "\$DMG_STAGE" \|\| true/);
  assert.match(cleanupFunction, /return "\$exit_status"/);
  assert(
    cleanupFunction.indexOf('security delete-keychain "$NOTARY_KEYCHAIN_PATH"') <
      cleanupFunction.indexOf('rm -rf "$DMG_STAGE"'),
    "credential cleanup must run before best-effort DMG cleanup",
  );
  assert.doesNotMatch(setupFunctions, /--password/);
  assert.doesNotMatch(logFunction, /--password "\$NOTARY_APPLE_PASSWORD"/);
  assert.doesNotMatch(submitFunction, /--password "\$NOTARY_APPLE_PASSWORD"/);

  const setupCall = releaseScript.lastIndexOf("setup_notary_keychain_profile");
  assert(
    setupCall > releaseScript.indexOf('echo "==> Signing DMG container"'),
    "the credential profile must not exist during build or packaging",
  );
  assert(
    setupCall < releaseScript.indexOf('echo "==> Submitting DMG for notarization"'),
    "the credential profile should be created immediately before notarization",
  );
});

test("notary rejection stops before stapling and prints the Apple log", () => {
  assert.match(releaseScript, /print_notary_log\(\)/);
  assert.match(releaseScript, /Submission in terminal status: Invalid/);
  assert.match(releaseScript, /Notary submission did not report Accepted/);
  // (cave-1hha) the call site is the retry wrapper now — transient submit
  // failures retry, an Invalid verdict still stops before stapling.
  assert.match(releaseScript, /notarize_with_retries\n\n/);
  assert(
    releaseScript.indexOf("notarize_with_retries") <
      releaseScript.indexOf('echo "==> Stapling notarization ticket"'),
  );
});

test("DMG packaging retries transient hdiutil resource-busy failures", () => {
  assert.match(releaseScript, /create_dmg_with_retry\(\)/);
  assert.match(releaseScript, /hdiutil detach "\$mount" -force/);
  assert.match(releaseScript, /Resource busy/);
  assert.match(releaseScript, /hdiutil create[\s\S]*"\$DMG_PATH"/);
  assert.match(releaseScript, /create_dmg_with_retry\n\n/);
  assert(
    releaseScript.indexOf("create_dmg_with_retry") <
      releaseScript.indexOf('echo "==> Signing DMG container"'),
  );
});

test("DMG packaging applies a branded Finder background and icon layout", () => {
  const dmgBackgroundUrl = new URL("../src-tauri/assets/dmg-background.png", import.meta.url);

  assert.equal(existsSync(dmgBackgroundUrl), true, "branded DMG background asset should exist");
  assert.deepEqual(
    [...readFileSync(dmgBackgroundUrl).subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    "DMG background should be a PNG",
  );
  assert.match(releaseScript, /DMG_BACKGROUND="src-tauri\/assets\/dmg-background\.png"/);
  assert.match(releaseScript, /require_file "\$DMG_BACKGROUND"/);
  assert.match(releaseScript, /mkdir -p "\$DMG_STAGE\/\.background"/);
  assert.match(
    releaseScript,
    /cp "\$DMG_BACKGROUND" "\$DMG_STAGE\/\.background\/coven-cave-dmg\.png"/,
  );
  assert.match(releaseScript, /hdiutil create[\s\S]*-format UDRW[\s\S]*"\$DMG_RW_PATH"/);
  assert.match(releaseScript, /hdiutil attach "\$DMG_RW_PATH"[\s\S]*-mountpoint "\$DMG_MOUNT"/);
  assert.match(releaseScript, /set background picture of opts to file "\.background:coven-cave-dmg\.png"/);
  assert.match(releaseScript, /set icon size of opts to 96/);
  assert.match(releaseScript, /set position of item "CovenCave\.app" to \{168, 252\}/);
  assert.match(releaseScript, /set position of item "Applications" to \{568, 252\}/);
  assert.match(releaseScript, /hdiutil convert "\$DMG_RW_PATH"[\s\S]*-format UDZO[\s\S]*"\$DMG_PATH"/);
});

test("Linux release job forces AppImage extract-and-run mode", () => {
  assert.match(releaseWorkflow, /APPIMAGE_EXTRACT_AND_RUN:/);
  assert.match(releaseWorkflow, /matrix\.family == 'linux'/);
  assert.match(
    releaseWorkflow,
    /label: Linux \(AppImage\)[\s\S]*args: '-vv --bundles appimage/,
    "Linux AppImage packaging should keep verbose linuxdeploy logs available",
  );
});

// One spelling of the step name, used by every reference below. Three copies
// drifted apart once already (#2987 renamed the step; one lookup kept the old
// name and silently resolved to -1), so this is deliberately a single constant.
const STRIP_STEP_NAME = "name: Strip bundled GLib/libmount from AppImage";

test("Linux AppImage strips bundled GLib/libmount so host libraries stay ABI-compatible", () => {
  assert.ok(releaseWorkflow.includes(STRIP_STEP_NAME), "strip step must exist under its exact name");
  assert.match(releaseWorkflow, /libglib-2\.0\*/);
  assert.match(releaseWorkflow, /APPIMAGETOOL_SHA256: \$\{\{ vars\.APPIMAGETOOL_SHA256 \}\}/);
  assert.match(releaseWorkflow, /sha256sum --check --status/);
  assert.match(releaseWorkflow, /libmount\.so\.1\*/);
  assert.match(releaseWorkflow, /libblkid\.so\.1\*/);
  assert.match(releaseWorkflow, /libuuid\.so\.1\*/);
  assert.match(releaseWorkflow, /libsystemd\.so\.0\*/);
  assert.match(releaseWorkflow, /libwayland-\*\.so\*/);
  assert.match(releaseWorkflow, /appimagetool squashfs-root/);
  assert.match(releaseWorkflow, /name: Upload and re-sign stripped AppImage/);
  assert.match(releaseWorkflow, /gh release upload "\$RELEASE_TAG" "\$APPIMAGE" --clobber/);
  assert.match(releaseWorkflow, /pnpm exec tauri signer sign/);
  assert(
    releaseWorkflow.indexOf("name: Sign Linux/Windows updater artifact") <
      releaseWorkflow.indexOf(STRIP_STEP_NAME),
    "GLib strip must run after initial signing so the repacked artifact is the final signed version",
  );
  assert(
    releaseWorkflow.indexOf('gh release upload "$RELEASE_TAG" "$APPIMAGE" --clobber') <
      releaseWorkflow.indexOf('gh release upload "$RELEASE_TAG" "${APPIMAGE}.sig" --clobber'),
    "the repacked AppImage itself must be uploaded before its regenerated signature",
  );
  // Match the step by shape rather than by its exact title. What this guard is
  // actually about is the SLICE — the lines below assert the strip step carries
  // no GH_TOKEN and no signing key — and pinning the full name coupled that
  // safety check to cosmetic wording. #2987 added libmount stripping, renamed
  // the step to "Strip bundled GLib/libmount from AppImage", and turned main
  // red on a required check (cave-ewnel).
  const stripStepMatch = releaseWorkflow.match(/name: Strip bundled [^\n]*AppImage/);
  const stripStepStart = stripStepMatch?.index ?? -1;
  const stripStepEnd = releaseWorkflow.indexOf("name: Upload and re-sign stripped AppImage");
  assert.ok(
    stripStepStart !== -1,
    "strip step must exist (a step named 'Strip bundled … AppImage')",
  );
  assert.ok(stripStepEnd > stripStepStart, "upload/re-sign step must follow the strip step");
  const stripStep = releaseWorkflow.slice(stripStepStart, stripStepEnd);
  assert.ok(stripStep.length > 0, "strip-step slice must be non-empty for the secret-isolation guard to mean anything");
  assert.doesNotMatch(stripStep, /GH_TOKEN/);
  assert.doesNotMatch(stripStep, /TAURI_SIGNING_PRIVATE_KEY/);
});

test("manual release verifies the tag once and pins publication to its commit", () => {
  assert.doesNotMatch(releaseWorkflow, /source_ref:/);
  assert.doesNotMatch(releaseWorkflow, /github\.event\.inputs\.source_ref/);
  assert.match(
    releaseWorkflow,
    /release-commit: \$\{\{ steps\.release\.outputs\.commit \}\}/,
    "the source gate must preserve the commit authorized by signed promotion",
  );
  for (const jobName of ["build", "checksums", "updater-manifest"]) {
    assert.match(
      getWorkflowJob(jobName),
      /ref: \$\{\{ needs\.source-version\.outputs\.release-commit \}\}/,
      `${jobName} must use the immutable commit verified by the source-version gate`,
    );
  }
  assert.match(
    releaseWorkflow,
    /RAW_RELEASE_TAG: \$\{\{ github\.event\.inputs\.tag \|\| github\.ref_name \}\}/,
    "release attachment metadata must continue to come from the tag input",
  );
  assert.match(
    releaseWorkflow,
    /use_current_release_tooling:[\s\S]*default: false[\s\S]*type: boolean/,
    "recovery tooling overlay must require an explicit manual-dispatch input",
  );
  assert.match(
    releaseWorkflow,
    /name: Overlay audited recovery release tooling[\s\S]*github\.event_name == 'workflow_dispatch' && inputs\.use_current_release_tooling/,
    "tag pushes must never overlay release tooling",
  );
  assert.match(
    releaseWorkflow,
    /RECOVERY_TOOLING_SHA: \$\{\{ github\.sha \}\}[\s\S]*git fetch --no-tags --depth=1 origin "\$RECOVERY_TOOLING_SHA"/,
    "manual recovery tooling must be pinned to the reviewed workflow commit",
  );
  assert.match(
    releaseWorkflow,
    /scripts\/release\.sh[\s\S]*scripts\/sidecar-bundle\.sh[\s\S]*scripts\/windows-msi-budget\.ps1/,
    "the allowlist must cover only the three packaging scripts needed by v0.2.0 recovery",
  );
});

test("release packages and checksum manifest receive GitHub artifact attestations", () => {
  const buildJob = getWorkflowJob("build");
  const checksumsJob = getWorkflowJob("checksums");

  for (const job of [buildJob, checksumsJob]) {
    assert.match(job, /^\s{4}permissions:\n\s{6}contents: write\n\s{6}id-token: write\n\s{6}attestations: write$/m);
  }

  assert.match(
    buildJob,
    /name: Attest Linux AppImage[\s\S]*uses: actions\/attest@[0-9a-f]{40} # v4[\s\S]*subject-path: src-tauri\/target\/release\/bundle\/\*\*\/\*\.AppImage/,
  );
  assert.match(
    buildJob,
    /name: Attest Windows MSI[\s\S]*uses: actions\/attest@[0-9a-f]{40} # v4[\s\S]*subject-path: src-tauri\/target\/release\/bundle\/\*\*\/\*\.msi/,
  );
  assert.match(
    buildJob,
    /name: Attest macOS DMG[\s\S]*uses: actions\/attest@[0-9a-f]{40} # v4[\s\S]*subject-path: release\/CovenCave-v\$\{\{ env\.RELEASE_VERSION \}\}-\$\{\{ matrix\.arch_suffix \}\}\.dmg/,
  );
  assert.match(
    checksumsJob,
    /name: Attest SHA256SUMS[\s\S]*uses: actions\/attest@[0-9a-f]{40} # v4[\s\S]*subject-path: _release\/SHA256SUMS/,
  );

  assert(
    buildJob.indexOf("name: Upload and re-sign stripped AppImage") <
      buildJob.indexOf("name: Attest Linux AppImage"),
    "the final repacked AppImage must be uploaded and re-signed before it is attested",
  );
  assert(
    buildJob.indexOf("name: Publish verified signed Windows MSI") <
      buildJob.indexOf("name: Attest Windows MSI"),
    "the verified signed MSI must be uploaded before it is attested",
  );
  assert(
    buildJob.indexOf("name: Verify macOS DMG is notarized") <
      buildJob.indexOf("name: Attest macOS DMG"),
    "the DMG must pass notarization verification before it is attested",
  );
  assert(
    checksumsJob.indexOf("name: Compute SHA256SUMS") <
      checksumsJob.indexOf("name: Attest SHA256SUMS"),
    "the checksum manifest must be complete before it is attested",
  );
});

const parsedReleaseWorkflow = parse(releaseWorkflow);

function workflowStepRun(jobName, stepName) {
  const step = parsedReleaseWorkflow.jobs[jobName].steps.find((candidate) => candidate.name === stepName);
  assert.ok(step, `${jobName} must define "${stepName}"`);
  return step.run;
}

// Runs a workflow step's bash with a stub `gh` first on PATH. Each answer
// replies to calls whose arguments contain `match`; `outputs` are returned in
// order, the last one repeating. Returns the exit status, stdout, every gh
// call, and what the step wrote to GITHUB_OUTPUT.
function runStepWithStubGh(script, env, answers) {
  const dir = mkdtempSync(join(tmpdir(), "release-object-"));
  try {
    writeFileSync(join(dir, "answers.json"), JSON.stringify(answers));
    writeFileSync(join(dir, "github-output"), "");
    writeFileSync(
      join(dir, "gh"),
      `#!/usr/bin/env node
const { appendFileSync, existsSync, readFileSync, writeFileSync } = require("node:fs");
const dir = ${JSON.stringify(dir)};
const args = process.argv.slice(2);
appendFileSync(dir + "/calls.jsonl", JSON.stringify(args) + "\\n");
const answers = JSON.parse(readFileSync(dir + "/answers.json", "utf8"));
const statePath = dir + "/state.json";
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};
const index = answers.findIndex((answer) => args.join(" ").includes(answer.match));
if (index === -1) process.exit(0);
const seen = state[index] ?? 0;
state[index] = seen + 1;
writeFileSync(statePath, JSON.stringify(state));
const { outputs = [""], status = 0 } = answers[index];
const output = outputs[Math.min(seen, outputs.length - 1)];
if (output) process.stdout.write(output + "\\n");
process.exit(status);
`,
      { mode: 0o755 },
    );
    const result = spawnSync("bash", ["-c", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        GITHUB_OUTPUT: join(dir, "github-output"),
        GITHUB_REPOSITORY: "OpenCoven/coven-cave",
        RELEASE_TAG: "v9.9.9",
        ...env,
      },
    });
    const callsPath = join(dir, "calls.jsonl");
    const calls = existsSync(callsPath)
      ? readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line))
      : [];
    return {
      status: result.status,
      stdout: result.stdout,
      calls,
      output: readFileSync(join(dir, "github-output"), "utf8"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("only the release-object job creates a release, and never as latest (#6248)", () => {
  assert.equal(
    releaseWorkflow.match(/gh release create/g)?.length,
    1,
    "a second creator brings back the race that published two releases for v0.5.16",
  );
  const releaseObject = getWorkflowJob("release-object");
  assert.match(releaseObject, /gh release create "\$RELEASE_TAG"[\s\S]*--verify-tag[\s\S]*--latest=false/);
  assert.match(releaseObject, /timeout-minutes: 10/);
  assert.deepEqual(
    parsedReleaseWorkflow.jobs["release-object"].needs,
    parsedReleaseWorkflow.jobs.build.needs.filter((need) => need !== "release-object"),
    "the release is created behind exactly the gates the builds wait for",
  );
  assert.ok(parsedReleaseWorkflow.jobs.build.needs.includes("release-object"));

  const buildJob = getWorkflowJob("build");
  assert.doesNotMatch(
    buildJob,
    /tagName:|releaseName:|releaseId:|releaseDraft:/,
    "tauri-action creates a missing release whenever it is given release inputs",
  );
});

test("release-object adopts one final release, creates a missing one, and refuses duplicates", () => {
  const script = workflowStepRun("release-object", "Find or create the release for this tag");
  const list = "releases?per_page=100";
  const env = { DESKTOP_UPLOADS: "true" };
  const creates = (calls) => calls.filter((args) => args[0] === "release" && args[1] === "create");

  const created = runStepWithStubGh(script, env, [{ match: list, outputs: ["", "111 false false 0"] }]);
  assert.equal(created.status, 0, created.stdout);
  assert.equal(creates(created.calls).length, 1);
  assert.ok(creates(created.calls)[0].includes("--latest=false"));
  assert.ok(creates(created.calls)[0].includes("--verify-tag"));
  assert.equal(created.output, "id=111\n");

  const adopted = runStepWithStubGh(script, env, [{ match: list, outputs: ["111 false false 12"] }]);
  assert.equal(adopted.status, 0, adopted.stdout);
  assert.equal(creates(adopted.calls).length, 0);
  assert.equal(adopted.output, "id=111\n");

  const duplicate = runStepWithStubGh(script, env, [
    { match: list, outputs: ["111 false false 12\n112 false false 0"] },
  ]);
  assert.notEqual(duplicate.status, 0);
  assert.equal(creates(duplicate.calls).length, 0);
  assert.match(duplicate.stdout, /found 2[\s\S]*111 false false 12[\s\S]*112 false false 0/);
  assert.equal(duplicate.output, "");

  for (const unfinished of ["111 true false 0", "111 false true 0"]) {
    const refused = runStepWithStubGh(script, env, [{ match: list, outputs: [unfinished] }]);
    assert.notEqual(refused.status, 0, `${unfinished} must not receive final assets`);
    assert.equal(refused.output, "");
  }

  const iosOnly = runStepWithStubGh(script, { DESKTOP_UPLOADS: "false" }, []);
  assert.equal(iosOnly.status, 0);
  assert.deepEqual(iosOnly.calls, [], "a run without desktop uploads leaves releases alone");
  assert.equal(iosOnly.output, "");
});

// The stub gh above ignores repository context, which is how release-object
// shipped a `gh release create` that real gh could not run (#6288).
test("every repository-scoped gh command knows its repository", () => {
  const scoped = /\bgh (?:release|pr|issue|run|workflow|repo|cache|secret|variable|attestation)\b[^\n]*/g;
  const missing = [];
  for (const [jobName, job] of Object.entries(parsedReleaseWorkflow.jobs)) {
    let checkedOut = false;
    for (const step of job.steps ?? []) {
      if (step.uses?.startsWith("actions/checkout@")) checkedOut = true;
      const env = { ...parsedReleaseWorkflow.env, ...job.env, ...step.env };
      for (const [command] of (step.run ?? "").matchAll(scoped)) {
        if (!checkedOut && !env.GH_REPO && !/--repo |-R /.test(command)) {
          missing.push(`${jobName} / ${step.name}: ${command.trim()}`);
        }
      }
    }
  }
  assert.deepEqual(missing, [], "without a checkout, set GH_REPO or pass --repo");
  const step = parsedReleaseWorkflow.jobs["release-object"].steps.find((candidate) => candidate.id === "release");
  assert.equal(step.env.GH_REPO, "${{ github.repository }}");
});

test("each build leg claims the release right before its first upload", () => {
  const linuxWindows = workflowStepRun("build", "Claim the release for the Linux/Windows upload");
  const macos = workflowStepRun("build", "Claim the release for the macOS upload");
  assert.equal(linuxWindows, macos, "both claims must apply one rule");

  const buildJob = getWorkflowJob("build");
  const position = (name) => {
    const index = buildJob.indexOf(`- name: ${name}\n`);
    assert.notEqual(index, -1, `build must define "${name}"`);
    return index;
  };
  const ordered = (names) => {
    const positions = names.map(position);
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b), names.join(" < "));
  };
  ordered([
    "Build Linux AppImage without publishing",
    "Measure and enforce Windows MSI budget",
    "Claim the release for the Linux/Windows upload",
    "Publish verified signed Windows MSI",
    "Sign Linux/Windows updater artifact",
    "Upload and re-sign stripped AppImage",
  ]);
  ordered([
    "Verify macOS DMG is notarized",
    "Claim the release for the macOS upload",
    "Upload macOS DMG to GitHub Release",
  ]);
  assert.doesNotMatch(
    buildJob.slice(0, position("Claim the release for the Linux/Windows upload")),
    /gh release upload/,
    "nothing uploads before a leg has claimed the release",
  );
  const claimStep = buildJob.slice(
    position("Claim the release for the Linux/Windows upload"),
    position("Publish verified signed Windows MSI"),
  );
  assert.match(claimStep, /!inputs\.windows_diagnostics_only/, "a diagnostics run claims nothing");
});

test("a claim promotes only an empty release and stops on a release it did not expect", () => {
  const script = workflowStepRun("build", "Claim the release for the macOS upload");
  const byTag = "releases/tags/v9.9.9";
  const promotions = (calls) =>
    calls.filter((args) => args.includes("PATCH") && args.includes("make_latest=true"));

  const first = runStepWithStubGh(script, { RELEASE_ID: "111" }, [{ match: byTag, outputs: ["111 0"] }]);
  assert.equal(first.status, 0, first.stdout);
  assert.equal(promotions(first.calls).length, 1, "the first upload makes the release latest");
  assert.ok(promotions(first.calls)[0].includes("repos/OpenCoven/coven-cave/releases/111"));

  const later = runStepWithStubGh(script, { RELEASE_ID: "111" }, [{ match: byTag, outputs: ["111 7"] }]);
  assert.equal(later.status, 0, later.stdout);
  assert.deepEqual(
    promotions(later.calls),
    [],
    "a release with assets is never promoted again, so a rerun cannot undo a rollback",
  );

  const other = runStepWithStubGh(script, { RELEASE_ID: "111" }, [{ match: byTag, outputs: ["222 0"] }]);
  assert.notEqual(other.status, 0, "uploads by tag would land on another release");
  assert.deepEqual(promotions(other.calls), []);

  const missing = runStepWithStubGh(script, { RELEASE_ID: "" }, [{ match: byTag, outputs: ["111 0"] }]);
  assert.notEqual(missing.status, 0);
  assert.deepEqual(promotions(missing.calls), []);
});

const WINDOWS_SIGNING_INPUTS = [
  "ES_USERNAME",
  "ES_PASSWORD",
  "CREDENTIAL_ID",
  "ES_TOTP_SECRET",
  "WINDOWS_SIGNING_CERT_THUMBPRINT",
];

function windowsReleaseStep(name) {
  const step = parsedReleaseWorkflow.jobs.build.steps.find((candidate) => candidate.name === name);
  assert.ok(step, `build must define "${name}"`);
  return step;
}

function assertSkippedForDiagnostics(step) {
  assert.match(step.if ?? "", /matrix\.family == 'windows'/, `${step.name} must be Windows-only`);
  assert.match(
    step.if ?? "",
    /\(github\.event_name != 'workflow_dispatch' \|\| !inputs\.windows_diagnostics_only\)/,
    `${step.name} must not run on a diagnostics-only dispatch`,
  );
  assert.equal(step["continue-on-error"], undefined, `${step.name} must fail closed`);
}

function runWindowsSigningGate(env) {
  const script = windowsReleaseStep("Require Windows signing configuration").run;
  const filtered = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !WINDOWS_SIGNING_INPUTS.includes(key)),
  );
  return spawnSync("bash", ["-c", script], { encoding: "utf8", env: { ...filtered, ...env } });
}

const COMPLETE_WINDOWS_SIGNING_INPUTS = {
  MATRIX_FAMILY: "windows",
  ES_USERNAME: "user",
  ES_PASSWORD: "password",
  CREDENTIAL_ID: "credential",
  ES_TOTP_SECRET: "totp",
  WINDOWS_SIGNING_CERT_THUMBPRINT: "0123456789abcdef0123456789ABCDEF01234567",
};

test("Windows signing inputs are required by name before the MSI is built (#5739)", () => {
  const gate = windowsReleaseStep("Require Windows signing configuration");
  assert.equal(gate.shell, "bash");
  assert.equal(gate["continue-on-error"], undefined);
  assert.doesNotMatch(gate.if, /matrix\./, "a tag push must always evaluate the gate");
  assert.match(gate.if, /\(github\.event_name != 'workflow_dispatch' \|\| !inputs\.windows_diagnostics_only\)/);
  for (const name of WINDOWS_SIGNING_INPUTS) {
    const source = name === "WINDOWS_SIGNING_CERT_THUMBPRINT" ? `vars.${name}` : `secrets.${name}`;
    assert.equal(
      gate.env[name],
      `\${{ matrix.family == 'windows' && ${source} || '' }}`,
      `${name} reaches only the Windows leg`,
    );
  }
  assert.doesNotMatch(gate.run, /echo[^\n]*\$(ES_|CREDENTIAL|value|\{!name)/, "never print a secret");

  const complete = runWindowsSigningGate(COMPLETE_WINDOWS_SIGNING_INPUTS);
  assert.equal(complete.status, 0, complete.stdout + complete.stderr);

  for (const name of WINDOWS_SIGNING_INPUTS) {
    for (const value of ["", "   "]) {
      const result = runWindowsSigningGate({ ...COMPLETE_WINDOWS_SIGNING_INPUTS, [name]: value });
      assert.notEqual(result.status, 0, `a ${value ? "blank" : "missing"} ${name} must stop the leg`);
      assert.match(
        result.stdout,
        new RegExp(`::error::Windows signing configuration is missing ${name}\\. See docs/workflows/windows-msi-signing\\.md\\.`),
      );
    }
  }
  for (const thumbprint of ["0123", "0123456789abcdef0123456789abcdef0123456g", "01:23:45:67:89:ab:cd:ef:01:23:45:67:89:ab:cd:ef:01:23:45:67"]) {
    const result = runWindowsSigningGate({ ...COMPLETE_WINDOWS_SIGNING_INPUTS, WINDOWS_SIGNING_CERT_THUMBPRINT: thumbprint });
    assert.notEqual(result.status, 0, `${thumbprint} is not a thumbprint`);
    assert.match(result.stdout, /::error::WINDOWS_SIGNING_CERT_THUMBPRINT must be 40 hexadecimal digits/);
  }
  for (const family of ["macos", "linux"]) {
    const result = runWindowsSigningGate({ MATRIX_FAMILY: family });
    assert.equal(result.status, 0, `the ${family} leg needs no Windows input`);
  }

  const steps = parsedReleaseWorkflow.jobs.build.steps.map((step) => step.name);
  assert.ok(
    steps.indexOf("Require Windows signing configuration") < steps.indexOf("Build Windows MSI without publishing"),
    "a missing input must stop the leg before the MSI build",
  );
});

test("Windows signer archive is verified before signing credentials are in scope", () => {
  const verify = windowsReleaseStep("Verify Windows signing tool");
  assertSkippedForDiagnostics(verify);
  assert.equal(verify.env, undefined, "no secret is in scope while the archive is downloaded");
  assert.match(verify.run, /e22094505decbe622afe5b0c27abc618ed2ba179bd94f3450490352399d5ef2a/);
  assert.ok(verify.run.indexOf("SHA-256 mismatch") < verify.run.indexOf("Expand-Archive"));
  assert.ok(verify.run.indexOf("Expand-Archive") < verify.run.indexOf("CODESIGNTOOL_PATH="));

  const sign = windowsReleaseStep("Sign Windows MSI with SSL.com eSigner");
  assertSkippedForDiagnostics(sign);
  assert.match(sign.uses, /^SSLcom\/esigner-codesign@[0-9a-f]{40}$/);
  assert.equal(sign.with.file_path, "${{ env.WINDOWS_MSI_PATH }}");
  assert.equal(sign.with.output_path, "${{ env.WINDOWS_SIGNED_DIR }}");
  assert.equal(sign.with.environment_name, "PROD");
  for (const [input, secret] of [
    ["username", "ES_USERNAME"],
    ["password", "ES_PASSWORD"],
    ["credential_id", "CREDENTIAL_ID"],
    ["totp_secret", "ES_TOTP_SECRET"],
  ]) {
    assert.equal(sign.with[input], `\${{ secrets.${secret} }}`);
  }
});

test("Windows MSI is signed, Authenticode-verified and hashed before the release is claimed", () => {
  const buildJob = getWorkflowJob("build");
  const ordered = [
    "Require Windows signing configuration",
    "Build Windows MSI without publishing",
    "Measure and enforce Windows MSI budget",
    "Verify Windows signing tool",
    "Stage Windows MSI for code signing",
    "Sign Windows MSI with SSL.com eSigner",
    "Verify signed Windows MSI",
    "Claim the release for the Linux/Windows upload",
    "Publish verified signed Windows MSI",
    "Recheck the signed Windows MSI before updater signing",
    "Sign Linux/Windows updater artifact",
    "Recheck the signed Windows MSI before attestation",
    "Attest Windows MSI",
  ];
  const positions = ordered.map((name) => buildJob.indexOf(`- name: ${name}\n`));
  ordered.forEach((name, index) => assert.notEqual(positions[index], -1, `build must define "${name}"`));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b), ordered.join(" < "));
  assert.doesNotMatch(
    buildJob.slice(positions[1], positions[7]),
    /gh release upload|make_latest/,
    "an unsigned or unverified MSI never reaches or promotes the release",
  );

  const verify = windowsReleaseStep("Verify signed Windows MSI");
  assertSkippedForDiagnostics(verify);
  assert.equal(verify.env.WINDOWS_SIGNING_CERT_THUMBPRINT, "${{ vars.WINDOWS_SIGNING_CERT_THUMBPRINT }}");
  assert.match(verify.run, /Get-AuthenticodeSignature -LiteralPath \$signedMsi\.FullName/);
  assert.match(verify.run, /\$signature\.Status -ne 'Valid'/);
  assert.match(verify.run, /SignerCertificate\.Thumbprint -ne \$env:WINDOWS_SIGNING_CERT_THUMBPRINT/);
  assert.match(verify.run, /\$null -eq \$signature\.TimeStamperCertificate/);
  assert.match(verify.run, /windows-msi-budget\.ps1[\s\S]*-MsiPath \$signedMsi\.FullName/);
  assert.match(verify.run, /Copy-Item -LiteralPath \$signedMsi\.FullName -Destination \$env:WINDOWS_MSI_PATH/);
  assert.match(verify.run, /"WINDOWS_MSI_SHA256=\$signedHash"/, "the verified hash is the one every later step binds to");
  assert.ok(
    verify.run.indexOf("Get-AuthenticodeSignature") < verify.run.indexOf("Copy-Item"),
    "the release path is replaced only after verification passes",
  );
});

test("Windows upload, updater signature and attestation bind the verified MSI hash", () => {
  const publish = windowsReleaseStep("Publish verified signed Windows MSI");
  assertSkippedForDiagnostics(publish);
  assert.ok(
    publish.run.indexOf("WINDOWS_MSI_SHA256") < publish.run.indexOf("gh release upload"),
    "the MSI is rechecked before it is uploaded",
  );
  assert.match(publish.run, /gh release upload \$env:RELEASE_TAG \$env:WINDOWS_MSI_PATH --clobber/);
  assert.match(publish.run, /\.digest/, "the uploaded asset digest is compared with the verified hash");
  assert.match(publish.run, /"sha256:\$\(\$env:WINDOWS_MSI_SHA256\.ToLowerInvariant\(\)\)"/);

  const beforeUpdater = windowsReleaseStep("Recheck the signed Windows MSI before updater signing");
  const beforeAttest = windowsReleaseStep("Recheck the signed Windows MSI before attestation");
  assert.equal(beforeUpdater.run, beforeAttest.run, "both rechecks apply one rule");
  for (const step of [beforeUpdater, beforeAttest]) {
    assertSkippedForDiagnostics(step);
    assert.match(step.run, /Get-ChildItem -Path src-tauri\/target\/release\/bundle -Recurse -Filter \*\.msi -File/);
    assert.match(step.run, /\$msis\.Count -ne 1 -or \$msis\[0\]\.FullName -ne \$env:WINDOWS_MSI_PATH/);
    assert.match(step.run, /Get-FileHash -LiteralPath \$env:WINDOWS_MSI_PATH -Algorithm SHA256/);
    assert.match(step.run, /-ne \$env:WINDOWS_MSI_SHA256/);
  }
  assert.equal(
    windowsReleaseStep("Attest Windows MSI").with["subject-path"],
    "src-tauri/target/release/bundle/**/*.msi",
  );
});

test("a diagnostics-only Windows dispatch builds and measures without signing or publishing", () => {
  const steps = parsedReleaseWorkflow.jobs.build.steps;
  for (const name of ["Build Windows MSI without publishing", "Measure and enforce Windows MSI budget"]) {
    const step = steps.find((candidate) => candidate.name === name);
    assert.doesNotMatch(step.if, /windows_diagnostics_only/, `${name} still runs for diagnostics`);
  }
  for (const step of steps) {
    const touchesSigning =
      /esigner|Authenticode|signing configuration|signing tool|signed Windows MSI|Attest Windows MSI/i.test(step.name ?? "") ||
      Object.keys(step.env ?? {}).some((key) => WINDOWS_SIGNING_INPUTS.includes(key));
    if (!touchesSigning) continue;
    if (step.name === "Require Windows signing configuration") {
      assert.match(step.if, /!inputs\.windows_diagnostics_only/);
    } else {
      assertSkippedForDiagnostics(step);
    }
  }
});

test("sidecar bundle prunes foreign native packages before release bundling", () => {
  assert.match(sidecarScript, /prune_foreign_native_packages\(\)/);
  assert.match(sidecarScript, /process\.platform/);
  assert.match(sidecarScript, /process\.arch/);
  // The per-target native package names now live in the shared, importable
  // single source of truth (scripts/sidecar-target.mjs), consumed by the prune
  // via `eval "$(node … --sh …)"` and asserted per-OS by the cross-environment
  // conformance suite (#1990). Verify the prune wires up the module and that
  // the module still derives the @next/swc-<libc> + @img/sharp-libvips targets.
  assert.match(sidecarScript, /sidecar-target\.mjs.*--sh/);
  assert.match(sidecarTargetModule, /@next\/swc-linux-\$\{arch\}-\$\{libc\}/);
  assert.match(sidecarTargetModule, /@img\/sharp-libvips-darwin-\$\{arch\}/);
  assert.match(sidecarScript, /node-pty\/prebuilds/);
  assert.match(sidecarScript, /rm -rf "\$base\/fsevents"/);
  assert(
    sidecarScript.indexOf('prune_foreign_native_packages "$PNPM_STAGE/node_modules"') <
      sidecarScript.indexOf('fix_node_pty_spawn_helpers "$PNPM_STAGE/node_modules"'),
    "native package pruning should run before node-pty permission repair",
  );
});

// ── Transient-failure retries (cave-1hha) ────────────────────────────────────
// The Intel leg failed 3 of 4 cuts on network-dependent steps: the Next
// build's Google Fonts fetch, Apple's timestamp service during codesign, and
// a notary submit. Each retries; an Apple REJECTION (Invalid) never retries.
test("release.sh retries its network-dependent steps", () => {
  assert.match(releaseScript, /^retry\(\) \{/m, "a retry helper exists");
  assert.match(releaseScript, /retry 2 30 env \\/, "the tauri build (font fetch inside) gets one retry");
  assert.match(releaseScript, /retry 3 15 codesign --force --options runtime --timestamp/, "the envelope seal retries the timestamp service");
  assert.match(releaseScript, /retry 3 10 codesign --force --options runtime --timestamp/, "inner-binary signs retry the timestamp service");
  assert.match(releaseScript, /notarize_with_retries/, "notary submission goes through the retry loop");
  assert.match(releaseScript, /2\) echo "Apple rejected the submission \(Invalid\) — not retrying\." >&2; exit 1 ;;/, "a real Invalid verdict never retries");
});

// ── App entitlements survive the manual re-sign (#5822) ──────────────────────
// `tauri build` signs the app with src-tauri/Entitlements.plist, then
// release.sh re-signs the bundle. A seal without --entitlements replaces that
// signature with one that has none, and the hardened runtime then makes macOS
// deny the microphone without a prompt. v0.5.7 shipped that way.
test("the envelope seal carries the app entitlements Tauri declares", () => {
  const tauriConfig = JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../src-tauri/tauri.conf.json", import.meta.url)),
      "utf8",
    ),
  );
  const declaredPath = join("src-tauri", tauriConfig.bundle.macOS.entitlements);
  assert.equal(declaredPath, "src-tauri/Entitlements.plist");
  assert.match(
    releaseScript,
    /^APP_ENTITLEMENTS="src-tauri\/Entitlements\.plist"$/m,
    "release.sh seals with the same entitlements file tauri build uses",
  );
  assert.match(releaseScript, /^require_file "\$APP_ENTITLEMENTS"$/m);

  const entitlements = readFileSync(
    fileURLToPath(new URL("../src-tauri/Entitlements.plist", import.meta.url)),
    "utf8",
  );
  assert.match(
    entitlements,
    /<key>com\.apple\.security\.device\.audio-input<\/key>\s*<true\/>/,
    "voice calls need the hardened-runtime microphone entitlement",
  );

  const seal = releaseScript.slice(
    releaseScript.indexOf('echo "==> Sealing the .app envelope"'),
    releaseScript.indexOf('echo "==> Verifying signature"'),
  );
  assert.match(
    seal,
    /codesign --force --options runtime --timestamp \\\n\s+--entitlements "\$APP_ENTITLEMENTS" \\\n\s+--sign "\$SIGNING_IDENTITY" "\$APP_PATH"/,
    "the seal signs the main executable, so it must pass the app entitlements",
  );
});

test("the release stops before packaging when the sealed app lost an entitlement", () => {
  const sealAt = releaseScript.indexOf('echo "==> Sealing the .app envelope"');
  const gateAt = releaseScript.indexOf('\nverify_app_entitlements "$APP_PATH"\n');
  const packageAt = releaseScript.indexOf('echo "==> Packaging DMG with Applications shortcut"');
  assert.notEqual(gateAt, -1, "release.sh checks the sealed app's entitlements");
  assert(sealAt < gateAt && gateAt < packageAt, "the check runs after the seal and before the DMG is built");
});

function entitlementGateSource() {
  const start = releaseScript.indexOf("verify_app_entitlements() {");
  assert.notEqual(start, -1, "release.sh defines verify_app_entitlements");
  const end = releaseScript.indexOf("\n}\n", start);
  return releaseScript.slice(start, end + 3);
}

test(
  "the entitlement check passes a correctly signed binary and rejects a stripped one",
  { skip: process.platform !== "darwin" && "codesign and PlistBuddy exist only on macOS" },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "cave-entitlement-gate-"));
    try {
      const declared = fileURLToPath(new URL("../src-tauri/Entitlements.plist", import.meta.url));
      const binary = join(dir, "app");
      copyFileSync("/usr/bin/true", binary);
      const gate = join(dir, "gate.sh");
      writeFileSync(
        gate,
        `set -euo pipefail\nAPP_ENTITLEMENTS="$1"\n${entitlementGateSource()}\nverify_app_entitlements "$2"\n`,
      );
      const sign = (...extra) =>
        execFileSync("codesign", ["--force", "--options", "runtime", ...extra, "--sign", "-", binary], {
          stdio: "pipe",
        });
      const runGate = (entitlementsPath) =>
        spawnSync("bash", [gate, entitlementsPath, binary], { encoding: "utf8" });

      sign();
      const stripped = runGate(declared);
      assert.equal(stripped.status, 1, "a signature without entitlements fails the release");
      assert.match(stripped.stderr, /missing entitlement: com\.apple\.security\.device\.audio-input/);
      assert.match(stripped.stderr, /missing entitlement: com\.apple\.security\.device\.camera/);

      sign("--entitlements", declared);
      const sealed = runGate(declared);
      assert.equal(sealed.status, 0, sealed.stderr);
      assert.match(sealed.stdout, /carries all 2 declared entitlements/);

      const empty = join(dir, "empty.plist");
      writeFileSync(
        empty,
        '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict/></plist>\n',
      );
      const unreadable = runGate(empty);
      assert.equal(unreadable.status, 1, "an entitlements file with no keys fails closed");
      assert.match(unreadable.stderr, /no entitlements could be read/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
