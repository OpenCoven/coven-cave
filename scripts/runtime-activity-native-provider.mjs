import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';

// Called only by the explicit real-provider canary. No synthetic response,
// request interception, provider installation or permission escalation.
export async function runNativeProviderCanary(input) {
  const { repo, destination, derived, evidence, origin, token, projectRoot,
    marker, harness, identity, prompt, initialSessionId } = input;
  assert.ok(['claude', 'copilot'].includes(harness));
  assert.ok(path.isAbsolute(derived) && path.isAbsolute(evidence));
  assert.ok(identity.version && identity.model);
  await mkdir(evidence, { recursive: false, mode: 0o700 });
  const fixtureId = randomUUID();
  const controlKey = randomUUID();
  const report = { startedAt: new Date().toISOString(), harness, fixtureId, destination,
    expectedIdentity: identity, passed: false, permissionMode: 'read',
    limitations: ['Real provider, built Cave and native Debug UI on loopback HTTP; not managed pairing, packaged release, physical device or human accessibility.',
      'The parent HTTP turn and native turn are distinct. Conversation counts are not a protected-effect or tool invocation receipt.'] };
  let fixturePlan;
  let controller;
  let firstSnapshot;
  let completionReceived = false;
  let controllerFailure;
  const headers = { authorization: `Bearer ${token}`, origin, 'x-forwarded-for': '203.0.113.9' };
  const get = async (url) => {
    const response = await fetch(`${origin}${url}`, { headers, signal: AbortSignal.timeout(15_000) });
    assert.equal(response.status, 200, 'native provider history/output/replay read must be authorized');
    return response;
  };
  async function run(label, command, args) {
    const log = createWriteStream(path.join(evidence, `${label}.log`), { flags: 'wx', mode: 0o600 });
    const startedAt = new Date().toISOString();
    const child = spawn(command, args, { cwd: repo, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    let force;
    const deadline = setTimeout(() => {
      child.kill('SIGTERM');
      force = setTimeout(() => child.kill('SIGKILL'), 5_000);
    }, 10 * 60_000);
    let code;
    try { [code] = await once(child, 'close'); }
    finally {
      clearTimeout(deadline); clearTimeout(force);
      await new Promise((resolve) => log.end(resolve));
    }
    await writeFile(path.join(evidence, `${label}.json`), JSON.stringify({ command: [command, ...args], startedAt,
      finishedAt: new Date().toISOString(), exitCode: code }, null, 2), { mode: 0o600 });
    assert.equal(code, 0, `${label} failed; retained native provider log owns the details`);
  }
  async function snapshot() {
    const container = execFileSync('xcrun', ['simctl', 'get_app_container', destination, 'ai.opencoven.cave', 'data'], { encoding: 'utf8' }).trim();
    const file = path.join(container, 'tmp', `ai.opencoven.cave.native-recovery.${fixtureId}`, 'threads.json');
    const bytes = await readFile(file);
    const threads = JSON.parse(bytes);
    assert.equal(threads.length, 1);
    const thread = threads[0];
    assert.equal(thread.id, 'native-activity-recovery');
    assert.equal(thread.projectRoot, projectRoot);
    assert.deepEqual(thread.familiarIds, ['activitycanary']);
    const users = thread.messages.filter((x) => x.role === 'user');
    const replies = thread.messages.filter((x) => x.role === 'assistant');
    assert.equal(users.length, 1); assert.equal(replies.length, 1);
    const user = users[0]; const reply = replies[0];
    assert.notEqual(user.queued, true); assert.equal(reply.streaming, false);
    assert.ok(reply.text.includes(marker));
    assert.equal(reply.runtimeIdentity.harness, harness);
    assert.equal(reply.runtimeIdentity.version, identity.version);
    assert.equal(reply.runtimeIdentity.model, identity.model);
    assert.ok(reply.activity.some((tool) => tool.status === 'ok'));
    const sessionId = thread.sessionIds.activitycanary;
    assert.ok(sessionId && sessionId !== initialSessionId, 'native send must create its own real turn');
    const saved = (await (await get(`/api/chat/conversation/${encodeURIComponent(sessionId)}`)).json()).conversation;
    const savedUsers = saved.turns.filter((x) => x.role === 'user');
    const savedReplies = saved.turns.filter((x) => x.role === 'assistant');
    assert.equal(savedUsers.length, 1); assert.equal(savedReplies.length, 1);
    const turn = savedReplies[0];
    assert.equal(turn.text, reply.text.trim(), 'history follows the structured-path outer-whitespace policy');
    for (const key of ['harness', 'version', 'model']) assert.equal(turn.responseMetadata.runtimeIdentity[key], reply.runtimeIdentity[key]);
    const tool = turn.tools.find((x) => x.status === 'ok' && String(x.output ?? '').includes(marker));
    assert.ok(tool, 'saved native tool output must contain the unpredictable marker');
    assert.ok(reply.activity.some((x) => x.id === tool.id && x.status === 'ok'));
    const output = await (await get(`/api/chat/conversation/${encodeURIComponent(sessionId)}/tool-output?toolId=${encodeURIComponent(tool.id)}`)).json();
    assert.equal(output.ok, true); assert.ok(output.output.includes(marker));
    const runId = savedUsers[0].attentionClearOperationId;
    assert.ok(runId);
    const replay = (await (await get(`/api/chat/stream?runId=${encodeURIComponent(runId)}&cursor=0`)).text())
      .split('\n').filter((line) => line.startsWith('data: ')).map((line) => JSON.parse(line.slice(6)));
    const done = replay.findLast((x) => x.kind === 'done');
    assert.ok(done && !done.isError && !done.cancelled);
    assert.ok(replay.some((x) => x.kind === 'tool_use' && x.id === tool.id && x.status === 'ok' && String(x.output ?? '').includes(marker)));
    for (const key of ['harness', 'version', 'model']) assert.equal(done.responseMetadata.runtimeIdentity[key], reply.runtimeIdentity[key]);
    return { bytes, record: { sessionId, runId, userMessageId: user.id, assistantMessageId: reply.id,
      identity: reply.runtimeIdentity, tool: { id: tool.id, name: tool.name, status: tool.status },
      outputContainsMarker: true, replayMatchesIdentityAndTool: true,
      snapshotSHA256: createHash('sha256').update(bytes).digest('hex') } };
  }
  async function persistedSnapshot() {
    const until = Date.now() + 10_000;
    let error;
    do {
      try { return await snapshot(); } catch (failure) { error = failure; }
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < until);
    throw error;
  }
  try {
    controller = createServer(async (request, response) => {
      try {
        const action = request.url?.slice(`/${controlKey}/`.length);
        if (request.method !== 'POST' || !request.url?.startsWith(`/${controlKey}/`) || !['snapshot', 'complete'].includes(action)) {
          response.writeHead(404).end(); return;
        }
        const value = await persistedSnapshot();
        if (action === 'snapshot') {
          assert.equal(firstSnapshot, undefined);
          firstSnapshot = value.record;
          report.live = value.record;
        } else {
          assert.ok(firstSnapshot); assert.equal(completionReceived, false);
          for (const key of ['sessionId', 'runId', 'userMessageId', 'assistantMessageId']) assert.equal(value.record[key], firstSnapshot[key]);
          report.hydrated = value.record;
          completionReceived = true;
        }
        await writeFile(path.join(evidence, `phone-${action}.json`), value.bytes, { mode: 0o600 });
        response.writeHead(204).end();
      } catch (error) {
        controllerFailure = error instanceof assert.AssertionError ? error.message : error.name;
        response.writeHead(500).end();
      }
    });
    controller.listen(0, '127.0.0.1'); await once(controller, 'listening');
    const controlURL = `http://127.0.0.1:${controller.address().port}/${controlKey}`;
    await run('xcodegen', 'pnpm', ['mobile:ios:xcodegen']);
    await run('build-for-testing', 'xcodebuild', ['build-for-testing', '-project', 'apps/ios/CovenCave/CovenCave.xcodeproj',
      '-scheme', 'CovenCave', '-destination', `platform=iOS Simulator,id=${destination}`, '-derivedDataPath', derived,
      '-parallel-testing-enabled', 'NO', '-enablePerformanceTestsDiagnostics', 'NO', '-jobs', '2', 'CODE_SIGNING_ALLOWED=YES', 'CODE_SIGN_IDENTITY=-']);
    const products = path.join(derived, 'Build/Products');
    const generated = (await readdir(products)).find((name) => /^CovenCave_iphonesimulator.*\.xctestrun$/.test(name));
    assert.ok(generated);
    const plan = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', path.join(products, generated)], { encoding: 'utf8' }));
    const targets = plan.TestConfigurations?.flatMap((x) => x.TestTargets) ?? Object.values(plan);
    const target = targets.find((x) => x?.BlueprintName === 'CovenCaveUITests' || x?.TestBundlePath?.endsWith('/CovenCaveUITests.xctest'));
    assert.ok(target);
    target.OnlyTestIdentifiers = ['ActivityProviderUITests'];
    target.EnvironmentVariables = { ...target.EnvironmentVariables, CAVE_NATIVE_ACTIVITY_UI_FIXTURE: JSON.stringify({
      mode: 'provider-canary', harness, origin, token, projectRoot, marker, prompt,
      runId: fixtureId, sessionId: 'native-provider-creates-session',
      expectedVersion: identity.version, expectedModel: identity.model, controlURL,
    }) };
    fixturePlan = path.join(products, `NativeProvider-${randomUUID()}.xctestrun`);
    await writeFile(`${fixturePlan}.json`, JSON.stringify(plan), { mode: 0o600 });
    execFileSync('plutil', ['-convert', 'xml1', '-o', fixturePlan, `${fixturePlan}.json`]);
    await rm(`${fixturePlan}.json`);
    // End prior fixture Live Activities before XCTest's install/launch handoff.
    await run('install-ui-app', 'xcrun', ['simctl', 'install', destination, target.UITargetAppPath.replace('__TESTROOT__', products)]);
    await run('native-provider-ui', 'xcodebuild', ['test-without-building', '-xctestrun', fixturePlan,
      '-destination', `platform=iOS Simulator,id=${destination}`, '-only-testing:CovenCaveUITests/ActivityProviderUITests',
      '-resultBundlePath', path.join(evidence, 'native-provider-ui.xcresult'), '-parallel-testing-enabled', 'NO', '-enablePerformanceTestsDiagnostics', 'NO']);
    assert.equal(controllerFailure, undefined);
    assert.equal(completionReceived, true, 'the native provider test must run rather than skip');
    report.passed = true;
  } catch (error) {
    report.failure = error instanceof assert.AssertionError ? error.message : error.name;
    if (input.stopNativeRuns) {
      try { report.stoppedNativeRuns = await input.stopNativeRuns(); }
      catch { report.nativeStopFailed = true; }
    }
    throw error;
  } finally {
    if (fixturePlan) {
      await rm(fixturePlan, { force: true });
      await rm(`${fixturePlan}.json`, { force: true });
    }
    report.temporaryPlanRemoved = true;
    if (controller) await new Promise((resolve) => controller.close(resolve));
    report.controllerStopped = true;
    if (controllerFailure) report.controllerFailure = controllerFailure;
    report.finishedAt = new Date().toISOString();
    await writeFile(path.join(evidence, 'result.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  }
  return report;
}
