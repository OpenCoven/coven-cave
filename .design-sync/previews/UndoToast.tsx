import { UndoToast } from "coven-cave";

function Surface({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--background)",
        padding: 24,
        borderRadius: "var(--radius-card)",
        minHeight: "85vh",
      }}
    >
      <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
        Grimoire · 42 pages
      </div>
      {children}
    </div>
  );
}

export const Basic = () => (
  <Surface>
    <UndoToast
      message={
        <>
          Deleted <strong>Moonlit refactor notes</strong>
        </>
      }
      onUndo={() => {}}
      onDismiss={() => {}}
      durationMs={60000}
    />
  </Surface>
);

export const MoveFlow = () => (
  <Surface>
    <UndoToast
      icon="arrow-bend-up-right"
      message={
        <>
          Moved <strong>Summoning circle sketches</strong> to <strong>Rituals</strong>
        </>
      }
      onUndo={() => {}}
      onDismiss={() => {}}
      undoAriaLabel="Undo move"
      durationMs={60000}
    />
  </Surface>
);
