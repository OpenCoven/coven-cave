import { loadInbox } from "@/lib/cave-inbox";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ date: string }>;
};

function statLabel(count: number, label: string): string {
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}

export default async function DailyReportPage({ params }: Props) {
  const { date } = await params;
  const inbox = await loadInbox();
  const item = inbox.items.find((candidate) => candidate.auto === `daily-summary:${date}`);

  if (!item) {
    return (
      <main style={{ minHeight: "100vh", overflowY: "auto", background: "var(--bg-base)", color: "var(--text-primary)", padding: 32 }}>
        <a href="/" style={{ color: "var(--text-secondary)", fontSize: 12 }}>Back to CovenCave</a>
        <section style={{ margin: "96px auto", maxWidth: 720 }}>
          <p style={{ color: "var(--text-muted)", fontSize: 12, textTransform: "uppercase", letterSpacing: 2 }}>Daily report</p>
          <h1 style={{ marginTop: 12, fontSize: 32 }}>Daily report not found</h1>
          <p style={{ color: "var(--text-secondary)", lineHeight: 1.6 }}>
            No generated daily summary exists for {date}.
          </p>
        </section>
      </main>
    );
  }

  const stats = item.media?.stats;
  return (
    <main style={{ minHeight: "100vh", overflowY: "auto", background: "var(--bg-base)", color: "var(--text-primary)", padding: 32 }}>
      <a href="/" style={{ color: "var(--text-secondary)", fontSize: 12 }}>Back to CovenCave</a>
      <article style={{ margin: "32px auto 72px", maxWidth: 960 }}>
        <header style={{ marginBottom: 24 }}>
          <p style={{ color: "var(--text-muted)", fontSize: 12, textTransform: "uppercase", letterSpacing: 2 }}>Daily report</p>
          <h1 style={{ margin: "10px 0 8px", fontSize: 40, lineHeight: 1.1 }}>{item.title}</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>
            Generated {item.firedAt ? new Date(item.firedAt).toLocaleString() : "today"}
          </p>
        </header>

        {item.media?.imageUrl ? (
          <img
            src={item.media.imageUrl}
            alt={item.media.alt}
            style={{ display: "block", width: "100%", borderRadius: 8, border: "1px solid var(--border-hairline)", marginBottom: 24 }}
          />
        ) : null}

        {stats ? (
          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 24 }}>
            <div style={{ border: "1px solid var(--border-hairline)", borderRadius: 8, padding: 16 }}>{statLabel(stats.reminders, "reminder")}</div>
            <div style={{ border: "1px solid var(--border-hairline)", borderRadius: 8, padding: 16 }}>{statLabel(stats.responses, "response")}</div>
            <div style={{ border: "1px solid var(--border-hairline)", borderRadius: 8, padding: 16 }}>{statLabel(stats.familiars, "familiar update")}</div>
            <div style={{ border: "1px solid var(--border-hairline)", borderRadius: 8, padding: 16 }}>{statLabel(stats.sessions, "session")}</div>
          </section>
        ) : null}

        <section style={{ border: "1px solid var(--border-hairline)", borderRadius: 8, padding: 20, background: "var(--bg-raised)" }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Summary</h2>
          <p style={{ whiteSpace: "pre-line", color: "var(--text-secondary)", lineHeight: 1.7 }}>{item.body}</p>
        </section>
      </article>
    </main>
  );
}
