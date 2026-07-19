import { ListRowCard } from "coven-cave";

function Surface({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--background)",
        padding: 20,
        borderRadius: "var(--radius-card)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxWidth: 420,
      }}
    >
      {children}
    </div>
  );
}

export const Basic = () => (
  <Surface>
    <ListRowCard
      icon="cat"
      name="Nova"
      description="General familiar — answers first, asks later."
    />
    <ListRowCard
      icon="book-open"
      name="Sage"
      description="Keeper of the grimoire and long memory."
    />
  </Surface>
);

export const WithMetaAndTrailing = () => (
  <Surface>
    <ListRowCard
      icon="terminal-window"
      name="Summoning circle"
      meta="v0.6.0"
      description="Gamified familiar creation and enhancement."
      trailing={<span style={{ fontSize: 11, color: "var(--text-muted)" }}>Installed</span>}
    />
    <ListRowCard
      icon="flask"
      name="Ward inspector"
      meta="BETA"
      description="Audits every loopback exemption in the cave."
      trailing={<span style={{ fontSize: 11, color: "var(--text-muted)" }}>3 wards</span>}
    />
  </Surface>
);

export const Selected = () => (
  <Surface>
    <ListRowCard
      icon="folder-open"
      name="Moonlit cave"
      description="12 sessions · last summon 2h ago"
      selected
    />
    <ListRowCard
      icon="folder-open"
      name="Ember archive"
      description="4 sessions · quiet since Tuesday"
    />
  </Surface>
);

export const CustomLeadingNoArrow = () => (
  <Surface>
    <ListRowCard
      leading={
        <span
          aria-hidden
          style={{
            width: 28,
            height: 28,
            borderRadius: 999,
            background: "var(--accent-presence)",
            color: "var(--accent-presence-foreground)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          E
        </span>
      }
      name="Ember"
      meta="CODE REVIEW"
      description="Reviews every ritual before it reaches main."
      showArrow={false}
    />
  </Surface>
);
