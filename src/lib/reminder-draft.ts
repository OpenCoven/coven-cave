import { parseWhen, splitWhenAndText, type ParsedWhen } from "./parse-when.ts";
import type { Recurrence } from "./inbox-recurrence.ts";

export type ReminderDraft =
  | {
      ok: true;
      title: string;
      whenText: string;
      fireAt: string;
      recurrence: Recurrence;
    }
  | {
      ok: false;
      title: string;
    };

function parsedAtSuffix(input: string, now: Date): (ParsedWhen & { title: string; whenText: string }) | null {
  const at = input.lastIndexOf("@");
  if (at < 0) return null;

  const title = input.slice(0, at).trim();
  const whenText = input.slice(at + 1).trim();
  if (!title || !whenText) return null;

  const parsed = parseWhen(whenText, now) ?? parseWhen(`at ${whenText}`, now);
  if (!parsed) return null;

  return { ...parsed, title, whenText };
}

function leadingWhenText(input: string, title: string): string {
  return title ? input.slice(0, input.length - title.length).trim() : input;
}

export function draftReminderFromText(input: string, now: Date = new Date()): ReminderDraft {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, title: "" };

  const atDraft = parsedAtSuffix(trimmed, now);
  if (atDraft) {
    return {
      ok: true,
      title: atDraft.title,
      whenText: atDraft.whenText,
      fireAt: atDraft.fireAt,
      recurrence: atDraft.recurrence,
    };
  }

  const { when, text } = splitWhenAndText(trimmed, now);
  if (when && text) {
    return {
      ok: true,
      title: text,
      whenText: leadingWhenText(trimmed, text),
      fireAt: when.fireAt,
      recurrence: when.recurrence,
    };
  }

  return { ok: false, title: trimmed };
}
