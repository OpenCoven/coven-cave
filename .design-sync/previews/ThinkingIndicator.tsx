import { ThinkingIndicator } from "coven-cave";

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
      }}
    >
      {children}
    </div>
  );
}

export const DefaultThinking = () => (
  <Surface>
    <ThinkingIndicator />
  </Surface>
);

export const DomainLabels = () => (
  <Surface>
    <ThinkingIndicator label="Nova is conjuring a reply" />
    <ThinkingIndicator label="Reaching out to the daemon" />
    <ThinkingIndicator label="Scanning the grimoire" />
  </Surface>
);

export const WithElapsedTimer = () => (
  <Surface>
    <ThinkingIndicator label="Summoning" startedAt={Date.now() - 4_200} />
    <ThinkingIndicator label="Running board card" startedAt={Date.now() - 47_000} />
    <ThinkingIndicator label="Deep research" startedAt={Date.now() - 3 * 60_000 - 12_000} />
  </Surface>
);
