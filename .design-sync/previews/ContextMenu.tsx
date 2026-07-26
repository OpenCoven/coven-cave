import { useState } from "react";
import { ContextMenu, PopoverItem, PopoverLabel, PopoverSeparator } from "coven-cave";
import type { ContextMenuState } from "coven-cave";

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

export const Basic = () => {
  const [state, setState] = useState<ContextMenuState>({ x: 180, y: 96 });
  return (
    <Surface>
      <div
        style={{
          border: "1px solid var(--border-hairline)",
          borderRadius: "var(--radius-card)",
          padding: "10px 14px",
          color: "var(--text-secondary)",
          fontSize: 13,
          maxWidth: 360,
        }}
      >
        <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>Moonlit refactor</div>
        <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
          Wren · 14 turns · right-click for actions
        </div>
      </div>
      <ContextMenu state={state} onClose={() => setState(null)} ariaLabel="Chat actions">
        <PopoverLabel>Moonlit refactor</PopoverLabel>
        <PopoverItem icon="pencil-simple" onSelect={() => {}}>
          Rename chat
        </PopoverItem>
        <PopoverItem icon="copy" onSelect={() => {}}>
          Duplicate
        </PopoverItem>
        <PopoverItem icon="archive" onSelect={() => {}}>
          Archive
        </PopoverItem>
        <PopoverSeparator />
        <PopoverItem icon="trash" danger onSelect={() => {}}>
          Sacrifice session
        </PopoverItem>
      </ContextMenu>
    </Surface>
  );
};
