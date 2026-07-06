import { loadInbox } from "@/lib/cave-inbox";
import { Icon } from "@/lib/icon";
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
        // Optional metrics are absent on pre-Phase-B reports — chart as gaps.
        value: s ? (s[metric] ?? null) : null,
      });
    }
    return out;
  };
  const recentSessions = parseRecentSessions(item.body);
  // Structured day-in-review facts — frozen per refresh, absent on old items.
  const report = item.media?.report ?? null;
  // media.generatedAt moves on every in-place refresh; firedAt stays at the
  // day's first generation, so prefer the former for a truthful timestamp.
  const generatedAt = item.media?.generatedAt ?? item.firedAt ?? item.updatedAt ?? null;
  const isToday = parsedDate ? slugFor(parsedDate) === slugFor(new Date()) : false;
  const totalEvents = stats
    ? stats.reminders +
      stats.responses +
      stats.familiars +
      stats.sessions +
      (stats.prsMerged ?? 0) +
      (stats.cardsCompleted ?? 0)
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
              Updated {generatedAt ? relativeTime(generatedAt) : "today"}
            </span>
            {isToday ? (
              <span className="dr-meta-row__item">
                <Icon name="ph:arrows-clockwise" aria-hidden />
                Live — refreshes today
              </span>
            ) : null}
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
            {typeof stats.prsMerged === "number" ? (
              <MetricCard
                icon="ph:git-pull-request"
                value={stats.prsMerged}
                label="PRs merged"
                caption="Shipped to main"
                accent="blue"
                trend={trendFor("prsMerged")}
              />
            ) : null}
            {typeof stats.cardsCompleted === "number" ? (
              <MetricCard
                icon="ph:kanban-bold"
                value={stats.cardsCompleted}
                label="Cards completed"
                caption="Board work finished"
                accent="amber"
                trend={trendFor("cardsCompleted")}
              />
            ) : null}
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

        {/* Shipped — PRs merged during this day (day-in-review facts). */}
        {report?.prsMerged && report.prsMerged.length > 0 ? (
          <section className="dr-section" aria-label="Merged pull requests">
            <SectionHead
              icon="ph:git-pull-request"
              title="Merged pull requests"
              count={report.prsMerged.length}
            />
            <div className="dr-list">
              {report.prsMerged.map((pr) => (
                <a
                  key={`${pr.repo}#${pr.number}`}
                  className="dr-row"
                  href={pr.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ ["--row-accent" as string]: "var(--color-info)" }}
                >
                  <span className="dr-row__icon">
                    <Icon name="ph:git-pull-request" aria-hidden />
                  </span>
                  <span className="dr-row__body">
                    <span className="dr-row__title">{pr.title}</span>
                    <span className="dr-row__metaline">
                      <span className="dr-tag">
                        {pr.repo}#{pr.number}
                      </span>
                      <span className="dr-row__time">merged {relativeTime(pr.mergedAt)}</span>
                    </span>
                  </span>
                  <span className="dr-row__open">
                    <span>Open</span>
                    <Icon name="ph:arrow-right-bold" aria-hidden />
                  </span>
                </a>
              ))}
            </div>
          </section>
        ) : null}

        {/* Sessions grouped by project (structured facts), falling back to the
            flat list recovered from the frozen body on pre-Phase-B reports. */}
        {report?.sessionGroups && report.sessionGroups.length > 0 ? (
          <section className="dr-section" aria-label="Sessions by project">
            <SectionHead
              icon="ph:graph-bold"
              title="Sessions by project"
              count={report.sessionGroups.length}
            />
            <div className="dr-groups">
              {report.sessionGroups.map((group) => (
                <div key={group.key} className="dr-group">
                  <div className="dr-group__head">
                    <span className="dr-group__label">
                      <Icon name="ph:code-bold" aria-hidden />
                      {group.label}
                    </span>
                    {group.additions + group.deletions > 0 ? (
                      <span className="dr-diffstat">
                        <span className="dr-diffstat__add">+{group.additions}</span>
                        <span className="dr-diffstat__del">-{group.deletions}</span>
                      </span>
                    ) : null}
                  </div>
                  <div className="dr-list">
                    {group.sessions.map((session) => (
                      <div
                        key={session.id}
                        className="dr-row"
                        style={{ ["--row-accent" as string]: "var(--color-success)" }}
                      >
                        <span className="dr-row__icon">
                          <Icon name="ph:code-bold" aria-hidden />
                        </span>
                        <span className="dr-row__body">
                          <span className="dr-row__title">{session.title}</span>
                        </span>
                        {session.pr?.url ? (
                          <a
                            className="dr-pr-chip"
                            href={session.pr.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Icon name="ph:git-pull-request" aria-hidden />
                            {session.pr.repo?.split("/").pop() ?? session.pr.repo}
                            {typeof session.pr.number === "number" ? `#${session.pr.number}` : ""}
                          </a>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : recentSessions.length > 0 ? (
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

        {/* Board cards finished today. */}
        {report?.cardsCompleted && report.cardsCompleted.length > 0 ? (
          <section className="dr-section" aria-label="Cards completed">
            <SectionHead
              icon="ph:kanban-bold"
              title="Cards completed"
              count={report.cardsCompleted.length}
            />
            <div className="dr-list">
              {report.cardsCompleted.map((card) => (
                <a
                  key={card.id}
                  className="dr-row"
                  href={`/#card-${card.id}`}
                  style={{ ["--row-accent" as string]: "var(--color-warning)" }}
                >
                  <span className="dr-row__icon">
                    <Icon name="ph:kanban-bold" aria-hidden />
                  </span>
                  <span className="dr-row__body">
                    <span className="dr-row__title">{card.title}</span>
                    <span className="dr-row__metaline">
                      <span className="dr-row__time">completed {relativeTime(card.completedAt)}</span>
                    </span>
                  </span>
                  <span className="dr-row__open">
                    <span>Open</span>
                    <Icon name="ph:arrow-right-bold" aria-hidden />
                  </span>
                </a>
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
            {item.media?.narrative?.text ? (
              <>
                <p className="dr-summary-body" style={{ whiteSpace: "pre-line" }}>
                  {item.media.narrative.text}
                </p>
                <p className="dr-narrative-byline">
                  <Icon name="ph:sparkle" aria-hidden />
                  Written by {item.media.narrative.familiarName || "a familiar"}
                  {" · "}
                  {relativeTime(item.media.narrative.generatedAt)}
                </p>
                <h3 className="dr-panel__subtitle">By the numbers</h3>
                <p className="dr-summary-body dr-summary-body--muted" style={{ whiteSpace: "pre-line" }}>
                  {item.body}
                </p>
              </>
            ) : (
              <p className="dr-summary-body" style={{ whiteSpace: "pre-line" }}>{item.body}</p>
            )}
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
