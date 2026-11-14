import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, realpath } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { tmpdir } from 'node:os';
const repo = process.cwd();
const imp = file => import(pathToFileURL(path.join(repo, file)).href);
const { startCave, stopCave, freePort } = await imp('scripts/client-v1-conformance.mjs');
const { prepareActivityAccessProbe } = await imp('scripts/runtime-activity-access-probes.mjs');
const { removeFixtureRoot } = await imp('scripts/native-harness-teardown.mjs');
const root = await realpath(await mkdtemp(path.join(tmpdir(), 'g14-live-')));
const covenHome = path.join(root, 'coven'), caveHome = path.join(covenHome, 'cave');
await mkdir(caveHome, { recursive: true, mode: 0o700 });
await mkdir(path.join(root, 'project'), { mode: 0o700 });
Object.assign(process.env, { COVEN_HOME: covenHome, COVEN_CAVE_HOME: caveHome,
 COVEN_SOCKET: path.join(root, 'daemon.sock'), COVEN_CAVE_ENV_FILE: path.join(root, 'no.env'),
 COVEN_PREFERENCES_PATH: path.join(root, 'preferences.json'), COVEN_VAULT_FILE: path.join(root, 'vault.yaml'),
 CAVE_PROJECTS_PATH_OVERRIDE: path.join(root, 'projects.json'), CAVE_PROJECT_PERMISSIONS_PATH_OVERRIDE: path.join(root, 'permissions.json'),
 CAVE_QUEUE_PROJECT_PATH_OVERRIDE: path.join(root, 'queue.json'), TAILSCALE_BIN: await prepareActivityAccessProbe(root) });
delete process.env.COVEN_CAVE_E2E;
await writeFile(path.join(covenHome, 'familiars.toml'), '[[familiar]]\nid="golden14"\ndisplay_name="Golden 14 fixture"\nrole="Verification"\ndescription="Synthetic local qualification"\n');
const { saveConfig } = await imp('src/lib/cave-config.ts');
const { createProject } = await imp('src/lib/cave-projects.ts');
const { grantProjectToFamiliar } = await imp('src/lib/project-permissions.ts');
const { selectQueueProject } = await imp('src/lib/queue-project-readiness.ts');
const { saveConversation } = await imp('src/lib/cave-conversations.ts');
const { fetchToolOutput, ToolOutputFetchError } = await imp('src/lib/tool-output-fetch.ts');
await saveConfig({ familiars: { golden14: { harness: 'hermes', model: '' } } });
const project = await createProject({ name: 'Golden 14 fixture', root: path.join(root, 'project') });
await grantProjectToFamiliar({ familiarId: 'golden14', projectId: project.id, access: 'write', source: 'human' });
await selectQueueProject(project.id);
const sessionId = 'golden14-' + randomUUID();
const marker = 'AUTHORIZED_GOLDEN14_' + randomUUID();
const atLimitText = 'Bounded display output. '.repeat(Math.ceil(256 * 1024 / Buffer.byteLength('Bounded display output. '))).slice(0, 256 * 1024);
const output = (id, text) => ({ id, name: 'Read', status: 'ok', input: '{"path":"fixture.txt"}', output: text, textOffset: 0 });
await saveConversation({ sessionId, familiarId: 'golden14', harness: 'hermes', runtime: project.root,
 updatedAt: '2026-11-12T12:00:00.000Z', activeLeafId: 'answer', turns: [
 { id: 'request', role: 'user', text: 'Inspect synthetic output', createdAt: '2026-11-12T12:00:00.000Z' },
 { id: 'answer', parentId: 'request', role: 'assistant', text: 'Fixture complete.', createdAt: '2026-11-12T12:00:00.000Z', lifecycle: 'complete',
 tools: [...Array.from({ length: 500 }, (_, i) => output('call-' + i, i === 0 ? marker : 'SAFE_OUTPUT_' + i)),
 output('ambiguous', 'first'), output('ambiguous', 'second'), output('oversized', 'X'.repeat(256 * 1024 + 1)), output('at-limit', atLimitText)] }
 ] });
const report = { classification: 'Built server, real storage/projection/device-gateway; controlled external peer inventory, synthetic saved conversation; no provider dispatch or physical ingress', root,
 head: process.env.NOVA6064_HEAD, buildId: (await readFile('.next/BUILD_ID', 'utf8')).trim(),
 serverSha256: createHash('sha256').update(await readFile('server.mjs')).digest('hex'), checks: [], passed: false };
let cave;
try {
 const adminToken = randomUUID(), mobileToken = randomUUID();
 cave = await startCave({ port: await freePort(), caveHomeDir: caveHome, covenHomeDir: covenHome, adminToken, mobileAccessToken: mobileToken });
 const origin = cave.origin, detail = '/api/chat/conversation/' + sessionId + '/tool-output?toolId=';
 const request = (url, init = {}) => fetch(origin + url, { ...init, signal: AbortSignal.timeout(10000) });
 let response = await request(detail + 'call-0');
 assert.equal(response.status, 200); assert.equal((await response.json()).output, marker); report.checks.push({ case: 'verified direct-local peer', status: 200 });
 const allowedFetch = (url, init) => request(url, { ...init, headers: { ...init?.headers, authorization: 'Bearer ' + mobileToken } });
 assert.equal(await fetchToolOutput(sessionId, 'call-0', allowedFetch), marker); report.checks.push({ case: 'authorized real lazy fetch', status: 200 });
 for (const [toolId, status] of [['missing', 404], ['ambiguous', 409]]) {
  response = await allowedFetch(detail + toolId); assert.equal(response.status, status); assert.ok(!(await response.text()).includes(marker)); report.checks.push({ case: toolId, status });
 }
 response = await allowedFetch(detail + 'oversized');
 assert.equal(response.status, 404);
 assert.ok(!(await response.text()).includes('X'.repeat(64)));
 await assert.rejects(fetchToolOutput(sessionId, 'oversized', allowedFetch), error => error instanceof ToolOutputFetchError && error.status === 404);
 report.checks.push({ case: 'oversized saved output withheld by server projection', status: 404, markerWithheld: true });
 const atLimit = await fetchToolOutput(sessionId, 'at-limit', allowedFetch);
 assert.equal(Buffer.byteLength(atLimit), 256 * 1024);
 assert.equal(atLimit, atLimitText);
 report.checks.push({ case: 'at-limit real lazy response', status: 200, outputBytes: Buffer.byteLength(atLimit) });
 const adminHeaders = { 'x-coven-cave-token': adminToken, origin, 'content-type': 'application/json' };
 const remoteHeaders = { origin: 'https://cave.example.ts.net', 'x-forwarded-host': 'cave.example.ts.net', 'x-forwarded-proto': 'https',
  'x-forwarded-for': '100.64.57.67', 'tailscale-user-login': 'fixture@example.invalid', 'content-type': 'application/json' };
 response = await request('/api/device-access/admin/tailnets', { method: 'PUT', headers: adminHeaders, body: JSON.stringify({ tailnets: ['example.ts.net'] }) }); assert.equal(response.status, 200); await response.body?.cancel();
 response = await request('/api/device-access/requests', { method: 'POST', headers: remoteHeaders, body: JSON.stringify({ installationId: randomUUID(), label: 'Golden 14 fixture' }) }); assert.equal(response.status, 201);
 const cookie = response.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie); const issued = await response.json(); remoteHeaders.cookie = cookie;
 response = await request(detail + 'call-0', { headers: remoteHeaders }); assert.equal(response.status, 403); assert.ok(!(await response.text()).includes(marker)); report.checks.push({ case: 'pending device', status: 403, markerWithheld: true });
 response = await request('/api/device-access/admin/decision', { method: 'POST', headers: adminHeaders, body: JSON.stringify({ id: issued.device.id, decision: 'allowed' }) }); assert.equal(response.status, 200); await response.body?.cancel();
 response = await request(detail + 'call-0', { headers: remoteHeaders }); assert.equal(response.status, 200); assert.equal((await response.json()).output, marker); report.checks.push({ case: 'allowed device', status: 200 });
 response = await request('/api/device-access/admin/decision', { method: 'POST', headers: adminHeaders, body: JSON.stringify({ id: issued.device.id, decision: 'revoked' }) }); assert.equal(response.status, 200); await response.body?.cancel();
 response = await request(detail + 'call-0', { headers: remoteHeaders }); assert.equal(response.status, 403); assert.ok(!(await response.text()).includes(marker)); report.checks.push({ case: 'revoked device', status: 403, markerWithheld: true });
 report.passed = true;
} catch (error) { report.failure = { name: error.name, message: error.message }; process.exitCode = 1; }
finally {
 if (cave) { try { await stopCave(cave, cave.port); report.serverStopped = true; } catch { report.serverStopped = false; process.exitCode = 1; } }
 if (!cave || report.serverStopped) report.cleanup = await removeFixtureRoot(root);
 if (process.env.C6064_REPORT_PATH) await writeFile(process.env.C6064_REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
 console.log(JSON.stringify(report));
}
