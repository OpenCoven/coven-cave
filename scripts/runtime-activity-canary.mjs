import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

// Explicit opt-in: this launches a real provider turn using existing account
// authentication. It never belongs in an unattended deterministic CI suite.
const args = process.argv.slice(2);
const harnessIndex = args.indexOf('--harness');
const harness = args[harnessIndex + 1];
const useHttp = args.includes('--http');
const option = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : null;
const nativeDestination = option('--native-client');
const nativeDerived = option('--derived-data');
const nativeEvidence = option('--native-evidence');
const interactiveClient = option('--interactive-client');
const interactiveEvidence = option('--interactive-evidence');
const interactiveOptionsValid = interactiveClient
  ? useHttp && !nativeDestination && ['claude', 'copilot'].includes(harness)
    && ['web', 'desktop'].includes(interactiveClient) && path.isAbsolute(interactiveEvidence ?? '')
  : !interactiveEvidence;
const nativeOptionsValid = nativeDestination
  ? useHttp && process.platform === 'darwin' && ['claude', 'copilot'].includes(harness)
    && /^[0-9a-f-]{36}$/i.test(nativeDestination) && path.isAbsolute(nativeDerived ?? '') && path.isAbsolute(nativeEvidence ?? '')
  : !nativeDerived && !nativeEvidence;
if (harnessIndex < 0 || !['claude', 'codex', 'copilot', 'opencode'].includes(harness) || !args.includes('--execute') || !nativeOptionsValid || !interactiveOptionsValid || args.length !== (useHttp ? 4 : 3) + (nativeDestination ? 6 : 0) + (interactiveClient ? 4 : 0)) {
  console.error('Usage: node --experimental-strip-types --import ./scripts/test-alias-register.mjs scripts/runtime-activity-canary.mjs --harness <claude|codex|copilot|opencode> --execute [--http] [--native-client <owned-simulator-uuid> --derived-data <absolute-path> --native-evidence <new-absolute-directory> | --interactive-client <web|desktop> --interactive-evidence <new-absolute-directory>]');
  process.exitCode = 2;
} else {
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await realpath(await mkdtemp(path.join(tmpdir(), 'cave-runtime-canary-')));
const resolveBin = (name, override) => override && path.isAbsolute(override)
  ? override : execFileSync('which', [name], { encoding: 'utf8' }).trim();
const covenBin = resolveBin('coven', process.env.COVEN_BIN);
const runtimeBin = resolveBin(harness, harness === 'codex' ? process.env.CODEX_BIN : undefined);
const covenHome = path.join(root, 'coven');
const caveHome = path.join(covenHome, 'cave');
const projectRoot = path.join(root, 'project');
await mkdir(projectRoot, { recursive: true, mode: 0o700 });
await mkdir(caveHome, { recursive: true, mode: 0o700 });
const marker = `CAVE_ACTIVITY_${randomUUID()}`;
await writeFile(path.join(projectRoot, 'marker.txt'), marker + '\n', { mode: 0o600 });
await writeFile(path.join(covenHome, 'familiars.toml'), '[[familiar]]\nid = "activitycanary"\ndisplay_name = "Activity Canary"\nrole = "Verification"\ndescription = "Reads the controlled marker file for this one verification turn."\n', { mode: 0o600 });
execFileSync('git', ['init', '--quiet', projectRoot]);
Object.assign(process.env, {
  COVEN_HOME: covenHome, COVEN_CAVE_HOME: caveHome,
  COVEN_SOCKET: path.join(covenHome, 'coven.sock'),
  COVEN_BIN: covenBin,
  PATH: `${path.dirname(runtimeBin)}${path.delimiter}${process.env.PATH ?? ''}`,
  ...(harness === 'codex' ? { CODEX_BIN: runtimeBin } : {}),
  COVEN_WORKSPACE_ROOT: projectRoot, COVEN_WORKSPACES_ROOT: root,
  COVEN_VAULT_FILE: path.join(root, 'vault.yaml'),
  COVEN_CAVE_ENV_FILE: path.join(root, '.env.local'),
  COVEN_CAVE_LOCAL_VAULT_FILE: path.join(root, 'local-vault.enc.json'),
  COVEN_CAVE_LOCAL_VAULT_KEY_FILE: path.join(root, 'local-vault.key'),
  COVEN_PREFERENCES_PATH: path.join(root, 'preferences.json'),
  COVEN_THEME_PATH: path.join(root, 'theme.json'),
  CAVE_PROJECTS_PATH_OVERRIDE: path.join(root, 'projects.json'),
  CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE: path.join(root, 'permissions.json'),
  CAVE_QUEUE_PROJECT_PATH_OVERRIDE: path.join(root, 'queue-project.json'),
});
delete process.env.COVEN_CAVE_E2E;
const native = (args) => execFileSync(process.env.COVEN_BIN, args, { env: process.env, cwd: projectRoot, encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'] });
const imp = (file) => import(pathToFileURL(path.join(repo, file)).href);
const sourceFingerprint = async () => {
  const changed = execFileSync('git', ['diff', '--name-only', '-z', 'HEAD'], { cwd: repo }).toString().split('\0');
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: repo }).toString().split('\0');
  const hash = createHash('sha256');
  for (const file of [...new Set([...changed, ...untracked])].filter((file) => /^(?:src\/|scripts\/|apps\/ios\/|package\.json$|pnpm-lock\.yaml$|tsconfig\.json$)/.test(file)).sort()) {
    hash.update(file + '\0');
    try { hash.update(await readFile(path.join(repo, file))); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      hash.update('[deleted]');
    }
    hash.update('\0');
  }
  return hash.digest('hex');
};
const report = {
  schemaVersion: 1, root, harness, permission: 'read', transport: useHttp ? 'http' : 'module',
  startedAt: new Date().toISOString(),
  candidate: { head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: repo }).trim(), patchSha256: createHash('sha256').update(execFileSync('git', ['diff', '--binary', 'HEAD'], { cwd: repo })).digest('hex'), changedSourceSha256: await sourceFingerprint() },
  runtimeVersion: execFileSync(runtimeBin, harness === 'copilot' ? ['--no-auto-update', '--version'] : ['--version'], { encoding: 'utf8', timeout: 30_000 }).trim(),
  runtimeVersionScope: 'Shell inventory; the send-route identity records Cave\'s selected launch version.',
  covenVersion: native(['--version']).trim(),
  limitations: [useHttp ? 'Built HTTP server on loopback; forwarded-peer classification is simulated with headers, not a physical remote client. No UI is exercised.' : 'Node imports the real route; no built HTTP server or UI is exercised.', 'Provider authentication and user CLI configuration use the existing account; HOME is not isolated.', 'Read-only scenario; no protected-effect receipt or side-effect counter qualification.'],
};
console.log(JSON.stringify({ phase: 'prepared', root, harness }));
let daemonStarted = false;
let timer;
let caveServer;
let httpHarness;
let httpHeaders;
let pendingStop;
const mobileToken = nativeDestination || interactiveClient ? `fixture-client-${randomUUID()}` : null;
const parseEvents = (wire) => wire.split('\n').filter((line) => line.startsWith('data: ')).map((line) => JSON.parse(line.slice(6)));
// Copilot can correct prior deltas with an authoritative full message. Apply
// the same append/replace wire semantics as the clients before comparing it.
const assistantText = (events) => events.reduce((text, event) => event.kind === 'assistant_replace'
  ? event.text : event.kind === 'assistant_chunk' ? text + event.text : text, '');
const httpRequest = (pathname, init = {}) => fetch(`${caveServer.origin}${pathname}`, {
  ...init,
  headers: { ...httpHeaders, ...init.headers },
  signal: init.signal ?? AbortSignal.timeout(150_000),
});
try {
  if (useHttp) {
    report.build = {
      id: (await readFile(path.join(repo, '.next/BUILD_ID'), 'utf8')).trim(),
      serverSha256: createHash('sha256').update(await readFile(path.join(repo, 'server.mjs'))).digest('hex'),
      sendRouteSha256: createHash('sha256').update(await readFile(path.join(repo, '.next/server/app/api/chat/send/route.js'))).digest('hex'),
    };
  }
  // This home was created by this invocation, so even a partially failed
  // startup is ours to stop. Never touch a daemon in another store.
  daemonStarted = true;
  native(['daemon', 'start']);
  const daemon = JSON.parse(await readFile(path.join(covenHome, 'daemon.json'), 'utf8'));
  report.daemon = { pid: daemon.pid, socket: daemon.socketPath ?? daemon.socket_path ?? daemon.socket };
  console.log(JSON.stringify({ phase: 'daemon-started', root, pid: daemon.pid }));
  const { saveConfig } = await imp('src/lib/cave-config.ts');
  const { createProject } = await imp('src/lib/cave-projects.ts');
  const { grantProjectToFamiliar } = await imp('src/lib/project-permissions.ts');
  const { loadConversation } = await imp('src/lib/cave-conversations.ts');
  const { subscribeRunStream } = await imp('src/lib/server/chat-stream-buffer.ts');
  const { requestChatStop } = await imp('src/lib/server/chat-stop-registry.ts');

  const route = useHttp ? null : await imp('src/app/api/chat/send/route.ts');
  await saveConfig({ familiars: { activitycanary: { harness, model: '' } } });
  const project = await createProject({ name: 'Runtime activity canary', root: projectRoot });
  await grantProjectToFamiliar({ familiarId: 'activitycanary', projectId: project.id, source: 'human', access: 'read' });
  if (interactiveClient) {
    const { selectQueueProject } = await imp('src/lib/queue-project-readiness.ts');
    await selectQueueProject(project.id);
  }
  if (harness === 'claude') {
    const { resolveInstalledClaudeCompatibility } = await imp('src/lib/server/claude-runtime-compatibility.ts');
    const profile = await resolveInstalledClaudeCompatibility();
    assert.equal(profile.kind, 'compatible');
    assert.equal(profile.stale, false);
    report.profile = profile.profile.id;
  } else if (harness === 'codex') {
    const { discoverCodexRuntime, productionCodexSchemaSources } = await imp('src/lib/codex-compatibility.ts');
    const { resolveCodexChatRouting } = await imp('src/app/api/chat/send/codex-routing.ts');
    const probe = await discoverCodexRuntime();
    const routing = resolveCodexChatRouting({ harness, isSshRuntime: false, report: probe, sources: await productionCodexSchemaSources() });
    report.routing = { mode: routing.mode, diagnostic: routing.diagnosticCode, version: probe.version };
  } else if (harness === 'opencode') {
    const { openCodeRunCapabilities } = await imp('src/app/api/chat/send/chat-send-capabilities.ts');
    const { resolveOpenCodeCompatibility } = await imp('src/lib/opencode-compatibility.ts');
    const { grokProbeEnvironment } = await imp('src/lib/grok-compatibility.ts');
    const capabilities = await openCodeRunCapabilities('activitycanary', undefined, grokProbeEnvironment(process.env));
    const compatibility = await resolveOpenCodeCompatibility(capabilities, {
      url: '', publicKeys: {}, cacheFile: path.join(root, 'opencode-schema.json'),
      fetch: () => { throw new Error('This canary does not refresh registry trust'); },
    });
    report.routing = { mode: compatibility.mode, diagnostic: compatibility.diagnostic ?? null,
      version: capabilities.version, probeStatus: capabilities.probeStatus, scope: 'passive-launch-probe-only' };
    report.profile = compatibility.schema?.id ?? null;
    report.limitations.push('OpenCode currently refuses Cave Read-only mode. Preserve that refusal; do not switch this canary to Full access to obtain tool evidence.');
  } else {
    const { probeCopilotCapability } = await imp('src/lib/server/copilot-capability-probe.ts');
    const { resolveRuntimeCompatibility } = await imp('src/lib/server/runtime-compatibility-registry.ts');
    const { prepareCopilotChatRouting } = await imp('src/app/api/chat/send/copilot-routing.ts');
    const { warmHarnessSpawnPath } = await imp('src/lib/harness-spawn-env.ts');
    // Use the same logical executable and canonical launch environment as the
    // send route. The shell's absolute inventory binary can be another install.
    // Mirror server startup: a cold, deadline-bounded probe can exhaust its
    // toolchain discovery budget and select a different PATH installation.
    await warmHarnessSpawnPath();
    const probe = await probeCopilotCapability('copilot');
    const routing = await prepareCopilotChatRouting({ harness, isSshRuntime: false,
      probe: async () => probe, resolveCompatibility: () => resolveRuntimeCompatibility('copilot') });
    report.routing = { mode: routing.mode, diagnostic: probe.diagnostic ?? null, version: probe.version,
      probeExecutable: 'copilot', launchCommand: probe.launchCommand, spawnPathWarmed: true, scope: 'canonical-launch-preflight' };
    report.profile = routing.spec?.protocol.id ?? null;
    assert.equal(routing.mode, 'direct-jsonl', 'Copilot must use an admitted JSONL protocol');
  }
  if (useHttp) {
    httpHarness = await import('./client-v1-conformance.mjs');
    const adminToken = randomUUID();
    caveServer = await httpHarness.startCave({ port: await httpHarness.freePort(), caveHomeDir: caveHome, covenHomeDir: covenHome, adminToken, mobileAccessToken: mobileToken });
    httpHeaders = { 'content-type': 'application/json', origin: caveServer.origin, [httpHarness.ADMIN_TOKEN_HEADER]: adminToken, 'x-forwarded-for': '203.0.113.9' };
    report.server = { pid: caveServer.child.pid, port: caveServer.port };
    report.ingress = {};
    for (const [name, credential] of [['missingCredential', null], ['invalidCredential', 'invalid-canary-credential']]) {
      const headers = { ...httpHeaders };
      if (credential === null) delete headers[httpHarness.ADMIN_TOKEN_HEADER];
      else headers[httpHarness.ADMIN_TOKEN_HEADER] = credential;
      const refused = await fetch(`${caveServer.origin}/api/chat/send`, { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(5_000) });
      report.ingress[name] = refused.status;
      await refused.body?.cancel();
      assert.ok([401, 403].includes(refused.status), `${name} must be refused before the send handler`);
    }
    console.log(JSON.stringify({ phase: 'http-ready', port: caveServer.port, ingress: report.ingress }));
  }
  const runId = randomUUID();
  const sessionId = randomUUID();
  report.runId = runId;
  timer = setTimeout(() => {
    pendingStop = (async () => {
      if (useHttp) {
        const stopped = await httpRequest('/api/chat/stop', { method: 'POST', body: JSON.stringify({ runId }), signal: AbortSignal.timeout(5_000) });
        report.stopRequested = (await stopped.json()).stopped === true;
      } else report.stopRequested = requestChatStop(runId);
      console.log(JSON.stringify({ phase: 'deadline', stopRequested: report.stopRequested }));
    })().catch(() => { report.stopRequested = false; });
  }, 120_000);
  const toolInstruction = harness === 'claude' ? 'Use the Read tool once to read marker.txt.'
    : harness === 'copilot' || harness === 'opencode' ? 'Use the file-reading tool once to read marker.txt.'
    : 'Use the shell tool once to run cat marker.txt.';
  const sendInit = {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ familiarId: 'activitycanary', sessionId, startNewConversation: true, runId,
      projectRoot, permissionMode: 'read',
      prompt: `This is a controlled read-only runtime activity canary in the current project directory. ${toolInstruction} Do not inspect any other file, run any other command, edit files, or use external tools. Return exactly the file contents after reading it.` }),
  };
  const response = useHttp ? await httpRequest('/api/chat/send', sendInit)
    : await route.POST(new Request('http://localhost/api/chat/send', sendInit));
  report.httpStatus = response.status;
  const wire = await response.text();
  clearTimeout(timer);
  if (!response.ok) {
    let refused;
    try { refused = JSON.parse(wire); } catch { /* Never retain arbitrary response content. */ }
    report.refusal = { code: typeof refused?.code === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(refused.code) ? refused.code : null };
    assert.fail(`send refused with HTTP ${response.status}`);
  }
  const events = parseEvents(wire);
  const done = events.findLast((event) => event.kind === 'done');
  report.eventKinds = [...new Set(events.map((event) => event.kind))];
  report.errors = events.filter((event) => event.kind === 'error').map((event) => ({ code: event.code }));
  report.diagnostics = events.filter((event) => event.kind === 'progress').map((event) => ({ id: event.id, status: event.status }));
  report.identity = done?.responseMetadata?.runtimeIdentity;
  report.path = report.identity?.activity?.path;
  report.done = { isError: done?.isError === true, cancelled: done?.cancelled === true, persisted: Boolean(done?.persistedTurnId) };
  const toolEvents = events.filter((event) => event.kind === 'tool_use');
  report.tools = toolEvents.map((event) => ({ id: event.id, name: ['Read', 'Bash', 'bash', 'view', 'command_execution'].includes(event.name) ? event.name : 'other', status: event.status, outputContainsMarker: String(event.output ?? '').includes(marker) }));
  const answer = assistantText(events);
  report.answerContainsMarker = answer.includes(marker);
  let saved = null;
  if (done?.sessionId) {
    if (useHttp) {
      const historyResponse = await httpRequest(`/api/chat/conversation/${encodeURIComponent(done.sessionId)}`);
      report.historyHttpStatus = historyResponse.status;
      assert.equal(historyResponse.status, 200);
      saved = (await historyResponse.json()).conversation;
    } else saved = await loadConversation(done.sessionId);
  }
  const turn = saved?.turns.at(-1);
  // These structured paths deliberately trim outer whitespace at persistence
  // (send/route.ts). Keep raw equality as evidence; compare saved text against
  // that exact policy, without normalizing interior content or replay bytes.
  report.saved = { exists: Boolean(turn), answerContainsMarker: turn?.text.includes(marker) ?? false,
    answerMatches: turn?.text === answer, answerMatchesPersistencePolicy: turn?.text === answer.trim(),
    identityMatches: JSON.stringify(turn?.responseMetadata?.runtimeIdentity) === JSON.stringify(report.identity),
    toolCount: turn?.tools?.length ?? 0,
    toolOutputContainsMarker: turn?.tools?.some((tool) => tool.status === 'ok' && String(tool.output ?? '').includes(marker)) ?? false };
  report.answerComparison = { liveLength: answer.length, savedLength: turn?.text.length ?? null,
    savedMatchesTrimmedLive: turn?.text === answer.trim(),
    liveLeadingWhitespace: answer.length - answer.trimStart().length,
    liveTrailingWhitespace: answer.length - answer.trimEnd().length };
  let replayEvents;
  let replayFinished;
  if (useHttp) {
    const replayResponse = await httpRequest(`/api/chat/stream?runId=${encodeURIComponent(runId)}&cursor=0`);
    report.replayHttpStatus = replayResponse.status;
    assert.equal(replayResponse.status, 200);
    replayEvents = parseEvents(await replayResponse.text());
    replayFinished = replayEvents.some((event) => event.kind === 'done');
  } else {
    const replay = subscribeRunStream(runId, 0, () => {}, () => {});
    replayEvents = replay?.replay.map((entry) => JSON.parse(entry.json)) ?? [];
    replayFinished = replay?.done === true;
    replay?.unsubscribe();
  }
  report.replay = { finished: replayFinished, toolsMatch: JSON.stringify(replayEvents.filter((event) => event.kind === 'tool_use')) === JSON.stringify(toolEvents), answerContainsMarker: assistantText(replayEvents).includes(marker), answerMatches: assistantText(replayEvents) === answer, identityMatches: JSON.stringify(replayEvents.findLast((event) => event.kind === 'done')?.responseMetadata?.runtimeIdentity) === JSON.stringify(report.identity) };
  assert.ok(done && !done.isError, 'real turn must complete successfully');
  assert.ok(report.answerContainsMarker, 'live answer must include the unpredictable marker');
  assert.ok(toolEvents.some((event) => event.status === 'ok' && String(event.output ?? '').includes(marker)), 'successful native tool output must include the marker');
  assert.ok(report.saved.answerContainsMarker && report.saved.answerMatchesPersistencePolicy && report.saved.identityMatches && report.saved.toolOutputContainsMarker, 'history must retain the real observations under the structured-path persistence policy');
  assert.ok(report.replay.finished && report.replay.toolsMatch && report.replay.answerContainsMarker && report.replay.answerMatches && report.replay.identityMatches, 'retained replay must match the live turn');
  assert.equal(report.identity?.harness, harness);
  if (harness === 'copilot') assert.equal(report.identity?.version, report.routing.version, 'reported version must match the canonical launch probe');
  if (harness === 'claude' || harness === 'copilot') assert.ok(report.identity?.model, 'the native model report must be present');
  if (nativeDestination) {
    const { runNativeProviderCanary } = await import('./runtime-activity-native-provider.mjs');
    const { listConversations } = await imp('src/lib/cave-conversations.ts');
    report.native = await runNativeProviderCanary({ repo, root, destination: nativeDestination,
      derived: nativeDerived, evidence: nativeEvidence, origin: caveServer.origin, token: mobileToken,
      projectRoot, marker, harness, identity: report.identity, initialSessionId: done.sessionId,
      prompt: `${toolInstruction} Do not inspect other files, run other commands, edit files or use external tools. Return exactly its contents.`,
      stopNativeRuns: async () => {
        const stopped = [];
        for (const entry of await listConversations()) {
          if (entry.sessionId === done.sessionId) continue;
          const conversation = await loadConversation(entry.sessionId);
          for (const turn of conversation?.turns ?? []) {
            if (turn.role !== 'user' || !turn.attentionClearOperationId) continue;
            const response = await httpRequest('/api/chat/stop', { method: 'POST',
              body: JSON.stringify({ runId: turn.attentionClearOperationId }), signal: AbortSignal.timeout(5_000) });
            assert.equal(response.status, 200);
            stopped.push({ runId: turn.attentionClearOperationId, stopped: (await response.json()).stopped === true });
          }
        }
        return stopped;
      } });
    const conversations = await listConversations();
    assert.equal(conversations.length, 2, 'one HTTP turn and one native turn; relaunch must not dispatch another');
    report.nativeDistinctConversations = conversations.length;
    report.limitations[0] = 'Built HTTP server, real provider and native Debug UI on loopback; forwarded-peer classification is simulated. Not remote HTTPS, managed pairing, packaged release or human accessibility.';
  }
  if (interactiveClient) {
    const { runInteractiveProviderCanary } = await import('./runtime-activity-interactive-provider.mjs');
    const { listConversations } = await imp('src/lib/cave-conversations.ts');
    report.interactive = await runInteractiveProviderCanary({ client: interactiveClient,
      evidence: interactiveEvidence, root, origin: caveServer.origin, token: mobileToken,
      project, marker, harness, identity: report.identity, initialSessionId: done.sessionId,
      prompt: `${toolInstruction} Do not inspect other files, run other commands, edit files or use external tools. Return exactly its contents.`,
      listConversations, loadConversation, httpRequest });
    report.limitations[0] = 'Built HTTP server, real provider and separately observed interactive client on loopback; backend checks do not themselves prove UI rendering, remote HTTPS, packaged release or human accessibility.';
  }
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = error instanceof assert.AssertionError ? error.message : error instanceof Error ? error.name : 'unknown';
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  await pendingStop;
  if (caveServer) {
    try { await httpHarness.stopCave(caveServer, caveServer.port); report.serverStopped = true; }
    catch { report.serverStopped = false; report.passed = false; process.exitCode = 1; }
  }
  if (daemonStarted) {
    try {
      native(['daemon', 'stop']);
      report.daemonStopped = true;
      if (Number.isSafeInteger(report.daemon?.pid)) {
        try { process.kill(report.daemon.pid, 0); report.daemonStopped = false; } catch (error) {
          report.daemonStopped = error.code === 'ESRCH';
        }
      }
      if (!report.daemonStopped) process.exitCode = 1;
    } catch { report.daemonStopped = false; process.exitCode = 1; }
  }
  report.sourceUnchanged = await sourceFingerprint() === report.candidate.changedSourceSha256;
  if (!report.sourceUnchanged || !report.daemonStopped) { report.passed = false; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
}

}
