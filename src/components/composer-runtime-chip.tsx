"use client";

import "@/styles/cave-composer.css";

// ComposerRuntimeChip — the always-visible "what will answer me" chip in the
// chat composer: the active runtime's logo + the effective model, clickable
// to switch either. Runtime picks are familiar-level (the same /api/config
// contract the home composer's selectRuntime uses) and apply from the next
// send — the send route re-resolves the binding from current config per turn.
// Mirrors ComposerHostChip's trigger + Popover conventions.

import { useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import {
  Popover,
  PopoverBody,
  PopoverItem,
  PopoverLabel,
  PopoverSeparator,
} from "@/components/ui/popover";
import { RUNTIME_MODEL_CATALOG, type RuntimeModelOption } from "@/lib/runtime-models";
import { RuntimeLogo, runtimeDisplayName } from "@/components/runtime-logo";
import "@/styles/composer-runtime-chip.css";

/** The effective label a runtime+model pair displays: the curated model label,
 *  a trailing path segment for custom ids, or null (runtime-only adapters). */
export function runtimeModelLabel(
  modelValue: string,
  modelOptions: RuntimeModelOption[],
): string | null {
  return (
    modelOptions.find((m) => m.id === modelValue)?.label ??
    (modelValue ? modelValue.split("/").pop() ?? modelValue : null)
  );
}

/** Controlled Runtime · Model popover — the menu half of the chip, anchored to
 *  any caller-owned trigger (the chip below, or the composer context pill). */
export function ComposerRuntimePopover({
  open,
  onOpenChange,
  anchorRef,
  runtime,
  modelValue,
  modelOptions,
  onPickRuntime,
  onPickModel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  runtime: string;
  modelValue: string;
  modelOptions: RuntimeModelOption[];
  onPickRuntime: (runtime: string) => void;
  onPickModel: (id: string) => void;
}) {
  const setOpen = onOpenChange;
  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      anchorRef={anchorRef}
      placement="top-start"
      minWidth={230}
      ariaLabel="Runtime and model"
    >
        <PopoverBody role="menu" ariaLabel="Runtime and model">
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
                if (catalog.runtime !== runtime) onPickRuntime(catalog.runtime);
                // Keep the menu open so the model pick completes the switch in
                // one visit — the Model group re-renders for the new runtime.
                // Menu-less runtimes (hermes/openclaw) have no model step, so
                // the pick is complete and the menu closes.
                if (catalog.models.length === 0) setOpen(false);
              }}
            >
              {runtimeDisplayName(catalog.runtime)}
            </PopoverItem>
          ))}
          {modelOptions.length > 0 && (
            <>
              <PopoverSeparator />
              <PopoverLabel>Model</PopoverLabel>
              {modelOptions.map((m) => (
                <PopoverItem
                  key={m.id}
                  checked={m.id === modelValue}
                  title={m.id}
                  onSelect={() => {
                    if (m.id !== modelValue) onPickModel(m.id);
                    setOpen(false);
                  }}
                >
                  {m.label}
                </PopoverItem>
              ))}
            </>
          )}
        </PopoverBody>
    </Popover>
  );
}

export function ComposerRuntimeChip({
  runtime,
  modelValue,
  modelOptions,
  onPickRuntime,
  onPickModel,
  disabled,
}: {
  /** Active runtime (harness id): codex | claude | copilot | hermes | openclaw. */
  runtime: string;
  /** Effective model id ("" when the runtime has no curated models). */
  modelValue: string;
  /** Curated models for the active runtime (catalogForRuntime). */
  modelOptions: RuntimeModelOption[];
  onPickRuntime: (runtime: string) => void;
  onPickModel: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);

  const runtimeName = runtimeDisplayName(runtime);
  // The chip shows the model when the runtime has one, else the runtime name
  // alone — hermes/openclaw run their own adapters without a curated menu.
  const modelLabel = runtimeModelLabel(modelValue, modelOptions);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="cave-composer-select cave-composer-runtime-chip"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Runtime: ${runtimeName}${modelLabel ? ` · Model: ${modelLabel}` : ""}`}
        title={`Runtime: ${runtimeName}${modelLabel ? ` · Model: ${modelLabel}` : ""}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="cave-runtime-chip__logo" aria-hidden>
          <RuntimeLogo runtime={runtime} size={13} />
        </span>
        <span className="cave-composer-select__value">{modelLabel ?? runtimeName}</span>
        <Icon name="ph:caret-down-bold" width={10} aria-hidden className="cave-composer-select__chevron" />
      </button>
      <ComposerRuntimePopover
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        runtime={runtime}
        modelValue={modelValue}
        modelOptions={modelOptions}
        onPickRuntime={onPickRuntime}
        onPickModel={onPickModel}
      />
    </>
  );
}
