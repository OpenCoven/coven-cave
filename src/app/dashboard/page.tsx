import { loadInbox } from "@/lib/cave-inbox";
import { Icon } from "@/lib/icon";
import { CopyLinkButton } from "@/components/copy-link-button";
import { EmptyState, ItemRow, MetricCard, QuickLink, SectionHead } from "@/components/daily-report-ui";
import {
  breakdownForDay,
  dateSlug,
  liveSnapshot,
  longDateLabel,
  recentReports,
  relativeDayLabel,
  relativeTime,
} from "@/lib/daily-report";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const inbox = await loadInbox();
  const now = new Date();
  const snapshot = liveSnapshot(inbox.items, now);
  const breakdown = breakdownForDay(inbox.items, now);
  const reports = recentReports(inbox.items);
  const todaySlug = dateSlug(now);
  const todaysReport = reports.find((report) => report.slug === todaySlug) ?? null;
  const latestReport = reports[0] ?? null;
  const featuredReport = todaysReport ?? latestReport;
  const openCount = breakdown.openItems.length;

  return (
    <main className="dr-page">
      <div className="dr-topbar">
        <nav className="dr-topbar__crumbs" aria-label="Breadcrumb">
          <a className="dr-back" href="/">
            <Icon name="ph:arrow-left" aria-hidden />
            CovenCave
          </a>
          <span className="dr-crumb-sep" aria-hidden>/</span>
          <span className="dr-crumb-current">Dashboard</span>
        </nav>
        <div className="dr-topbar__actions">
          <CopyLinkButton />
        </div>
      </div>

      <div className="dr-shell">
        <header className="dr-hero">
          <p className="dr-eyebrow">
            <span className="dr-eyebrow__dot" aria-hidden />
            Dashboard
          </p>
          <h1 className="dr-title">Today in your cave</h1>
          <p className="dr-subtitle">
            A live overview of what needs you and what your familiars have been up to. {longDateLabel(now)}.
          </p>
          <div className="dr-meta-row">
            <span className="dr-meta-row__item">
              <Icon name="ph:clock" aria-hidden />
              Updated {relativeTime(now.toISOString(), now) || "just now"}
            </span>
            {openCount > 0 ? (
              <span className="dr-meta-row__item">
                <Icon name="ph:warning-circle" aria-hidden />
                {openCount} {openCount === 1 ? "item needs" : "items need"} attention
              </span>
            ) : (
              <span className="dr-meta-row__item">
                <Icon name="ph:check-circle" aria-hidden />
                All caught up
              </span>
            )}
          </div>
        </header>

        {/* Primary CTA → today's (or the latest) daily report. */}
        {featuredReport ? (
          <a className="dr-cta" href={featuredReport.href}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
              <span className="dr-cta__icon">
                <Icon name="ph:newspaper" aria-hidden />
              </span>
              <span style={{ minWidth: 0 }}>
                <div className="dr-cta__title">
                  {todaysReport ? "Today's daily report is ready" : "Latest daily report"}
                </div>
                <div className="dr-cta__sub">
                  {featuredReport.title}
                  {featuredReport.generatedAt
                    ? ` · generated ${relativeTime(featuredReport.generatedAt, now)}`
                    : ""}
                </div>
              </span>
            </div>
            <span className="dr-btn dr-btn--primary" aria-hidden>
              Read report
              <Icon name="ph:arrow-right-bold" aria-hidden />
            </span>
          </a>
        ) : (
          <div className="dr-cta" style={{ cursor: "default" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
              <span className="dr-cta__icon">
                <Icon name="ph:newspaper" aria-hidden />
              </span>
              <span style={{ minWidth: 0 }}>
                <div className="dr-cta__title">No daily report yet</div>
                <div className="dr-cta__sub">
                  A daily report is generated automatically once there&apos;s activity to
                  summarize — it&apos;ll appear here.
                </div>
              </span>
            </div>
          </div>
        )}

        {/* Live snapshot metrics. */}
        <section className="dr-metrics" aria-label="Today at a glance">
          <MetricCard
            icon="ph:bell"
            value={snapshot.reminders}
            label="Reminders today"
            caption="Fired today"
            accent="amber"
          />
          <MetricCard
            icon="ph:chat-circle-dots"
            value={snapshot.responses}
            label="Responses waiting"
            caption="Need your reply"
            accent="rose"
          />
          <MetricCard
            icon="ph:sparkle"
            value={snapshot.familiars}
            label="Familiar updates"
            caption="From your agents"
            accent="lavender"
          />
          <MetricCard
            icon="ph:newspaper"
            value={reports.length}
            label="Daily reports"
            caption="Archived snapshots"
            accent="blue"
          />
        </section>

        {/* Needs attention — actionable, live. */}
        <section className="dr-section" aria-label="Needs attention">
          <SectionHead
            icon="ph:warning-circle"
            title="Needs attention"
            count={openCount}
            hint="Click to jump back in"
          />
          {openCount > 0 ? (
            <div className="dr-list">
              {breakdown.openItems.slice(0, 8).map((open) => (
                <ItemRow key={open.id} item={open} now={now} />
              ))}
            </div>
          ) : (
            <EmptyState icon="ph:check-circle">
              Nothing needs you right now. Your reminders and responses are all handled.
            </EmptyState>
          )}
        </section>

        {/* Recent daily reports. */}
        <section className="dr-section" aria-label="Recent daily reports">
          <SectionHead icon="ph:newspaper" title="Recent daily reports" count={reports.length} />
          {reports.length > 0 ? (
            <div className="dr-list">
              {reports.slice(0, 7).map((report) => {
                const reportDate = new Date(`${report.slug}T00:00:00`);
                return (
                  <a key={report.slug} className="dr-row" href={report.href}>
                    <span className="dr-row__icon" style={{ ["--row-accent" as string]: "var(--color-info)" }}>
                      <Icon name="ph:newspaper" aria-hidden />
                    </span>
                    <span className="dr-row__body dr-report-row">
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span className="dr-row__title">{relativeDayLabel(reportDate, now)}</span>
                        <span className="dr-row__sub">{report.title}</span>
                      </span>
                      {report.stats ? (
                        <span className="dr-report-row__stats">
                          <span className="dr-mini-stat"><b>{report.stats.reminders}</b> rem</span>
                          <span className="dr-mini-stat"><b>{report.stats.responses}</b> resp</span>
                          <span className="dr-mini-stat"><b>{report.stats.sessions}</b> sess</span>
                        </span>
                      ) : null}
                    </span>
                    <span className="dr-row__open">
                      <span>Open</span>
                      <Icon name="ph:arrow-right-bold" aria-hidden />
                    </span>
                  </a>
                );
              })}
            </div>
          ) : (
            <EmptyState icon="ph:newspaper">
              No daily reports yet. They&apos;re generated automatically as you use the cave.
            </EmptyState>
          )}
        </section>

        {/* Jump-off quick links into the app shell. */}
        <section className="dr-section" aria-label="Workspaces">
          <SectionHead icon="ph:squares-four" title="Workspaces" />
          <div className="dr-quicklinks">
            <QuickLink href="/" icon="ph:house-bold" label="Home" sub="Your cave" />
            <QuickLink href="/#card-" icon="ph:kanban-bold" label="Board" sub="Cards & tasks" />
            <QuickLink href="/" icon="ph:calendar-bold" label="Calendar" sub="Reminders & agenda" />
            <QuickLink href="/" icon="ph:books-bold" label="Library" sub="Saved knowledge" />
            <QuickLink href="/settings" icon="ph:gear-six" label="Settings" sub="Preferences" />
            <QuickLink href="/aesthetic" icon="ph:paint-brush" label="Aesthetic" sub="Design tokens" />
          </div>
        </section>

        <footer className="dr-footer">
          This dashboard reads your local inbox and session activity. Metrics are live; daily reports
          are point-in-time snapshots generated automatically.
        </footer>
      </div>
    </main>
  );
}
