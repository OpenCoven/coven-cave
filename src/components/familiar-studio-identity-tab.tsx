"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import {
  setFamiliarOverride,
  clearFamiliarOverrideField,
  useFamiliarOverrides,
  type FamiliarOverride,
} from "@/lib/cave-familiar-overrides";
import { FAMILIAR_TYPES, parseFamiliarTypeIds, type FamiliarTypeSpec } from "@/lib/familiar-types";
import { roomEnabledInBuild } from "@/lib/room-flags";
import { Icon } from "@/lib/icon";
import { useAnnouncer } from "@/components/ui/live-region";
import dynamic from "next/dynamic";
import { FamiliarSettingsDisclosure } from "@/components/familiar-settings-disclosure";
const FamiliarStudioLookTab = dynamic(() => import("@/components/familiar-studio-look-tab").then(module => module.FamiliarStudioLookTab), {
  loading: () => <div role="status" aria-label="Loading appearance"><SkeletonRows count={3} /></div>,
});
import { FamiliarLifecycleSection } from "@/components/familiar-lifecycle-section";
import type { ContractReport } from "@/lib/familiar-contract";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import { showSettingsSavedToast } from "@/lib/settings-save-feedback";

type Props = {
  familiar: ResolvedFamiliar;
  /** Underlying daemon values shown as ghosted placeholders when no override is set. */
  rawDaemonValues: Partial<FamiliarOverride>;
  /** Full resolved roster — the appearance controls diff accent colors across familiars. */
  allFamiliars: ResolvedFamiliar[];
  /** Re-fetch the roster after the lifecycle section removes/restores a familiar. */
  onRosterChanged?: () => void;
  focusContract?: boolean;
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
  focusContract = false,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusContract) return;
    const frame = requestAnimationFrame(() => {
      const grimoire = root.current?.querySelector<HTMLElement>(".familiar-studio-grimoire");
      grimoire?.scrollIntoView({ block: "nearest" });
      grimoire?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusContract]);
  const overrides = useFamiliarOverrides();
  const current = overrides[familiar.id] ?? {};

  // Core identity stays in view; optional editors load on explicit intent.
  return (
    <div ref={root} className="familiar-studio-identity">
      {FIELDS.map((f) => (
        <IdentityField
          key={`${familiar.id}:${f.key}`}
          field={f.key}
          label={f.label}
          textarea={f.textarea}
          value={current[f.key]}
          daemonValue={rawDaemonValues[f.key]}
          onSave={(v) => {
            setFamiliarOverride(familiar.id, { [f.key]: v });
            showSettingsSavedToast(`${f.label} saved.`);
          }}
          onReset={() => {
            clearFamiliarOverrideField(familiar.id, f.key);
            showSettingsSavedToast(`${f.label} reset.`);
          }}
        />
      ))}
      <FamiliarSettingsDisclosure title="Type and rooms" description="Choose the kinds of work this familiar can do.">
        <FamiliarTypePicker familiar={familiar} />
      </FamiliarSettingsDisclosure>
      <FamiliarSettingsDisclosure title="Appearance" description="Avatar, icon, backdrop, and accent color.">
        <FamiliarStudioLookTab familiar={familiar} allFamiliars={allFamiliars} />
      </FamiliarSettingsDisclosure>
      <FamiliarSettingsDisclosure title="Grimoire files" description="Check identity, memory, and guardrail files." reveal={focusContract}>
        <FamiliarGrimoireFiles familiarId={familiar.id} />
      </FamiliarSettingsDisclosure>
      <FamiliarSettingsDisclosure title="Lifecycle" description="Archive or remove this familiar from your Cave.">
        <FamiliarLifecycleSection familiar={familiar} onRosterChanged={onRosterChanged} />
      </FamiliarSettingsDisclosure>
    </div>
  );
}

type ContractFileKey = "soul" | "identity" | "ward" | "memory";

type ContractPayload = {
  ok?: boolean;
  present?: Record<ContractFileKey, boolean>;
  report?: ContractReport;
  error?: string;
};

type ContractState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      present: Record<ContractFileKey, boolean>;
      report: ContractReport;
    };

const GRIMOIRE_FILES: Array<{
  key: ContractFileKey;
  name: string;
  kind: string;
  description: string;
}> = [
  {
    key: "soul",
    name: "SOUL.md",
    kind: "MD",
    description: "Voice, temperament, and reasoning style.",
  },
  {
    key: "identity",
    name: "IDENTITY.md",
    kind: "MD",
    description: "Name, pronouns, avatar, and public identity.",
  },
  {
    key: "ward",
    name: "ward.toml",
    kind: "TOML",
    description: "Guardrails, protected files, and approval tiers.",
  },
  {
    key: "memory",
    name: "MEMORY.md",
    kind: "MD",
    description: "Long-term memory; manage entries from the Memory tab.",
  },
];

function FamiliarGrimoireFiles({ familiarId }: { familiarId: string }) {
  const [state, setState] = useState<ContractState>({ status: "loading" });

  const load = useCallback(async (signal?: AbortSignal) => {
    setState({ status: "loading" });
    try {
      const response = await fetch(
        `/api/familiars/${encodeURIComponent(familiarId)}/contract`,
        { cache: "no-store", signal },
      );
      const payload = await response.json().catch(() => null) as ContractPayload | null;
      if (signal?.aborted) return;
      if (!response.ok || !payload?.ok || !payload.present || !payload.report) {
        throw new Error(payload?.error || `contract check failed (${response.status})`);
      }
      setState({
        status: "ready",
        present: payload.present,
        report: payload.report,
      });
    } catch (error) {
      if (signal?.aborted) return;
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Contract check failed",
      });
    }
  }, [familiarId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <section
      className="familiar-studio-grimoire"
      aria-labelledby={`familiar-grimoire-heading-${familiarId}`}
      tabIndex={-1}
    >
      <div className="familiar-studio-grimoire__heading">
        <h2 id={`familiar-grimoire-heading-${familiarId}`}>Grimoire files</h2>
        {state.status === "ready" ? (
          <>
            <span className="familiar-studio-grimoire__count">
              {Object.values(state.present).filter(Boolean).length} of {GRIMOIRE_FILES.length} found
            </span>
            <span
              className="familiar-studio-grimoire__compliance"
              data-pass={state.report.pass || undefined}
            >
              {state.report.pass
                ? "Compliant"
                : `${state.report.violations.length} ${state.report.violations.length === 1 ? "issue" : "issues"}`}
            </span>
          </>
        ) : null}
        <span className="familiar-studio-grimoire__rule" aria-hidden />
      </div>

      {state.status === "loading" ? (
        <div role="status" aria-label="Checking Grimoire files">
          <SkeletonRows count={2} />
        </div>
      ) : state.status === "error" ? (
        <ErrorState
          compact
          headline="Couldn't check Grimoire files"
          subtitle={state.message}
          actions={(
            <Button size="xs" leadingIcon="ph:arrow-clockwise" onClick={() => void load()}>
              Retry
            </Button>
          )}
        />
      ) : (
        <div className="familiar-studio-grimoire__grid">
          {GRIMOIRE_FILES.map((file) => {
            const present = state.present[file.key];
            const issues = state.report.violations.filter(
              (violation) => violation.file === file.name,
            ).length;
            return (
              <article
                key={file.key}
                className="familiar-studio-grimoire__file"
                data-present={present || undefined}
              >
                <div className="familiar-studio-grimoire__file-head">
                  <span className="familiar-studio-grimoire__kind">{file.kind}</span>
                  <code>{file.name}</code>
                  <span className="familiar-studio-grimoire__state">
                    {present ? "Found" : "Missing"}
                  </span>
                </div>
                <p>{file.description}</p>
                {issues > 0 ? (
                  <span className="familiar-studio-grimoire__issues">
                    {issues} {issues === 1 ? "issue" : "issues"}
                  </span>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * A type's unlock line. Every type still grants its role token, but a build
 * that doesn't ship the promised room would otherwise leave the picker
 * advertising a door that opens onto nothing — so say so here rather than let
 * the user find out by clicking (`src/lib/room-flags.ts`).
 */
function familiarTypeHint(spec: FamiliarTypeSpec): string {
  if (spec.roomId && !roomEnabledInBuild(spec.roomId)) {
    return `${spec.description} That room is still under construction and isn't part of this build.`;
  }
  return spec.description;
}

/**
 * The explicit familiar Type picker (cave-cc5r / cave-gud8): a chip
 * checkbox-row over the static FAMILIAR_TYPES table. Multiple types may be
 * selected; the choice is stored comma-separated in the same `familiarType`
 * Cave override and synced to cave-config like every other identity field.
 * Each selected type ADDS its role token to the familiar's Role Surface
 * grants; the free-text Role label below keeps working exactly as before.
 * General is the empty state — it is checked when nothing is selected.
 * Picking General, or unchecking the last selected type, stores the literal
 * `"general"` sentinel rather than an empty string: an empty string would
 * only *clear* the override (see cave-familiar-overrides.ts) and let a
 * daemon-provided `familiarType` win on resolution, making General a
 * visible no-op. `"general"` is already treated as the empty state
 * everywhere downstream (parseFamiliarTypeIds excludes it,
 * familiarTypeRoleIds grants nothing, resolveFamiliarType falls back to
 * General), so it safely beats any base value.
 */
function FamiliarTypePicker({ familiar }: { familiar: ResolvedFamiliar }) {
  const { announce } = useAnnouncer();
  const selectedIds = parseFamiliarTypeIds(familiar.familiarType);
  const labelId = `familiar-type-label-${familiar.id}`;
  return (
    <div className="familiar-studio-identity__row">
      <span className="familiar-studio-identity__label" id={labelId}>
        Type
      </span>
      <div role="group" aria-labelledby={labelId} className="familiar-studio-identity__types">
        {FAMILIAR_TYPES.map((t) => {
          const isChecked = t.id === "general" ? selectedIds.length === 0 : selectedIds.includes(t.id);
          return (
            <button
              key={t.id}
              type="button"
              role="checkbox"
              aria-checked={isChecked}
              title={familiarTypeHint(t)}
              className={`focus-ring familiar-studio-type-chip${isChecked ? " familiar-studio-type-chip--active" : ""}`}
              onClick={() => {
                if (t.id === "general") {
                  setFamiliarOverride(familiar.id, { familiarType: "general" });
                  announce("Type set to General");
                  showSettingsSavedToast();
                } else {
                  const next = new Set(selectedIds);
                  if (next.has(t.id)) next.delete(t.id); else next.add(t.id);
                  const selected = FAMILIAR_TYPES.filter((s) => next.has(s.id));
                  const value = selected.length === 0 ? "general" : selected.map((s) => s.id).join(",");
                  setFamiliarOverride(familiar.id, { familiarType: value });
                  announce(
                    selected.length === 0
                      ? "Type set to General"
                      : `Type set to ${selected.map((s) => s.label).join(", ")}`,
                  );
                  showSettingsSavedToast();
                }
              }}
            >
              <Icon name={t.iconName} width={12} height={12} aria-hidden />
              {t.label}
            </button>
          );
        })}
      </div>
      {selectedIds.length === 0 ? (
        <p className="familiar-studio-identity__hint">{familiarTypeHint(FAMILIAR_TYPES[0])}</p>
      ) : (
        FAMILIAR_TYPES.filter((s) => selectedIds.includes(s.id)).map((s) => (
          <p key={s.id} className="familiar-studio-identity__hint">{familiarTypeHint(s)}</p>
        ))
      )}
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
  const inputId = useId();
  const [draft, setDraft] = useState(value ?? "");
  const placeholder = daemonValue ?? "—";
  const hasOverride = value !== undefined;
  const dirty = draft !== (value ?? "");

  useEffect(() => {
    setDraft(value ?? "");
  }, [field, value]);

  function commit() {
    if (!dirty) return;
    if (draft.trim() === "") {
      // Empty input clears the override (reverts to daemon).
      setDraft("");
      if (hasOverride) onReset();
      return;
    }
    if (draft !== value) onSave(draft);
  }

  const sharedProps = {
    id: inputId,
    value: draft,
    placeholder,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft(e.target.value),
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Enter" && (!textarea || event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        commit();
      }
    },
    className: "familiar-studio-identity__input",
  };

  return (
    <div className="familiar-studio-identity__row">
      <label htmlFor={inputId} className="familiar-studio-identity__label">{label}</label>
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
        <Button
          variant="secondary"
          size="sm"
          leadingIcon="ph:floppy-disk-bold"
          disabled={!dirty}
          onClick={commit}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
