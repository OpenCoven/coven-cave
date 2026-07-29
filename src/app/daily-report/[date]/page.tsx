import { loadInbox } from "@/lib/cave-inbox";
import { Icon } from "@/lib/icon";
import { AnalyticsPageShell } from "@/components/analytics-page-shell";
import { DailyReportDay, type WeekCell } from "@/components/daily-report-day";
import {
  breakdownForDay,
  dateSlug,
  longDateLabel,
  parseDateSlug,
  parseStatsFromBody,
  recentReports,
  relativeTime,
} from "@/lib/daily-report";
import { buildDayModel } from "@/lib/daily-report-day";
import { extractNextPaths } from "@/lib/next-paths";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ date: string }>;
};

const WEEKDAY_LETTER = ["S", "M", "T", "W", "T", "F", "S"];

/** "cody" → "Cody"; ids are the only familiar identity the report holds. */
function familiarLabel(id: string): string {
  const cleaned = id.replace(/[-_]+/g, " ").trim();
  if (!cleaned) return id;
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

function shortDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase();
}

/** One honest sentence about the day — never a claim the facts don't carry. */
function headlineFor(merges: number, projects: number, sessions: number): string {
  if (merges === 0 && sessions === 0) return "A quiet day in the cave.";
  if (merges === 0) return `${sessions} ${sessions === 1 ? "session" : "sessions"}, nothing merged yet.`;
  const where = projects > 0 ? ` across ${projects} ${projects === 1 ? "project" : "projects"}` : "";
  return `${merges} ${merges === 1 ? "merge" : "merges"}${where}.`;
}

export default async function DailyReportPage({ params }: Props) {
  const { date } = await params;
  const inbox = await loadInbox();
  const item = inbox.items.find((candidate) => candidate.auto === `daily-summary:${date}`);
  const parsedDate = parseDateSlug(date);

  if (!item) {
    return (
      <AnalyticsPageShell>
        {/* div, not main: the shell's aps-main is the page's main landmark. */}
        <div className="dr-page">
          <div className="dr-topbar" data-tauri-drag-region="deep">
            <a className="dr-back" href="/dashboard">
              <Icon name="ph:arrow-left" aria-hidden />
              Dashboard
            </a>
          </div>
          <div className="dr-shell">
            <section className="dr-hero" style={{ marginTop: 64 }}>
              <p className="dr-eyebrow">
                <span className="dr-eyebrow__dot" aria-hidden />
                Daily report
              </p>
              <h1 className="dr-title">Daily report not found</h1>
              <p className="dr-subtitle">
                No generated daily summary exists for{" "}
                {parsedDate ? longDateLabel(parsedDate) : date}. Reports are created automatically
                once there is activity to summarize.
              </p>
              <div className="dr-actions">
                <a className="dr-btn dr-btn--primary" href="/dashboard">
                  <Icon name="ph:squares-four" aria-hidden />
                  Go to dashboard
                </a>
                <a className="dr-btn" href="/">
                  <Icon name="ph:house-bold" aria-hidden />
                  Back to CovenCave
                </a>
              </div>
            </section>
          </div>
        </div>
      </AnalyticsPageShell>
    );
  }

  const day = parsedDate ?? new Date();
  const stats = item.media?.stats ?? parseStatsFromBody(item.body) ?? {
    reminders: 0,
    responses: 0,
    familiars: 0,
    sessions: 0,
  };
  const breakdown = breakdownForDay(inbox.items, day);
  // Structured day-in-review facts — frozen per refresh, absent on old items.
  const report = item.media?.report ?? null;
  const recent = recentReports(inbox.items);

  const model = buildDayModel({
    stats,
    payload: report,
    breakdown,
    recent,
    day,
    items: inbox.items,
    familiarName: familiarLabel,
  });

  // The week strip: the trailing seven days ending on this report, with each
  // day's bar scaled against the busiest day in view.
  const statBySlug = new Map(recent.map((r) => [r.slug, r.stats]));
  const weekDates: Date[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(day);
    d.setDate(day.getDate() - i);
    weekDates.push(d);
  }
  const weekMerges = weekDates.map((d) => statBySlug.get(dateSlug(d))?.prsMerged ?? 0);
  const peakMerges = Math.max(...weekMerges, 0);
  const week: WeekCell[] = weekDates.map((d, i) => {
    const slug = dateSlug(d);
    const dayStats = statBySlug.get(slug);
    const merges = weekMerges[i];
    return {
      slug,
      letter: WEEKDAY_LETTER[d.getDay()],
      num: String(d.getDate()),
      level: peakMerges > 0 ? merges / peakMerges : 0,
      selected: slug === dateSlug(day),
      hasReport: Boolean(dayStats),
      title: `${d.toDateString()} · ${dayStats ? `${merges} ${merges === 1 ? "merge" : "merges"}` : "no report"}`,
    };
  });

  const prevWeek = new Date(day);
  prevWeek.setDate(day.getDate() - 7);
  const nextWeek = new Date(day);
  nextWeek.setDate(day.getDate() + 7);

  // media.generatedAt moves on every in-place refresh; firedAt stays at the
  // day's first generation, so prefer the former for a truthful timestamp.
  const generatedAt = item.media?.generatedAt ?? item.firedAt ?? item.updatedAt ?? null;
  const isToday = dateSlug(day) === dateSlug(new Date());

  // The familiar's narrative, with the piggybacked next-paths block stripped.
  const rawNarrative = item.media?.narrative?.text ?? null;
  const narrative = rawNarrative ? extractNextPaths(rawNarrative).visible.trim() : null;
  const narrativeAuthor = item.media?.narrative?.familiarName ?? item.media?.narrative?.familiarId ?? null;
  const narrativeByline = narrativeAuthor
    ? `Written by ${familiarLabel(narrativeAuthor)}${generatedAt ? ` · ${relativeTime(generatedAt)}` : ""}`
    : null;

  return (
    <AnalyticsPageShell>
      {/* div, not main: the shell's aps-main is the page's main landmark. */}
      <div className="dr-page dr-page--day">
        <div className="dr-shell dr-shell--wide">
          <DailyReportDay
            model={model}
            dateLabel={longDateLabel(day)}
            kicker={`DAILY REPORT · ${shortDate(day)}`}
            headline={headlineFor(model.shipped.total, model.projectCount, stats.sessions)}
            week={week}
            weekLabel={`${shortDate(weekDates[0])} — ${shortDate(weekDates[6])}`}
            prevWeekSlug={dateSlug(prevWeek)}
            nextWeekSlug={dateSlug(nextWeek)}
            isToday={isToday}
            narrative={narrative}
            narrativeByline={narrativeByline}
            shareImageUrl={item.media?.imageUrl ?? null}
            summaryBody={item.body ?? null}
          />
        </div>
      </div>
    </AnalyticsPageShell>
  );
}
