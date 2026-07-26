import { Button } from "coven-cave";

function Surface({ children, row = true }: { children: React.ReactNode; row?: boolean }) {
  return (
    <div
      style={{
        background: "var(--background)",
        padding: 20,
        borderRadius: "var(--radius-card)",
        display: "flex",
        flexDirection: row ? "row" : "column",
        alignItems: row ? "center" : "flex-start",
        gap: 10,
        flexWrap: "wrap",
      }}
    >
      {children}
    </div>
  );
}

export const Variants = () => (
  <Surface>
    <Button variant="primary">Summon familiar</Button>
    <Button variant="secondary">Open grimoire</Button>
    <Button variant="ghost">Dismiss</Button>
    <Button variant="danger">Sacrifice session</Button>
    <Button variant="danger-ghost">Remove</Button>
  </Surface>
);

export const Sizes = () => (
  <Surface>
    <Button variant="primary" size="xs">
      Add
    </Button>
    <Button variant="primary" size="sm">
      Add project
    </Button>
    <Button variant="primary" size="md">
      Add project
    </Button>
    <Button variant="primary" size="lg">
      Add project
    </Button>
  </Surface>
);

export const WithIcons = () => (
  <Surface>
    <Button variant="primary" leadingIcon="sparkle">
      Enhance prompt
    </Button>
    <Button variant="secondary" leadingIcon="plus">
      New chat
    </Button>
    <Button variant="secondary" trailingIcon="arrow-square-out">
      Open in editor
    </Button>
    <Button variant="ghost" leadingIcon="gear-six">
      Settings
    </Button>
  </Surface>
);

export const States = () => (
  <Surface>
    <Button variant="primary" disabled>
      Disabled
    </Button>
    <Button variant="primary" loading>
      Summoning…
    </Button>
    <Button variant="secondary" fullWidth>
      Full width
    </Button>
  </Surface>
);
