// Opt-in built-server fixture for manual/CLI browser qualification.
// Only the external provider is synthetic. Commands on stdin: release, finish.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { appendFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { freePort, startCave, stopCave } from './client-v1-conformance.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [execute, evidence] = process.argv.slice(2);
assert.ok(execute === '--execute' && evidence && path.isAbsolute(evidence) && process.argv.length === 4,
  'Usage: node --experimental-strip-types --import ./scripts/test-alias-register.mjs scripts/runtime-activity-browser-fixture.mjs --execute <new-absolute-evidence-directory>');
await mkdir(evidence, { recursive: false, mode: 0o700 });
const root = await realpath(await mkdtemp(path.join(tmpdir(), 'cave-browser-activity-')));
const covenHome = path.join(root, 'coven');
const caveHome = path.join(covenHome, 'cave');
const projectRoot = path.join(root, 'project');
const token = 'fixture-browser-' + randomUUID();
const adminToken = 'fixture-sidecar-' + randomUUID();
const providerToken = 'fixture-provider-' + randomUUID();
const marker = 'CAVE_BROWSER_' + randomUUID();
const covenBin = execFileSync('which', ['coven'], { encoding: 'utf8' }).trim();
const report = { schemaVersion: 1, startedAt: new Date().toISOString(), root,
  candidate: { head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
    buildId: (await readFile(path.join(repo, '.next/BUILD_ID'), 'utf8')).trim() },
  classification: 'built Cave, real Coven daemon, synthetic external Hermes provider; browser assertions recorded separately',
  providerRequests: 0, toolInvocations: 0, modelInventoryRequests: 0, fixturePassed: false };
let provider, cave, daemonStarted = false, release, timedOut = false;
const gate = new Promise((resolve) => { release = resolve; });
const input = createInterface({ input: process.stdin });
const deadline = setTimeout(() => { timedOut = true; input.close(); }, 30 * 60_000);
const native = (args) => execFileSync(covenBin, args, {
  env: process.env, cwd: projectRoot, encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'],
});
const ledger = path.join(evidence, 'invocations.jsonl');
const imp = (file) => import(pathToFileURL(path.join(repo, file)).href);
function frames(res, values) {
  const bytes = Buffer.from(values.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(''));
  for (let i = 0; i < bytes.length; i += 7) res.write(bytes.subarray(i, i + 7));
}
try {
  await mkdir(caveHome, { recursive: true, mode: 0o700 });
  await mkdir(projectRoot, { mode: 0o700 });
  await writeFile(path.join(projectRoot, 'marker.txt'), marker, { mode: 0o600 });
  await writeFile(ledger, '', { flag: 'wx', mode: 0o600 });
  await writeFile(path.join(covenHome, 'familiars.toml'),
    '[[familiar]]\nid = "nativeactivity"\ndisplay_name = "Activity fixture"\nrole = "Verification"\ndescription = "Controlled local provider fixture."\n');
  execFileSync('git', ['init', '--quiet', projectRoot]);
  Object.assign(process.env, {
    COVEN_HOME: covenHome, COVEN_CAVE_HOME: caveHome, COVEN_SOCKET: path.join(covenHome, 'coven.sock'), COVEN_BIN: covenBin,
    COVEN_WORKSPACE_ROOT: projectRoot, COVEN_WORKSPACES_ROOT: root,
    COVEN_VAULT_FILE: path.join(root, 'vault.yaml'), COVEN_CAVE_ENV_FILE: path.join(root, '.env.local'),
    COVEN_CAVE_LOCAL_VAULT_FILE: path.join(root, 'local-vault.enc.json'), COVEN_CAVE_LOCAL_VAULT_KEY_FILE: path.join(root, 'local-vault.key'),
    COVEN_PREFERENCES_PATH: path.join(root, 'preferences.json'), COVEN_THEME_PATH: path.join(root, 'theme.json'),
    CAVE_PROJECTS_PATH_OVERRIDE: path.join(root, 'projects.json'), CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE: path.join(root, 'permissions.json'),
    CAVE_QUEUE_PROJECT_PATH_OVERRIDE: path.join(root, 'queue-project.json'),
  });
  delete process.env.COVEN_CAVE_E2E;
  const scenarioBytes = await readFile(path.join(repo, 'apps/ios/CovenCave/CovenCaveTests/Fixtures/runtime-activity-http-v1.json'));
  report.scenarioSha256 = createHash('sha256').update(scenarioBytes).digest('hex');
  const scenario = JSON.parse(scenarioBytes.toString().replaceAll('{{MARKER}}', marker));
  provider = createServer(async (req, res) => {
    try {
      if (req.headers.authorization !== `Bearer ${providerToken}`) { res.writeHead(403).end(); return; }
      if (req.method === 'GET' && req.url === '/v1/models') {
        report.modelInventoryRequests += 1;
        // Synthetic inventory, including supported older releases: exercise
        // the real discovery/menu policy without claiming provider availability.
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [
          'openai/gpt-5.6', 'openai/gpt-6.0', 'openai/gpt-6.1',
          'anthropic/claude-opus-4-8', 'anthropic/claude-opus-5-5', 'served-fixture-v3',
        ].map((id) => ({ id })) }));
        return;
      }
      assert.equal(req.method, 'POST'); assert.equal(req.url, '/v1/responses');
      let body = '';
      for await (const chunk of req) { body += chunk; assert.ok(body.length < 1024 * 1024); }
      assert.equal(JSON.parse(body).stream, true);
      report.providerRequests += 1;
      await appendFile(ledger, JSON.stringify({ kind: 'provider', ordinal: report.providerRequests }) + '\n');
      assert.equal(report.providerRequests, 1, 'history/reconnect must not dispatch again');
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      frames(res, scenario.beforeRelease);
      await gate;
      const value = await readFile(path.join(projectRoot, 'marker.txt'), 'utf8');
      assert.equal(value, marker);
      report.toolInvocations += 1;
      await appendFile(ledger, JSON.stringify({ kind: 'read_file', ordinal: report.toolInvocations,
        markerSha256: createHash('sha256').update(value).digest('hex') }) + '\n');
      frames(res, scenario.afterRelease); res.end();
    } catch (error) { report.providerFailure = error.message; res.destroy(); }
  });
  provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
  Object.assign(process.env, { HERMES_API_URL: `http://127.0.0.1:${provider.address().port}`, HERMES_API_KEY: providerToken });
  const { saveConfig } = await imp('src/lib/cave-config.ts');
  const { createProject } = await imp('src/lib/cave-projects.ts');
  const { grantProjectToFamiliar } = await imp('src/lib/project-permissions.ts');
  const { selectQueueProject } = await imp('src/lib/queue-project-readiness.ts');
  await saveConfig({ familiars: { nativeactivity: { harness: 'hermes', model: '' } } });
  const project = await createProject({ name: 'Browser activity fixture', root: projectRoot });
  await grantProjectToFamiliar({ familiarId: 'nativeactivity', projectId: project.id, source: 'human', access: 'write' });
  await selectQueueProject(project.id);
  report.covenVersion = native(['--version']).trim();
  daemonStarted = true; native(['daemon', 'start']);
  report.daemon = JSON.parse(await readFile(path.join(covenHome, 'daemon.json'), 'utf8'));
  cave = await startCave({ port: await freePort(), caveHomeDir: caveHome, covenHomeDir: covenHome,
    adminToken, mobileAccessToken: token });
  report.serverPid = cave.child.pid;
  const connection = { origin: cave.origin, token, adminToken, project, marker, familiarId: 'nativeactivity' };
  await writeFile(path.join(evidence, 'connection.json'), JSON.stringify(connection, null, 2), { mode: 0o600 });
  assert.ok(!input.closed, 'Browser fixture needs an open control input; start the command with tty=true.');
  console.log(JSON.stringify({ phase: 'ready', origin: cave.origin, connection: path.join(evidence, 'connection.json'),
    commands: ['release', 'finish'] }));
  for await (const line of input) {
    if (line.trim() === 'release') { release(); console.log(JSON.stringify({ phase: 'released' })); }
    if (line.trim() === 'finish') {
      assert.equal(report.providerRequests, 1); assert.equal(report.toolInvocations, 1);
      assert.equal(report.providerFailure, undefined);
      const { listConversations, loadConversation } = await imp('src/lib/cave-conversations.ts');
      const saved = await listConversations(); assert.equal(saved.length, 1);
      const conversation = await loadConversation(saved[0].sessionId);
      await writeFile(path.join(evidence, 'saved-conversation.json'), JSON.stringify(conversation, null, 2), { mode: 0o600 });
      report.fixturePassed = true; break;
    }
  }
  assert.ok(!timedOut && report.fixturePassed, 'fixture must finish explicitly after browser inspection');
} catch (error) { report.failure = error.message; process.exitCode = 1; }
finally {
  clearTimeout(deadline); input.close(); release();
  if (cave) {
    try { await stopCave(cave, cave.port); report.serverStopped = true; }
    catch { report.serverStopped = false; process.exitCode = 1; }
  }
  if (provider) { provider.closeAllConnections(); await new Promise((resolve) => provider.close(resolve)); }
  if (daemonStarted) {
    try {
      native(['daemon', 'stop']);
      try { process.kill(report.daemon.pid, 0); report.daemonStopped = false; }
      catch (error) { report.daemonStopped = error.code === 'ESRCH'; }
    } catch { report.daemonStopped = false; }
  }
  if (report.serverStopped === true && report.daemonStopped === true) {
    await rm(root, { recursive: true, force: true }); report.fixtureRootRemoved = true;
  } else { report.fixturePassed = false; process.exitCode = 1; report.preservedRoot = root; }
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
