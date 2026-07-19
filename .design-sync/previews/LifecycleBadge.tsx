import { LifecycleBadge } from "coven-cave";

function Surface({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--background)",
        padding: 20,
        borderRadius: "var(--radius-card)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
      }}
    >
      {children}
    </div>
  );
}

export const AllLifecycles = () => (
  <Surface>
    <LifecycleBadge lifecycle="queued" />
    <LifecycleBadge lifecycle="dispatched" />
    <LifecycleBadge lifecycle="running" />
    <LifecycleBadge lifecycle="review" />
    <LifecycleBadge lifecycle="completed" />
    <LifecycleBadge lifecycle="failed" />
    <LifecycleBadge lifecycle="cancelled" />
  </Surface>
);

export const NeedsHuman = () => (
  <Surface>
    <LifecycleBadge lifecycle="running" needsHuman />
    <LifecycleBadge lifecycle="review" needsHuman />
    <LifecycleBadge lifecycle="failed" needsHuman />
  </Surface>
);
