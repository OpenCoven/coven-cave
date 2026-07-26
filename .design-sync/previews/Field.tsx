import { Field, TextInput, TextArea } from "coven-cave";

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

export const Basic = () => (
  <Surface>
    <Field label="Familiar name">
      <TextInput defaultValue="Nova" />
    </Field>
  </Surface>
);

export const WithDescription = () => (
  <Surface>
    <Field
      label="Coven name"
      description="Shown on invites and in the session rail."
    >
      <TextInput placeholder="Midnight Circle" />
    </Field>
  </Surface>
);

export const OptionalAndRequired = () => (
  <Surface>
    <Field label="Ward note" optional>
      <TextInput placeholder="Why this ward exists…" />
    </Field>
    <Field label="Grimoire title" required>
      <TextInput defaultValue="Book of Shadows" />
    </Field>
  </Surface>
);

export const WithError = () => (
  <Surface>
    <Field
      label="Familiar name"
      error="A familiar named Nova already prowls this coven."
    >
      <TextInput defaultValue="Nova" />
    </Field>
  </Surface>
);

export const TextAreaControl = () => (
  <Surface>
    <Field
      label="Summoning instructions"
      description="The familiar reads this before every session."
    >
      <TextArea
        rows={3}
        defaultValue="Keep replies terse. Prefer the grimoire over the open web."
      />
    </Field>
  </Surface>
);
