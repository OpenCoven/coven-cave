import { useState } from "react";
import { ColorPicker } from "coven-cave";

function Surface({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--background)",
        padding: 20,
        borderRadius: "var(--radius-card)",
        display: "flex",
        alignItems: "flex-start",
        gap: 16,
      }}
    >
      {children}
    </div>
  );
}

export const Basic = () => {
  const [hex, setHex] = useState("#8b7bd8");
  return (
    <Surface>
      <ColorPicker value={hex} onChange={setHex} />
    </Surface>
  );
};

export const WithSwatches = () => {
  const [hex, setHex] = useState("#b28dff");
  return (
    <Surface>
      <ColorPicker
        value={hex}
        onChange={setHex}
        themeSwatches={[
          { hex: "#b28dff", label: "Lavender presence" },
          { hex: "#7ee0c2", label: "Ward mint" },
          { hex: "#ffb86b", label: "Ember" },
          { hex: "#f97583", label: "Sacrifice red" },
          { hex: "#6cb6ff", label: "Moonlight" },
        ]}
        recents={["#22212e", "#5a4fcf", "#e0d7ff"]}
      />
    </Surface>
  );
};
