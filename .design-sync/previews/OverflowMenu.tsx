import { useEffect, useRef } from "react";
import { OverflowMenu, PopoverItem, PopoverLabel, PopoverSeparator } from "coven-cave";

function Surface({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--background)",
        padding: 24,
        borderRadius: "var(--radius-card)",
        minHeight: "70vh",
      }}
    >
      {children}
    </div>
  );
}

/** OverflowMenu owns its open state internally, so the preview clicks the
 *  trigger once on mount to show the canonical open menu. */
function AutoOpen({ children }: { children: React.ReactNode }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    hostRef.current?.querySelector("button")?.click();
  }, []);
  return <div ref={hostRef}>{children}</div>;
}

export const Basic = () => (
  <Surface>
    <AutoOpen>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          maxWidth: 380,
          border: "1px solid var(--border-hairline)",
          borderRadius: "var(--radius-card)",
          padding: "10px 12px",
        }}
      >
        <div>
          <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)" }}>Wren</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Grimoire keeper · awake</div>
        </div>
        <OverflowMenu ariaLabel="More actions for Wren" placement="bottom-end" minWidth={200}>
          <PopoverLabel>Wren</PopoverLabel>
          <PopoverItem icon="pencil-simple" onSelect={() => {}}>
            Edit familiar
          </PopoverItem>
          <PopoverItem icon="book-open" onSelect={() => {}}>
            Open memories
          </PopoverItem>
          <PopoverItem icon="moon" onSelect={() => {}}>
            Send to rest
          </PopoverItem>
          <PopoverSeparator />
          <PopoverItem icon="trash" danger onSelect={() => {}}>
            Remove familiar
          </PopoverItem>
        </OverflowMenu>
      </div>
    </AutoOpen>
  </Surface>
);

export const ClosedTrigger = () => (
  <Surface>
    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
      <OverflowMenu ariaLabel="More actions" minWidth={180}>
        <PopoverItem icon="pencil-simple" onSelect={() => {}}>
          Rename
        </PopoverItem>
      </OverflowMenu>
      <OverflowMenu ariaLabel="More actions (disabled)" disabled minWidth={180}>
        <PopoverItem icon="pencil-simple" onSelect={() => {}}>
          Rename
        </PopoverItem>
      </OverflowMenu>
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>default · disabled</span>
    </div>
  </Surface>
);
