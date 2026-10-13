import { consumeChatSse } from '../chat-sse.ts';
import type { ScheduledDispatchResult } from './scheduled-chat-store.ts';

export async function scheduledChatResult(response: Response): Promise<ScheduledDispatchResult> {
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    if (response.status === 409 && body?.code === 'chat_run_active') return { status: 'scheduled' };
    return { status: response.status >= 500 ? 'uncertain' : 'failed', error: 'Could not confirm this reply. Check the chat before sending again.' };
  }
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) return { status: 'uncertain' };
  let failed = false;
  const result = await consumeChatSse(response.body, event => {
    if (event.kind === 'error' || (event.kind === 'done' && event.isError)) failed = true;
  });
  if (failed) return { status: 'failed', error: 'The reply failed. Check the chat for details.' };
  return { status: result.sawDone ? 'sent' : 'uncertain' };
}
