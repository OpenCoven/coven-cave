import { loadInbox } from "@/lib/cave-inbox";
import { Icon } from "@/lib/icon";
import { CopyLinkButton } from "@/components/copy-link-button";
import { EmptyState, ItemRow, MetricCard, QuickLink, SectionHead } from "@/components/daily-report-ui";
import {
  breakdownForDay,
  longDateLabel,
  parseDateSlug,
  parseRecentSessions,
  parseStatsFromBody,
  recentReports,
  relativeTime,
  type DailyReportStats,
} from "@/lib/daily-report";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ date: string }>;
};

export default async function DailyReportPage({ params }: Props) {
  const { date } = await params;
  const inbox = await loadInbox();
  const item = inbox.items.find((candidate) => candidate.auto === `daily-summary:${date}`);
  const parsedDate = parseDateSlug(date);

  if (!item) {
    return (
      <main className="dr-page">
        <div className="dr-topbar">
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
      </main>
    );
  }

  const stats = item.media?.stats ?? parseStatsFromBody(item.body);
  const breakdown = breakdownForDay(inbox.items, parsedDate ?? new Date());

  // 7-day trend per metric, ending on this report's date, from the daily reports.
  const slugFor = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const statBySlug = new Map(recentReports(inbox.items).map((r) => [r.slug, r.stats]));
  const trendBase = parsedDate ?? new Date();
  const trendFor = (metric: keyof DailyReportStats) => {
    const out: { label: string; value: number | null }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(trendBase);
      d.setDate(trendBase.getDate() - i);
      const s = statBySlug.get(slugFor(d));
      out.push({
        label: d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
        value: s ? s[metric] : null,
      });
    }
    return out;
  };
  const recentSessions = parseRecentSessions(item.body);
  const generatedAt = item.firedAt ?? item.updatedAt ?? null;
  const totalEvents = stats
    ? stats.reminders + stats.responses + stats.familiars + stats.sessions
    : 0;

  return (
    <main className="dr-page">
      <div className="dr-topbar">
        <nav className="dr-topbar__crumbs" aria-label="Breadcrumb">
          <a className="dr-back" href="/dashboard">
            <Icon name="ph:arrow-left" aria-hidden />
            Dashboard
          </a>
          <span className="dr-crumb-sep" aria-hidden>/</span>
          <span className="dr-crumb-current">{item.title}</span>
        </nav>
        <div className="dr-topbar__actions">
          <CopyLinkButton />
          <a className="dr-btn dr-btn--sm" href="/">
            <Icon name="ph:house-bold" aria-hidden />
            Open CovenCave
          </a>
        </div>
      </div>

      <div className="dr-shell">
        <header className="dr-hero">
          <p className="dr-eyebrow">
            <span className="dr-eyebrow__dot" aria-hidden />
            Daily report
          </p>
          <h1 className="dr-title">{parsedDate ? longDateLabel(parsedDate) : item.title}</h1>
          <p className="dr-subtitle">
            {totalEvents > 0
              ? `An auto-generated snapshot of your cave — ${totalEvents} ${
                  totalEvents === 1 ? "event" : "events"
                } across reminders, responses, familiars, and sessions.`
              : "An auto-generated snapshot of your cave activity for the day."}
          </p>
          <div className="dr-meta-row">
            <span className="dr-meta-row__item">
              <Icon name="ph:clock" aria-hidden />
              Generated {generatedAt ? relativeTime(generatedAt) : "today"}
            </span>
            {breakdown.openItems.length > 0 ? (
              <span className="dr-meta-row__item">
                <Icon name="ph:warning-circle" aria-hidden />
                {breakdown.openItems.length} still open
              </span>
            ) : (
              <span className="dr-meta-row__item">
                <Icon name="ph:check-circle" aria-hidden />
                Nothing left open
              </span>
            )}
          </div>
        </header>

        {/* Headline metrics — the frozen snapshot captured at generation time. */}
        {stats ? (
          <section className="dr-metrics" aria-label="Day at a glance">
            <MetricCard
              icon="ph:bell"
              value={stats.reminders}
              label="Reminders fired"
              caption={stats.reminders === 1 ? "1 reminder" : `${stats.reminders} reminders`}
              accent="amber"
              trend={trendFor("reminders")}
            />
            <MetricCard
              icon="ph:chat-circle-dots"
              value={stats.responses}
              label="Responses waiting"
              caption="Need your reply"
              accent="rose"
              trend={trendFor("responses")}
            />
            <MetricCard
              icon="ph:sparkle"
              value={stats.familiars}
              label="Familiar updates"
              caption="From your agents"
              accent="lavender"
              trend={trendFor("familiars")}
            />
            <MetricCard
              icon="ph:graph-bold"
              value={stats.sessions}
              label="Sessions updated"
              caption="Coding & chat work"
              accent="green"
              trend={trendFor("sessions")}
            />
          </section>
        ) : null}

        {/* Actionable: what still needs attention right now (live inbox state). */}
        <section className="dr-section" aria-label="Needs attention">
          <SectionHead
            icon="ph:warning-circle"
            title="Needs attention"
            count={breakdown.openItems.length}
            hint="Live — updates as you act"
          />
          {breakdown.openItems.length > 0 ? (
            <div className="dr-list">
              {breakdown.openItems.map((open) => (
                <ItemRow key={open.id} item={open} />
              ))}
            </div>
          ) : (
            <EmptyState icon="ph:check-circle">
              You&apos;re all caught up — no open reminders or responses from this day.
            </EmptyState>
          )}
        </section>

        {/* Familiar updates from the day. */}
        {breakdown.familiars.length > 0 ? (
          <section className="dr-section" aria-label="Familiar updates">
            <SectionHead
              icon="ph:sparkle"
              title="Familiar updates"
              count={breakdown.familiars.length}
            />
            <div className="dr-list">
              {breakdown.familiars.map((fam) => (
                <ItemRow key={fam.id} item={fam} />
              ))}
            </div>
          </section>
        ) : null}

        {/* Sessions — recovered from the frozen summary body (daemon-backed). */}
        {recentSessions.length > 0 ? (
          <section className="dr-section" aria-label="Recent sessions">
            <SectionHead
              icon="ph:graph-bold"
              title="Recent sessions"
              count={recentSessions.length}
            />
            <div className="dr-list">
              {recentSessions.map((line, i) => (
                <div key={i} className="dr-row" style={{ ["--row-accent" as string]: "var(--color-success)" }}>
                  <span className="dr-row__icon">
                    <Icon name="ph:code-bold" aria-hidden />
                  </span>
                  <span className="dr-row__body">
                    <span className="dr-row__title">{line}</span>
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section
          className="dr-section"
          aria-label="Summary"
          style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 16 }}
        >
          <div className="dr-panel">
            <h2 className="dr-panel__title">Summary</h2>
            <p className="dr-summary-body" style={{ whiteSpace: "pre-line" }}>{item.body}</p>
          </div>
          {item.media?.imageUrl ? (
            <img
              className="dr-cardimg"
              src={item.media.imageUrl}
              alt={item.media.alt}
            />
          ) : null}
        </section>

        <section className="dr-section" aria-label="Jump back in">
          <SectionHead icon="ph:squares-four" title="Jump back in" />
          <div className="dr-quicklinks">
            <QuickLink href="/dashboard" icon="ph:squares-four" label="Dashboard" sub="Overview & reports" />
            <QuickLink href="/" icon="ph:house-bold" label="Home" sub="Your cave" />
            <QuickLink href="/#card-" icon="ph:kanban-bold" label="Board" sub="Cards & tasks" />
            <QuickLink href="/" icon="ph:calendar-bold" label="Calendar" sub="Reminders & agenda" />
          </div>
        </section>

        <footer className="dr-footer">
          Daily reports are generated automatically from your inbox and session activity. Headline
          numbers reflect the day this report was created; the &ldquo;Needs attention&rdquo; list
          stays live.
        </footer>
      </div>
    </main>
  );
}
