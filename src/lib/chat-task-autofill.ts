// Smart chat → task autofill: turn a conversation into a fully filled board
// card in one click. Where chat-task-handoff.ts carries the transcript onto a
// card, this module *reads* the transcript and deterministically derives the
// structured fields — priority, due date, subtasks, links, and GitHub links —
// so the created card arrives on the board already triaged instead of as a
// bare inbox stub. Extraction is pure and offline (no LLM round-trip); the
// board's enrich-steps pipeline can still refine the card later.

import type { CardGitHubLink, CardPriority } from "@/lib/cave-board-types";
import { taskGitHubLinkFromUrl } from "@/lib/task-github";
import {
  buildChatHandoffNotes,
  deriveTaskTitleFromTurns,
  handoffTurns,
  type ChatHandoffContext,
  type HandoffTurn,
} from "@/lib/chat-task-handoff";
import type { Card } from "@/lib/cave-board-types";

const MAX_LINKS = 16;
const MAX_STEPS = 8;
const STEP_TEXT_MAX = 120;
const URL_RE = /https?:\/\/[^\s<>"'`)\]}]+/g;

/** Strip trailing punctuation a URL picked up from prose ("see https://x.com."). */
function trimUrl(raw: string): string {
  return raw.replace(/[.,;:!?]+$/, "");
}

/** All http(s) URLs mentioned anywhere in the conversation, deduped in
 *  first-mention order. GitHub URLs are included here too — the caller splits
 *  them out via extractGitHubLinks and mergeLinksWithGitHub-style handling. */
export function extractLinksFromTurns(turns: HandoffTurn[]): string[] {
  const seen = new Set<string>();
  const links: string[] = [];
  for (const turn of handoffTurns(turns)) {
    for (const match of turn.text.match(URL_RE) ?? []) {
      const url = trimUrl(match);
      let normalized: string;
      try {
        normalized = new URL(url).href;
      } catch {
        continue;
      }
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      links.push(normalized);
      if (links.length >= MAX_LINKS) return links;
    }
  }
  return links;
}

/** GitHub URLs from the conversation as structured card links (repo/issue/PR/
 *  discussion kind, number, repo), deduped by taskGitHubLinkFromUrl's id. */
export function extractGitHubLinksFromTurns(turns: HandoffTurn[]): CardGitHubLink[] {
  const seen = new Set<string>();
  const github: CardGitHubLink[] = [];
  for (const url of extractLinksFromTurns(turns)) {
    const link = taskGitHubLinkFromUrl(url);
    if (!link || seen.has(link.id)) continue;
    seen.add(link.id);
    github.push(link);
  }
  return github;
}

const URGENT_RE = /\b(urgent(ly)?|asap|critical|emergency|right (away|now)|immediately|blocker|blocking|prod(uction)? (is )?down|hotfix)\b/i;
const HIGH_RE = /\b(high priority|important|soon as possible|by (today|tonight|tomorrow|eod|end of day)|deadline|time.?sensitive|priorit(y|ize))\b/i;
const LOW_RE = /\b(low priority|no rush|whenever|not urgent|nice.?to.?have|someday|eventually|backburner|back burner)\b/i;

/** Priority inferred from how the humans talked about the work. User turns
 *  outrank assistant turns (the requester sets the urgency); the strongest
 *  signal wins; silence means "medium". */
export function inferPriorityFromTurns(turns: HandoffTurn[]): CardPriority {
  const usable = handoffTurns(turns);
  const ranked = [
    ...usable.filter((turn) => turn.role === "user"),
    ...usable.filter((turn) => turn.role !== "user"),
  ];
  for (const turn of ranked) {
    if (URGENT_RE.test(turn.text)) return "urgent";
  }
  for (const turn of ranked) {
    if (HIGH_RE.test(turn.text)) return "high";
  }
  for (const turn of ranked) {
    if (LOW_RE.test(turn.text)) return "low";
  }
  return "medium";
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

function toBoardDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(base: Date, days: number): Date {
  const next = new Date(base);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** Due date (YYYY-MM-DD) from natural-language deadlines in the conversation:
 *  explicit ISO dates ("due 2026-07-20"), "today"/"tonight"/"eod",
 *  "tomorrow", "by friday"/"next monday", and "end of (the) week"/"next week".
 *  Scans user turns first (the requester owns the deadline). Returns null when
 *  the chat names no deadline — the card simply gets no endDate. */
export function inferDueDateFromTurns(turns: HandoffTurn[], now: Date = new Date()): string | null {
  const usable = handoffTurns(turns);
  const ranked = [
    ...usable.filter((turn) => turn.role === "user"),
    ...usable.filter((turn) => turn.role !== "user"),
  ];
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (const turn of ranked) {
    const text = turn.text.toLowerCase();

    const iso = text.match(/\b(?:due|by|before|deadline[:\s]+)\s*(\d{4}-\d{2}-\d{2})\b/);
    if (iso) {
      const parsed = new Date(`${iso[1]}T00:00:00.000Z`);
      if (!Number.isNaN(parsed.getTime())) return iso[1];
    }

    if (/\b(by|due|before)\s+(today|tonight|eod|end of day)\b/.test(text)) return toBoardDate(today);
    if (/\b(by|due|before)\s+tomorrow\b/.test(text)) return toBoardDate(addDays(today, 1));

    const weekday = text.match(
      /\b(?:by|due|before|next)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/,
    );
    if (weekday) {
      const target = WEEKDAYS.indexOf(weekday[1] as (typeof WEEKDAYS)[number]);
      const delta = (target - today.getUTCDay() + 7) % 7 || 7;
      return toBoardDate(addDays(today, delta));
    }

    if (/\bend of (the )?week\b/.test(text)) {
      const delta = (5 - today.getUTCDay() + 7) % 7 || 7; // upcoming Friday
      return toBoardDate(addDays(today, delta));
    }
    if (/\bnext week\b/.test(text)) return toBoardDate(addDays(today, 7));
  }
  return null;
}

const LIST_ITEM_RE = /^(?:[-*•]|\d{1,2}[.)]|\[[ x]\])\s+(.*)$/;

function cleanStepText(raw: string): string {
  const text = raw
    .replace(/^\[[ x]\]\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .trim();
  return text.length > STEP_TEXT_MAX ? `${text.slice(0, STEP_TEXT_MAX - 1).trimEnd()}…` : text;
}

/** Subtasks mined from the conversation's plan: bullet / numbered / checklist
 *  lines in the LAST assistant turn that contains a list (the most recent plan
 *  supersedes earlier drafts). Deduped, cleaned of markdown emphasis, capped. */
export function extractSubtasksFromTurns(turns: HandoffTurn[]): string[] {
  const assistantTurns = handoffTurns(turns).filter((turn) => turn.role === "assistant");
  for (let i = assistantTurns.length - 1; i >= 0; i -= 1) {
    const items: string[] = [];
    const seen = new Set<string>();
    for (const line of assistantTurns[i].text.split("\n")) {
      const match = line.trim().match(LIST_ITEM_RE);
      if (!match) continue;
      const text = cleanStepText(match[1]);
      const key = text.toLowerCase();
      if (!text || seen.has(key)) continue;
      seen.add(key);
      items.push(text);
      if (items.length >= MAX_STEPS) break;
    }
    if (items.length >= 2) return items; // one bullet is prose, not a plan
  }
  return [];
}

export type ChatTaskDraft = {
  title: string;
  notes: string;
  status: "inbox";
  priority: CardPriority;
  sessionId: string;
  familiarId: string | null;
  projectId: string | null;
  labels: string[];
  links: string[];
  github: CardGitHubLink[];
  endDate: string | null;
  steps: { text: string }[];
};

/** The full auto-filled card draft for POST /api/board: title + audited notes
 *  from chat-task-handoff, plus priority, due date, subtasks, links, and
 *  structured GitHub links derived from the conversation itself. */
export function buildTaskDraftFromChat({
  sessionId,
  context,
  title,
  now = new Date(),
}: {
  sessionId: string;
  context: ChatHandoffContext;
  /** Explicit title override; derived from the turns when omitted. */
  title?: string;
  now?: Date;
}): ChatTaskDraft {
  const github = extractGitHubLinksFromTurns(context.turns);
  const githubUrls = new Set(github.map((item) => item.url.toLowerCase()));
  return {
    title: title?.trim() || deriveTaskTitleFromTurns(context.turns),
    notes: buildChatHandoffNotes({
      sessionId,
      turns: context.turns,
      capturedAt: now.toISOString(),
    }),
    status: "inbox",
    priority: inferPriorityFromTurns(context.turns),
    sessionId,
    familiarId: context.familiarId ?? null,
    projectId: context.projectId ?? null,
    labels: ["chat-handoff"],
    // GitHub URLs ride in the structured `github` field; keep `links` to the rest.
    links: extractLinksFromTurns(context.turns).filter((url) => !githubUrls.has(url.toLowerCase())),
    github,
    endDate: inferDueDateFromTurns(context.turns, now),
    steps: extractSubtasksFromTurns(context.turns).map((text) => ({ text })),
  };
}

/** One-click smart handoff: build the auto-filled draft and create the card.
 *  Mirrors createTaskFromChat's contract so callers can swap between them. */
export async function createSmartTaskFromChat({
  sessionId,
  context,
  title,
  now,
}: {
  sessionId: string;
  context: ChatHandoffContext;
  title?: string;
  now?: Date;
}): Promise<{ ok: boolean; card?: Card; error?: string }> {
  const draft = buildTaskDraftFromChat({ sessionId, context, title, now });
  try {
    const res = await fetch("/api/board", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      return { ok: false, error: data?.error ?? `HTTP ${res.status}` };
    }
    return { ok: true, card: data.card as Card };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}
