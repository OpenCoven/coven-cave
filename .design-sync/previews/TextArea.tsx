import { Field, TextArea } from "coven-cave";

function Surface({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--background)",
        padding: 20,
        borderRadius: "var(--radius-card)",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        maxWidth: 400,
      }}
    >
      {children}
    </div>
  );
}

export const InField = () => (
  <Surface>
    <Field
      label="Familiar instructions"
      description="Read by the familiar at the start of every summon."
    >
      <TextArea
        rows={4}
        defaultValue={
          "Guard the cave. Answer in the coven's voice.\nConsult the grimoire before the open web."
        }
      />
    </Field>
  </Surface>
);

export const Placeholder = () => (
  <Surface>
    <Field label="Session notes" optional>
      <TextArea rows={3} placeholder="What should the coven remember about this session?" />
    </Field>
  </Surface>
);

export const Disabled = () => (
  <Surface>
    <Field label="Sealed incantation" description="Locked while the ward is active.">
      <TextArea rows={3} defaultValue="By moon and ember, hold the gate." disabled />
    </Field>
  </Surface>
);

export const Invalid = () => (
  <Surface>
    <Field
      label="Grimoire entry"
      error="Entries must be shorter than 2,000 runes."
    >
      <TextArea
        rows={3}
        defaultValue="On the care and feeding of familiars, volume one of nine…"
      />
    </Field>
  </Surface>
);
