import { Field, TextInput } from "coven-cave";

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
        maxWidth: 360,
      }}
    >
      {children}
    </div>
  );
}

export const InField = () => (
  <Surface>
    <Field label="Familiar name">
      <TextInput defaultValue="Sage" />
    </Field>
  </Surface>
);

export const Placeholder = () => (
  <Surface>
    <Field label="Project root" description="Absolute path to the cave.">
      <TextInput placeholder="/Users/morgan/covens/moonlit-cave" />
    </Field>
  </Surface>
);

export const Disabled = () => (
  <Surface>
    <Field label="Coven id" description="Assigned when the coven is founded.">
      <TextInput defaultValue="coven-7f3a" disabled />
    </Field>
  </Surface>
);

export const Invalid = () => (
  <Surface>
    <Field label="Ward port" error="Port 3000 is already claimed by another ward.">
      <TextInput defaultValue="3000" inputMode="numeric" />
    </Field>
  </Surface>
);
