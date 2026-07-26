import { draftReminderFromText } from "@/lib/reminder-draft";

/** Map a `/remind ...` argument string into reminder-modal defaults. */
export function draftFromSlashArgs(args: string): {
  title: string;
  whenText: string;
} {
  const trimmed = args.trim();
  const draft = draftReminderFromText(trimmed);
  if (!draft.ok) return { title: trimmed, whenText: "" };
  return { title: draft.title, whenText: draft.whenText };
}
