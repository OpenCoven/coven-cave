import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, realpath } from 'node:fs/promises';
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
    const calls = path.join(dir, 'calls.jsonl');
    await writeFile(path.join(bin, 'xcrun'), `#!/usr/bin/env python3
import json,pathlib,sys
args=sys.argv[1:]
with pathlib.Path(${JSON.stringify(calls)}).open('a') as f: f.write(json.dumps(args)+'\\n')
if args == ['simctl','list','devices','12345678-1234-1234-1234-123456789ABC','--json']:
    print(json.dumps({'devices':{'runtime':[{'udid':'12345678-1234-1234-1234-123456789ABC','state':'Booted'}]}}))
    sys.exit(0)
print('CAVE_SCROLL_TRACE_WRITE_ERROR')
sys.exit(17)
`, { mode: 0o755 });
    const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, RUNNER_TEMP: dir,
      CAVE_TEST_DESTINATION: 'platform=iOS Simulator,id=12345678-1234-1234-1234-123456789ABC' };
    const result = spawnSync('bash', ['-c', marker.run], { cwd: root, env, encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.status, 17, result.stderr);
    const saved = await json(path.join(dir, 'scroll-pan-marker.receipt.json'));
    assert.equal(saved.childExitCode, 17);
    assert.equal(saved.terminal, true);
    assert.equal(saved.timedOut, false);
    assert.deepEqual(saved.command, ['python3', 'scripts/ios-scroll-marker.py', '12345678-1234-1234-1234-123456789ABC']);
    const invoked = (await readFile(calls, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(invoked[0], ['simctl', 'list', 'devices', '12345678-1234-1234-1234-123456789ABC', '--json']);
    assert.deepEqual(invoked[1], ['simctl', 'spawn', '12345678-1234-1234-1234-123456789ABC',
      'log', 'show', '--style', 'compact', '--last', '70m', '--predicate',
      'process == "CovenCave" AND eventMessage == "CAVE_SCROLL_TRACE_WRITE_ERROR"']);
    const log = await readFile(path.join(dir, 'scroll-pan-marker.log'), 'utf8');
    assert.match(log, /Marker query started: \d{4}-\d\d-\d\dT/);
    assert.match(log, /Marker query finished: \d{4}-\d\d-\d\dT.*status=17/);
    assert.match(log, /CAVE_SCROLL_TRACE_WRITE_ERROR/);
    assert.match(log, /Marker reader exit: 17/);
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

await test('hosted pan marker collection reads only the selected shutdown store and rejects uncertain metadata', async () => {
  const workflow = parse(await readFile(path.join(root, '.github/workflows/ios-transcript-regression.yml'), 'utf8'));
  const marker = workflow.jobs.transcript.steps.find((s) => String(s.run).includes('scroll-pan-marker.receipt.json'));
  assert.match(marker.run, /scripts\/ios-scroll-marker\.py/, 'the collector must handle the selected simulator after XCTest shuts it down');
  assert.ok(workflow.on.pull_request.paths.includes('scripts/ios-scroll-marker.py'));
  const dir = await mkdtemp(path.join(tmpdir(), 'ios-offline-marker-'));
  const udid = '12345678-1234-1234-1234-123456789ABC';
  try {
    const bin = path.join(dir, 'bin');
    await mkdir(bin);
    const data = path.join(dir, 'Devices', udid, 'data');
    const store = path.join(data, 'var', 'db', 'diagnostics');
    await mkdir(store, { recursive: true });
    const escapedData = path.join(dir, 'escaped', udid, 'data');
    await mkdir(path.join(escapedData, 'var', 'db'), { recursive: true });
    const outside = path.join(dir, 'outside');
    await mkdir(outside);
    await symlink(outside, path.join(escapedData, 'var', 'db', 'diagnostics'));
    const internalData = path.join(dir, 'internal', udid, 'data');
    await mkdir(path.join(internalData, 'var', 'db'), { recursive: true });
    const substitutedStore = path.join(internalData, 'substituted-store');
    await mkdir(substitutedStore);
    await symlink(substitutedStore, path.join(internalData, 'var', 'db', 'diagnostics'));
    const aliasedData = path.join(dir, 'alias', udid, 'data');
    await mkdir(path.dirname(aliasedData), { recursive: true });
    await symlink(data, aliasedData);
    const fixture = path.join(dir, 'metadata.json');
    const calls = path.join(dir, 'calls.jsonl');
    await writeFile(path.join(bin, 'xcrun'), `#!/usr/bin/env python3
import json,os,pathlib,sys
args=sys.argv[1:]
with pathlib.Path(os.environ['MARKER_CALLS']).open('a') as f: f.write(json.dumps(args)+'\\n')
if args == ['simctl','list','devices','${udid}','--json']:
    code=int(os.environ.get('MARKER_METADATA_EXIT','0'))
    if not code: print(pathlib.Path(os.environ['MARKER_METADATA']).read_text())
    sys.exit(code)
print('CAVE_SCROLL_TRACE_WRITE_ERROR')
sys.exit(int(os.environ.get('MARKER_QUERY_EXIT','0')))
`, { mode: 0o755 });
    const device = { udid, state: 'Shutdown', dataPath: data };
    const metadata = (devices) => ({ devices: { runtime: devices } });
    const scenarios = [
      { name: 'shutdown-success', body: metadata([device]), exit: 0, queried: true },
      { name: 'shutdown-query-failure', body: metadata([device]), queryExit: 17, exit: 17, queried: true },
      { name: 'wrong-data-owner', body: metadata([{ ...device, dataPath: path.join(dir, 'another-device', 'data') }]), exit: 2 },
      { name: 'escaped-store', body: metadata([{ ...device, dataPath: escapedData }]), exit: 2 },
      { name: 'internal-substituted-store', body: metadata([{ ...device, dataPath: internalData }]), exit: 2 },
      { name: 'redirected-same-uuid-data', body: metadata([{ ...device, dataPath: aliasedData }]), exit: 2 },
      { name: 'ambiguous-device', body: metadata([device, device]), exit: 2 },
      { name: 'missing-device', body: metadata([]), exit: 2 },
      { name: 'transitional-device', body: metadata([{ ...device, state: 'Shutting Down' }]), exit: 2 },
      { name: 'malformed-metadata', raw: 'not JSON', exit: 2 },
      { name: 'metadata-command-failure', body: metadata([device]), metadataExit: 23, exit: 23 },
    ];
    for (const scenario of scenarios) {
      const runnerTemp = path.join(dir, scenario.name);
      await mkdir(runnerTemp);
      await writeFile(fixture, scenario.raw ?? JSON.stringify(scenario.body));
      await writeFile(calls, '');
      const result = spawnSync('bash', ['-c', marker.run], { cwd: root, encoding: 'utf8', timeout: 10_000,
        env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, RUNNER_TEMP: runnerTemp,
          CAVE_TEST_DESTINATION: `platform=iOS Simulator,id=${udid}`, MARKER_CALLS: calls, MARKER_METADATA: fixture,
          MARKER_QUERY_EXIT: String(scenario.queryExit ?? 0), MARKER_METADATA_EXIT: String(scenario.metadataExit ?? 0) } });
      assert.equal(result.status, scenario.exit, `${scenario.name}: ${result.stderr}`);
      const saved = await json(path.join(runnerTemp, 'scroll-pan-marker.receipt.json'));
      assert.equal(saved.childExitCode, scenario.exit);
      assert.equal(saved.terminal, true);
      assert.equal(saved.timedOut, false);
      const invoked = (await readFile(calls, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
      assert.deepEqual(invoked[0], ['simctl', 'list', 'devices', udid, '--json']);
      assert.equal(invoked.length, scenario.queried ? 2 : 1, `${scenario.name}: reject before any log read`);
      if (scenario.queried) {
        assert.deepEqual(invoked[1], ['--sdk', 'macosx', 'log', 'show', '--directory', await realpath(store),
          '--style', 'compact', '--last', '70m', '--predicate', 'process == "CovenCave" AND eventMessage == "CAVE_SCROLL_TRACE_WRITE_ERROR"']);
        const log = await readFile(path.join(runnerTemp, 'scroll-pan-marker.log'), 'utf8');
        const reader = JSON.parse(log.split('\n').find((line) => line.startsWith('Marker reader: ')).slice('Marker reader: '.length));
        assert.equal(reader.selectedUUID, udid);
        assert.deepEqual(reader.command, ['xcrun', ...invoked[1]]);
        assert.match(log, new RegExp(`Marker reader exit: ${scenario.exit}`));
      }
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

await test('marker budget admits a delayed reader and still drains an unresponsive owned reader', { skip: process.platform === 'win32' }, async () => {
  const workflow = parse(await readFile(path.join(root, '.github/workflows/ios-transcript-regression.yml'), 'utf8'));
  const marker = workflow.jobs.transcript.steps.find((s) => String(s.run).includes('scroll-pan-marker.receipt.json'));
  const phases = ['timeout', 'grace', 'terminate', 'kill'].map((flag) => Number(marker.run.match(new RegExp(`--${flag}-seconds (\\d+)`))?.[1]));
  assert.equal(phases.reduce((total, value) => total + value, 0), 30, 'reallocate the existing owner without spending the job reserve');
  const dir = await mkdtemp(path.join(tmpdir(), 'ios-marker-budget-'));
  const udid = '12345678-1234-1234-1234-123456789ABC';
  let cleanupVerified = true;
  try {
    const bin = path.join(dir, 'bin');
    const data = path.join(dir, 'Devices', udid, 'data');
    const store = path.join(data, 'var', 'db', 'diagnostics');
    await mkdir(bin);
    await mkdir(store, { recursive: true });
    const metadata = path.join(dir, 'metadata.json');
    await writeFile(metadata, JSON.stringify({ devices: { runtime: [{ udid, state: 'Shutdown', dataPath: data }] } }));
    const query = ['--sdk', 'macosx', 'log', 'show', '--directory', await realpath(store),
      '--style', 'compact', '--last', '70m', '--predicate', 'process == "CovenCave" AND eventMessage == "CAVE_SCROLL_TRACE_WRITE_ERROR"'];
    await writeFile(path.join(bin, 'xcrun'), `#!/usr/bin/env python3
import json,os,pathlib,signal,sys,time
args=sys.argv[1:]
with pathlib.Path(os.environ['MARKER_CALLS']).open('a') as f: f.write(json.dumps(args)+chr(10))
if args == ['simctl','list','devices',os.environ['MARKER_UDID'],'--json']:
    print(pathlib.Path(os.environ['MARKER_METADATA']).read_text())
    sys.exit(0)
assert args == json.loads(os.environ['MARKER_EXPECTED_QUERY'])
if os.environ['MARKER_READER_MODE'] == 'unresponsive':
    signal.signal(signal.SIGINT,signal.SIG_IGN)
    signal.signal(signal.SIGTERM,signal.SIG_IGN)
pathlib.Path(os.environ['MARKER_READER_PID']).write_text(str(os.getpid()))
if os.environ['MARKER_READER_MODE'] == 'unresponsive':
    deadline=time.monotonic()+31
    while not pathlib.Path(os.environ['MARKER_READER_STOP']).exists() and time.monotonic()<deadline: time.sleep(0.1)
    sys.exit(0)
time.sleep(17)
print('Fixture reader completed',flush=True)
`, { mode: 0o755 });
    for (const mode of ['delayed', 'unresponsive']) {
      const runnerTemp = path.join(dir, mode);
      await mkdir(runnerTemp);
      const calls = path.join(runnerTemp, 'calls.jsonl');
      const pidFile = path.join(runnerTemp, 'reader.pid');
      const stopFile = path.join(runnerTemp, 'reader.stop');
      let readerPid;
      try {
        const started = process.hrtime.bigint();
        const result = spawnSync('bash', ['-c', marker.run], { cwd: root, encoding: 'utf8', timeout: 35_000,
          env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, RUNNER_TEMP: runnerTemp,
            CAVE_TEST_DESTINATION: `platform=iOS Simulator,id=${udid}`, MARKER_UDID: udid,
            MARKER_METADATA: metadata, MARKER_CALLS: calls, MARKER_EXPECTED_QUERY: JSON.stringify(query),
            MARKER_READER_MODE: mode, MARKER_READER_PID: pidFile, MARKER_READER_STOP: stopFile } });
        const observedSeconds = Number(process.hrtime.bigint() - started) / 1e9;
        readerPid = Number(await readFile(pidFile, 'utf8'));
        assert.ok(Number.isInteger(readerPid) && readerPid > 0);
        const saved = await json(path.join(runnerTemp, 'scroll-pan-marker.receipt.json'));
        const expected = mode === 'delayed' ? 0 : 124;
        assert.equal(result.status, expected, `${mode}: ${JSON.stringify(saved)}; ${result.stderr}`);
        assert.equal(saved.exitCode, expected);
        assert.equal(saved.terminal, true);
        assert.equal(saved.failure, null);
        assert.equal(saved.timedOut, mode === 'unresponsive');
        assert.ok(observedSeconds < 30, `command and inherited output finish inside the same total bound: ${observedSeconds}s`);
        const invoked = (await readFile(calls, 'utf8')).trim().split('\n').map(JSON.parse);
        assert.deepEqual(invoked, [['simctl', 'list', 'devices', udid, '--json'], query]);
        const log = await readFile(path.join(runnerTemp, 'scroll-pan-marker.log'), 'utf8');
        if (mode === 'delayed') {
          assert.equal(saved.childExitCode, 0);
          assert.ok(saved.elapsedSeconds > 15, 'the completed read must exercise the previously truncated interval');
          assert.match(log, /Fixture reader completed/);
          assert.match(log, /Marker reader exit: 0/);
        } else {
          let readerAliveAtReceipt = true;
          try { process.kill(readerPid, 0); } catch (error) { if (error.code !== 'ESRCH') throw error; readerAliveAtReceipt = false; }
          assert.equal(readerAliveAtReceipt, false, `owner returned while the exact reader ${readerPid} was still alive: ${JSON.stringify(saved)}`);
          assert.ok(saved.elapsedSeconds >= phases[0], 'timeout remains a failure after the helper has drained its child');
          assert.doesNotMatch(log, /Fixture reader completed|Marker reader exit: 0/);
        }
        assert.ok(saved.elapsedSeconds < 30, 'owned completion stays inside the existing total bound');
        const deadline = Date.now() + 1000;
        let absent = false;
        while (Date.now() < deadline) {
          try { process.kill(readerPid, 0); } catch (error) { if (error.code !== 'ESRCH') throw error; absent = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.ok(absent, 'the exact owned reader is gone before accepting its receipt');
      } finally {
        // The fixture's private stop file can clean up a regressed reader
        // without signalling a PID after its terminal state is known.
        await writeFile(stopFile, 'test finished');
        if (readerPid) {
          const deadline = Date.now() + 1000;
          let absent = false;
          while (Date.now() < deadline) {
            try { process.kill(readerPid, 0); } catch (error) { if (error.code !== 'ESRCH') throw error; absent = true; break; }
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          cleanupVerified &&= absent;
        }
      }
    }
  } finally {
    if (cleanupVerified) await rm(dir, { recursive: true, force: true });
    else assert.fail(`owned reader cleanup remains uncertain; fixture preserved at ${dir}`);
  }
});
