import { useState } from "react";
import { AiToggle } from "coven-cave";

function Surface({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--background)",
        padding: 20,
        borderRadius: "var(--radius-card)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      {children}
    </div>
  );
}

export const Manual = () => {
  const [mode, setMode] = useState<"manual" | "agent">("manual");
  return (
    <Surface>
      <AiToggle mode={mode} onChange={setMode} />
    </Surface>
  );
};

export const Agent = () => {
  const [mode, setMode] = useState<"manual" | "agent">("agent");
  return (
    <Surface>
      <AiToggle mode={mode} onChange={setMode} title="Familiar handles triage" />
    </Surface>
  );
};
