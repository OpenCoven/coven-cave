/**
 * Journal automation — a familiar's daily reflection as a native Coven
 * routine (the daemon's coven.automations.* actions). Pure helpers shared by
 * /api/journal/automation (server) and the journal day pane (client): the
 * routine id, its daily RRULE, and the self-contained instruction the
 * familiar runs on schedule.
 *
 * The routine's cwd is the familiar's own journal directory
 * (`~/.coven/journal/familiars/<id>`), so the one file it writes —
 * `<YYYY-MM-DD>.md` for the local day — sits inside its task boundary.
 *
 * The native scheduler runs routines on the hour: its RRULE vocabulary is
 * FREQ (DAILY|WEEKLY), BYHOUR and BYDAY, and it refuses BYMINUTE outright
 * ("rrule key `BYMINUTE` is not supported"). So a reflection time is an hour;
 * `minute` stays in the shapes for forward compatibility and must be 0.
 */

import { JOURNAL_TONE_RULES } from "./journal-prompt.ts";

export const JOURNAL_ROUTINE_PREFIX = "journal-reflection-";
export const JOURNAL_ROUTINE_TAG = "journal";
export const JOURNAL_ROUTINE_TIMEOUT_MINUTES = 10;
/** Default time of day for a new daily reflection (local time). */
export const DEFAULT_JOURNAL_ROUTINE_TIME = { hour: 21, minute: 0 } as const;

export type JournalRoutineTime = { hour: number; minute: number };

/**
 * Harnesses a reflection routine can run on — the daemon's built-in adapters.
 * Coven Code is the default; the picker exists because a routine whose
 * harness is signed out still exits 0 ("Login expired"), so the run reads as
 * succeeded while nothing is written. Choosing a signed-in harness is the fix.
 */
export const JOURNAL_RUNTIMES = [
  { id: "coven-code", label: "Coven Code" },
  { id: "codex", label: "Codex" },
  { id: "claude", label: "Claude Code" },
  { id: "copilot", label: "Copilot" },
] as const;
export type JournalRuntime = (typeof JOURNAL_RUNTIMES)[number]["id"];
export const DEFAULT_JOURNAL_RUNTIME: JournalRuntime = "coven-code";

export function isJournalRuntime(value: unknown): value is JournalRuntime {
  return typeof value === "string" && JOURNAL_RUNTIMES.some((runtime) => runtime.id === value);
}

/** `journal-reflection-<familiarId>` — one routine per familiar. */
export function journalRoutineId(familiarId: string): string {
  return `${JOURNAL_ROUTINE_PREFIX}${familiarId}`;
}

/** True for a whole hour 0–23 on the hour — the only times the native
 *  scheduler can run (see the header). */
export function isValidRoutineTime(hour: unknown, minute: unknown = 0): boolean {
  return Number.isInteger(hour)
    && (hour as number) >= 0
    && (hour as number) <= 23
    && minute === 0;
}

/**
 * A daily RRULE at `hour`:00 local time, in the daemon's stored form (no
 * `RRULE:` prefix — /api/codex-automations strips it the same way).
 */
export function journalRRule(hour: number, minute = 0): string {
  if (!isValidRoutineTime(hour, minute)) throw new Error("invalid routine time");
  return `FREQ=DAILY;BYHOUR=${hour}`;
}

/**
 * Read the time of day back out of a daily RRULE (with or without the
 * `RRULE:` prefix). Null for anything that is not a single daily time —
 * a weekly rule, several hours, or a missing BYHOUR.
 */
export function parseJournalRRule(rrule: string | null | undefined): JournalRoutineTime | null {
  if (!rrule) return null;
  const body = rrule.trim().replace(/^RRULE:/i, "");
  const parts = new Map<string, string>();
  for (const part of body.split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    parts.set(part.slice(0, i).trim().toUpperCase(), part.slice(i + 1).trim());
  }
  if (parts.get("FREQ")?.toUpperCase() !== "DAILY") return null;
  if (parts.has("BYMINUTE")) return null; // not a rule the native scheduler runs
  const hourRaw = parts.get("BYHOUR");
  if (!hourRaw || !/^\d{1,2}$/.test(hourRaw)) return null;
  const hour = Number(hourRaw);
  return isValidRoutineTime(hour) ? { hour, minute: 0 } : null;
}

/** `21:00` — a stable 24-hour form for logs and announcements. */
export function formatRoutineTime({ hour, minute }: JournalRoutineTime): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** The hour as the reader's locale writes it ("9 PM", "21:00"). */
export function formatRoutineHour(hour: number, locale?: string): string {
  return new Date(2000, 0, 1, hour, 0, 0).toLocaleTimeString(locale, { hour: "numeric" });
}

export type JournalRoutinePromptInput = {
  familiarId: string;
  /** Display name; falls back to the id. */
  familiarName?: string | null;
  /** Absolute path of the familiar's journal directory (the routine cwd). */
  journalDir: string;
  /** Absolute path of the familiar's workspace, when known. */
  workspaceDir?: string | null;
};

/**
 * The instruction the familiar runs each day. Self-contained — the routine
 * has no other context — and explicit about the ONE file it may write, the
 * canonical entry format the journal store parses (server/journal-store.ts),
 * and when to stop instead of overwriting a person's words.
 */
export function buildJournalRoutinePrompt(input: JournalRoutinePromptInput): string {
  const name = input.familiarName?.trim() || input.familiarId;
  const dir = input.journalDir.replace(/[\\/]+$/, "");
  const workspace = input.workspaceDir?.trim() || null;
  return [
    `You are ${name}, writing today's entry in your own journal.`,
    "",
    "1. Find the current LOCAL date (YYYY-MM-DD, e.g. with `date +%F`) and the current time as an ISO 8601 timestamp (e.g. `date -u +%Y-%m-%dT%H:%M:%SZ`). Call them DATE and NOW.",
    `2. The entry file is exactly \`${dir}/DATE.md\`. If that file already exists and its frontmatter has no \`generatedAt\` value, a person wrote or edited it: stop now, change nothing, and reply that today's entry was left as written.`,
    "3. Look back over your own activity for DATE, read-only:",
    workspace
      ? `   - files in your workspace memory (\`${workspace}\`) modified today;`
      : "   - files in your workspace memory modified today;",
    "   - your own sessions from today, if your tools can list them.",
    "   Never modify, move, or delete anything you look at.",
    // The in-app format rule ends "return only the reflection text"; here the
    // reflection goes into the file, so only its no-heading half applies.
    `4. Write a short, first-person reflection on the day. ${JOURNAL_TONE_RULES} If nothing happened, say plainly that it was a quiet day. No heading, no preamble, no sign-off in the reflection.`,
    `5. Write the file \`${dir}/DATE.md\` with exactly this layout (frontmatter, one blank line, then the reflection):`,
    "",
    "---",
    `reflectedBy: ${input.familiarId}`,
    "generatedAt: NOW",
    "---",
    "",
    "<the reflection>",
    "",
    `Write no other file: do not create, edit, or delete anything else, inside or outside \`${dir}\`, and do not commit. When you are done, reply with only the path you wrote, or the reason you stopped.`,
  ].join("\n");
}
