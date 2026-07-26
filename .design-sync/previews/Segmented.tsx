import { useState } from "react";
import { Segmented } from "coven-cave";

function Surface({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--background)",
        padding: 20,
        borderRadius: "var(--radius-card)",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 14,
      }}
    >
      {children}
    </div>
  );
}

const MODE_LABELS: Record<string, string> = {
  chat: "Chat",
  code: "Code",
  board: "Board",
};

export const Basic = () => {
  const [mode, setMode] = useState<"chat" | "code" | "board">("chat");
  return (
    <Surface>
      <Segmented
        options={["chat", "code", "board"] as const}
        value={mode}
        onChange={setMode}
        getLabel={(o) => MODE_LABELS[o] ?? o}
        ariaLabel="Cave mode"
      />
    </Surface>
  );
};

export const EqualWidth = () => {
  const [radius, setRadius] = useState<"0" | "8" | "12" | "16">("12");
  return (
    <Surface>
      <Segmented
        options={["0", "8", "12", "16"] as const}
        value={radius}
        onChange={setRadius}
        getLabel={(o) => o}
        ariaLabel="Corner radius"
        equalWidth
      />
    </Surface>
  );
};

export const TwoOptions = () => {
  const [style, setStyle] = useState<"dropdown" | "rail">("rail");
  return (
    <Surface>
      <Segmented
        options={["dropdown", "rail"] as const}
        value={style}
        onChange={setStyle}
        getLabel={(o) => (o === "dropdown" ? "Dropdown" : "Rail")}
        ariaLabel="Familiar switcher style"
      />
    </Surface>
  );
};
