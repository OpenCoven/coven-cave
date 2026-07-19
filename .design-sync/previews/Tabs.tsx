import { Tabs } from "coven-cave";
import { useState } from "react";

function Surface({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--background)",
        padding: 20,
        borderRadius: "var(--radius-card)",
      }}
    >
      {children}
    </div>
  );
}

const SURFACES = [
  { id: "chats", label: "Chats", icon: "chats-circle", count: 12 },
  { id: "board", label: "Board", icon: "kanban", count: 5 },
  { id: "grimoire", label: "Grimoire", icon: "book-open" },
  { id: "analytics", label: "Analytics", icon: "chart-bar-bold" },
] as const;

export const Underline = () => {
  const [value, setValue] = useState<string>("chats");
  return (
    <Surface>
      <Tabs
        items={SURFACES}
        value={value}
        onChange={setValue}
        ariaLabel="Cave surfaces"
        idPrefix="preview-underline"
      />
    </Surface>
  );
};

export const Segment = () => {
  const [value, setValue] = useState<string>("board");
  return (
    <Surface>
      <div style={{ display: "inline-flex" }}>
        <Tabs
          items={SURFACES}
          value={value}
          onChange={setValue}
          variant="segment"
          ariaLabel="Cave surfaces"
          idPrefix="preview-segment"
        />
      </div>
    </Surface>
  );
};

export const Vertical = () => {
  const [value, setValue] = useState<string>("grimoire");
  return (
    <Surface>
      <div style={{ maxWidth: 180 }}>
        <Tabs
          items={SURFACES}
          value={value}
          onChange={setValue}
          orientation="vertical"
          ariaLabel="Cave surfaces"
          idPrefix="preview-vertical"
        />
      </div>
    </Surface>
  );
};

export const SmallFillAndStates = () => {
  const [value, setValue] = useState<string>("open");
  return (
    <Surface>
      <Tabs
        size="sm"
        fill
        items={[
          { id: "open", label: "Open", count: 8 },
          { id: "in-review", label: "In review", count: 3, accent: "var(--color-warning)" },
          { id: "done", label: "Done", count: 21 },
          { id: "archived", label: "Archived", disabled: true },
        ]}
        value={value}
        onChange={setValue}
        ariaLabel="Work queue states"
        idPrefix="preview-smallfill"
      />
    </Surface>
  );
};
