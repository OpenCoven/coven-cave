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

export const JOURNAL_ROUTINE_PREFIX = "journal-reflection-";
export const JOURNAL_ROUTINE_TAG = "journal";
export const JOURNAL_ROUTINE_TIMEOUT_MINUTES = 10;
/**
 * Default time of day for a new daily reflection (local time). Morning:
 * the routine reflects on the previous day, and late-night work means an
 * evening run would miss part of it (see buildJournalRoutinePrompt).
 */
export const DEFAULT_JOURNAL_ROUTINE_TIME = { hour: 8, minute: 0 } as const;

/** Morning hours new routines are spread across, so a coven's familiars
 *  don't all launch a harness in the same hour. */
export const JOURNAL_STAGGER_HOURS = [7, 8, 9, 10, 11] as const;

/** A stable morning hour for a familiar's first reflection time: the same
 *  familiar always gets the same suggestion, and different ones spread out. */
export function suggestedJournalHour(familiarId: string): number {
  let hash = 0;
  for (const ch of familiarId) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return JOURNAL_STAGGER_HOURS[hash % JOURNAL_STAGGER_HOURS.length];
}

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

/**
 * Version stamp at the end of every routine prompt. The daemon stores the
 * prompt text, so a routine keeps the instructions it was saved with; bump
 * this whenever buildJournalRoutinePrompt changes meaningfully and the
 * journal pane will offer to refresh routines saved before the change.
 */
export const JOURNAL_ROUTINE_PROMPT_VERSION = 3;
export const JOURNAL_ROUTINE_PROMPT_MARKER = `(journal-reflection instructions v${JOURNAL_ROUTINE_PROMPT_VERSION})`;

/** Whether a stored routine prompt carries the current instructions. */
export function isJournalRoutinePromptCurrent(prompt: string | null | undefined): boolean {
  return typeof prompt === "string" && prompt.includes(JOURNAL_ROUTINE_PROMPT_MARKER);
}

export type JournalRoutinePromptInput = {
  familiarId: string;
  /** Display name; falls back to the id. */
  familiarName?: string | null;
  /** Absolute path of the familiar's journal directory (the routine cwd). */
  journalDir: string;
  /** Absolute path of the familiar's workspace, when known. */
  workspaceDir?: string | null;
  /** Absolute path of the Cave board (`<caveHome>/board.json`), when known. */
  boardPath?: string | null;
};

/** Single-quote a value for POSIX sh. */
function shq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Days before the reflected day that a run checks for a missed entry. */
export const JOURNAL_BACKFILL_DAYS = 3;

// Step 2: the familiar's sessions, grouped by local day. `coven sessions` has
// no filter flags, so jq does it; `--all` keeps archived sessions; the
// routine's own runs (rooted in the journal dir) are excluded; most titles are
// the launch prompt's boilerplate, so those are labelled, not interpreted.
const SESSIONS_JQ = String.raw`[.sessions[] | select(.familiar_id==$fid and .project_root!=$jd)
 | .t=(.created_at|sub("\\.[0-9]+Z$";"Z")|fromdate) | .day=(.t|localtime|strftime("%Y-%m-%d")) | .hm=(.t|localtime|strftime("%H:%M"))
 | select(.day>=$from and .day<=$to)
 | .label=(.title//""|gsub("\n";" ")|gsub("\\s+";" ")
     | if startswith("Runtime filesystem boundary") then "(untitled run)"
       elif startswith("## Prior conversation") then "(resumed) "+sub("^## Prior conversation \\*\\*(User|Assistant):\\*\\* ";"") else . end | .[0:72])]
| group_by(.day)[] | .[0].day as $d
| "== \($d): \(length) sessions, \([.[]|select(.status=="failed" or (.exit_code//0)!=0)]|length) failed",
  (group_by(.project_root)|sort_by(-length)|.[0:6][]|"   \(length)x \(.[0].project_root)"),
  (group_by(.label)|sort_by(-length)|.[0:12][]|"   \(length)x \(.[0].hm) \(.[0].label) [\(map(.status)|unique|join("/"))]")`;

// Step 3: board cards the familiar touched — the richest source of what is
// blocked and what comes next.
const BOARD_JQ = String.raw`[.cards[] | select(.familiarId==$fid) | .day=(.updatedAt|tostring|sub("\\.[0-9]+Z$";"Z")|try (fromdate|localtime|strftime("%Y-%m-%d")) catch "?") | select(.day>=$from and .day<=$to)]
| group_by(.day)[] | "== \(.[0].day): \(length) board cards touched",
  (.[0:10][]|"   [\(.status)]\(if .needsHuman then " NEEDS-HUMAN" else "" end) \(.title|.[0:70]) -> \((.nextStep.summary // .nextStep // "")|tostring|.[0:90])\(if .primaryBlockerId then " BLOCKED-BY \(.primaryBlockerId)" else "" end)")`;

/**
 * The instruction the familiar runs each morning. Self-contained — the
 * routine has no other context — and explicit about the files it may write,
 * the canonical entry format the journal store parses
 * (server/journal-store.ts), and when to stop instead of overwriting a
 * person's words.
 *
 * Shape (Echo's 2026-10-07 study, ~/.coven/research/familiar-journaling-2026-10-07/REPORT.md):
 * - It reflects on YESTERDAY's local date. Val's sessions run past midnight,
 *   so a same-evening run missed a third of the day; a morning run sees the
 *   whole of it exactly once.
 * - Activity comes from three fixed read-only commands (sessions ledger,
 *   board cards, workspace files), not from whatever the model thinks to
 *   look at: a run that browsed instead wrote "a quiet day" over 37 sessions.
 * - It backfills at most one missed recent day, so a quota or network
 *   failure heals the next morning instead of leaving a hole.
 * - A day with no activity still gets a one-line entry. The daemon does not
 *   keep the routine's reply, so an absent file can't be told apart from a
 *   signed-out harness; a counted line can.
 */
export function buildJournalRoutinePrompt(input: JournalRoutinePromptInput): string {
  const name = input.familiarName?.trim() || input.familiarId;
  const dir = input.journalDir.replace(/[\\/]+$/, "");
  const workspace = input.workspaceDir?.trim() || null;
  const board = input.boardPath?.trim() || null;
  const fid = shq(input.familiarId);
  const back = JOURNAL_BACKFILL_DAYS + 1;
  const dayAgo = (n: string) => `$(date -v-${n}d +%F 2>/dev/null || date -d "${n} days ago" +%F)`;
  // Every shell call starts fresh, so each block sets its own variables.
  const vars = `JD=${shq(dir)}; DATE=${dayAgo("1")}; FROM=${dayAgo(String(back))}`;
  return [
    `You are ${name}, writing yesterday's entry in your own journal. The journal exists so that Val, and you tomorrow, can pick up where you left off: what moved, what broke or is blocked, and what carries forward.`,
    "",
    "Rules:",
    "- Use only your shell and file-write tools. No web, no MCP tools, no exploring. Run the commands below as given; at most one extra read before you write.",
    "- Read-only everywhere except the entry files named in step 5. Never modify, move, or delete anything you look at. Do not commit.",
    "- Never invent activity. Every claim must trace to a line printed by steps 1–3. If a command errors, reply `failed: <what failed>; nothing written` and stop.",
    "- \"(untitled run)\" and \"(resumed)\" labels are boilerplate titles: count them, don't interpret them.",
    "",
    "Step 1. Dates, existing entries, and your previous entry (one shell call):",
    "```sh",
    vars,
    "NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    `echo "DATE=$DATE FROM=$FROM NOW=$NOW"`,
    `for i in $(seq 1 ${back}); do d=${dayAgo("${i}")}; f="$JD/$d.md"; if [ ! -f "$f" ]; then echo "$d: missing"; elif grep -q '^generatedAt: *[^ ]' "$f"; then echo "$d: generated"; else echo "$d: HUMAN"; fi; done`,
    `prev=$(find "$JD" -maxdepth 1 -name '????-??-??.md' 2>/dev/null | sort | awk -v d="$JD/$DATE.md" '$0<d' | tail -1); echo "PREV=$prev"; [ -n "$prev" ] && awk 'f>=2{print} /^---$/{f++}' "$prev" | head -12`,
    "```",
    "DATE is yesterday, local time. \"generated\" means already written: leave it alone. \"HUMAN\" means a person wrote it: never touch it. \"missing\" can be written. PREV is your last entry before DATE; use it for continuity.",
    "",
    "Step 2. Your sessions from FROM to DATE (one shell call):",
    "```sh",
    vars,
    `coven sessions --all --json | jq -r --arg fid ${fid} --arg jd "$JD" --arg from "$FROM" --arg to "$DATE" ${shq(SESSIONS_JQ)}`,
    "```",
    "",
    "Step 3. Board cards you touched and workspace files you changed, FROM to DATE (one shell call):",
    "```sh",
    vars,
    board
      ? `[ -f ${shq(board)} ] && jq -r --arg fid ${fid} --arg from "$FROM" --arg to "$DATE" ${shq(BOARD_JQ)} ${shq(board)}`
      : "echo 'no board'",
    workspace
      ? `find ${shq(workspace)} -type f -newermt "$FROM 00:00" ! -newermt "$DATE 23:59:59" -not -path '*/.*' -not -path '*/node_modules/*' -not -path '*/avatars/*' 2>/dev/null | head -30`
      : "echo 'no workspace'",
    "```",
    "No output from a command means zero of that kind. If one listed file would answer a specific question, you may read that ONE file.",
    "",
    "Step 4. Decide what to write:",
    "- DATE: write it if it is \"missing\". Skip it if it is \"generated\" or \"HUMAN\".",
    `- Backfill: of the days before DATE that are "missing" and show at least one session, card, or file, write the most recent one too. At most one backfill per run.`,
    "",
    "Step 5. Write each chosen day's entry to `" + dir + "/<day>.md`. Three to five sentences, first person, warm and concrete, prose only (no heading, bullet list, preamble, or sign-off). Cover what moved (repos, counts, cards), what broke or is blocked (failed sessions, NEEDS-HUMAN cards, blockers; if PREV already explained a blocker, one clause will do), and end with a sentence that begins \"Carrying forward:\" naming the next concrete step. Where the ledger can't tell whether something landed, say so. If the day had no sessions, cards, or files, the whole reflection is one line: \"A quiet day: no sessions, board cards, or workspace changes.\" Never call a day with activity quiet.",
    "Use exactly this layout (frontmatter, one blank line, then the reflection):",
    "",
    "---",
    `reflectedBy: ${input.familiarId}`,
    "generatedAt: NOW",
    "---",
    "",
    "<the reflection>",
    "",
    `Write no other file: do not create, edit, or delete anything else, inside or outside \`${dir}\`, and do not commit. Reply with exactly one line: \`wrote <path>\`, \`wrote <path>; backfilled <path>\`, \`left as written <path>\`, or \`failed: <reason>; nothing written\`.`,
    "",
    JOURNAL_ROUTINE_PROMPT_MARKER,
  ].join("\n");
}

// ── Failed-run diagnosis ─────────────────────────────────────────────────────

/** Why a reflection run failed, read from its session log. */
export type JournalRunFailureKind = "quota" | "auth" | "network" | "turns" | "timeout" | "other";
export type JournalRunFailure = { kind: JournalRunFailureKind; message: string; hint: string };

type SessionLogLine = { message?: unknown } | null | undefined;

const FAILURE_PATTERNS: Array<{ kind: Exclude<JournalRunFailureKind, "other">; re: RegExp }> = [
  { kind: "quota", re: /\b(weekly|daily|usage|rate|session) limit\b|hit your .*limit|quota|insufficient credits|429\b/i },
  { kind: "auth", re: /login expired|not logged in|sign(?:ed)? ?in|unauthori[sz]ed|\b401\b|authenticat/i },
  { kind: "turns", re: /(?:maximum|max) turn|turn limit|max[_ ]turns/i },
  { kind: "timeout", re: /timed out|timeout exceeded|deadline exceeded/i },
  { kind: "network", re: /request failed|error sending request|ECONN\w*|ENOTFOUND|ETIMEDOUT|network|socket hang up|\b50[234]\b/i },
];

const FAILURE_HINTS: Record<JournalRunFailureKind, string> = {
  quota: "The harness hit its usage limit. Pick another harness, or let the next scheduled run try again after the limit resets.",
  auth: "The harness is signed out. Sign it in (check with `coven doctor`), or pick another harness.",
  network: "The harness couldn't reach its provider. This is usually transient; Run now to try again.",
  turns: "The run used up its turn budget before writing the entry. Update to the latest reflection instructions, or pick another harness.",
  timeout: "The run hit the routine's time limit before writing the entry. Run now to try again.",
  other: "Open the session for the full log.",
};

/** Daemon bookkeeping and tool-progress lines that never explain a failure. */
function isNoiseLine(text: string): boolean {
  return /^exit:\s*\{/.test(text) || /^\[[A-Za-z]+\.\.\.\]$/.test(text) || /^Warning: no stdin data/i.test(text);
}

/**
 * Read a failed run's session log (`/api/v1/sessions/<id>/log` lines) and
 * name why it failed, so the journal can say "weekly limit reached" rather
 * than a bare "Failed". Null when the log says nothing usable.
 */
export function diagnoseJournalRunFailure(log: readonly SessionLogLine[] | null | undefined): JournalRunFailure | null {
  if (!Array.isArray(log)) return null;
  const lines = log
    .map((line) => (line && typeof line.message === "string" ? line.message.replace(/\u001b\[[0-9;]*m/g, "").trim() : ""))
    .filter((text) => text && !isNoiseLine(text));
  if (lines.length === 0) return null;
  // Newest first: the last meaningful line is usually the one that ended it.
  for (const text of [...lines].reverse()) {
    const match = FAILURE_PATTERNS.find((pattern) => pattern.re.test(text));
    if (match) return { kind: match.kind, message: clip(text), hint: FAILURE_HINTS[match.kind] };
  }
  return { kind: "other", message: clip(lines[lines.length - 1]), hint: FAILURE_HINTS.other };
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 240 ? `${flat.slice(0, 239)}…` : flat;
}
