import { useState } from "react";
import { SettingsGroup, SettingControlRow, Segmented, AiToggle } from "coven-cave";

function Surface({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--background)",
        padding: 20,
        borderRadius: "var(--radius-card)",
        display: "flex",
        flexDirection: "column",
        gap: 20,
        maxWidth: 440,
      }}
    >
      {children}
    </div>
  );
}

export const Basic = () => {
  const [density, setDensity] = useState<"cozy" | "compact">("cozy");
  return (
    <Surface>
      <SettingsGroup label="Appearance">
        <SettingControlRow label="Density" hint="How tightly the session rail packs rows.">
          <Segmented
            options={["cozy", "compact"] as const}
            value={density}
            onChange={setDensity}
            getLabel={(o) => (o === "cozy" ? "Cozy" : "Compact")}
            ariaLabel="Density"
          />
        </SettingControlRow>
      </SettingsGroup>
    </Surface>
  );
};

export const WithDescription = () => {
  const [mode, setMode] = useState<"manual" | "agent">("agent");
  const [scope, setScope] = useState<"coven" | "cave">("coven");
  return (
    <Surface>
      <SettingsGroup
        label="Familiars"
        description="How your familiars behave when summoned."
      >
        <SettingControlRow
          label="Triage mode"
          hint="Let a familiar sort the inbox before you arrive."
        >
          <AiToggle mode={mode} onChange={setMode} />
        </SettingControlRow>
        <SettingControlRow label="Memory scope" hint="Where remembered lore is shared.">
          <Segmented
            options={["coven", "cave"] as const}
            value={scope}
            onChange={setScope}
            getLabel={(o) => (o === "coven" ? "Whole coven" : "This cave")}
            ariaLabel="Memory scope"
          />
        </SettingControlRow>
      </SettingsGroup>
    </Surface>
  );
};

export const MultipleGroups = () => (
  <Surface>
    <SettingsGroup label="Wards">
      <SettingControlRow
        label="Loopback exemption"
        hint="Direct loopback peers skip the access-token gate."
      >
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>On</span>
      </SettingControlRow>
    </SettingsGroup>
    <SettingsGroup label="Grimoire" description="Reading and recall.">
      <SettingControlRow label="Auto-link mentions" hint="Surface unlinked lore as you write.">
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Off</span>
      </SettingControlRow>
    </SettingsGroup>
  </Surface>
);
