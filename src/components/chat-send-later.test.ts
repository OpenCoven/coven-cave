import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const source = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
test('desktop send later uses a trapped modal, labelled date, and server acknowledgement before clearing', () => {
  const component = source('./chat-send-later.tsx');
  assert.match(component, /<Modal/);
  assert.match(component, /type="datetime-local"/);
  assert.match(component, /useAnnouncer/);
  assert.match(component, /\/api\/chat\/scheduled/);
  assert.match(component, /if \(!response.ok/);
  assert.match(component, /onScheduled\(attempt.current!.message\)/);
  const chat = source('./chat-view.tsx');
  assert.match(chat, /<ChatSendLater/);
  assert.match(chat, /buildQuotedPrompt\(replyTarget, input.trim\(\)\)/);
});
test('iOS exposes the same scheduling and cancellation contract', () => {
  const view = source('../../apps/ios/CovenCave/CovenCave/Views/ChatView.swift');
  assert.match(view, /ScheduledChatSheet/);
  assert.match(view, /label: "Send later"/);
  const sheet = source('../../apps/ios/CovenCave/CovenCave/Views/ScheduledChatSheet.swift');
  assert.match(sheet, /DatePicker\("Send at"/);
  assert.match(sheet, /cancelScheduledReply/);
  assert.match(sheet, /scheduleReply/);
});
