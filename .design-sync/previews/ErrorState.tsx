import { Button, ErrorState } from "coven-cave";

function Surface({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--background)",
        padding: 20,
        borderRadius: "var(--radius-card)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {children}
    </div>
  );
}

export const WithRetry = () => (
  <Surface>
    <ErrorState
      headline="The coven daemon is unreachable"
      subtitle="Summons and session history stay paused until the connection returns."
      actions={
        <Button variant="secondary" size="sm" leadingIcon="arrows-clockwise">
          Retry connection
        </Button>
      }
    />
  </Surface>
);

export const CustomIcon = () => (
  <Surface>
    <ErrorState
      icon="ph:shield-slash"
      headline="Grimoire access denied"
      subtitle="This familiar's grants don't cover the shared grimoire. Ask the coven keeper to widen the scope."
      actions={
        <Button variant="secondary" size="sm">
          Review grants
        </Button>
      }
    />
  </Surface>
);

export const Compact = () => (
  <Surface>
    <ErrorState
      compact
      headline="Couldn't load familiar memories"
      subtitle="The memory scan timed out after 30s."
    />
  </Surface>
);
