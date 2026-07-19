import { OriginChip } from "coven-cave";

function Surface({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--background)",
        padding: 20,
        borderRadius: "var(--radius-card)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
      }}
    >
      {children}
    </div>
  );
}

export const AllOrigins = () => (
  <Surface>
    <OriginChip origin="chat" />
    <OriginChip origin="mention" />
    <OriginChip origin="board" />
    <OriginChip origin="cron" />
    <OriginChip origin="heartbeat" />
    <OriginChip origin="call" />
    <OriginChip origin="canvas" />
    <OriginChip origin="journal" />
    <OriginChip origin="enhance" />
  </Surface>
);

export const WithProvenance = () => (
  <Surface>
    <OriginChip origin="call" from="nova" />
    <OriginChip origin="mention" from="scout" about="release notes" />
    <OriginChip origin="board" about="cave-q06w" />
  </Surface>
);

export const IconOnly = () => (
  <Surface>
    <OriginChip origin="chat" iconOnly />
    <OriginChip origin="cron" iconOnly />
    <OriginChip origin="heartbeat" iconOnly />
    <OriginChip origin="canvas" iconOnly />
    <OriginChip origin="enhance" iconOnly />
  </Surface>
);
