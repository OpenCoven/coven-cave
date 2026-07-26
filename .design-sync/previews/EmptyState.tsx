import { Button, EmptyState } from "coven-cave";

function Surface({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--background)",
        padding: 24,
        borderRadius: "var(--radius-card)",
      }}
    >
      {children}
    </div>
  );
}

export const Default = () => (
  <Surface>
    <EmptyState
      icon="cat"
      headline="No familiars yet"
      subtitle="Summon your first familiar to start delegating work — it'll appear here with its presence dot once it wakes."
      actions={
        <Button variant="primary" leadingIcon="sparkle">
          Summon familiar
        </Button>
      }
    />
  </Surface>
);

export const WithSecondaryAction = () => (
  <Surface>
    <EmptyState
      icon="folder-open"
      headline="No projects yet"
      subtitle="Add a project folder to group chats by codebase."
      actions={
        <>
          <Button variant="primary" leadingIcon="plus">
            Add a project folder
          </Button>
          <Button variant="ghost">Learn more</Button>
        </>
      }
    />
  </Surface>
);

export const Compact = () => (
  <Surface>
    <EmptyState
      compact
      icon="magnifying-glass"
      headline="No results"
      subtitle="Try a different search — grimoire pages match on title and tags."
    />
  </Surface>
);
