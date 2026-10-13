import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { writeJsonAtomic } from './atomic-write.ts';
import { withProcessIntentLock } from './process-intent-lock.ts';
import type { ScheduledChatMessage, ScheduledChatReply } from '../scheduled-chat.ts';

export class ScheduleError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/;
const MESSAGE_KEYS = new Set(['familiarId', 'sessionId', 'prompt', 'projectRoot', 'attachments', 'modelOverride', 'modelOverrideScope', 'modelControls', 'permissionMode', 'runtimeHost', 'mentionedFiles', 'mentionedFilesRoot', 'parentTurnId']);
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
export function validateSchedule(input: unknown): { id: string; sendAt: string; message: ScheduledChatMessage } {
  if (!isObject(input) || typeof input.id !== 'string' || !SAFE_ID.test(input.id)) throw new ScheduleError('A valid scheduling ID is required.');
  if (typeof input.sendAt !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(input.sendAt) || !Number.isFinite(Date.parse(input.sendAt))) throw new ScheduleError('Choose a valid date and time with a time zone.');
  const m = input.message;
  if (!isObject(m) || Object.keys(m).some(k => !MESSAGE_KEYS.has(k))) throw new ScheduleError('Invalid scheduled reply.');
  if (typeof m.familiarId !== 'string' || !SAFE_ID.test(m.familiarId) || typeof m.sessionId !== 'string' || !SAFE_ID.test(m.sessionId)) throw new ScheduleError('Open an existing chat before scheduling a reply.');
  if (typeof m.prompt !== 'string' || m.prompt.length > 1_000_000) throw new ScheduleError('Invalid reply text.');
  if (m.attachments !== undefined && (!Array.isArray(m.attachments) || m.attachments.length > 10 || m.attachments.some(a => !isObject(a) || typeof a.name !== 'string' || typeof a.mimeType !== 'string'))) throw new ScheduleError('Invalid attachments.');
  if (!m.prompt.trim() && !(Array.isArray(m.attachments) && m.attachments.length)) throw new ScheduleError('Write a reply or attach a file first.');
  for (const key of ['projectRoot', 'modelOverride', 'runtimeHost', 'mentionedFilesRoot']) {
    if (m[key] !== undefined && (typeof m[key] !== 'string' || m[key].length > 4096)) throw new ScheduleError(`Invalid ${key}.`);
  }
  if (m.parentTurnId !== undefined && m.parentTurnId !== null && (typeof m.parentTurnId !== 'string' || !SAFE_ID.test(m.parentTurnId))) throw new ScheduleError('Invalid reply branch.');
  if (m.permissionMode !== undefined && m.permissionMode !== 'read' && m.permissionMode !== 'full') throw new ScheduleError('Invalid access mode.');
  if (m.modelOverrideScope !== undefined && !['session', 'next-message', 'runtime-default'].includes(String(m.modelOverrideScope))) throw new ScheduleError('Invalid model scope.');
  if (m.modelControls !== undefined && (!isObject(m.modelControls) || Object.keys(m.modelControls).length > 20 || Object.values(m.modelControls).some(v => typeof v !== 'string' || v.length > 200))) throw new ScheduleError('Invalid model controls.');
  if (m.mentionedFiles !== undefined && (!Array.isArray(m.mentionedFiles) || m.mentionedFiles.length > 100 || m.mentionedFiles.some(v => typeof v !== 'string' || v.length > 4096))) throw new ScheduleError('Invalid file mentions.');
  if (JSON.stringify(m).length > 75_000_000) throw new ScheduleError('Attachments are too large to schedule.');
  return { id: input.id, sendAt: new Date(input.sendAt).toISOString(), message: structuredClone(m) as ScheduledChatMessage };
}
export type ScheduledDispatchResult = { status: 'sent' | 'failed' | 'uncertain' | 'scheduled'; error?: string };
export type ScheduledDispatch = (message: ScheduledChatMessage, runId: string) => Promise<ScheduledDispatchResult>;

/** Atomic durable claim BEFORE dispatch. A crashed claim is never replayed. */
export function createScheduledChatStore(file: string) {
  async function read(): Promise<ScheduledChatReply[]> {
    try {
      const data = JSON.parse(await readFile(file, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.items)) throw new Error('Invalid scheduled reply store');
      return data.items;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
  async function change<T>(fn: (items: ScheduledChatReply[]) => T): Promise<T> {
    await mkdir(path.dirname(file), { recursive: true });
    return withProcessIntentLock({ intentsDirectory: `${file}.locks`, label: 'scheduled replies' }, async () => {
      const items = await read();
      const result = fn(items);
      await writeJsonAtomic(file, { version: 1, items });
      return result;
    });
  }
  return {
    async list(sessionId: string) { return (await read()).filter(i => i.message.sessionId === sessionId && i.status !== 'cancelled').sort((a, b) => a.sendAt.localeCompare(b.sendAt)); },
    async add(input: unknown, now = Date.now()) {
      const value = validateSchedule(input);
      return change(items => {
        const existing = items.find(i => i.id === value.id);
        if (existing) {
          if (existing.sendAt !== value.sendAt || JSON.stringify(existing.message) !== JSON.stringify(value.message)) throw new ScheduleError('This scheduling ID already belongs to another reply.', 409);
          return existing;
        }
        if (Date.parse(value.sendAt) <= now) throw new ScheduleError('Choose a future date and time.');
        if (items.filter(i => i.status === 'scheduled').length >= 100) throw new ScheduleError('There are 100 scheduled replies. Cancel one before adding another.', 409);
        const item: ScheduledChatReply = { ...value, status: 'scheduled', createdAt: new Date(now).toISOString() };
        items.push(item);
        return item;
      });
    },
    async cancel(id: string, sessionId: string) {
      return change(items => {
        const item = items.find(i => i.id === id && i.message.sessionId === sessionId);
        if (!item) throw new ScheduleError('Scheduled reply not found.', 404);
        if (item.status !== 'scheduled' && item.status !== 'cancelled') throw new ScheduleError('Delivery has already started. Check the chat before sending again.', 409);
        item.status = 'cancelled';
        return item;
      });
    },
    async tick(dispatch: ScheduledDispatch, now = Date.now()) {
      // One oldest reply per chat per tick: unrelated chats run in parallel,
      // while catch-up never races newer replies ahead of earlier ones.
      const sessions = new Set<string>();
      const due = (await read())
        .filter(i => i.status === 'scheduled' && Date.parse(i.sendAt) <= now)
        .sort((a, b) => a.sendAt.localeCompare(b.sendAt))
        .filter(item => {
          if (sessions.has(item.message.sessionId)) return false;
          sessions.add(item.message.sessionId);
          return true;
        });
      await Promise.all(due.map(async candidate => {
        const key = createHash('sha256').update(candidate.message.sessionId).digest('hex');
        try { await withProcessIntentLock({
          intentsDirectory: `${file}.${key}.dispatch`, label: 'scheduled chat session', timeoutMs: 2_000,
        }, async () => {
        const claimed = await change(items => {
          const item = items.find(i => i.id === candidate.id);
          if (!item || item.status !== 'scheduled' || Date.parse(item.sendAt) > now) return null;
          const oldest = items.filter(i => i.status === 'scheduled' && i.message.sessionId === item.message.sessionId)
            .sort((a, b) => a.sendAt.localeCompare(b.sendAt))[0];
          if (oldest?.id !== item.id) return null;
          item.status = 'sending';
          return structuredClone(item);
        });
        if (!claimed) return;
        let result: ScheduledDispatchResult;
        try { result = await dispatch(claimed.message, `scheduled-${claimed.id}`); }
        catch { result = { status: 'uncertain', error: 'Delivery could not be confirmed. Check the chat before sending again.' }; }
        await change(items => {
          const item = items.find(i => i.id === claimed.id)!;
          item.status = result.status;
          item.error = result.error;
        });
        }); } catch (error) {
          // Another process is already delivering to this chat. Leave this
          // item scheduled so cancellation and a later tick remain possible.
          if (!(error instanceof Error) || error.message !== 'timed out waiting for scheduled chat session lock') throw error;
        }
      }));
    },
  };
}
