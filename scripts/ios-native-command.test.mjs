import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import { parse } from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts/ios-native-command.py');
const run = (args) => spawnSync('python3', [script, ...args], { encoding: 'utf8', timeout: 10_000 });
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));

await test('native command preserves its real exit status and output', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ios-command-'));
  try {
    const receipt = path.join(dir, 'receipt.json');
    const result = run(['run', '--timeout-seconds', '3', '--receipt', receipt, '--', 'python3', '-c', 'import sys; print("native first failure"); sys.exit(17)']);
    assert.equal(result.status, 17, result.stderr);
    assert.match(result.stdout, /native first failure/);
    const saved = await json(receipt);
    assert.equal(saved.childExitCode, 17);
    assert.equal(saved.timedOut, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

await test('timeout waits for owned child finalization and cannot become green', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ios-command-'));
  try {
    const receipt = path.join(dir, 'receipt.json');
    const final = path.join(dir, 'finalized.txt');
    const child = 'import signal,time,sys,pathlib\ndef stop(*args):\n time.sleep(0.08)\n pathlib.Path(sys.argv[1]).write_text("finalized after interrupt")\n sys.exit(0)\nsignal.signal(signal.SIGINT,stop)\nwhile True: time.sleep(0.02)';
    const result = run(['run', '--timeout-seconds', '0.5', '--grace-seconds', '2', '--receipt', receipt, '--', 'python3', '-c', child, final]);
    assert.equal(result.status, 124, result.stderr);
    assert.equal(await readFile(final, 'utf8'), 'finalized after interrupt');
    const saved = await json(receipt);
    assert.equal(saved.childExitCode, 0);
    assert.equal(saved.timedOut, true);
    assert.equal(saved.exitCode, 124);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

await test('operator interruption drains only the owned command and preserves cancellation', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ios-interrupt-'));
  let process;
  let closed;
  try {
    const ready = path.join(dir, 'ready');
    const final = path.join(dir, 'final');
    const receipt = path.join(dir, 'receipt.json');
    const child = 'import signal,time,sys,pathlib\ndef stop(*args):\n pathlib.Path(sys.argv[2]).write_text("stopped")\n sys.exit(0)\nsignal.signal(signal.SIGINT,stop)\npathlib.Path(sys.argv[1]).write_text("ready")\nwhile True: time.sleep(0.02)';
    process = spawn('python3', [script, 'run', '--timeout-seconds', '5', '--grace-seconds', '1', '--receipt', receipt, '--', 'python3', '-c', child, ready, final], { stdio: 'ignore' });
    closed = new Promise((resolve) => process.once('close', (code, signal) => resolve({ code, signal })));
    const deadline = Date.now() + 3000;
    let observed = false;
    while (Date.now() < deadline) {
      try { observed = (await readFile(ready, 'utf8')) === 'ready'; } catch {}
      if (observed) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(observed, 'the owned child installed its interrupt handler');
    process.kill('SIGINT');
    assert.equal((await closed).code, 130);
    assert.equal(await readFile(final, 'utf8'), 'stopped');
    const saved = await json(receipt);
    assert.equal(saved.interruptedSignal, 2);
    assert.equal(saved.terminal, true);
    assert.equal(saved.timedOut, false);
  } finally {
    if (process && process.exitCode === null && process.signalCode === null) {
      process.kill('SIGTERM');
      await closed;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

await test('frozen evidence survives later movement of xcresult staging files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ios-evidence-'));
  try {
    const bundle = path.join(dir, 'scroll-bounce.xcresult');
    await mkdir(path.join(bundle, 'Staging'), { recursive: true });
    await writeFile(path.join(bundle, 'Info.plist'), 'fixture marker; snapshot does not claim xcresult validity');
    await writeFile(path.join(bundle, 'Staging', 'session.log'), 'first failure diagnostic');
    await writeFile(path.join(dir, 'scroll-bounce.log'), 'strict failure, not retried');
    const out = path.join(dir, 'frozen');
    const result = run(['freeze', '--root', dir, '--output', out]);
    assert.equal(result.status, 0, result.stderr);
    await rm(path.join(bundle, 'Staging'), { recursive: true });
    assert.equal(await readFile(path.join(out, 'results', 'scroll-bounce.xcresult', 'Staging', 'session.log'), 'utf8'), 'first failure diagnostic');
    assert.equal(await readFile(path.join(out, 'logs', 'scroll-bounce.log'), 'utf8'), 'strict failure, not retried');
    const saved = await json(path.join(out, 'manifest.json'));
    assert.equal(saved.bundles[0].hasInfoPlist, true);
    assert.equal(saved.bundles[0].issues.length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

await test('a second collection cannot overwrite retained evidence', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ios-evidence-'));
  try {
    const out = path.join(dir, 'frozen');
    await mkdir(out);
    await writeFile(path.join(out, 'retained.txt'), 'first receipt');
    const result = run(['freeze', '--root', dir, '--output', out]);
    assert.notEqual(result.status, 0);
    assert.equal(await readFile(path.join(out, 'retained.txt'), 'utf8'), 'first receipt');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

await test('incomplete evidence stays available and fails visibly without following links', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ios-evidence-'));
  try {
    const bundle = path.join(dir, 'scroll-debug.xcresult');
    await mkdir(bundle);
    await writeFile(path.join(bundle, 'partial.log'), 'interrupted native evidence');
    await writeFile(path.join(dir, 'scroll-debug.log'), 'timeout must remain a failure');
    await writeFile(path.join(dir, 'outside.txt'), 'outside scope');
    await symlink(path.join(dir, 'outside.txt'), path.join(bundle, 'external-link'));
    const out = path.join(dir, 'frozen');
    const result = run(['freeze', '--root', dir, '--output', out]);
    assert.equal(result.status, 1, result.stderr);
    const saved = await json(path.join(out, 'manifest.json'));
    assert.equal(saved.bundles[0].hasInfoPlist, false);
    assert.ok(saved.bundles[0].issues.some((x) => x.reason.includes('symbolic link')));
    assert.equal(await readFile(path.join(out, 'logs', 'scroll-debug.log'), 'utf8'), 'timeout must remain a failure');
    assert.equal(await readFile(path.join(out, 'results', 'scroll-debug.xcresult', 'partial.log'), 'utf8'), 'interrupted native evidence');
    await assert.rejects(readFile(path.join(out, 'results', 'scroll-debug.xcresult', 'external-link')));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

await test('transcript workflow owns deadlines and uploads logs separately from frozen results', async () => {
  const workflow = parse(await readFile(path.join(root, '.github/workflows/ios-transcript-regression.yml'), 'utf8'));
  const job = workflow.jobs.transcript;
  const steps = job.steps;
  const native = steps.filter((s) => String(s.run).includes('xcodebuild test '));
  assert.equal(native.length, 3);
  const debug = native.find((s) => String(s.run).includes("scroll-debug.receipt.json"));
  // Run 43789410401 exhausted 900s after 59 cases passed. The final case
  // received about 166s, versus its preceding complete 172.598s execution.
  // Combine the observed 59-case work with that complete final case and the
  // preceding wrapper residual; reserve owned shutdown rather than cutting a case.
  const retainedCompleteDebugSeconds = 319.142 + 172.598 + 459.713;
  const debugBound = Number(debug.run.match(/--timeout-seconds (\d+)/)?.[1]);
  assert.ok(debugBound > retainedCompleteDebugSeconds + 30,
    'the complete observed Debug workload and owned shutdown must fit the command allowance');
  assert.ok(debugBound <= 1080, 'keep the reviewed Debug command resource ceiling bounded');
  const destination = steps.find((s) => s.id === 'destination');
  assert.ok(destination, 'native execution requires an identified simulator-selection prerequisite');
  assert.ok(destination['timeout-minutes'] >= 3, 'cold CoreSimulator selection needs its own bounded setup budget');
  assert.match(destination.run, /scroll-setup\.log/, 'retain setup output independently of native results');
  for (const s of native) assert.match(String(s.if), /steps\.destination\.outcome == 'success'/, 'never launch native stages without a selected destination');
  let nativeSeconds = 0;
  for (const s of native) {
    const command = String(s.run);
    assert.match(command, /ios-native-command\.py run/);
    const bound = Number(command.match(/--timeout-seconds (\d+)/)?.[1]);
    const grace = Number(command.match(/--grace-seconds (\d+)/)?.[1]);
    const term = Number(command.match(/--terminate-seconds (\d+)/)?.[1]);
    const kill = Number(command.match(/--kill-seconds (\d+)/)?.[1]);
    assert.ok(bound > 0 && grace > 0 && term > 0 && kill > 0);
    assert.ok(bound + grace + term + kill < s['timeout-minutes'] * 60);
    nativeSeconds += bound + grace + term + kill;
    assert.notEqual(s['continue-on-error'], true);
  }
  const strict = native.find((s) => s.name.includes('three full runs'));
  // Run 43778586069 completed 20/21 executions in 3063.685s; setup and
  // inter-case gaps added about 200s. Its final case previously took 78.081s
  // but started with under 40s left. Reserve shutdown after the full matrix.
  const retainedCompleteMatrixSeconds = 3063.685 + 200 + 78.081;
  const strictBound = Number(strict.run.match(/--timeout-seconds (\d+)/)?.[1]);
  assert.ok(strictBound > retainedCompleteMatrixSeconds + 30,
    'the unchanged complete matrix and owned shutdown must fit the command allowance');
  assert.ok(strictBound <= 3600, 'keep the reviewed strict command resource ceiling bounded');
  assert.match(strict.run, /-test-iterations 3/);
  assert.doesNotMatch(strict.run, /-retry-tests-on-failure/);
  assert.match(strict.run, /-only-testing:CovenCaveUITests\/TranscriptAccessibilityUITests/);
  const freeze = steps.find((s) => String(s.run).includes('ios-native-command.py freeze'));
  assert.match(String(freeze.if), /always\(\)/);
  const uploads = steps.filter((s) => String(s.uses).startsWith('actions/upload-artifact@'));
  assert.equal(uploads.length, 2);
  assert.ok(uploads.some((s) => String(s.with.path).includes('scroll-*.log')));
  assert.ok(uploads.some((s) => String(s.with.path).includes('transcript-evidence/results')));
  for (const s of uploads) assert.match(String(s.if), /always\(\)/);
  const otherOwned = steps.filter((s) => !native.includes(s) && String(s.run).includes('ios-native-command.py run'));
  let otherOwnedSeconds = 0;
  for (const s of otherOwned) {
    const command = String(s.run);
    const total = ['timeout', 'grace', 'terminate', 'kill'].reduce((n, flag) => {
      const value = Number(command.match(new RegExp(`--${flag}-seconds (\\d+)`))?.[1]);
      assert.ok(value > 0, 'every owned command has an explicit shutdown bound');
      return n + value;
    }, 0);
    assert.ok(total <= 30, 'independent marker collection fits the remaining resource allowance');
    assert.ok(total < s['timeout-minutes'] * 60);
    otherOwnedSeconds += total;
  }
  const nonNative = steps.filter((s) => !native.includes(s) && !otherOwned.includes(s) && !uploads.includes(s)).reduce((n, s) => n + (s['timeout-minutes'] ?? 0), 0);
  const uploadsMinutes = uploads.reduce((n, s) => n + s['timeout-minutes'], 0);
  assert.ok((nativeSeconds + otherOwnedSeconds) / 60 + nonNative + uploadsMinutes <= job['timeout-minutes'] - 1, 'retain at least one minute inside the bounded job budget');
  assert.equal(job['timeout-minutes'], 108, 'allow the complete measured native matrix plus independent failure collection');
});

await test('hosted pan marker collection preserves query failures without broadening the selected simulator', async () => {
  const workflow = parse(await readFile(path.join(root, '.github/workflows/ios-transcript-regression.yml'), 'utf8'));
  const steps = workflow.jobs.transcript.steps;
  const marker = steps.find((s) => String(s.run).includes('scroll-pan-marker.receipt.json'));
  assert.ok(marker, 'a failed or missing trace needs an independent writer-error collection channel');
  const strictIndex = steps.findIndex((s) => String(s.name).includes('three full runs'));
  const releaseIndex = steps.findIndex((s) => String(s.name).includes('Release shrink'));
  assert.ok(steps.indexOf(marker) > strictIndex && steps.indexOf(marker) < releaseIndex);
  assert.match(String(marker.if), /!cancelled\(\)/, 'collection must still run after a strict failure');
  assert.match(String(marker.if), /steps\.destination\.outcome == 'success'/);
  assert.notEqual(marker['continue-on-error'], true);

  const dir = await mkdtemp(path.join(tmpdir(), 'ios-pan-marker-'));
  try {
    const bin = path.join(dir, 'bin');
    await mkdir(bin);
    // The OS simulator is unavailable to this contract; run the real workflow
    // shell and command owner against one deliberately failing external tool.
    await writeFile(path.join(bin, 'xcrun'), '#!/usr/bin/env python3\nimport sys\nprint("CAVE_SCROLL_TRACE_WRITE_ERROR fixture")\nsys.exit(17)\n', { mode: 0o755 });
    const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, RUNNER_TEMP: dir,
      CAVE_TEST_DESTINATION: 'platform=iOS Simulator,id=12345678-1234-1234-1234-123456789ABC' };
    const result = spawnSync('bash', ['-c', marker.run], { cwd: root, env, encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.status, 17, result.stderr);
    const saved = await json(path.join(dir, 'scroll-pan-marker.receipt.json'));
    assert.equal(saved.childExitCode, 17);
    assert.equal(saved.terminal, true);
    assert.equal(saved.timedOut, false);
    assert.deepEqual(saved.command, ['xcrun', 'simctl', 'spawn', '12345678-1234-1234-1234-123456789ABC',
      'log', 'show', '--style', 'compact', '--last', '70m', '--predicate',
      'process == "CovenCave" AND eventMessage CONTAINS "CAVE_SCROLL_TRACE_WRITE_ERROR"']);
    const log = await readFile(path.join(dir, 'scroll-pan-marker.log'), 'utf8');
    assert.match(log, /Marker query started: \d{4}-\d\d-\d\dT/);
    assert.match(log, /Marker query finished: \d{4}-\d\d-\d\dT.*status=17/);
    assert.match(log, /CAVE_SCROLL_TRACE_WRITE_ERROR fixture/);
    const invalidDir = path.join(dir, 'invalid');
    await mkdir(invalidDir);
    const invalid = spawnSync('bash', ['-c', marker.run], { cwd: root,
      env: { ...env, RUNNER_TEMP: invalidDir, CAVE_TEST_DESTINATION: 'platform=iOS Simulator,id=invalid' },
      encoding: 'utf8', timeout: 10_000 });
    assert.notEqual(invalid.status, 0);
    await assert.rejects(readFile(path.join(invalidDir, 'scroll-pan-marker.receipt.json')));
    assert.doesNotMatch(await readFile(path.join(invalidDir, 'scroll-pan-marker.log'), 'utf8'), /fixture/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
