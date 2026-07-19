import { Button, Field, Modal, PropertyPill, TextInput } from "coven-cave";

function AppBackdrop({ children }: { children: React.ReactNode }) {
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
        Familiars · 3 awake · 2 resting
      </div>
      {children}
    </div>
  );
}

export const Basic = () => (
  <AppBackdrop>
    <Modal
      open
      onClose={() => {}}
      breadcrumb={["Familiars", "Summon a familiar"]}
      footerPills={
        <>
          <PropertyPill icon="cat" label="Runtime: Claude Code" filled />
          <PropertyPill icon="folder-open" label="Project" />
        </>
      }
      footerActions={
        <>
          <Button variant="secondary">Cancel</Button>
          <Button variant="primary" leadingIcon="sparkle">
            Summon
          </Button>
        </>
      }
    >
      <div style={{ display: "grid", gap: 14 }}>
        <Field label="Name" description="What the coven will call this familiar.">
          <TextInput defaultValue="Wren" />
        </Field>
        <Field
          label="Purpose"
          description="One line the summoning circle uses to shape its instincts."
        >
          <TextInput defaultValue="Tends the grimoire and files research notes" />
        </Field>
      </div>
    </Modal>
  </AppBackdrop>
);

export const Wide = () => (
  <AppBackdrop>
    <Modal
      open
      onClose={() => {}}
      wide
      breadcrumb={["Grimoire", "Moonlit refactor", "Bind page"]}
      footerActions={
        <>
          <Button variant="ghost">Keep drafting</Button>
          <Button variant="primary" leadingIcon="book-open">
            Bind to grimoire
          </Button>
        </>
      }
    >
      <div style={{ display: "grid", gap: 10, color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.6 }}>
        <p style={{ margin: 0 }}>
          Binding this page makes it part of the coven&apos;s shared grimoire. Every familiar can
          recall it when a chat touches the <strong>moonlit-refactor</strong> project.
        </p>
        <p style={{ margin: 0, color: "var(--text-muted)" }}>
          Pages stay editable after binding — unbinding returns them to your private notes without
          losing history.
        </p>
      </div>
    </Modal>
  </AppBackdrop>
);
