import { PropertyPill } from "coven-cave";

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

export const OutlinedVsFilled = () => (
  <Surface>
    <PropertyPill label="Assign familiar" title="No familiar assigned yet" />
    <PropertyPill label="Nova" filled title="Assigned to Nova" />
    <PropertyPill label="Set timeout" />
    <PropertyPill label="2h timeout" filled />
  </Surface>
);

export const WithIcons = () => (
  <Surface>
    <PropertyPill icon="ph:sparkle" label="Summon" />
    <PropertyPill icon="ph:cat" label="Nova" filled />
    <PropertyPill icon="ph:clock" label="Due Friday" filled />
    <PropertyPill icon="ph:tag" label="Add label" />
    <PropertyPill icon="ph:git-branch" label="feat/grimoire-graph" filled />
  </Surface>
);

export const CardProperties = () => (
  <Surface>
    <PropertyPill icon="ph:kanban" label="Board: Coven Cave" filled />
    <PropertyPill icon="ph:user" label="Started by Val" filled />
    <PropertyPill icon="ph:hourglass" label="running 47m of 2h" filled />
    <PropertyPill icon="ph:plus" label="Add property" />
  </Surface>
);
