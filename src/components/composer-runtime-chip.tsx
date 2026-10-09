"use client";

import "@/styles/cave-composer.css";

// Composer runtime · model · control pickers (#5896). The chat composer's
// "what will answer me" controls are separately labelled chips: a Runtime chip
// (the harness mark + name), a Model chip (the effective model, or the runtime
// default), and one chip per selected-model control the runtime reports for
// that model — Thinking and Speed — which appear and disappear with the
// capability report from /api/chat/model-state, never from a local guess.
//
// Runtime picks are familiar-level (the same /api/config contract the home
// composer's selectRuntime uses) and apply from the next send — the send route
// re-resolves the binding from current config per turn. The menus mirror
// ComposerHostChip's Popover conventions; the chips themselves live in
// ComposerContextChips (composer-context-pill.tsx).

import { Icon, type IconName } from "@/lib/icon";
import {
  Popover,
  PopoverBody,
  PopoverItem,
  PopoverLabel,
  PopoverSeparator,
} from "@/components/ui/popover";
import {
  RUNTIME_MODEL_CATALOG,
  type RuntimeModelOption,
} from "@/lib/runtime-models";
import type {
  ModelControlCapability,
  ModelControlFamily,
} from "@/lib/model-control-capabilities";
import { RuntimeLogo, runtimeDisplayName } from "@/components/runtime-logo";
import "@/styles/composer-runtime-chip.css";

/** Preserve the exact provider-qualified selection in every composer. */
export function runtimeModelLabel(
  modelValue: string,
  _modelOptions: RuntimeModelOption[],
): string | null {
  return modelValue || null;
}

type PopoverPlacement = "bottom-start" | "top-start";

// ── Selected-model control chips ─────────────────────────────────────────────
// Only the two families people reach for mid-conversation earn a chip in the
// context row; the rest (verbosity, …) stay under Tools → Response options so
// the row does not grow one chip per provider knob.

export const COMPOSER_CONTROL_CHIP_FAMILIES: readonly ModelControlFamily[] = [
  "reasoning",
  "performance",
];

const CONTROL_CHIP_LABEL: Partial<Record<ModelControlFamily, string>> = {
  reasoning: "Thinking",
  performance: "Speed",
};

const CONTROL_CHIP_ICON: Partial<Record<ModelControlFamily, IconName>> = {
  reasoning: "ph:brain-bold",
  performance: "ph:lightning-fill",
};

/** The unset state: nothing is sent and the runtime/model keeps its default. */
export const CONTROL_AUTO_LABEL = "Auto";

export function controlChipLabel(capability: ModelControlCapability): string {
  return CONTROL_CHIP_LABEL[capability.family] ?? capability.label;
}

export function controlChipIcon(capability: ModelControlCapability): IconName {
  return CONTROL_CHIP_ICON[capability.family] ?? "ph:sliders-horizontal";
}

export function controlValueLabel(
  capability: ModelControlCapability,
  value: string | undefined,
): string {
  if (!value) return CONTROL_AUTO_LABEL;
  return capability.values.find((option) => option.value === value)?.label ?? value;
}

/** How a pick reaches the model — the chip says so, so a prompt-only guidance
 *  value is never mistaken for a provider setting. */
export function controlDeliveryNote(capability: ModelControlCapability): string {
  switch (capability.delivery) {
    case "runtime-cli":
      return "Applied by the runtime";
    case "native-provider":
      return "Applied by the provider";
    case "prompt-only":
      return "Sent as prompt guidance";
    default:
      return "Unavailable";
  }
}

/** The chips to render for a capability report, in a stable Thinking → Speed
 *  order regardless of report order. Families the report omits render nothing. */
export function composerControlChips(
  capabilities: readonly ModelControlCapability[],
): ModelControlCapability[] {
  return COMPOSER_CONTROL_CHIP_FAMILIES
    .map((family) =>
      capabilities.find(
        (capability) => capability.family === family && capability.delivery !== "unsupported",
      ),
    )
    .filter((capability): capability is ModelControlCapability => Boolean(capability));
}

// ── Runtime menu ─────────────────────────────────────────────────────────────

/** Controlled Runtime popover, anchored to any caller-owned trigger (the
 *  Runtime chip, or the composer Tools menu). */
export function ComposerRuntimePopover({
  open,
  onOpenChange,
  anchorRef,
  placement = "top-start",
  runtime,
  onPickRuntime,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  placement?: PopoverPlacement;
  runtime: string;
  onPickRuntime: (runtime: string) => void;
}) {
  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      anchorRef={anchorRef}
      placement={placement}
      minWidth={200}
      ariaLabel="Runtime"
    >
      <PopoverBody role="menu" ariaLabel="Runtime">
        <PopoverLabel>Runtime</PopoverLabel>
        {Object.values(RUNTIME_MODEL_CATALOG).map((catalog) => (
          <PopoverItem
            key={catalog.runtime}
            leading={
              <span className="cave-runtime-chip__logo" aria-hidden>
                <RuntimeLogo runtime={catalog.runtime} size={13} />
              </span>
            }
            checked={catalog.runtime === runtime}
            onSelect={() => {
              // Close before the pick: a switch is complete only once a model
              // is chosen (cave-bfwk), so the caller's pick handler opens the
              // Model menu and must win the state batch over this close.
              onOpenChange(false);
              if (catalog.runtime !== runtime) onPickRuntime(catalog.runtime);
            }}
          >
            {runtimeDisplayName(catalog.runtime)}
          </PopoverItem>
        ))}
      </PopoverBody>
    </Popover>
  );
}

// ── Model menu ───────────────────────────────────────────────────────────────

/** Controlled Model popover for the active runtime's reported inventory. */
export function ComposerModelPopover({
  open,
  onOpenChange,
  anchorRef,
  placement = "top-start",
  runtime,
  modelValue,
  modelOptions,
  onPickModel,
  promotableModel = null,
  onPromoteModelToDefault,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  placement?: PopoverPlacement;
  runtime: string;
  modelValue: string;
  modelOptions: RuntimeModelOption[];
  onPickModel: (id: string | null) => void;
  /** cave-pkapw: a session-scoped model id to offer promoting to the familiar
   *  default. This component renders the row whenever the value is non-null and
   *  cannot check it itself; the CALLER owes the "would actually change the
   *  default" test (chat-view compares against `familiarDefaultModel`) and
   *  passes null otherwise, which hides the row. */
  promotableModel?: string | null;
  onPromoteModelToDefault?: () => void;
}) {
  const modelIsOutsideInventory =
    Boolean(modelValue) && !modelOptions.some((option) => option.id === modelValue);
  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      anchorRef={anchorRef}
      placement={placement}
      minWidth={230}
      ariaLabel="Model"
    >
      <PopoverBody role="menu" ariaLabel="Model">
        <PopoverLabel>Model · {runtimeDisplayName(runtime)}</PopoverLabel>
        <PopoverItem
          checked={!modelValue}
          onSelect={() => {
            if (modelValue) onPickModel(null);
            onOpenChange(false);
          }}
        >
          Runtime default
        </PopoverItem>
        {modelOptions.length === 0 ? (
          <PopoverLabel>No models reported · use runtime default</PopoverLabel>
        ) : null}
        {modelIsOutsideInventory ? (
          <PopoverItem checked disabled title={modelValue}>
            Current selection · {modelValue} (not in current inventory)
          </PopoverItem>
        ) : null}
        {modelOptions.map((m) => (
          <PopoverItem
            key={m.id}
            checked={m.id === modelValue}
            title={m.id}
            onSelect={() => {
              if (m.id !== modelValue) onPickModel(m.id);
              onOpenChange(false);
            }}
          >
            {m.label === m.id ? m.id : `${m.label} · ${m.id}`}
          </PopoverItem>
        ))}
        {/* cave-pkapw: inside a session a model pick is session-scoped, so
            the familiar's default is untouched. This promotes it using the
            same PATCH a brand-new chat's pick already sends (scope
            "familiar-default", no sessionId). Shown only when the session
            model differs from that default — otherwise the action is a no-op
            and the row is noise. */}
        {promotableModel && onPromoteModelToDefault ? (
          <>
            <PopoverSeparator />
            <PopoverItem
              title={`New chats with this familiar will start on ${promotableModel}`}
              onSelect={() => {
                onPromoteModelToDefault();
                onOpenChange(false);
              }}
            >
              Set as default for new chats
            </PopoverItem>
          </>
        ) : null}
      </PopoverBody>
    </Popover>
  );
}

// ── Thinking / Speed menu ────────────────────────────────────────────────────

/** Controlled popover for one selected-model control. The rows are the
 *  capability's own reported values plus Auto (unset: nothing is sent). */
export function ComposerModelControlPopover({
  open,
  onOpenChange,
  anchorRef,
  placement = "top-start",
  capability,
  value,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  placement?: PopoverPlacement;
  capability: ModelControlCapability;
  value: string | undefined;
  onChange: (value: string | null) => void;
}) {
  const label = controlChipLabel(capability);
  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      anchorRef={anchorRef}
      placement={placement}
      minWidth={200}
      ariaLabel={label}
    >
      <PopoverBody role="menu" ariaLabel={label}>
        <PopoverLabel>{label} · {controlDeliveryNote(capability)}</PopoverLabel>
        <PopoverItem
          checked={!value}
          title="Leave the runtime and model on their own default"
          onSelect={() => {
            if (value) onChange(null);
            onOpenChange(false);
          }}
        >
          {CONTROL_AUTO_LABEL}
        </PopoverItem>
        {capability.values.map((option) => (
          <PopoverItem
            key={option.value}
            checked={option.value === value}
            onSelect={() => {
              if (option.value !== value) onChange(option.value);
              onOpenChange(false);
            }}
          >
            {option.label}
          </PopoverItem>
        ))}
      </PopoverBody>
    </Popover>
  );
}

/** Shared chip leading mark for a control chip. */
export function ControlChipIcon({ capability }: { capability: ModelControlCapability }) {
  return <Icon name={controlChipIcon(capability)} width={13} aria-hidden />;
}
