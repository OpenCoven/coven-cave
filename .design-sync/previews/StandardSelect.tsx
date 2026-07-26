import { useState } from "react";
import { StandardSelect } from "coven-cave";

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

export const Basic = () => {
  const [value, setValue] = useState("nova");
  return (
    <Surface>
      <StandardSelect
        label="Familiar"
        value={value}
        onChange={setValue}
        options={[
          { value: "nova", label: "Nova", icon: "cat", detail: "General familiar" },
          { value: "sage", label: "Sage", icon: "book-open", detail: "Research" },
          { value: "ember", label: "Ember", icon: "flame", detail: "Code review", disabled: true },
        ]}
      />
    </Surface>
  );
};

export const Grouped = () => {
  const [value, setValue] = useState("opus");
  return (
    <Surface>
      <StandardSelect
        label="Model"
        value={value}
        onChange={setValue}
        options={[
          {
            label: "Claude",
            options: [
              { value: "fable", label: "Fable 5", detail: "Most capable" },
              { value: "opus", label: "Opus 4.8", detail: "Balanced" },
              { value: "haiku", label: "Haiku 4.5", detail: "Fastest" },
            ],
          },
          {
            label: "Local",
            options: [{ value: "llama", label: "Llama", detail: "Runs on this machine" }],
          },
        ]}
      />
    </Surface>
  );
};

export const Placeholder = () => {
  const [value, setValue] = useState("");
  return (
    <Surface>
      <StandardSelect
        label="Runtime"
        placeholder="Choose a runtime…"
        value={value}
        onChange={setValue}
        options={[
          { value: "claude", label: "Claude Code", icon: "terminal-window" },
          { value: "openclaw", label: "OpenClaw", icon: "paw-print-bold" },
        ]}
      />
      <StandardSelect
        label="Disabled"
        value=""
        placeholder="Unavailable"
        disabled
        onChange={() => {}}
        options={[{ value: "x", label: "X" }]}
      />
    </Surface>
  );
};
