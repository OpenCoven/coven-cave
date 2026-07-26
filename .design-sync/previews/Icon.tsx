import { Icon } from "coven-cave";

function Surface({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--background)",
        padding: 20,
        borderRadius: "var(--radius-card)",
        display: "flex",
        alignItems: "center",
        gap: 14,
        flexWrap: "wrap",
        color: "var(--text-primary, #e8e6f0)",
      }}
    >
      {children}
    </div>
  );
}

const GALLERY = [
  "ph:cat",
  "ph:sparkle",
  "ph:brain",
  "ph:kanban",
  "ph:magic-wand-fill",
  "ph:book-open",
  "ph:heartbeat",
  "ph:flame",
  "ph:moon",
  "ph:paw-print-fill",
  "ph:flask",
  "ph:lightbulb",
] as const;

export const Gallery = () => (
  <Surface>
    {GALLERY.map((name) => (
      <Icon key={name} name={name} width={18} height={18} title={name} />
    ))}
  </Surface>
);

export const Sizes = () => (
  <Surface>
    <Icon name="ph:sparkle" width={12} height={12} />
    <Icon name="ph:sparkle" width={16} height={16} />
    <Icon name="ph:sparkle" width={22} height={22} />
    <Icon name="ph:sparkle" width={30} height={30} />
    <Icon name="ph:cat" width={12} height={12} />
    <Icon name="ph:cat" width={16} height={16} />
    <Icon name="ph:cat" width={22} height={22} />
    <Icon name="ph:cat" width={30} height={30} />
  </Surface>
);

export const ColorInheritance = () => (
  <Surface>
    <span style={{ color: "var(--accent-presence)", display: "inline-flex" }}>
      <Icon name="ph:sparkle" width={20} height={20} />
    </span>
    <span style={{ color: "var(--color-danger)", display: "inline-flex" }}>
      <Icon name="ph:warning" width={20} height={20} />
    </span>
    <span style={{ color: "var(--color-success)", display: "inline-flex" }}>
      <Icon name="ph:check-circle-fill" width={20} height={20} />
    </span>
    <span style={{ color: "var(--color-warning)", display: "inline-flex" }}>
      <Icon name="ph:hourglass" width={20} height={20} />
    </span>
    <span style={{ color: "var(--text-muted)", display: "inline-flex" }}>
      <Icon name="ph:moon" width={20} height={20} />
    </span>
  </Surface>
);
