#!/usr/bin/env node
// Physical iPhone warm-journey capture for #5292.
//
// A device keeps only about the last 48 s of signposts per Instruments
// recording, in every recording mode tried, so one long recording cannot hold
// a 20-cycle distribution. This runs one recording per measured cycle: a fresh
// fixture process, Instruments attached to it, the driver's priming cycle plus
// one warm cycle, then the recording saved. The retained tail covers the warm
// cycle. Rounds whose recording hangs, whose driver fails, or whose data starts
// after the warm window are retried, then the rounds are merged.
//
// Build first (docs/performance/ios-performance-audit.md, "Release capture
// driver"), install both apps from Build/Products/Release-iphoneos, and keep
// the phone unlocked in portrait with Auto-Lock off.
//
//   pnpm ios:performance:capture --device <core-device-id> \
//     --products /tmp/cave-performance-release/Build/Products --out /tmp/cave-capture
//   pnpm ios:performance:capture --analyze-only --out /tmp/cave-capture

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import {
  coverageLead,
  markdownTable,
  pairSpans,
  parseCycleWindow,
  parseSpanEvents,
  spansInWindow,
  summarize,
  traceStartSeconds,
} from "./ios-performance-trace.mjs";

const BUNDLE_ID = "ai.opencoven.cave";
const TEST_ID = "PerformanceBaselineUITests/testCurrentShellWarmJourneys";
const COLD_TEST_ID = "PerformanceBaselineUITests/testCurrentShellColdJourneys";
// `--cold` measures the first cycle of each freshly launched fixture process
// (phase "cold-app-launch") instead of a warm cycle after priming. App startup
// precedes the window and is not included.
let measuredPhase = "warm";
const TRIES_PER_ROUND = 3;
const ATTACH_ATTEMPTS = 8;
const SAVE_TIMEOUT_MS = 120_000;
const DRIVER_TIMEOUT_MS = 10 * 60_000;

function parseArgs(argv) {
  const options = { rounds: 20, analyzeOnly: false, resume: false, cold: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      return value;
    };
    if (arg === "--device") options.device = next();
    else if (arg === "--products") options.products = path.resolve(next());
    else if (arg === "--out") options.out = path.resolve(next());
    else if (arg === "--rounds") options.rounds = Number(next());
    else if (arg === "--analyze-only") options.analyzeOnly = true;
    else if (arg === "--resume") options.resume = true;
    else if (arg === "--cold") options.cold = true;
    else throw new Error(`unknown option ${arg}`);
  }
  if (!options.out) throw new Error("--out is required");
  if (!Number.isInteger(options.rounds) || options.rounds < 1 || options.rounds > 100) {
    throw new Error("--rounds must be an integer from 1 to 100");
  }
  if (!options.analyzeOnly && (!options.device || !options.products)) {
    throw new Error("--device and --products are required unless --analyze-only");
  }
  return options;
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options });
}

/**
 * Run devicectl and return its JSON result. `--json-output` goes right after
 * `--device <id>`: for `process launch`, anything after the bundle identifier
 * is passed to the app as launch arguments.
 */
export function withJsonOutput(args, file) {
  const at = args.indexOf("--device");
  if (at < 0 || at + 1 >= args.length) throw new Error("devicectl call is missing --device <id>");
  return [...args.slice(0, at + 2), "--json-output", file, ...args.slice(at + 2)];
}

function devicectlJson(args) {
  const file = path.join(process.env.TMPDIR ?? "/tmp", `cave-devicectl-${process.pid}-${Date.now()}.json`);
  try {
    spawnSync("xcrun", ["devicectl", ...withJsonOutput(args, file)], { stdio: "ignore" });
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  } finally {
    rmSync(file, { force: true });
  }
}

function requireUnlocked(device) {
  const state = devicectlJson(["device", "info", "lockState", "--device", device]);
  if (state?.result?.passcodeRequired !== false) {
    throw new Error("the device is locked or unreachable: unlock it, turn Auto-Lock off, and retry");
  }
}

function hardwareUdid(device) {
  const details = devicectlJson(["device", "info", "details", "--device", device]);
  const udid = details?.result?.hardwareProperties?.udid;
  if (!udid) throw new Error(`could not read the hardware UDID of ${device}`);
  return udid;
}

/**
 * The generated `.xctestrun`, adjusted for attach mode: one measured cycle
 * against the already running fixture, using the installed apps instead of
 * reinstalling over the process Instruments is attached to.
 */
export function attachPlan(generatedPlan, testId = TEST_ID) {
  const plan = structuredClone(generatedPlan);
  const target = plan.CovenCaveUITests;
  if (!target) throw new Error("the xctestrun has no CovenCaveUITests target");
  target.EnvironmentVariables = {
    ...target.EnvironmentVariables,
    CAVE_PERFORMANCE_REPETITIONS: "1",
    CAVE_PERFORMANCE_ATTACH_RUNNING: "1",
  };
  target.OnlyTestIdentifiers = [testId];
  target.UseDestinationArtifacts = true;
  target.UITargetAppBundleIdentifier = BUNDLE_ID;
  target.TestBundleDestinationRelativePath = "__TESTHOST__/PlugIns/CovenCaveUITests.xctest";
  target.UserAttachmentLifetime = "keepAlways";
  delete target.TestBundlePath;
  delete target.TestHostPath;
  delete target.UITargetAppPath;
  return plan;
}

function writeAttachXctestrun(products, testId = TEST_ID) {
  const generated = readdirSync(products).find((name) => /^CovenCavePerformance_iphoneos.*\.xctestrun$/.test(name));
  if (!generated) throw new Error(`no generated CovenCavePerformance xctestrun in ${products}; run build-for-testing first`);
  const plan = attachPlan(JSON.parse(run("plutil", ["-convert", "json", "-o", "-", path.join(products, generated)])), testId);
  // Stay beside the generated file so __TESTROOT__ keeps resolving.
  const attach = path.join(products, "CovenCavePerformance-attach-capture.xctestrun");
  const json = path.join(products, "CovenCavePerformance-attach-capture.json");
  writeFileSync(json, JSON.stringify(plan));
  run("plutil", ["-convert", "xml1", "-o", attach, json]);
  rmSync(json, { force: true });
  return attach;
}

function launchFixture(device, dir) {
  const result = devicectlJson([
    "device", "process", "launch", "--device", device, "--terminate-existing",
    BUNDLE_ID, "--performance-instrumentation", "--performance-fixture",
  ]);
  const pid = result?.result?.process?.processIdentifier;
  if (!pid) throw new Error("could not launch the fixture app");
  writeFileSync(path.join(dir, "launch.json"), JSON.stringify(result, null, 2));
  return pid;
}

/** The PID of Cave's app process on the device, or null when it is not running. */
function runningCavePid(device) {
  const processes = devicectlJson(["device", "info", "processes", "--device", device])?.result?.runningProcesses ?? [];
  const cave = processes.find((entry) => String(entry.executable ?? "").endsWith("CovenCave.app/CovenCave"));
  return cave ? cave.processIdentifier : null;
}

/** The launched fixture must still be the running Cave process, or the trace is not its trace. */
async function confirmFixturePid(device, pid) {
  const confirmed = await waitFor(() => runningCavePid(device) === pid, 30_000);
  if (!confirmed) throw new Error(`fixture process ${pid} is not the running Cave process`);
}

function logText(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

async function waitFor(predicate, timeoutMs, stepMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(stepMs);
  }
  return predicate();
}

/**
 * Attach Instruments to the fixture process. Right after a launch the device
 * often reports "Cannot find process" or "Waiting for device to boot"; listing
 * device processes first wakes the tunnel, and a later attempt succeeds.
 */
async function attachRecorder({ device, udid, pid, dir }) {
  const log = path.join(dir, "xctrace.log");
  for (let attempt = 1; attempt <= ATTACH_ATTEMPTS; attempt += 1) {
    devicectlJson(["device", "info", "processes", "--device", device]);
    rmSync(path.join(dir, "t.trace"), { recursive: true, force: true });
    writeFileSync(log, "");
    const recorder = spawn("xcrun", [
      "xctrace", "record", "--instrument", "Points of Interest", "--device", udid,
      "--attach", String(pid), "--time-limit", "5m", "--output", path.join(dir, "t.trace"),
    ], { stdio: ["ignore", "pipe", "pipe"] });
    const append = (chunk) => writeFileSync(log, logText(log) + chunk);
    recorder.stdout.on("data", append);
    recorder.stderr.on("data", append);
    await waitFor(() => /Attaching to|Cannot|Timed out|rror/.test(logText(log)) || recorder.exitCode !== null, 120_000);
    if (/Attaching to/.test(logText(log))) {
      // "Attaching to" precedes live recording. Wait until xctrace says it is
      // recording, then a few seconds more: a cold cycle starts at once and
      // its first spans were otherwise lost.
      await waitFor(() => /Ctrl-C to stop/.test(logText(log)) || recorder.exitCode !== null, 60_000, 500);
      if (/Ctrl-C to stop/.test(logText(log)) && recorder.exitCode === null) {
        await sleep(5_000);
        if (recorder.exitCode === null) return recorder;
      }
    }
    recorder.kill("SIGINT");
    await sleep(3_000);
    recorder.kill("SIGKILL");
    await sleep(10_000);
  }
  throw new Error("Instruments could not attach to the fixture process");
}

/** Stop the recording and wait for it to save; a recorder that hangs loses the round. */
async function stopRecorder(recorder, dir) {
  recorder.kill("SIGINT");
  const saved = await waitFor(() => /Output file saved/.test(logText(path.join(dir, "xctrace.log"))), SAVE_TIMEOUT_MS);
  if (!saved) recorder.kill("SIGKILL");
  return saved;
}

function exportTable(trace, xpath) {
  return run("xcrun", ["xctrace", "export", "--input", trace, ...(xpath ? ["--xpath", xpath] : ["--toc"])], {
    maxBuffer: 512 * 1024 * 1024,
  });
}

/** The round's warm window, its span events, and whether the data covers it. */
function readRound(dir) {
  const trace = path.join(dir, "t.trace");
  const result = path.join(dir, "r.xcresult");
  if (!existsSync(trace) || !existsSync(result)) return null;
  const attachments = path.join(dir, "attachments");
  rmSync(attachments, { recursive: true, force: true });
  mkdirSync(attachments, { recursive: true });
  spawnSync("xcrun", ["xcresulttool", "export", "attachments", "--path", result, "--output-path", attachments], { stdio: "ignore" });
  const window = readdirSync(attachments)
    .filter((name) => name.endsWith(".txt"))
    .map((name) => {
      try {
        return parseCycleWindow(readFileSync(path.join(attachments, name), "utf8"));
      } catch {
        return null;
      }
    })
    .find((candidate) => candidate?.phase === measuredPhase);
  if (!window) return null;
  const start = traceStartSeconds(exportTable(trace));
  const events = parseSpanEvents(
    exportTable(trace, '/trace-toc/run[@number="1"]/data/table[@schema="os-signpost-arg"]'),
    start,
  );
  const lead = coverageLead(events, window);
  const inside = spansInWindow(pairSpans(events), window);
  // A positive lead only proves data began before the window; the round must
  // also hold completed spans inside it, or it contributes nothing.
  // A cold process is idle until the driver's first tap, so no span precedes
  // its window. There, coverage means the cycle's first interaction was kept:
  // all four drawer opens of the journey are inside the window.
  const covered = measuredPhase === "warm"
    ? lead > 0 && inside.spans.length > 0
    : inside.spans.filter((span) => span.span === "drawer.open").length >= 4;
  return { window, events, lead, inside, covered };
}

/** Run the UI driver; stop the recording when its test case ends. */
async function runDriverAndStop({ attach, device, dir, recorder }) {
  const child = spawn("xcodebuild", [
    "test-without-building", "-xctestrun", attach, "-destination", `id=${device}`,
    "-resultBundlePath", path.join(dir, "r.xcresult"),
  ], { cwd: path.dirname(attach), stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let stopping = null;
  const onData = (chunk) => {
    output += chunk;
    if (!stopping && /Test Case '-\[[^\]]+\]' (passed|failed)/.test(output)) {
      stopping = stopRecorder(recorder, dir);
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  const timer = setTimeout(() => child.kill("SIGKILL"), DRIVER_TIMEOUT_MS);
  const status = await new Promise((resolve) => child.on("close", (code) => resolve(code)));
  clearTimeout(timer);
  writeFileSync(path.join(dir, "test.log"), output);
  const saved = await (stopping ?? stopRecorder(recorder, dir));
  return { driver: { status }, saved };
}

async function captureRound({ device, udid, attach, dir }) {
  for (let attempt = 1; attempt <= TRIES_PER_ROUND; attempt += 1) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    requireUnlocked(device);
    // A fresh process per try: a failed rich open can leave the transcript
    // unable to mount its renderer for the rest of the process (#5613).
    const pid = launchFixture(device, dir);
    await sleep(10_000);
    await confirmFixturePid(device, pid);
    const recorder = await attachRecorder({ device, udid, pid, dir });
    // The device keeps only the recording's last ~48 s of signposts, so stop
    // the recorder as soon as the test case finishes rather than after
    // xcodebuild has written its result bundle; that tail costs coverage at
    // the start of the window, where a cold cycle's first spans are.
    const { driver, saved } = await runDriverAndStop({ attach, device, dir, recorder });
    const samePid = runningCavePid(device) === pid;
    const reason = driver.status !== 0 ? "driver failed"
      : !samePid ? "the fixture process changed during the cycle"
        : !saved ? "recording hung while saving"
          : null;
    if (!reason) {
      const round = readRound(dir);
      if (round?.covered) return { attempt };
      console.log(`  try ${attempt}: the recording does not cover the warm window (${round ? `lead ${round.lead.toFixed(1)} s, ${round.inside.spans.length} spans inside` : "no data"})`);
    } else {
      console.log(`  try ${attempt}: ${reason}`);
    }
  }
  throw new Error(`round ${path.basename(dir)} failed ${TRIES_PER_ROUND} times`);
}

/** Every `r<N>` round directory under `out`, in round order, whatever `--rounds` was. */
function roundDirectories(out) {
  return readdirSync(out, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^r\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

function analyze(out) {
  const usable = [];
  const skipped = [];
  for (const name of roundDirectories(out)) {
    const round = readRound(path.join(out, name));
    if (!round?.covered) {
      skipped.push(name);
      continue;
    }
    usable.push(round.inside);
  }
  const rows = summarize(usable);
  const report = { phase: measuredPhase, cycles: usable.length, skipped, rows };
  writeFileSync(path.join(out, "summary.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(markdownTable(rows, usable.length, measuredPhase === "warm" ? "warm" : "cold"));
  if (skipped.length) console.log(`\nSkipped (missing or incomplete): ${skipped.join(", ")}`);
  return report;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.cold) measuredPhase = "cold-app-launch";
  mkdirSync(options.out, { recursive: true });
  if (!options.analyzeOnly) {
    requireUnlocked(options.device);
    const udid = hardwareUdid(options.device);
    const attach = writeAttachXctestrun(options.products, options.cold ? COLD_TEST_ID : TEST_ID);
    for (let index = 1; index <= options.rounds; index += 1) {
      const dir = path.join(options.out, `r${index}`);
      if (options.resume) {
        if (readRound(dir)?.covered) continue;
      }
      const started = Date.now();
      const { attempt } = await captureRound({ device: options.device, udid, attach, dir });
      console.log(`round ${index}/${options.rounds} captured on try ${attempt} (${Math.round((Date.now() - started) / 1000)} s)`);
    }
  }
  analyze(options.out);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`ios-performance-capture: ${error.message}`);
    process.exit(1);
  });
}
