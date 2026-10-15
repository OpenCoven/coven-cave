import { isSafeConversationSessionId, loadConversation } from '@/lib/cave-conversations';
import { ScheduleError, validateSchedule } from '@/lib/server/scheduled-chat-store';
import { scheduledChatStore, startScheduledChatScheduler } from '@/lib/server/scheduled-chat-scheduler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function errorResponse(error: unknown) {
  if (error instanceof ScheduleError) return Response.json({ ok: false, error: error.message }, { status: error.status });
  console.warn('[scheduled-chat] Store operation failed:', error);
  return Response.json({ ok: false, error: 'Could not update scheduled replies. Refresh the list before retrying.' }, { status: 500 });
}
export async function GET(req: Request) {
  const sessionId = new URL(req.url).searchParams.get('sessionId');
  if (!sessionId || !isSafeConversationSessionId(sessionId)) return Response.json({ ok: false, error: 'Valid sessionId required' }, { status: 400 });
  try {
    startScheduledChatScheduler();
    const items = await scheduledChatStore().list(sessionId);
    // Preview text and delivery state are enough for management; avoid sending
    // retained attachment bytes on every list refresh.
    return Response.json({ ok: true, items: items.map(item => ({ ...item, message: { familiarId: item.message.familiarId, sessionId, prompt: item.message.prompt } })) });
  } catch (error) { return errorResponse(error); }
}
export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); }
  catch { return Response.json({ ok: false, error: 'invalid json body' }, { status: 400 }); }
  try {
    const value = validateSchedule(body);
    const conversation = await loadConversation(value.message.sessionId);
    if (!conversation || conversation.familiarId !== value.message.familiarId) throw new ScheduleError('Open an existing chat before scheduling a reply.', 404);
    const item = await scheduledChatStore().add(value);
    startScheduledChatScheduler();
    return Response.json({ ok: true, item });
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(req: Request) {
  const params = new URL(req.url).searchParams;
  const id = params.get('id'), sessionId = params.get('sessionId');
  if (!id || !sessionId || !isSafeConversationSessionId(sessionId)) return Response.json({ ok: false, error: 'id and sessionId required' }, { status: 400 });
  try {
    const item = await scheduledChatStore().cancel(id, sessionId);
    return Response.json({ ok: true, item });
  } catch (error) { return errorResponse(error); }
}
