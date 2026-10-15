import path from 'node:path';
import { caveHome } from '../coven-paths.ts';
import { createScheduledChatStore, type ScheduledDispatch } from './scheduled-chat-store.ts';
import { scheduledChatResult } from './scheduled-chat-dispatch.ts';

export const scheduledChatStore = () => createScheduledChatStore(path.join(caveHome(), 'scheduled-chat-replies.json'));
const dispatch: ScheduledDispatch = async (message, runId) => {
  const { loadConversation } = await import('../cave-conversations.ts');
  const conversation = await loadConversation(message.sessionId);
  if (!conversation || conversation.familiarId !== message.familiarId) return { status: 'failed', error: 'The original chat is no longer available.' };
  // Use the ordinary send admission path: current project access, model,
  // runtime availability, and the one-live-turn guard are all checked again.
  const { POST } = await import('../../app/api/chat/send/route.ts');
  return scheduledChatResult(await POST(new Request('http://localhost/api/chat/send', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...message, runId }),
  })));
};
declare global {
  // eslint-disable-next-line no-var
  var __caveScheduledChatTimer: ReturnType<typeof setInterval> | undefined;
}
export function startScheduledChatScheduler() {
  if (globalThis.__caveScheduledChatTimer || process.env.NEXT_PHASE === 'phase-production-build') return;
  const tick = async () => {
    try { await scheduledChatStore().tick(dispatch); }
    catch (error) { console.warn('[scheduled-chat] Could not process scheduled replies:', error); }
  };
  globalThis.__caveScheduledChatTimer = setInterval(() => { void tick(); }, 15_000);
  globalThis.__caveScheduledChatTimer.unref?.();
  void tick();
}
