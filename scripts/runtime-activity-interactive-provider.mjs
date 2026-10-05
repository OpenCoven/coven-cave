import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';

// The opt-in parent owns the provider, daemon and service. A human or UI
// controller sends through the real composer; this helper only reads evidence.
// It never treats a backend assertion as proof that a client rendered it.
export async function runInteractiveProviderCanary(input) {
  const { client, evidence, origin, token, project, marker, harness, identity,
    initialSessionId, listConversations, loadConversation, httpRequest } = input;
  assert.ok(['web', 'desktop'].includes(client) && path.isAbsolute(evidence));
  assert.ok(['claude', 'copilot'].includes(harness) && identity.version && identity.model);
  await mkdir(evidence, { recursive: false, mode: 0o700 });
  const report = { startedAt: new Date().toISOString(), client, harness, passed: false,
    expectedIdentity: identity, uiRenderingVerified: false,
    limitations: ['UI observations must be recorded separately; these assertions inspect saved history and replay.',
      'Conversation counts are not tool-invocation or protected-effect receipts.'] };
  const connectionFile = path.join(evidence, 'connection.json');
  const control = createInterface({ input: process.stdin });
  let timedOut = false;
  const deadline = setTimeout(() => { timedOut = true; control.close(); }, 30 * 60_000);
  async function get(url) {
    const response = await httpRequest(url, { signal: AbortSignal.timeout(15_000) });
    assert.equal(response.status, 200);
    return response;
  }
  async function snapshot() {
    const conversations = await listConversations();
    assert.equal(conversations.length, 2, 'exactly the HTTP canary and one composer conversation');
    const entry = conversations.find((x) => x.sessionId !== initialSessionId);
    assert.ok(entry);
    const sessionId = entry.sessionId;
    const saved = (await (await get(`/api/chat/conversation/${encodeURIComponent(sessionId)}`)).json()).conversation;
    assert.equal(saved.runtime, `local:${project.root}`);
    assert.equal(saved.familiarId, 'activitycanary');
    const users = saved.turns.filter((x) => x.role === 'user');
    const replies = saved.turns.filter((x) => x.role === 'assistant');
    assert.equal(users.length, 1); assert.equal(replies.length, 1);
    const reply = replies[0];
    assert.ok(!reply.isError && !reply.cancelled && reply.text.includes(marker));
    for (const key of ['harness', 'version', 'model']) assert.equal(reply.responseMetadata?.runtimeIdentity?.[key], identity[key]);
    const tool = reply.tools?.find((x) => x.status === 'ok' && String(x.output ?? '').includes(marker));
    assert.ok(tool, 'successful saved tool output must contain the unpredictable marker');
    const output = await (await get(`/api/chat/conversation/${encodeURIComponent(sessionId)}/tool-output?toolId=${encodeURIComponent(tool.id)}`)).json();
    assert.equal(output.ok, true); assert.ok(output.output.includes(marker));
    const runId = users[0].attentionClearOperationId;
    assert.ok(runId);
    const events = (await (await get(`/api/chat/stream?runId=${encodeURIComponent(runId)}&cursor=0`)).text())
      .split('\n').filter((line) => line.startsWith('data: ')).map((line) => JSON.parse(line.slice(6)));
    const done = events.findLast((x) => x.kind === 'done');
    assert.ok(done && !done.isError && !done.cancelled);
    for (const key of ['harness', 'version', 'model']) assert.equal(done.responseMetadata?.runtimeIdentity?.[key], identity[key]);
    assert.ok(events.some((x) => x.kind === 'tool_use' && x.id === tool.id && x.status === 'ok' && String(x.output ?? '').includes(marker)));
    const answer = events.reduce((text, event) => event.kind === 'assistant_replace' ? event.text
      : event.kind === 'assistant_chunk' ? text + event.text : text, '');
    assert.equal(reply.text, answer.trim());
    return { sessionId, runId, userTurnId: users[0].id, assistantTurnId: reply.id,
      identity: reply.responseMetadata.runtimeIdentity, tool: { id: tool.id, name: tool.name, status: tool.status },
      outputContainsMarker: true, replayMatchesSavedAnswerIdentityAndTool: true, conversationCount: conversations.length };
  }
  try {
    await writeFile(connectionFile, JSON.stringify({ origin, token, root: input.root, project, marker,
      familiarId: 'activitycanary', harness, expectedIdentity: identity, prompt: input.prompt }, null, 2), { flag: 'wx', mode: 0o600 });
    assert.ok(!control.closed, 'interactive verification requires an open stdin; use tty=true');
    console.log(JSON.stringify({ phase: 'interactive-ready', client, origin, connection: connectionFile,
      commands: ['snapshot', 'restored', 'finish', 'abort'] }));
    for await (const line of control) {
      const command = line.trim();
      if (command === 'abort') throw new Error('InteractiveCanaryAborted');
      if (command === 'snapshot') {
        assert.equal(report.live, undefined);
        report.live = await snapshot();
      } else if (command === 'restored') {
        assert.ok(report.live && !report.restored);
        report.restored = await snapshot();
        assert.deepEqual(report.restored, report.live, 'reload/reopen must preserve the same history and replay');
      } else if (command === 'finish') {
        assert.ok(report.live && report.restored, 'inspect the live client and reload/reopen before finishing');
        assert.deepEqual(await snapshot(), report.live, 'finishing must not add a send');
        report.passed = true; break;
      } else throw new Error('UnknownInteractiveCommand');
      await writeFile(path.join(evidence, 'progress.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
      console.log(JSON.stringify({ phase: command, backendVerified: true }));
    }
    assert.ok(!timedOut && report.passed, 'interactive verification must finish explicitly');
  } catch (error) {
    report.failure = error instanceof assert.AssertionError ? error.message : error.name;
    report.stopRequests = [];
    try {
      for (const entry of await listConversations()) {
        if (entry.sessionId === initialSessionId) continue;
        const saved = await loadConversation(entry.sessionId);
        for (const turn of saved?.turns ?? []) {
          if (turn.role !== 'user' || !turn.attentionClearOperationId) continue;
          const response = await httpRequest('/api/chat/stop', { method: 'POST',
            body: JSON.stringify({ runId: turn.attentionClearOperationId }), signal: AbortSignal.timeout(5_000) });
          assert.equal(response.status, 200);
          report.stopRequests.push({ runId: turn.attentionClearOperationId, stopped: (await response.json()).stopped === true });
        }
      }
    } catch { report.stopFailed = true; }
    throw error;
  } finally {
    clearTimeout(deadline); control.close();
    await rm(connectionFile, { force: true });
    report.temporaryConnectionRemoved = true;
    report.finishedAt = new Date().toISOString();
    await writeFile(path.join(evidence, 'result.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  }
  return report;
}
