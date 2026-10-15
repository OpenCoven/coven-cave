import type { ChatAttachment } from './chat-attachments.ts';
import type { ModelControlValues } from './model-control-capabilities.ts';

/** A frozen ordinary send, always bound to an existing chat. */
export type ScheduledChatMessage = {
  familiarId: string;
  sessionId: string;
  prompt: string;
  projectRoot?: string;
  attachments?: ChatAttachment[];
  modelOverride?: string;
  modelOverrideScope?: 'next-message' | 'session' | 'runtime-default';
  modelControls?: ModelControlValues;
  permissionMode?: string;
  runtimeHost?: string;
  mentionedFiles?: string[];
  mentionedFilesRoot?: string;
  parentTurnId?: string | null;
};
export type ScheduledChatReply = {
  id: string;
  sendAt: string;
  message: ScheduledChatMessage;
  status: 'scheduled' | 'sending' | 'sent' | 'failed' | 'uncertain' | 'cancelled';
  createdAt: string;
  error?: string;
};
export const SCHEDULE_HOST_NOTICE = 'Cave sends from your connected host. If the host is asleep or offline, the reply waits until Cave is running again.';
export function scheduledReplyLabel(status: ScheduledChatReply['status']): string {
  return ({ scheduled: 'Scheduled', sending: 'Delivery started — check chat', sent: 'Sent', failed: 'Failed — check chat', uncertain: 'Delivery unconfirmed — check chat before sending again', cancelled: 'Cancelled' })[status];
}
