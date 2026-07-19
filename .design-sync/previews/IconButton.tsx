import { IconButton } from "coven-cave";

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

export const Sizes = () => (
  <Surface>
    <IconButton icon="ph:plus" size="xs" aria-label="New chat" />
    <IconButton icon="ph:plus" size="sm" aria-label="New chat" />
    <IconButton icon="ph:plus" size="md" aria-label="New chat" />
    <IconButton icon="ph:plus" size="lg" aria-label="New chat" />
  </Surface>
);

export const CommonActions = () => (
  <Surface>
    <IconButton icon="ph:pencil-simple" aria-label="Rename session" />
    <IconButton icon="ph:copy" aria-label="Copy grimoire link" />
    <IconButton icon="ph:arrows-clockwise" aria-label="Refresh familiars" />
    <IconButton icon="ph:push-pin" aria-label="Pin to board" />
    <IconButton icon="ph:gear-six" aria-label="Familiar settings" />
  </Surface>
);

export const States = () => (
  <Surface>
    <IconButton icon="ph:sidebar-simple" active aria-label="Session rail shown" />
    <IconButton icon="ph:bell" aria-label="Notifications" />
    <IconButton icon="ph:trash" danger aria-label="Sacrifice session" />
    <IconButton icon="ph:x" danger size="sm" aria-label="Dismiss summon" />
    <IconButton icon="ph:magic-wand-fill" disabled aria-label="Summon familiar (unavailable)" />
  </Surface>
);
