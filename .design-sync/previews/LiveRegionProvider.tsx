import { Button, LiveRegionProvider, useAnnouncer } from "coven-cave";
import { useState } from "react";

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
        gap: 12,
        color: "var(--text-primary, #e8e6f0)",
        fontSize: 13,
      }}
    >
      {children}
    </div>
  );
}

function MemorySaver() {
  const { announce } = useAnnouncer();
  const [saved, setSaved] = useState(0);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setSaved((n) => n + 1);
          announce("Memory saved to the grimoire.");
        }}
      >
        Save memory
      </Button>
      <Button
        variant="danger-ghost"
        size="sm"
        onClick={() => announce("Failed to reach the daemon", "assertive")}
      >
        Simulate failure
      </Button>
      <span style={{ color: "var(--text-muted)" }}>
        {saved === 0 ? "No memories saved yet" : `${saved} memor${saved === 1 ? "y" : "ies"} saved`}
      </span>
    </div>
  );
}

export const AnnouncerComposition = () => (
  <Surface>
    <LiveRegionProvider>
      <MemorySaver />
    </LiveRegionProvider>
    <span style={{ color: "var(--text-muted)" }}>
      The provider wraps its children and appends two visually-hidden live regions (polite +
      assertive) — invisible here by design; screen readers hear each announce().
    </span>
  </Surface>
);

export const RootMountPattern = () => (
  <Surface>
    <LiveRegionProvider>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <strong>Coven Cave shell</strong>
        <span style={{ color: "var(--text-muted)" }}>
          Mounted once at the app root: any surface can call useAnnouncer() to speak status
          ("Familiar summoned") or alerts ("Session failed") to assistive tech.
        </span>
      </div>
    </LiveRegionProvider>
  </Surface>
);
