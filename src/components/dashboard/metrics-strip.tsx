import { MetricCard, SectionHead } from "@/components/daily-report-ui";
import type { DailyReportStats } from "@/lib/daily-report";

/**
 * Day-at-a-glance metric cards. Mirrors the standalone daily report's headline
 * row, but lives inline on the dashboard so today's numbers and the live triage
 * share one page. `live` flips the hint between the at-this-moment snapshot and
 * the frozen counts captured when today's report generated.
 */
export function MetricsStrip({ metrics, live }: { metrics: DailyReportStats; live: boolean }) {
  return (
    <section className="dr-section" aria-label="Day at a glance">
      <SectionHead
        icon="ph:graph-bold"
        title="Today at a glance"
        hint={live ? "Live — right now" : "From today's report"}
      />
      <div className="dr-metrics">
        <MetricCard
          icon="ph:bell"
          value={metrics.reminders}
          label="Reminders fired"
          caption={metrics.reminders === 1 ? "1 reminder" : `${metrics.reminders} reminders`}
          accent="amber"
        />
        <MetricCard
          icon="ph:chat-circle-dots"
          value={metrics.responses}
          label="Responses waiting"
          caption="Need your reply"
          accent="rose"
        />
        <MetricCard
          icon="ph:sparkle"
          value={metrics.familiars}
          label="Familiar updates"
          caption="From your agents"
          accent="lavender"
        />
        <MetricCard
          icon="ph:graph-bold"
          value={metrics.sessions}
          label="Sessions updated"
          caption="Coding & chat work"
          accent="green"
        />
      </div>
    </section>
  );
}
