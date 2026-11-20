// Controlled external Tailscale identity; production device gateway, store,
// approval/revocation endpoints, replay and conversation routes remain real.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function prepareActivityAccessProbe(root) {
  const binary = path.join(root, 'tailscale-fixture');
  const inventory = { BackendState: 'Running', Self: { DNSName: 'cave.example.ts.net.' },
    User: { '5767': { LoginName: 'fixture@example.invalid' } },
    Peer: { fixture: { ID: 'fixture-node-5767', UserID: 5767, DNSName: 'phone.example.ts.net.', HostName: 'fixture-phone', TailscaleIPs: ['100.64.57.67'] } } };
  await writeFile(binary, '#!' + process.execPath + '\nif (process.argv.slice(2).join(" ") !== "status --json") process.exit(2);\nprocess.stdout.write(' + JSON.stringify(JSON.stringify(inventory)) + ');\n', { mode: 0o700, flag: 'wx' });
  return binary;
}

export async function probeActivityRevocation({ origin, adminToken, runId, sessionId }) {
  assert.ok(sessionId, 'actual conversation identity is required');
  const report = { classification: 'Production HTTP device gateway with controlled external peer inventory; not physical Tailscale ingress or per-project delegation.', reads: [] };
  const adminHeaders = { 'x-coven-cave-token': adminToken, origin, 'content-type': 'application/json' };
  const remoteHeaders = { origin: 'https://cave.example.ts.net', 'x-forwarded-host': 'cave.example.ts.net',
    'x-forwarded-proto': 'https', 'x-forwarded-for': '100.64.57.67', 'tailscale-user-login': 'fixture@example.invalid', 'content-type': 'application/json' };
  const request = (url, init = {}) => fetch(origin + url, { ...init, signal: init.signal ?? AbortSignal.timeout(10_000) });
  let response = await request('/api/device-access/admin/tailnets', { method: 'PUT', headers: adminHeaders, body: JSON.stringify({ tailnets: ['example.ts.net'] }) });
  assert.equal(response.status, 200, 'enable managed access in scratch store'); await response.body?.cancel();
  response = await request('/api/device-access/requests', { method: 'POST', headers: remoteHeaders, body: JSON.stringify({ installationId: randomUUID(), label: 'Qualification device' }) });
  assert.equal(response.status, 201, 'real gateway issues a pending device');
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie?.startsWith('cave_device_access='));
  const issued = await response.json();
  remoteHeaders.cookie = cookie;
  response = await request('/api/chat/stream?runId=' + runId, { headers: remoteHeaders });
  assert.equal(response.status, 403, 'pending device cannot guess a live run'); await response.body?.cancel();
  response = await request('/api/device-access/admin/decision', { method: 'POST', headers: adminHeaders, body: JSON.stringify({ id: issued.device.id, decision: 'allowed' }) });
  assert.equal(response.status, 200); await response.body?.cancel();
  response = await request('/api/chat/stream?runId=' + randomUUID(), { headers: remoteHeaders });
  assert.equal(response.status, 404, 'unknown run cannot resolve to another session'); await response.body?.cancel();
  const live = await request('/api/chat/stream?runId=' + runId + '&cursor=0', { headers: remoteHeaders });
  assert.equal(live.status, 200, 'allowed device reaches real live replay');
  const reader = live.body.getReader();
  assert.equal((await reader.read()).done, false, 'live replay has data before revocation');
  response = await request('/api/device-access/admin/decision', { method: 'POST', headers: adminHeaders, body: JSON.stringify({ id: issued.device.id, decision: 'revoked' }) });
  assert.equal(response.status, 200); await response.body?.cancel();
  let closed = false;
  const end = (async () => { try { while (!(await reader.read()).done) { /* drain already delivered bytes */ } } catch { /* gateway destroys socket */ } closed = true; })();
  await Promise.race([end, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('revoked stream remained open')), 5000); timer.unref(); })]);
  assert.equal(closed, true);
  report.activeStreamClosedOnRevocation = true;
  for (const url of ['/api/chat/stream?runId=' + runId, '/api/chat/conversation/' + sessionId, '/api/chat/conversation/' + sessionId + '/tool-output?toolId=effect-once-1']) {
    response = await request(url, { headers: remoteHeaders });
    assert.equal(response.status, 403, 'revoked device cannot read replay/history/detail');
    const body = await response.text();
    for (const forbidden of ['Inspecting', 'increment_counter', 'effect-once-1', 'PRIVATE_']) assert.ok(!body.includes(forbidden));
    report.reads.push({ surface: url.split('?')[0].replace(sessionId, ':id'), status: response.status });
  }
  return report;
}
