import path from 'node:path';
import { caveHome } from '../coven-paths.ts';
import { createScheduledChatStore, type ScheduledDispatch } from './scheduled-chat-store.ts';
import { scheduledChatResult } from './scheduled-chat-dispatch.ts';

export const scheduledChatStore = () => createScheduledChatStore(path.join(/* turbopackIgnore: true */ caveHome(), 'scheduled-chat-replies.json'));
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
type ScheduledChatScheduler = {
  wanted: boolean;
  revision: number;
  timer?: ReturnType<typeof setInterval>;
  pending?: Promise<void>;
  starting?: Promise<void>;
};

declare global {
  // eslint-disable-next-line no-var
  var __caveScheduledChatScheduler: ScheduledChatScheduler | undefined;
}

function schedulerOwner(): ScheduledChatScheduler {
  return globalThis.__caveScheduledChatScheduler ??= { wanted: false, revision: 0 };
}

function tick(owner: ScheduledChatScheduler): void {
  if (!owner.wanted || owner.pending) return;
  // Admission belongs to this pass. Stopping clears future passes, while the
  // existing store retains authority over the admitted claims and sends.
  const pending = Promise.resolve()
    .then(() => scheduledChatStore().tick(dispatch))
    .catch(error => { console.warn('[scheduled-chat] Could not process scheduled replies:', error); })
    .finally(() => {
      if (owner.pending === pending) owner.pending = undefined;
    });
  owner.pending = pending;
}

export function startScheduledChatScheduler(): Promise<void> {
  if (process.env.NEXT_PHASE === 'phase-production-build') return Promise.resolve();
  const owner = schedulerOwner();
  if (owner.wanted) return owner.starting ?? Promise.resolve();
  owner.wanted = true;
  const revision = ++owner.revision;
  const activate = () => {
    if (!owner.wanted || owner.revision !== revision) return;
    owner.timer = setInterval(() => { tick(owner); }, 15_000);
    owner.timer.unref?.();
    tick(owner);
  };
  if (!owner.pending) {
    activate();
    return Promise.resolve();
  }
  // A restart cannot create another owner while an old admitted pass drains.
  const starting = owner.pending.then(activate);
  owner.starting = starting;
  const settled = () => {
    if (owner.starting === starting) owner.starting = undefined;
  };
  void starting.then(settled, settled);
  return starting;
}

/** Stop admission now; the caller may observe a deadline without cancelling work. */
export function stopScheduledChatScheduler(): Promise<void> {
  const owner = schedulerOwner();
  owner.wanted = false;
  owner.revision += 1;
  if (owner.timer !== undefined) clearInterval(owner.timer);
  owner.timer = undefined;
  return owner.pending ?? Promise.resolve();
}
