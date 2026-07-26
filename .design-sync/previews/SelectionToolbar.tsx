import { Button, SelectionToolbar } from "coven-cave";

function Surface({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--background)",
        padding: 20,
        borderRadius: "var(--radius-card)",
      }}
    >
      {children}
    </div>
  );
}

export const Basic = () => (
  <Surface>
    <SelectionToolbar
      allSelected={false}
      count={3}
      onToggleSelectAll={() => {}}
      onCancel={() => {}}
    >
      <Button variant="ghost" size="xs" leadingIcon="archive">
        Archive
      </Button>
      <Button variant="danger-ghost" size="xs" leadingIcon="trash">
        Sacrifice
      </Button>
    </SelectionToolbar>
    <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
      3 of 12 chats selected in Moonlit refactor
    </div>
  </Surface>
);

export const AllSelected = () => (
  <Surface>
    <SelectionToolbar
      allSelected
      count={12}
      onToggleSelectAll={() => {}}
      onCancel={() => {}}
      selectAllLabel="Select all 12 matches"
    >
      <Button variant="ghost" size="xs" leadingIcon="moon">
        Send to rest
      </Button>
      <Button variant="danger-ghost" size="xs" leadingIcon="trash">
        Delete
      </Button>
    </SelectionToolbar>
    <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
      Every chat matching &ldquo;grimoire&rdquo; is selected
    </div>
  </Surface>
);
