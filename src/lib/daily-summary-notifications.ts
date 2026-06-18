import type { InboxItem, InboxMedia, ItemKind, ItemStatus, LinkRef, Recurrence } from "./cave-inbox";
import type { SessionRow } from "./types";

export type DailySummaryDraft = {
  kind: Extract<ItemKind, "daily-summary">;
  title: string;
  body: string;
  status: Extract<ItemStatus, "fired">;
  source: "system";
  auto: string;
  link: LinkRef;
  media: InboxMedia;
  fireAt: string;
  firedAt: string;
  recurrence: Recurrence;
};

type BuildInput = {
  items: InboxItem[];
  sessions: SessionRow[];
  now?: Date;
};

type EnsureInput = BuildInput;

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function isSameLocalDay(iso: string | null | undefined, day: Date): boolean {
  if (!iso) return false;
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return false;
  return value >= startOfLocalDay(day) && value < new Date(startOfLocalDay(day).getTime() + 24 * 60 * 60 * 1000);
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function dayLabel(date: Date): string {
  return new Intl.DateTimeFormat([], { month: "short", day: "numeric" }).format(date);
}

function sessionSummaryLine(session: SessionRow): string {
  const title = session.title?.trim() || "Untitled session";
  const diff = session.diff ? ` (+${session.diff.additions} -${session.diff.deletions})` : "";
  return `${title}${diff}`;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dateSlug(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function dailySummaryAutoKey(now = new Date()): string {
  return `daily-summary:${dateSlug(now)}`;
}

export function dailySummaryReportPath(now = new Date()): string {
  return `/daily-report/${dateSlug(now)}`;
}

export function shouldCreateDailySummary(items: InboxItem[], now = new Date()): boolean {
  const key = dailySummaryAutoKey(now);
  return !items.some((item) => item.auto === key);
}

export function buildDailySummaryNotification({
  items,
  sessions,
  now = new Date(),
}: BuildInput): DailySummaryDraft | null {
  if (!shouldCreateDailySummary(items, now)) return null;

  const todayReminders = items.filter(
    (item) =>
      item.kind === "reminder" &&
      item.status === "fired" &&
      isSameLocalDay(item.firedAt ?? item.updatedAt, now),
  );
  const waitingResponses = items.filter(
    (item) =>
      item.kind === "response-needed" &&
      (item.status === "pending" || item.status === "fired") &&
      isSameLocalDay(item.updatedAt, now),
  );
  const agentNotifications = items.filter(
    (item) =>
      item.kind === "agent" &&
      item.status === "fired" &&
      isSameLocalDay(item.firedAt ?? item.updatedAt, now),
  );
  const todaySessions = sessions
    .filter((session) => !session.archived_at && isSameLocalDay(session.updated_at, now))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  if (
    todayReminders.length === 0 &&
    waitingResponses.length === 0 &&
    agentNotifications.length === 0 &&
    todaySessions.length === 0
  ) {
    return null;
  }

  const lines = [
    plural(todayReminders.length, "reminder", "reminders") + " fired",
    plural(waitingResponses.length, "response", "responses") + " waiting",
    plural(agentNotifications.length, "familiar update", "familiar updates"),
    plural(todaySessions.length, "session", "sessions") + " updated",
  ];
  const topSessions = todaySessions.slice(0, 3).map(sessionSummaryLine);
  if (topSessions.length > 0) lines.push(`Recent: ${topSessions.join(" · ")}`);

  const sentAt = now.toISOString();
  const stats = {
    reminders: todayReminders.length,
    responses: waitingResponses.length,
    familiars: agentNotifications.length,
    sessions: todaySessions.length,
  };
  const day = dayLabel(now);
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#171222"/>
      <stop offset="0.52" stop-color="#2a1c37"/>
      <stop offset="1" stop-color="#0d2730"/>
    </linearGradient>
    <radialGradient id="glow" cx="74%" cy="20%" r="58%">
      <stop offset="0" stop-color="#d7c7ff" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#d7c7ff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="960" height="540" rx="36" fill="url(#bg)"/>
  <rect width="960" height="540" rx="36" fill="url(#glow)"/>
  <text x="64" y="96" fill="#d8ccff" font-family="Inter, system-ui, sans-serif" font-size="24" font-weight="700" letter-spacing="4">COVENCAVE DAILY REPORT</text>
  <text x="64" y="176" fill="#ffffff" font-family="Inter, system-ui, sans-serif" font-size="72" font-weight="800">${xmlEscape(day)}</text>
  <text x="64" y="232" fill="#b9b0c8" font-family="Inter, system-ui, sans-serif" font-size="28">A generated snapshot of today's cave activity.</text>
  <g font-family="Inter, system-ui, sans-serif" font-weight="800">
    <text x="92" y="362" fill="#ffffff" font-size="58">${stats.reminders}</text>
    <text x="300" y="362" fill="#ffffff" font-size="58">${stats.responses}</text>
    <text x="508" y="362" fill="#ffffff" font-size="58">${stats.familiars}</text>
    <text x="716" y="362" fill="#ffffff" font-size="58">${stats.sessions}</text>
  </g>
  <g fill="#b9b0c8" font-family="Inter, system-ui, sans-serif" font-size="22" font-weight="700">
    <text x="92" y="410">reminders</text>
    <text x="300" y="410">responses</text>
    <text x="508" y="410">familiars</text>
    <text x="716" y="410">sessions</text>
  </g>
</svg>`.trim();

  return {
    kind: "daily-summary",
    title: `Daily summary · ${day}`,
    body: lines.join("\n"),
    status: "fired",
    source: "system",
    auto: dailySummaryAutoKey(now),
    link: { kind: "url", ref: dailySummaryReportPath(now) },
    media: {
      kind: "summary-card",
      imageUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
      alt: `Daily summary generated image for ${day}`,
      stats,
      generatedAt: sentAt,
    },
    fireAt: sentAt,
    firedAt: sentAt,
    recurrence: { type: "none" },
  };
}

export async function ensureDailySummaryNotification({
  items,
  sessions,
  now = new Date(),
}: EnsureInput): Promise<"created" | "skipped" | "failed"> {
  if (!buildDailySummaryNotification({ items, sessions, now })) return "skipped";
  try {
    const res = await fetch("/api/inbox/daily-summary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessions }),
    });
    if (!res.ok) return "failed";
    const json = (await res.json().catch(() => null)) as { ok?: boolean; created?: boolean } | null;
    return json?.ok && json.created ? "created" : "skipped";
  } catch {
    return "failed";
  }
}
