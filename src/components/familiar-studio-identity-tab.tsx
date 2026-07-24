"use client";

import { useEffect, useState } from "react";
import { IconButton } from "@/components/ui/icon-button";
import {
  setFamiliarOverride,
  clearFamiliarOverrideField,
  useFamiliarOverrides,
  type FamiliarOverride,
} from "@/lib/cave-familiar-overrides";
import { FAMILIAR_TYPES, resolveFamiliarType } from "@/lib/familiar-types";
import { Icon } from "@/lib/icon";
import { FamiliarStudioLookTab } from "@/components/familiar-studio-look-tab";
import { FamiliarLifecycleSection } from "@/components/familiar-lifecycle-section";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";

type Props = {
  familiar: ResolvedFamiliar;
  /** Underlying daemon values shown as ghosted placeholders when no override is set. */
  rawDaemonValues: Partial<FamiliarOverride>;
  /** Full resolved roster — the appearance controls diff accent colors across familiars. */
  allFamiliars: ResolvedFamiliar[];
  /** Re-fetch the roster after the lifecycle section removes/restores a familiar. */
  onRosterChanged?: () => void;
};

const FIELDS: Array<{
  key: keyof FamiliarOverride;
  label: string;
  textarea?: boolean;
}> = [
  { key: "display_name", label: "Display name" },
  { key: "role", label: "Role" },
  { key: "pronouns", label: "Pronouns" },
  { key: "description", label: "Description", textarea: true },
];

export function FamiliarStudioIdentityTab({
  familiar,
  rawDaemonValues,
  allFamiliars,
  onRosterChanged,
}: Props) {
  const overrides = useFamiliarOverrides();
  const current = overrides[familiar.id] ?? {};

  // One continuous page: who the familiar is (type + identity fields), how it
  // looks (the merged Look sections — avatar, icon, backdrop, accent), then the
  // lifecycle verbs (archive / remove) last, in the classic danger-zone slot.
  return (
    <div className="familiar-studio-identity">
      <FamiliarTypePicker familiar={familiar} />
      {FIELDS.map((f) => (
        <IdentityField
          key={`${familiar.id}:${f.key}`}
          field={f.key}
          label={f.label}
          textarea={f.textarea}
          value={current[f.key]}
          daemonValue={rawDaemonValues[f.key]}
          onSave={(v) => setFamiliarOverride(familiar.id, { [f.key]: v })}
          onReset={() => clearFamiliarOverrideField(familiar.id, f.key)}
        />
      ))}
      <FamiliarStudioLookTab familiar={familiar} allFamiliars={allFamiliars} />
      <FamiliarLifecycleSection familiar={familiar} onRosterChanged={onRosterChanged} />
    </div>
  );
}

/**
 * The explicit familiar Type picker (cave-cc5r): a chip radio-row over the
 * static FAMILIAR_TYPES table. The choice is stored as a Cave override
 * (`familiarType`) and synced to cave-config like every other identity field;
 * it ADDS the type's role token to the familiar's Role Surface grants, so the
 * free-text Role label below keeps working exactly as before. Picking General
 * (the default) clears the override.
 */
function FamiliarTypePicker({ familiar }: { familiar: ResolvedFamiliar }) {
  const selected = resolveFamiliarType(familiar.familiarType);
  const labelId = `familiar-type-label-${familiar.id}`;
  return (
    <div className="familiar-studio-identity__row">
      <span className="familiar-studio-identity__label" id={labelId}>
        Type
      </span>
      <div role="radiogroup" aria-labelledby={labelId} className="familiar-studio-identity__types">
        {FAMILIAR_TYPES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={selected.id === t.id}
            title={t.description}
            className={`focus-ring familiar-studio-type-chip${selected.id === t.id ? " familiar-studio-type-chip--active" : ""}`}
            onClick={() =>
              setFamiliarOverride(familiar.id, {
                familiarType: t.id === "general" ? "" : t.id,
              })
            }
          >
            <Icon name={t.iconName} width={12} height={12} aria-hidden />
            {t.label}
          </button>
        ))}
      </div>
      <p className="familiar-studio-identity__hint">{selected.description}</p>
    </div>
  );
}

function IdentityField({
  field,
  label,
  textarea,
  value,
  daemonValue,
  onSave,
  onReset,
}: {
  field: keyof FamiliarOverride;
  label: string;
  textarea?: boolean;
  value: string | undefined;
  daemonValue: string | undefined;
  onSave: (v: string) => void;
  onReset: () => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const placeholder = daemonValue ?? "—";
  const hasOverride = value !== undefined;

  useEffect(() => {
    setDraft(value ?? "");
  }, [field, value]);

  function commit() {
    if (draft.trim() === "") {
      // Empty input clears the override (reverts to daemon).
      onReset();
      return;
    }
    if (draft !== value) onSave(draft);
  }

  const sharedProps = {
    value: draft,
    placeholder,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft(e.target.value),
    onBlur: commit,
    className: "familiar-studio-identity__input",
  };

  return (
    <label className="familiar-studio-identity__row">
      <span className="familiar-studio-identity__label">{label}</span>
      <div className="familiar-studio-identity__control">
        {textarea ? (
          <textarea rows={3} {...(sharedProps as any)} />
        ) : (
          <input type="text" {...(sharedProps as any)} />
        )}
        <IconButton
          icon="ph:arrow-counter-clockwise"
          size="lg"
          aria-label={`Reset ${label} to daemon value`}
          title="Reset to daemon value"
          disabled={!hasOverride}
          onClick={() => {
            onReset();
            setDraft("");
          }}
        />
      </div>
    </label>
  );
}
