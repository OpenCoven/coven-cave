import { SeparatorHandle } from "coven-cave";

function Pane({ label, hint }: { label: string; hint: string }) {
  return (
    <div style={{ padding: 14, minWidth: 0 }}>
      <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)" }}>{label}</div>
      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{hint}</div>
    </div>
  );
}

export const ColumnResize = () => (
  <div
    style={{
      background: "var(--background)",
      padding: 20,
      borderRadius: "var(--radius-card)",
    }}
  >
    <div
      style={{
        display: "flex",
        height: 180,
        border: "1px solid var(--border-hairline)",
        borderRadius: "var(--radius-card)",
        overflow: "hidden",
      }}
    >
      <div style={{ flex: 1 }}>
        <Pane label="Session rail" hint="Chats grouped by project" />
      </div>
      <SeparatorHandle orientation="col" />
      <div style={{ flex: 2 }}>
        <Pane label="Chat" hint="Moonlit refactor · Wren is thinking…" />
      </div>
    </div>
    <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-muted)" }}>
      Vertical handle between panes — hover or drag lights the accent line
    </div>
  </div>
);

export const RowResize = () => (
  <div
    style={{
      background: "var(--background)",
      padding: 20,
      borderRadius: "var(--radius-card)",
    }}
  >
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: 200,
        border: "1px solid var(--border-hairline)",
        borderRadius: "var(--radius-card)",
        overflow: "hidden",
      }}
    >
      <div style={{ flex: 2 }}>
        <Pane label="Canvas" hint="Summoning circle sketch" />
      </div>
      <SeparatorHandle orientation="row" />
      <div style={{ flex: 1 }}>
        <Pane label="Terminal" hint="coven serve · port 3001" />
      </div>
    </div>
  </div>
);

export const Dragging = () => (
  <div
    style={{
      background: "var(--background)",
      padding: 20,
      borderRadius: "var(--radius-card)",
    }}
  >
    <div
      style={{
        display: "flex",
        height: 140,
        border: "1px solid var(--border-hairline)",
        borderRadius: "var(--radius-card)",
        overflow: "hidden",
      }}
    >
      <div style={{ flex: 1 }}>
        <Pane label="Grimoire" hint="42 pages" />
      </div>
      <SeparatorHandle orientation="col" className="ui-sep-handle--dragging" />
      <div style={{ flex: 1 }}>
        <Pane label="Preview" hint="Bound page" />
      </div>
    </div>
    <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-muted)" }}>
      Active drag state — accent-tinted line
    </div>
  </div>
);
