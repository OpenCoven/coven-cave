import { useEffect } from "react";
import { ConfirmProvider, useConfirm } from "coven-cave";

function Surface({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--background)",
        padding: 24,
        borderRadius: "var(--radius-card)",
        minHeight: "70vh",
      }}
    >
      <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
        Sessions · Moonlit refactor · 14 turns
      </div>
      {children}
    </div>
  );
}

/** Fires the confirm() request on mount so the dialog renders open. */
function TriggerOnMount(props: Parameters<ReturnType<typeof useConfirm>>[0]) {
  const confirm = useConfirm();
  useEffect(() => {
    void confirm(props);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export const Basic = () => (
  <Surface>
    <ConfirmProvider>
      <TriggerOnMount
        title="Sacrifice this session?"
        body="Moonlit refactor and its 14 turns are gone for good — the grimoire keeps any pages you bound, but the chat itself cannot be recalled."
        confirmLabel="Sacrifice"
        cancelLabel="Keep session"
        danger
      />
    </ConfirmProvider>
  </Surface>
);

export const Standard = () => (
  <Surface>
    <ConfirmProvider>
      <TriggerOnMount
        title="Wake all resting familiars?"
        body="Wren, Sage, and Ember will resume their queued work immediately."
        confirmLabel="Wake them"
      />
    </ConfirmProvider>
  </Surface>
);
