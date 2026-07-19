import { SessionInitiatorChip } from "coven-cave";

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

export const AllKinds = () => (
  <Surface>
    <SessionInitiatorChip initiator={{ kind: "human", label: "Val", channel: "telegram" }} />
    <SessionInitiatorChip initiator={{ kind: "familiar", label: "Nova", agentId: "nova" }} />
    <SessionInitiatorChip initiator={{ kind: "system", label: "cron", channel: "cron" }} />
    <SessionInitiatorChip initiator={{ kind: "unknown", label: "Unknown" }} />
  </Surface>
);

export const MissingInitiator = () => (
  <Surface>
    <SessionInitiatorChip />
  </Surface>
);

export const IconOnly = () => (
  <Surface>
    <SessionInitiatorChip iconOnly initiator={{ kind: "human", label: "Val", channel: "discord" }} />
    <SessionInitiatorChip iconOnly initiator={{ kind: "familiar", label: "Scout", agentId: "scout" }} />
    <SessionInitiatorChip iconOnly initiator={{ kind: "system", label: "heartbeat", channel: "heartbeat" }} />
  </Surface>
);
