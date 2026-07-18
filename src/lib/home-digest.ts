/**
 * Pure builder for home-page digest cards (needs-you, summary, session,
 * suggestion, and RSS).
 *
 * Combines the home strip's signals into one ordered card list:
 *   1. needs-you cards — the attention tier (fired + response-needed), capped,
 *      with a "+N more" card when the tier overflows;
 *   2. a single summary card — today's at-a-glance counts (sessions, reminders,
 *      responses waiting, familiar updates);
 *   3. session cards — the chats touched today, newest first;
 *   4. suggestion cards — the quick-action prompts (board tasks + starters);
 *   5. RSS cards — freshest merged AI-related headlines; non-AI feed items
 *      are filtered out (see `isAiRelated`).
 *
 * Consumed by the home digest carousel (home-digest-carousel.tsx), which drifts
 * the needs/summary/session/suggestion cards on its chats track and the RSS
 * cards on its media track; covered by home-digest.test.ts. Pure and
 * clock-injected (`nowMs`) for unit-testing without network, DOM, or wall
 * clock.
 */

import type { InboxItem } from "@/lib/cave-inbox";
import { covenStreak } from "@/lib/familiar-renown";
import type { SessionRow } from "@/lib/types";
import { hostFromUrl, relativeAge, type FeedItem } from "@/lib/rss";

export type DigestSummaryCard = {
  kind: "summary";
  id: string;
  /** Always "Daily summary". */
  title: string;
  /** Short month/day label, e.g. "Jun 28". */
  dayLabel: string;
  /** Pre-formatted count chips, e.g. ["3 sessions", "1 reminder"]. */
  lines: string[];
};

export type DigestSessionCard = {
  kind: "session";
  id: string;
  sessionId: string;
  familiarId: string | null;
  title: string;
  /** "familiar · 3h · +12 -4" (only the present parts). */
  subtitle: string;
};

/** A session a familiar is working RIGHT NOW — the agentic-presence tier.
 *  Leads the chats track (after needs-you) so "what's happening" reads from
 *  Home without opening a chat (cave-9j6a). */
export type DigestLiveCard = {
  kind: "live";
  id: string;
  sessionId: string;
  familiarId: string | null;
  title: string;
  /** "Nova · working · 2m" (only the present parts). */
  subtitle: string;
};

export type DigestRssCard = {
  kind: "rss";
  id: string;
  title: string;
  source: string;
  host: string | null;
  url: string;
  /** Compact relative age, e.g. "2h". */
  age: string;
  /** First http(s) image pulled from the item body — the media row's thumbnail. */
  image?: string;
};

/** One "needs you" attention item folded into the chats track (cave-925w). */
export type DigestNeedsCard = {
  kind: "needs";
  id: string;
  title: string;
  /** "Waiting on you" for response-needed items, else a compact relative age. */
  meta: string;
  /** The full inbox item so the card opens through the bell's handler. */
  item: InboxItem;
};

/** Overflow marker when the needs-you tier exceeds the card cap. */
export type DigestNeedsMoreCard = {
  kind: "needs-more";
  id: string;
  count: number;
};

/** A quick-action prompt pill folded into the chats track. */
export type DigestSuggestionCard = {
  kind: "suggestion";
  id: string;
  prompt: string;
  /** True when the suggestion resumes real board work (task: ids). */
  isTask: boolean;
};

export type DigestCard =
  | DigestNeedsCard
  | DigestNeedsMoreCard
  | DigestLiveCard
  | DigestSummaryCard
  | DigestSessionCard
  | DigestSuggestionCard
  | DigestRssCard;

export type BuildDigestInput = {
  items: InboxItem[];
  sessions: SessionRow[];
  rssItems: FeedItem[];
  /** The "needs you" attention tier (most-recent first) — leads the chats track. */
  needsYou?: InboxItem[];
  /** Quick-action prompts (buildHomeSuggestions) — trail the chats track. */
  suggestions?: { id: string; prompt: string }[];
  /** Maps a familiar id to its display name (for session subtitles). */
  familiarNameById?: Map<string, string>;
  nowMs: number;
  /** Max session cards (default 6), RSS cards (default 14), and needs-you
   *  cards (default 6; the rest collapse into one "+N more" card). */
  maxSessions?: number;
  maxRss?: number;
  maxNeeds?: number;
  /** Max live "working now" cards (default 4). */
  maxLive?: number;
};

function sameLocalDay(iso: string | null | undefined, now: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * Pull the first http(s) image out of a feed item's body HTML for the media-row
 * thumbnail. Returns undefined for protocol-relative/inline/data URIs or no img,
 * so the card cleanly falls back to its icon. Pure — unit-tested.
 */
export function firstImageUrl(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const src = html.match(/<img[^>]+\bsrc=["']([^"']+)["']/i)?.[1];
  return src && /^https?:\/\//i.test(src) ? src : undefined;
}

function dayLabel(now: Date): string {
  return now.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * AI-relevance matcher for the media row. The home carousel only surfaces
 * AI-related headlines, so an item qualifies when its feed is categorized "AI"
 * or its title mentions an AI topic. Phrases are matched with word boundaries
 * so short tokens (e.g. "ai", "ml", "gpt") don't match inside unrelated words
 * ("email", "html", "egypt"). Pure — unit-tested.
 */
const AI_KEYWORDS = [
  "ai",
  "a\\.i\\.",
  "artificial intelligence",
  "machine learning",
  "ml",
  "llm",
  "llms",
  "gpt",
  "chatgpt",
  "claude",
  "anthropic",
  "openai",
  "gemini",
  "deepmind",
  "mistral",
  "llama",
  "hugging ?face",
  "neural network",
  "deep learning",
  "generative",
  "diffusion",
  "transformer",
  "copilot",
  "agentic",
  "multimodal",
  "chatbot",
  "midjourney",
];
const AI_KEYWORD_RE = new RegExp(`\\b(?:${AI_KEYWORDS.join("|")})\\b`, "i");

export function isAiRelated(item: FeedItem): boolean {
  if (item.category && item.category.toLowerCase() === "ai") return true;
  return AI_KEYWORD_RE.test(item.title ?? "");
}

/** Build the ordered carousel cards. Returns [] when there's nothing to show
 *  (no activity today and no headlines), so the home strip stays hidden. */
export function buildDigestCards(input: BuildDigestInput): DigestCard[] {
  const { items, sessions, rssItems, familiarNameById, nowMs } = input;
  const maxSessions = input.maxSessions ?? 6;
  const maxRss = input.maxRss ?? 14;
  const maxNeeds = input.maxNeeds ?? 6;
  const maxLive = input.maxLive ?? 4;
  const needsYou = input.needsYou ?? [];
  const suggestions = input.suggestions ?? [];
  const now = new Date(nowMs);

  // Sessions a familiar is actively working — the presence tier. Not gated to
  // "today": a long-running job started yesterday is still happening now.
  const liveSessions = sessions
    .filter((s) => !s.archived_at && s.status === "running")
    .sort((a, b) =>
      (b.updated_at ?? b.created_at ?? "").localeCompare(a.updated_at ?? a.created_at ?? ""),
    );
  const liveIds = new Set(liveSessions.slice(0, maxLive).map((s) => s.id));

  // Summary counts every session touched today (live included) …
  const todayTouchedCount = sessions.filter(
    (s) => !s.archived_at && sameLocalDay(s.updated_at ?? s.created_at, now),
  ).length;

  // … while the resumable-session cards exclude the live tier (no doubles).
  const todaySessions = sessions
    .filter(
      (s) =>
        !s.archived_at &&
        !liveIds.has(s.id) &&
        sameLocalDay(s.updated_at ?? s.created_at, now),
    )
    .sort((a, b) =>
      (b.updated_at ?? b.created_at ?? "").localeCompare(a.updated_at ?? a.created_at ?? ""),
    );

  const remindersFired = items.filter(
    (i) => i.kind === "reminder" && i.status === "fired" && sameLocalDay(i.firedAt ?? i.updatedAt, now),
  ).length;
  const responsesWaiting = items.filter(
    (i) =>
      i.kind === "response-needed" &&
      (i.status === "pending" || i.status === "fired") &&
      sameLocalDay(i.updatedAt, now),
  ).length;
  const familiarUpdates = items.filter(
    (i) => i.kind === "agent" && i.status === "fired" && sameLocalDay(i.firedAt ?? i.updatedAt, now),
  ).length;

  const cards: DigestCard[] = [];

  // Needs-you cards lead the chats track so attention items drift past first;
  // overflow collapses into a single "+N more" jump to Schedules.
  for (const it of needsYou.slice(0, maxNeeds)) {
    cards.push({
      kind: "needs",
      id: `needs:${it.id}`,
      title: it.title,
      meta:
        it.kind === "response-needed"
          ? "Waiting on you"
          : relativeAge(it.firedAt ?? it.fireAt ?? it.updatedAt ?? it.createdAt ?? null, nowMs),
      item: it,
    });
  }
  if (needsYou.length > maxNeeds) {
    cards.push({ kind: "needs-more", id: "needs-more", count: needsYou.length - maxNeeds });
  }

  // Live tier — what familiars are doing right now, right after what needs
  // you. Elapsed reads from last activity so the card stays honest while a
  // long task streams.
  for (const s of liveSessions.slice(0, maxLive)) {
    const fam = s.familiarId ? familiarNameById?.get(s.familiarId) ?? null : null;
    const age = relativeAge(s.updated_at ?? s.created_at ?? null, nowMs);
    cards.push({
      kind: "live",
      id: `live:${s.id}`,
      sessionId: s.id,
      familiarId: s.familiarId ?? null,
      title: s.title?.trim() || "Untitled session",
      subtitle: [fam, "working", age].filter(Boolean).join(" · "),
    });
  }

  const summaryLines: string[] = [];
  if (todayTouchedCount) summaryLines.push(plural(todayTouchedCount, "session"));
  // Ambient ritual-streak presence (cave-qvox): only once it's a real chain —
  // a single active day is just "today", and absence never reads as shame.
  const streakDays = covenStreak(sessions, nowMs);
  if (streakDays >= 2) summaryLines.push(`${streakDays}-day streak`);
  if (remindersFired) summaryLines.push(plural(remindersFired, "reminder"));
  if (responsesWaiting) summaryLines.push(`${responsesWaiting} waiting`);
  if (familiarUpdates) summaryLines.push(plural(familiarUpdates, "familiar update"));

  if (summaryLines.length) {
    cards.push({
      kind: "summary",
      id: "summary",
      title: "Daily summary",
      dayLabel: dayLabel(now),
      lines: summaryLines,
    });
  }

  for (const s of todaySessions.slice(0, maxSessions)) {
    const fam = s.familiarId ? familiarNameById?.get(s.familiarId) ?? null : null;
    const age = relativeAge(s.updated_at ?? s.created_at ?? null, nowMs);
    const diff = s.diff ? `+${s.diff.additions} -${s.diff.deletions}` : "";
    const subtitle = [fam, age, diff].filter(Boolean).join(" · ");
    cards.push({
      kind: "session",
      id: `session:${s.id}`,
      sessionId: s.id,
      familiarId: s.familiarId ?? null,
      title: s.title?.trim() || "Untitled session",
      subtitle,
    });
  }

  // Quick-action prompts trail the chats so the track always offers a next
  // step after the resumable work drifts past.
  for (const s of suggestions) {
    cards.push({
      kind: "suggestion",
      id: `suggestion:${s.id}`,
      prompt: s.prompt,
      isTask: s.id.startsWith("task:"),
    });
  }

  for (const r of rssItems.filter((it) => it.link && isAiRelated(it)).slice(0, maxRss)) {
    cards.push({
      kind: "rss",
      id: `rss:${r.id}`,
      title: r.title,
      source: r.source,
      host: hostFromUrl(r.link),
      url: r.link,
      age: relativeAge(r.isoDate, nowMs),
      image: firstImageUrl(r.descriptionHtml),
    });
  }

  return cards;
}
