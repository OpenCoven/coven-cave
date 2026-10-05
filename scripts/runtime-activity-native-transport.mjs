#!/usr/bin/env node
// Opt-in native TCP gate. Requires a normal production build and an explicitly
// selected owned simulator. Only the external Hermes API is synthetic; the
// built Cave server and Swift client use their production transport and stores.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile, appendFile, readdir, rm, lstat, realpath } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startCave, stopCave, freePort } from './client-v1-conformance.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function sourceFingerprint() {
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard',
    '--', 'src', 'scripts', 'apps/ios', 'package.json', 'pnpm-lock.yaml'], { cwd: repo }).toString().split('\0');
  const hash = createHash('sha256');
  for (const file of [...new Set(files)].filter((file) => file && !file.startsWith('scripts/.mobile-process-')).sort()) {
    hash.update(file + '\0');
    try { hash.update(await readFile(path.join(repo, file))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; hash.update('<missing>'); }
    hash.update('\0');
  }
  return hash.digest('hex');
}
const args = process.argv.slice(2);
function option(name) {
  const index = args.indexOf(name);
  return index < 0 ? null : args[index + 1];
}
const destination = option('--destination');
const evidence = option('--evidence');
const derived = option('--derived-data');
const liveUISend = args.includes('--live-ui-send');
const unitSuite = args.includes('--unit-suite');
const fixtureId = randomUUID();
if (process.platform !== 'darwin' || !args.includes('--execute') || !destination ||
    !evidence || !derived || !path.isAbsolute(evidence) || !path.isAbsolute(derived) || (liveUISend && unitSuite) || args.length !== (liveUISend || unitSuite ? 8 : 7)) {
  console.error('Usage: node --experimental-strip-types --import ./scripts/test-alias-register.mjs scripts/runtime-activity-native-transport.mjs --execute --destination <owned-simulator-uuid> --derived-data <absolute-path> --evidence <new-absolute-directory> [--live-ui-send | --unit-suite]');
  process.exitCode = 2;
} else {
await mkdir(evidence, { recursive: false, mode: 0o700 });
const root = await realpath(await mkdtemp(path.join(tmpdir(), 'cave-native-activity-')));
const covenHome = path.join(root, 'coven');
const caveHome = path.join(covenHome, 'cave');
const projectRoot = path.join(root, 'project');
const covenBin = process.env.COVEN_BIN && path.isAbsolute(process.env.COVEN_BIN)
  ? process.env.COVEN_BIN : execFileSync('which', ['coven'], { encoding: 'utf8' }).trim();
const native = (args) => execFileSync(covenBin, args, { env: process.env, cwd: projectRoot,
  encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'] });
const ledger = path.join(evidence, 'invocations.jsonl');
// Keep the byte-exact oracle neutral under both native and web Markdown.
const marker = `CAVE-NATIVE-${randomUUID()}`;
const mobileToken = `fixture-native-${randomUUID()}`;
const providerToken = `fixture-provider-${randomUUID()}`;
const releaseKey = randomUUID();
const restartKey = randomUUID();
const uiCompletionKey = randomUUID();
const uiRestartKey = randomUUID();
const uiSnapshotKey = randomUUID();
const runReport = {
  schemaVersion: 1, startedAt: new Date().toISOString(), destination, fixtureId,
  candidate: { head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
    sourceBefore: await sourceFingerprint() },
  host: { node: process.version, xcode: execFileSync('xcodebuild', ['-version'], { encoding: 'utf8' }).trim() },
  scenario: unitSuite ? 'full-unit-suite-with-native-tcp-recovery' : liveUISend ? 'hermes-live-native-send-termination-restart-hydration' : 'hermes-summary-tool-reconnect-restart-native-supervisor-history',
  classification: unitSuite
    ? 'full XCTest unit suite with real built Cave and Coven daemon, native TCP recovery; synthetic external Hermes provider'
    : 'real built Cave and Coven daemon, native TCP and scene-supervisor recovery; synthetic external Hermes provider',
  passed: false, providerRequests: 0, toolInvocations: 0,
  limitations: ['Loopback HTTP with simulated forwarded-peer headers; not remote HTTPS or managed-device pairing.',
    unitSuite ? 'Unit suite only; no rendered UI, human VoiceOver, physical-device performance or real provider qualification.' : liveUISend ? 'UI starts from an empty isolated thread, then uses actual send/persistence/hydration; external provider remains synthetic.' : 'UI starts from an accepted-delivery fixture and uses real recovery/history/output; not managed pairing, human VoiceOver, physical-device performance or a real provider.',
    'The invocation counter belongs to the controlled fixture tool; it is not a protected-action approval or committed-effect receipt.'],
};
let caveServer;
let daemonStarted = false;
let provider;
let fixturePlan;
let caveInput;
let restartTask;
let uiRestartTask;
let release;
const released = new Promise((resolve) => { release = resolve; });
let currentChild;
let phoneStoreRoot;
let interruptedPhone;

async function poll(check, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let failure;
  do {
    try { return await check(); }
    catch (error) { failure = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(`${label}: ${failure?.message ?? 'condition not met'}`);
}

async function phoneSnapshot() {
  if (!phoneStoreRoot) {
    const container = execFileSync('xcrun', ['simctl', 'get_app_container', destination, 'ai.opencoven.cave', 'data'], { encoding: 'utf8' }).trim();
    phoneStoreRoot = path.join(container, 'tmp', `ai.opencoven.cave.native-recovery.${fixtureId}`);
  }
  const bytes = await readFile(path.join(phoneStoreRoot, 'threads.json'));
  const threads = JSON.parse(bytes.toString());
  assert.equal(threads.length, 1, 'the fixture must contain only its own phone thread');
  const thread = threads[0];
  assert.equal(thread.id, 'native-activity-recovery');
  assert.equal(thread.projectRoot, projectRoot);
  assert.deepEqual(thread.familiarIds, ['nativeactivity']);
  const users = thread.messages.filter((message) => message.role === 'user');
  const replies = thread.messages.filter((message) => message.role === 'assistant');
  assert.equal(users.length, 1);
  assert.equal(replies.length, 1);
  return { bytes, thread, user: users[0], reply: replies[0] };
}

async function recordInterruptedPhone() {
  assert.equal(liveUISend, true);
  assert.equal(runReport.providerRequests, 1);
  assert.equal(runReport.toolInvocations, 0);
  assert.equal(interruptedPhone, undefined);
  interruptedPhone = await poll(async () => {
    const value = await phoneSnapshot();
    assert.equal(value.user.queued, true);
    assert.ok(value.user.queuedAttemptedFamiliarIds.includes('nativeactivity'));
    assert.match(value.user.queuedRunIdsByFamiliarId.nativeactivity, /^[0-9a-f-]{36}$/i);
    assert.equal(value.reply.activity.find((tool) => tool.id === 'native-read-1')?.status, 'running');
    assert.equal(value.reply.reasoningBlocks.length, 1);
    assert.equal(value.reply.text, 'Inspecting 🧙 café.\n');
    assert.ok(value.thread.sessionIds.nativeactivity);
    return value;
  }, 'persist actual in-flight phone snapshot');
  await writeFile(path.join(evidence, 'phone-interrupted.json'), interruptedPhone.bytes, { mode: 0o600 });
  runReport.interruptedPhone = {
    sha256: createHash('sha256').update(interruptedPhone.bytes).digest('hex'),
    userMessageId: interruptedPhone.user.id, assistantMessageId: interruptedPhone.reply.id,
    runId: interruptedPhone.user.queuedRunIdsByFamiliarId.nativeactivity,
    sessionId: interruptedPhone.thread.sessionIds.nativeactivity,
    queued: true, toolStatus: 'running', summaries: 1,
  };
}

async function verifyRecoveredPhone() {
  const value = await poll(async () => {
    const value = await phoneSnapshot();
    assert.equal(value.user.queued === true, false);
    assert.equal(value.user.id, interruptedPhone.user.id);
    assert.equal(value.reply.id, interruptedPhone.reply.id);
    assert.equal(value.reply.streaming, false);
    assert.equal(value.reply.activity.find((tool) => tool.id === 'native-read-1')?.status, 'ok');
    assert.equal(value.reply.reasoningBlocks.length, 2);
    assert.equal(value.reply.runtimeIdentity.model, 'served-fixture-v3');
    assert.equal(value.reply.text, `Inspecting 🧙 café.\nDone: ${marker}`);
    return value;
  }, 'persist recovered phone snapshot');
  await writeFile(path.join(evidence, 'phone-recovered.json'), value.bytes, { mode: 0o600 });
  runReport.recoveredPhone = { sha256: createHash('sha256').update(value.bytes).digest('hex'),
    stableMessageIds: true, queued: false, toolStatus: 'ok', summaries: 2 };
}

async function run(label, command, commandArgs, timeoutMs = 10 * 60_000) {
  const log = createWriteStream(path.join(evidence, `${label}.log`), { flags: 'wx', mode: 0o600 });
  const startedAt = new Date().toISOString();
  const child = spawn(command, commandArgs, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  currentChild = child;
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  let forceTimer;
  const timeout = setTimeout(() => {
    child.kill('SIGTERM');
    forceTimer = setTimeout(() => child.kill('SIGKILL'), 5_000);
  }, timeoutMs);
  let code;
  try { [code] = await once(child, 'close'); }
  finally {
    clearTimeout(timeout); clearTimeout(forceTimer); currentChild = null;
    await new Promise((resolve) => log.end(resolve));
  }
  await writeFile(path.join(evidence, `${label}.json`), JSON.stringify({ command: [command, ...commandArgs], startedAt, finishedAt: new Date().toISOString(), exitCode: code }, null, 2));
  assert.equal(code, 0, `${label} failed; see its retained log`);
  console.log(JSON.stringify({ phase: label, passed: true }));
}

function writeFrames(res, frames) {
  const bytes = Buffer.from(frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(''));
  // Fragment across UTF-8 characters as well as JSON/SSE boundaries.
  for (let offset = 0; offset < bytes.length; offset += 7) res.write(bytes.subarray(offset, offset + 7));
}

try {
  runReport.candidate.buildId = (await readFile(path.join(repo, '.next/BUILD_ID'), 'utf8')).trim();
  for (const dir of [caveHome, projectRoot]) await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(path.join(projectRoot, 'marker.txt'), marker, { mode: 0o600 });
  await writeFile(ledger, '', { flag: 'wx', mode: 0o600 });
  const corpusBytes = await readFile(path.join(repo, 'apps/ios/CovenCave/CovenCaveTests/Fixtures/runtime-activity-http-v1.json'));
  runReport.scenarioSha256 = createHash('sha256').update(corpusBytes).digest('hex');
  const scenario = JSON.parse(corpusBytes.toString().replaceAll('{{MARKER}}', marker));
  assert.equal(scenario.schemaVersion, 1);
  provider = createServer(async (req, res) => {
    try {
      if (req.method === 'POST' && req.url === `/release/${releaseKey}`) {
        release(); res.writeHead(204).end(); return;
      }
      if (req.method === 'POST' && req.url === `/ui-snapshot/${uiSnapshotKey}`) {
        await recordInterruptedPhone();
        res.writeHead(204).end(); return;
      }
      if (req.method === 'POST' && req.url === `/ui-complete/${uiCompletionKey}`) {
        if (liveUISend) await verifyRecoveredPhone();
        else assert.equal(runReport.restart?.previousStopped, true);
        assert.equal(runReport.uiRestart?.previousStopped, true);
        assert.equal(runReport.uiCompletionReceived, undefined);
        runReport.uiCompletionReceived = true;
        await appendFile(ledger, JSON.stringify({ kind: 'native_ui_recovery', ordinal: 1 }) + '\n');
        res.writeHead(204).end(); return;
      }
      if (req.method === 'POST' && req.url === `/ui-restart/${uiRestartKey}`) {
        assert.ok(caveInput && caveServer);
        if (liveUISend) {
          assert.ok(interruptedPhone, 'the actual phone snapshot must be retained before termination');
          release();
          const { loadConversation } = await import(pathToFileURL(path.join(repo, 'src/lib/cave-conversations.ts')).href);
          await poll(async () => {
            const conversation = await loadConversation(runReport.interruptedPhone.sessionId);
            const users = conversation?.turns.filter((turn) => turn.role === 'user') ?? [];
            const replies = conversation?.turns.filter((turn) => turn.role === 'assistant') ?? [];
            assert.equal(users.length, 1);
            assert.equal(users[0].attentionClearOperationId, runReport.interruptedPhone.runId);
            assert.equal(replies.length, 1);
            assert.equal(replies[0].text, `Inspecting 🧙 café.\nDone: ${marker}`);
            assert.equal(runReport.toolInvocations, 1);
            runReport.serverPersistenceVerified = true;
          }, 'save completed provider turn while phone is terminated');
          await stopCave(caveServer, caveServer.port);
          assert.ok(caveServer.child.exitCode !== null || caveServer.child.signalCode !== null);
          runReport.uiOutage = { previousPid: caveServer.child.pid, previousStopped: true };
          await appendFile(ledger, JSON.stringify({ kind: 'native_ui_server_stopped', ordinal: 1 }) + '\n');
        }
        assert.equal(runReport.uiOutage?.previousStopped, true);
        assert.equal(uiRestartTask, undefined, 'the UI restores its owned server once');
        uiRestartTask = (async () => {
          const previous = caveServer;
          caveServer = await startCave(caveInput);
          assert.notEqual(caveServer.child.pid, previous.child.pid);
          assert.equal(caveServer.origin, previous.origin);
          runReport.uiRestart = { previousPid: previous.child.pid, newPid: caveServer.child.pid,
            previousStopped: true, sameOrigin: true };
          await appendFile(ledger, JSON.stringify({ kind: 'native_ui_server_restart', ordinal: 1 }) + '\n');
        })();
        await uiRestartTask;
        res.writeHead(204).end(); return;
      }
      if (req.method === 'POST' && req.url === `/restart/${restartKey}`) {
        assert.ok(caveServer && caveInput, 'restart requires the owned ready server');
        assert.equal(restartTask, undefined, 'the fixture restarts exactly once');
        assert.equal(runReport.providerRequests, 1);
        assert.equal(runReport.toolInvocations, 1, 'restart only after the controlled tool completes');
        restartTask = (async () => {
          const previous = caveServer;
          await stopCave(previous, previous.port);
          assert.ok(previous.child.exitCode !== null || previous.child.signalCode !== null);
          caveServer = await startCave(caveInput);
          assert.notEqual(caveServer.child.pid, previous.child.pid);
          assert.equal(caveServer.origin, previous.origin);
          for (const credential of [null, 'fixture-invalid']) {
            const response = await fetch(`${caveServer.origin}/api/chat/conversation/fixture`, { headers: {
              origin: caveServer.origin, 'x-forwarded-for': '203.0.113.9',
              ...(credential ? { authorization: `Bearer ${credential}` } : {}),
            } });
            assert.equal(response.status, 401, 'restart preserves the real ingress gate');
          }
          runReport.restart = { previousPid: previous.child.pid, newPid: caveServer.child.pid,
            previousStopped: true, sameOrigin: true, ingressRefusalsVerified: true };
          await appendFile(ledger, JSON.stringify({ kind: 'server_restart', ordinal: 1 }) + '\n');
        })();
        await restartTask;
        res.writeHead(204).end(); return;
      }
      if (req.method !== 'POST' || req.url !== '/v1/responses' || req.headers.authorization !== `Bearer ${providerToken}`) {
        res.writeHead(403).end(); return;
      }
      let body = '';
      for await (const chunk of req) { body += chunk; assert.ok(body.length < 1024 * 1024); }
      assert.equal(JSON.parse(body).stream, true);
      runReport.providerRequests += 1;
      await appendFile(ledger, JSON.stringify({ kind: 'provider', ordinal: runReport.providerRequests }) + '\n');
      assert.equal(runReport.providerRequests, 1, 'reconnect must never dispatch the provider twice');
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      writeFrames(res, scenario.beforeRelease);
      await released;
      const contents = await readFile(path.join(projectRoot, 'marker.txt'), 'utf8');
      assert.equal(contents, marker);
      runReport.toolInvocations += 1;
      await appendFile(ledger, JSON.stringify({ kind: 'read_file', ordinal: runReport.toolInvocations, markerSha256: createHash('sha256').update(contents).digest('hex') }) + '\n');
      writeFrames(res, scenario.afterRelease);
      res.end();
    } catch (error) {
      runReport.providerFailure = error instanceof Error ? error.message : 'provider fixture failed';
      res.destroy();
    }
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const providerOrigin = `http://127.0.0.1:${provider.address().port}`;
  Object.assign(process.env, {
    COVEN_HOME: covenHome, COVEN_CAVE_HOME: caveHome, COVEN_SOCKET: path.join(covenHome, 'coven.sock'), COVEN_BIN: covenBin,
    COVEN_WORKSPACE_ROOT: projectRoot, COVEN_WORKSPACES_ROOT: root,
    COVEN_VAULT_FILE: path.join(root, 'vault.yaml'), COVEN_CAVE_ENV_FILE: path.join(root, '.env.local'),
    COVEN_CAVE_LOCAL_VAULT_FILE: path.join(root, 'local-vault.enc.json'),
    COVEN_CAVE_LOCAL_VAULT_KEY_FILE: path.join(root, 'local-vault.key'),
    HERMES_API_URL: providerOrigin, HERMES_API_KEY: providerToken,
  });
  // Normal app discovery reads /api/familiars, which requires the real daemon.
  // Register only this controlled familiar in the invocation-owned home.
  await writeFile(path.join(covenHome, 'familiars.toml'),
    '[[familiar]]\nid = "nativeactivity"\ndisplay_name = "Native activity"\nrole = "Verification"\ndescription = "Owned native recovery fixture."\n', { mode: 0o600 });
  execFileSync('git', ['init', '--quiet', projectRoot]);
  daemonStarted = true;
  native(['daemon', 'start']);
  const daemon = JSON.parse(await readFile(path.join(covenHome, 'daemon.json'), 'utf8'));
  runReport.daemon = { pid: daemon.pid, version: native(['--version']).trim() };
  const imp = (file) => import(pathToFileURL(path.join(repo, file)).href);
  const { saveConfig } = await imp('src/lib/cave-config.ts');
  const { createProject } = await imp('src/lib/cave-projects.ts');
  const { grantProjectToFamiliar } = await imp('src/lib/project-permissions.ts');
  await saveConfig({ familiars: { nativeactivity: { harness: 'hermes', model: '' } } });
  const project = await createProject({ name: 'Native transport fixture', root: projectRoot });
  await grantProjectToFamiliar({ familiarId: 'nativeactivity', projectId: project.id, source: 'human', access: 'write' });
  caveInput = { port: await freePort(), caveHomeDir: caveHome, covenHomeDir: covenHome,
    adminToken: `fixture-sidecar-${randomUUID()}`, mobileAccessToken: mobileToken };
  caveServer = await startCave(caveInput);
  runReport.serverPid = caveServer.child.pid;
  console.log(JSON.stringify({ phase: 'native-http-ready', origin: caveServer.origin }));
  const headers = { origin: caveServer.origin, 'x-forwarded-for': '203.0.113.9' };
  for (const credential of [null, 'fixture-invalid']) {
    const response = await fetch(`${caveServer.origin}/api/chat/conversation/fixture`, { headers: {
      ...headers, ...(credential ? { authorization: `Bearer ${credential}` } : {}),
    } });
    assert.equal(response.status, 401, 'missing/invalid credentials must reach the real ingress gate');
  }
  runReport.ingressRefusalsVerified = true;
  const rosterResponse = await fetch(`${caveServer.origin}/api/familiars`, { headers: {
    ...headers, authorization: `Bearer ${mobileToken}`,
  } });
  assert.equal(rosterResponse.status, 200, 'normal native discovery requires the real daemon roster');
  assert.ok((await rosterResponse.json()).familiars.some((entry) => entry.id === 'nativeactivity'));
  runReport.realDaemonRosterVerified = true;

  await run('xcodegen', 'pnpm', ['mobile:ios:xcodegen']);
  await run('build-for-testing', 'xcodebuild', ['build-for-testing', '-project', 'apps/ios/CovenCave/CovenCave.xcodeproj',
    '-scheme', 'CovenCave', '-destination', `platform=iOS Simulator,id=${destination}`, '-derivedDataPath', derived,
    '-parallel-testing-enabled', 'NO', '-enablePerformanceTestsDiagnostics', 'NO',
    '-jobs', '2', 'CODE_SIGNING_ALLOWED=YES', 'CODE_SIGN_IDENTITY=-', 'CODE_SIGN_STYLE=Manual', 'DEVELOPMENT_TEAM=']);
  const products = path.join(derived, 'Build/Products');
  const generated = (await readdir(products)).find((name) => /^CovenCave_iphonesimulator.*\.xctestrun$/.test(name));
  assert.ok(generated, 'the generated native test plan must exist');
  const plan = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', path.join(products, generated)], { encoding: 'utf8' }));
  const targets = plan.TestConfigurations?.flatMap((configuration) => configuration.TestTargets) ?? Object.values(plan);
  const target = targets.find((entry) => entry?.BlueprintName === 'CovenCaveTests' || entry?.TestBundlePath?.endsWith('/CovenCaveTests.xctest'));
  assert.ok(target, 'the generated plan must contain CovenCaveTests');
  if (unitSuite) {
    delete target.OnlyTestIdentifiers;
    delete target.SkipTestIdentifiers;
  } else {
    target.OnlyTestIdentifiers = ['ActivityTransportTests'];
  }
  target.EnvironmentVariables = { ...target.EnvironmentVariables, CAVE_NATIVE_ACTIVITY_FIXTURE: JSON.stringify({
    origin: caveServer.origin, token: mobileToken, projectRoot, marker, releaseURL: `${providerOrigin}/release/${releaseKey}`,
    restartURL: `${providerOrigin}/restart/${restartKey}`,
  }) };
  fixturePlan = path.join(products, `NativeActivity-${randomUUID()}.xctestrun`);
  const planJson = `${fixturePlan}.json`;
  await writeFile(planJson, JSON.stringify(plan), { mode: 0o600 });
  execFileSync('plutil', ['-convert', 'xml1', '-o', fixturePlan, planJson]);
  await rm(planJson);
  let conversation;
  let acceptedRunId;
  if (!liveUISend) {
    // Drain replacement-triggered Live Activity wakeups before the app-hosted
    // test launch, too: they can otherwise preempt XCTest bundle injection.
    await run('install-native-app', 'xcrun', ['simctl', 'install', destination,
      target.TestHostPath.replace('__TESTROOT__', products)]);
    await run('native-transport', 'xcodebuild', ['test-without-building', '-xctestrun', fixturePlan,
      '-destination', `platform=iOS Simulator,id=${destination}`,
      unitSuite ? '-only-testing:CovenCaveTests' : '-only-testing:CovenCaveTests/ActivityTransportTests',
      '-resultBundlePath', path.join(evidence, 'native-transport.xcresult'), '-parallel-testing-enabled', 'NO',
      '-enablePerformanceTestsDiagnostics', 'NO',
      '-test-timeouts-enabled', 'YES', '-default-test-execution-time-allowance', '60',
      '-maximum-test-execution-time-allowance', '180']);
    assert.equal(runReport.providerRequests, 1);
    assert.equal(runReport.toolInvocations, 1);
    assert.equal(runReport.restart?.previousStopped, true, 'the native test must exercise a real server restart');
    assert.equal(runReport.providerFailure, undefined);
    const { listConversations, loadConversation } = await imp('src/lib/cave-conversations.ts');
    const conversations = await listConversations();
    runReport.savedConversations = conversations.length;
    assert.equal(conversations.length, 1);
    assert.equal(conversations[0].familiarId, 'nativeactivity');
    conversation = await loadConversation(conversations[0].sessionId);
    acceptedRunId = conversation?.turns.find((turn) => turn.role === 'user')?.attentionClearOperationId;
    assert.ok(acceptedRunId, 'the UI must reconcile the exact accepted delivery');
  }
  if (!unitSuite) {
    const uiTarget = targets.find((entry) => entry?.BlueprintName === 'CovenCaveUITests' || entry?.TestBundlePath?.endsWith('/CovenCaveUITests.xctest'));
    assert.ok(uiTarget, 'the generated plan must contain the native UI target');
    uiTarget.OnlyTestIdentifiers = ['ActivityRecoveryUITests'];
    uiTarget.EnvironmentVariables = { ...uiTarget.EnvironmentVariables, CAVE_NATIVE_ACTIVITY_UI_FIXTURE: JSON.stringify({
      origin: caveServer.origin, token: mobileToken, projectRoot, marker,
      sessionId: conversation?.sessionId ?? 'live-ui-creates-session', runId: acceptedRunId ?? fixtureId,
      ...(liveUISend ? { mode: 'live-send', snapshotURL: `${providerOrigin}/ui-snapshot/${uiSnapshotKey}` } : {}),
      completionURL: `${providerOrigin}/ui-complete/${uiCompletionKey}`,
      restartURL: `${providerOrigin}/ui-restart/${uiRestartKey}`,
    }) };
    // Replacing the app ends the previous fixture's Live Activity and can launch
    // it without arguments. Drain that installation side effect before XCTest
    // installs its runner and launches the fixture. XCTest still installs and
    // owns its test artifacts (UseDestinationArtifacts requires a physical device).
    const installedApp = uiTarget.UITargetAppPath.replace('__TESTROOT__', products);
    await run('install-ui-app', 'xcrun', ['simctl', 'install', destination, installedApp]);
    await writeFile(planJson, JSON.stringify(plan), { mode: 0o600 });
    execFileSync('plutil', ['-convert', 'xml1', '-o', fixturePlan, planJson]);
    await rm(planJson);
    if (!liveUISend) {
      await stopCave(caveServer, caveServer.port);
      assert.ok(caveServer.child.exitCode !== null || caveServer.child.signalCode !== null);
      runReport.uiOutage = { previousPid: caveServer.child.pid, previousStopped: true };
      await appendFile(ledger, JSON.stringify({ kind: 'native_ui_server_stopped', ordinal: 1 }) + '\n');
    }
    await run('native-recovery-ui', 'xcodebuild', ['test-without-building', '-xctestrun', fixturePlan,
      '-destination', `platform=iOS Simulator,id=${destination}`, '-only-testing:CovenCaveUITests/ActivityRecoveryUITests',
      '-resultBundlePath', path.join(evidence, 'native-recovery-ui.xcresult'), '-parallel-testing-enabled', 'NO',
      '-enablePerformanceTestsDiagnostics', 'NO']);
    assert.equal(runReport.uiCompletionReceived, true, 'the opt-in UI gate must run, not skip');
    assert.equal(runReport.providerRequests, 1, 'rendered recovery must not dispatch again');
    assert.equal(runReport.toolInvocations, 1, 'rendered recovery must not repeat the tool');
    assert.equal(runReport.providerFailure, undefined);
    // A completion receipt alone does not prove XCTest's assertions passed.
    // run() above must also have observed a successful terminal test exit.
    runReport.renderedRecoveryVerified = true;
    runReport.sceneSupervisorRecoveryVerified = true;
    runReport.liveUISendTerminationHydrationVerified = liveUISend;
  } else {
    runReport.fullUnitSuiteExecuted = true;
  }
  runReport.passed = true;
} catch (error) {
  runReport.failure = error instanceof Error ? error.message : 'native transport failed';
  process.exitCode = 1;
} finally {
  release();
  if (currentChild) currentChild.kill('SIGTERM');
  if (restartTask) await restartTask.catch(() => { runReport.passed = false; process.exitCode = 1; });
  if (uiRestartTask) await uiRestartTask.catch(() => { runReport.passed = false; process.exitCode = 1; });
  if (caveServer) {
    try { await stopCave(caveServer, caveServer.port); runReport.serverStopped = true; }
    catch { runReport.serverStopped = false; runReport.passed = false; process.exitCode = 1; }
  }
  if (provider) {
    provider.closeAllConnections();
    await new Promise((resolve) => provider.close(resolve));
    runReport.providerStopped = !provider.listening;
  }
  if (daemonStarted) {
    try {
      native(['daemon', 'stop']);
      runReport.daemonStopped = true;
      if (Number.isSafeInteger(runReport.daemon?.pid)) {
        try { process.kill(runReport.daemon.pid, 0); runReport.daemonStopped = false; }
        catch (error) { runReport.daemonStopped = error.code === 'ESRCH'; }
      }
    } catch { runReport.daemonStopped = false; }
    if (!runReport.daemonStopped) { runReport.passed = false; process.exitCode = 1; }
  }
  if (fixturePlan) await rm(fixturePlan, { force: true });
  // Preserve unexpected state rather than removing a home that a detached
  // process might still own, including a failed daemon shutdown.
  let unexpectedDaemonState = false;
  for (const name of ['daemon.json', 'coven.sock']) {
    try { await lstat(path.join(covenHome, name)); unexpectedDaemonState = true; }
    catch (error) { if (error.code !== 'ENOENT') unexpectedDaemonState = true; }
  }
  runReport.noDaemonState = !unexpectedDaemonState;
  if (!unexpectedDaemonState && runReport.serverStopped !== false && runReport.daemonStopped !== false) {
    await rm(root, { recursive: true, force: true });
    runReport.fixtureRootRemoved = true;
  } else {
    runReport.preservedRoot = root;
    runReport.passed = false;
    process.exitCode = 1;
  }
  runReport.candidate.sourceAfter = await sourceFingerprint();
  runReport.sourceUnchanged = runReport.candidate.sourceBefore === runReport.candidate.sourceAfter;
  if (!runReport.sourceUnchanged) { runReport.passed = false; process.exitCode = 1; }
  runReport.finishedAt = new Date().toISOString();
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify(runReport, null, 2) + '\n');
  console.log(JSON.stringify(runReport));
}
}
