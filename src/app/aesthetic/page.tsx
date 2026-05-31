// Token reference page (issue #14 acceptance criterion).
// Demonstrates each design token + radius + the Coven presence accent.
// Lives at /aesthetic so designers/contributors can sanity-check tokens
// without booting the full app.

const PALETTE: Array<{ name: string; cssVar: string; note?: string }> = [
  { name: "bg-base", cssVar: "--bg-base", note: "page background" },
  { name: "bg-raised", cssVar: "--bg-raised", note: "cards, panels" },
  { name: "card", cssVar: "--card" },
  { name: "muted", cssVar: "--muted", note: "hover, chip backgrounds" },
  { name: "border-hairline", cssVar: "--border-hairline" },
  { name: "border-strong", cssVar: "--border-strong" },
  { name: "text-primary", cssVar: "--text-primary" },
  { name: "text-secondary", cssVar: "--text-secondary" },
  { name: "text-muted", cssVar: "--text-muted" },
  { name: "primary", cssVar: "--primary" },
  { name: "accent-presence", cssVar: "--accent-presence", note: "OpenCoven lavender" },
];

const RADII: Array<{ name: string; cssVar: string }> = [
  { name: "control", cssVar: "--radius-control" },
  { name: "card", cssVar: "--radius-card" },
  { name: "panel", cssVar: "--radius-panel" },
];

const SPACING: Array<{ name: string; cssVar: string }> = [
  { name: "1", cssVar: "--space-1" },
  { name: "2", cssVar: "--space-2" },
  { name: "3", cssVar: "--space-3" },
  { name: "4", cssVar: "--space-4" },
  { name: "5", cssVar: "--space-5" },
  { name: "6", cssVar: "--space-6" },
  { name: "8", cssVar: "--space-8" },
  { name: "10", cssVar: "--space-10" },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 48 }}>
      <h2
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "var(--text-secondary)",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          marginBottom: 16,
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function AestheticPage() {
  return (
    <div
      style={{
        background: "var(--bg-base)",
        color: "var(--text-primary)",
        minHeight: "100vh",
        padding: "48px 64px",
        fontFamily: "var(--font-geist-sans), system-ui",
      }}
    >
      <header style={{ marginBottom: 48 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>
          Coven aesthetic — Mood C
        </h1>
        <p style={{ color: "var(--text-secondary)", maxWidth: 600 }}>
          Design tokens shipped in issue #14. Reference this page when
          touching any UI to keep colors, radii, and spacing consistent
          with the rest of the cave.
        </p>
      </header>

      <Section title="Palette">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
          }}
        >
          {PALETTE.map((p) => (
            <div
              key={p.name}
              className="shell-card"
              style={{
                padding: 12,
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "var(--radius-control)",
                  background: `var(${p.cssVar})`,
                  border: "1px solid var(--border-hairline)",
                  flexShrink: 0,
                }}
              />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</div>
                <div
                  className="shell-chip-mono"
                  style={{ display: "inline-block", marginTop: 2 }}
                >
                  {p.cssVar}
                </div>
                {p.note && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-secondary)",
                      marginTop: 4,
                    }}
                  >
                    {p.note}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Radii">
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          {RADII.map((r) => (
            <div
              key={r.name}
              style={{ display: "flex", flexDirection: "column", gap: 8 }}
            >
              <div
                style={{
                  width: 80,
                  height: 80,
                  background: "var(--bg-raised)",
                  border: "1px solid var(--border-hairline)",
                  borderRadius: `var(${r.cssVar})`,
                }}
              />
              <div style={{ fontSize: 12, fontWeight: 500 }}>{r.name}</div>
              <div className="shell-chip-mono">{r.cssVar}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Spacing">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {SPACING.map((s) => (
            <div
              key={s.name}
              style={{ display: "flex", alignItems: "center", gap: 12 }}
            >
              <div
                style={{
                  width: `var(${s.cssVar})`,
                  height: 16,
                  background: "var(--accent-presence)",
                  borderRadius: 2,
                  flexShrink: 0,
                }}
              />
              <div style={{ fontSize: 12 }}>space-{s.name}</div>
              <div className="shell-chip-mono">{s.cssVar}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Presence">
        <div
          className="shell-card"
          style={{
            padding: 16,
            display: "flex",
            gap: 24,
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span aria-hidden className="shell-presence-dot" />
            <span style={{ fontSize: 13 }}>Active familiar</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              aria-hidden
              className="shell-presence-dot shell-presence-dot--idle"
            />
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              Idle
            </span>
          </div>
        </div>
      </Section>

      <Section title="Typography">
        <div
          className="shell-card"
          style={{ padding: 20, display: "flex", flexDirection: "column", gap: 8 }}
        >
          <div style={{ fontSize: 20, fontWeight: 600 }}>
            Display — Geist Sans 20/600
          </div>
          <div style={{ fontSize: 14 }}>Body — Geist Sans 14/regular</div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Secondary — Geist Sans 13/regular muted
          </div>
          <div
            style={{
              fontFamily: "var(--font-geist-mono), ui-monospace",
              fontSize: 12,
            }}
          >
            Mono — Geist Mono 12 · COV-123 · ⌘K · feat/aesthetic-mood-c-foundation
          </div>
        </div>
      </Section>
    </div>
  );
}
