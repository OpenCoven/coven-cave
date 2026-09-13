export type ChatContinuityChapter = {
  id: string;
  conversationId: string;
  day: string;
  firstTurnId: string;
  lastTurnId: string;
  turnCount: number;
};

export type ChatContinuityIndex = {
  status: "complete" | "partial" | "unavailable";
  chapters: readonly ChatContinuityChapter[];
};

/** A source-position window, not a timestamp order or a completeness claim. */
export function chatContinuityWindow(total: number, start: number | null, limit: number): { start: number; end: number } {
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(limit) || limit < 1 ||
    (start !== null && (!Number.isSafeInteger(start) || start < 0 || start >= total))) {
    return { start: 0, end: 0 };
  }
  const first = start ?? Math.max(0, total - limit);
  return { start: first, end: Math.min(total, first + limit) };
}

/** Chapter metadata accepts canonical UTC seconds or exactly three fractional digits. */
export function utcChapterDay(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, milliseconds] = match;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return null;
  const instant = new Date(0);
  instant.setUTCFullYear(year, month - 1, day);
  instant.setUTCHours(hour, minute, second, Number(milliseconds ?? 0));
  const iso = instant.toISOString();
  const canonical = milliseconds === undefined ? iso.replace(".000Z", "Z") : iso;
  return canonical === value ? iso.slice(0, 10) : null;
}

/** The renderer may recover a broken tree; recovered paths cannot certify anchors. */
export function hasValidChatContinuityLineage(
  turns: readonly { id: string; parentId?: string | null }[],
  activeLeafId: unknown,
): boolean {
  if (activeLeafId != null && typeof activeLeafId !== "string") return false;
  const byId = new Map<string, (typeof turns)[number]>();
  for (const turn of turns) {
    if (typeof turn.id !== "string" || !turn.id || byId.has(turn.id)) return false;
    // Raw legacy order is an indexable path only when it contains no links.
    if (!activeLeafId && turn.parentId != null) return false;
    byId.set(turn.id, turn);
  }
  const seen = new Set<string>();
  let id = typeof activeLeafId === "string" ? activeLeafId : null;
  while (id) {
    const turn = byId.get(id);
    if (!turn || seen.has(id)) return false;
    seen.add(id);
    if (turn.parentId != null && (typeof turn.parentId !== "string" || !turn.parentId)) return false;
    id = turn.parentId ?? null;
  }
  return true;
}

/**
 * One linear pass over the host's already-resolved active branch. Consecutive
 * UTC-day runs, not a timestamp sort: clock corrections can revisit a day.
 * The projection owns references/counts only, never transcript text.
 */
export function buildChatContinuityChapters(
  conversationId: string,
  activeBranch: readonly { id: string; createdAt?: string }[],
  partial: boolean,
): ChatContinuityIndex {
  const unavailable: ChatContinuityIndex = { status: "unavailable", chapters: [] };
  if (!conversationId || activeBranch.length === 0) return unavailable;
  const chapters: ChatContinuityChapter[] = [];
  const seen = new Set<string>();
  let chapter: ChatContinuityChapter | undefined;
  for (const turn of activeBranch) {
    const day = utcChapterDay(turn.createdAt);
    if (!day || typeof turn.id !== "string" || !turn.id || seen.has(turn.id)) return unavailable;
    seen.add(turn.id);
    if (chapter?.day === day) {
      chapter.turnCount += 1;
      chapter.lastTurnId = turn.id;
    } else {
      chapter = {
        id: JSON.stringify(["utc-day-v1", conversationId, turn.id]),
        conversationId,
        day,
        firstTurnId: turn.id,
        lastTurnId: turn.id,
        turnCount: 1,
      };
      chapters.push(chapter);
    }
  }
  return { status: partial ? "partial" : "complete", chapters };
}
