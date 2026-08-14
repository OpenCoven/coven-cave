"use client";

import "@/styles/cave-composer.css";

// ComposerPlusMenu — the home composer's single resting utility control: a
// 30px "+" button whose popover now renders the shared hierarchical
// ComposerAddMenu (attach · Add to project › · Skills › · Connectors › ·
// legacy utilities below). Each relocated item keeps the exact behavior of
// the standalone control it replaced (disabled logic, dictation
// aria-pressed, voice-call mint guards). "Model & tuning…" chains to the
// existing ComposerOptionsMenu popover, which the host anchors to this same
// trigger via `triggerRef`.

import { useRef, useState, type RefObject } from "react";
import { Icon } from "@/lib/icon";
import { Popover, PopoverBody } from "@/components/ui/popover";
import {
  ComposerAddMenu,
  type AddMenuLegacySection,
  type AddMenuProjectsSection,
} from "@/components/composer-add-menu";
import type { SkillOption } from "@/lib/slash-skill";
import type { EnhanceIntent } from "@/lib/prompt-enhancer";

export function ComposerPlusMenu({
  triggerRef,
  disabled,
  attach,
  projects,
  skills,
  connectors,
  dictation,
  call,
  promptSnippets,
  enhance,
  onOpenModelTuning,
}: {
  /** Shared anchor ref so the host can chain the Model & tuning popover
   *  (ComposerOptionsMenu) to the same trigger. */
  triggerRef?: RefObject<HTMLButtonElement | null>;
  disabled?: boolean;
  attach: {
    onSelect: () => void;
    disabled?: boolean;
    /** Platform-aware shortcut hint (e.g. "⌘⇧A"). */
    hint?: string;
  };
  /** "Add to project ›" flyout — mirrors the footer-band context chips. */
  projects?: AddMenuProjectsSection;
  /** Skills flyout; picking inserts `/skill <id> ` into the composer. */
  skills?: { onPickSkill: (skill: SkillOption) => void };
  /** Connectors (MCP registry) flyout. */
  connectors?: boolean;
  dictation?: AddMenuLegacySection["dictation"];
  call?: AddMenuLegacySection["call"];
  promptSnippets?: {
    onSelect: () => void;
    disabled?: boolean;
  };
  enhance?: {
    onEnhance: (intent: EnhanceIntent) => void;
    disabled?: boolean;
    loading?: boolean;
  };
  /** Opens the existing composer options panel ("Model & tuning…"). */
  onOpenModelTuning: () => void;
}) {
  const [open, setOpen] = useState(false);
  const internalRef = useRef<HTMLButtonElement | null>(null);
  const anchorRef = triggerRef ?? internalRef;

  const close = () => setOpen(false);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="cave-composer-plus focus-ring"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Composer actions"
        title="Attach, projects, skills, and tuning"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="ph:plus" width={15} aria-hidden />
      </button>
      <Popover
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        placement="top-start"
        minWidth={236}
        ariaLabel="Composer actions"
        className="composer-plus__panel"
      >
        <PopoverBody role="menu" ariaLabel="Composer actions">
          <ComposerAddMenu
            open={open}
            onClose={close}
            attach={attach}
            projects={projects}
            skills={skills}
            connectors={connectors}
            legacy={{
              dictation,
              call,
              promptSnippets,
              onOpenModelTuning,
              enhance,
            }}
          />
        </PopoverBody>
      </Popover>
    </>
  );
}
