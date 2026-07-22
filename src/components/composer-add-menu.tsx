"use client";

import "@/styles/cave-composer.css";

// ComposerAddMenu — the shared hierarchical "+" menu body (chat + home
// composers). Mirrors the reference design's cascade: attach on top, then
// "Add to project ›", "Add from GitHub", and Skills/Connectors flyouts, with
// the relocated legacy utilities (dictation, call, snippets, Model & tuning,
// enhance) grouped below. Hosts own the trigger button and Popover shell —
// this renders only the menu content, so chat keeps its indicator/summary
// trigger and chained pickers while home keeps its options-panel anchor.
//
// Skills/connectors data loads lazily on first open (useComposerSkills /
// useComposerConnectors); picking a skill inserts `/skill <id> ` into the
// composer for argument editing (the host wires onPickSkill → setText/focus).

import { type ReactNode } from "react";
import { Icon, type IconName } from "@/lib/icon";
import { PopoverSeparator, PopoverSubmenu } from "@/components/ui/popover";
import { ENHANCE_INTENTS, type EnhanceIntent } from "@/lib/prompt-enhancer";
import {
  useComposerConnectors,
  useComposerSkills,
} from "@/lib/composer-add-menu-data";
import type { SkillOption } from "@/lib/slash-skill";
import { CHAT_OPEN_SKILLS_EVENT, markSkillsTabPending } from "@/lib/chat-tab-events";

/** Route "Browse skills" / "Manage connectors" to the Marketplace surface. */
function openMarketplace() {
  window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "marketplace" } }));
}

/** Route "Manage skills" to Chat's Skills tab (familiar scope). Latch-then-
 *  event, same shape as the Workspace's coven-tab handoff, so a fresh-mounting
 *  ChatSurface still lands on the right tab. */
function openSkillsTab() {
  markSkillsTabPending();
  window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "chat" } }));
  window.setTimeout(() => window.dispatchEvent(new CustomEvent(CHAT_OPEN_SKILLS_EVENT)), 0);
}

/** Menu row: icon · label · trailing hint. Same classes as the original
 *  ComposerPlusMenu rows so the existing cave-composer.css styling carries. */
export function AddMenuRow({
  icon,
  label,
  hint,
  disabled,
  onSelect,
  ariaLabel,
  ariaPressed,
  role = "menuitem",
  checked,
  live,
  title,
}: {
  icon: IconName;
  label: ReactNode;
  /** Trailing shortcut hint, monospace muted (e.g. "⌘⇧A" or "/"). */
  hint?: string;
  disabled?: boolean;
  onSelect: () => void;
  ariaLabel?: string;
  /** Toggle items (dictation) keep their pressed state for AT parity. */
  ariaPressed?: boolean;
  role?: "menuitem" | "menuitemcheckbox" | "menuitemradio";
  checked?: boolean;
  /** Accent-pulses the icon (live dictation / enhancing). */
  live?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      className="ui-popover-item composer-plus__item"
      role={role}
      aria-checked={role === "menuitem" ? undefined : checked}
      aria-pressed={ariaPressed}
      aria-label={ariaLabel}
      disabled={disabled}
      title={title}
      onClick={onSelect}
    >
      <Icon
        name={icon}
        width={14}
        aria-hidden
        className={live ? "composer-plus__icon--live" : undefined}
      />
      <span className="composer-plus__item-label">{label}</span>
      {hint ? (
        <span className="composer-plus__hint" aria-hidden>
          {hint}
        </span>
      ) : null}
      {role !== "menuitem" && checked ? (
        <Icon name="ph:check" width={12} aria-hidden />
      ) : null}
    </button>
  );
}

function MenuNote({ children }: { children: ReactNode }) {
  return <div className="composer-add__note">{children}</div>;
}

export type AddMenuProjectsSection = {
  /** Pre-sorted list (hosts own ordering). */
  projects: Array<{ id: string; name: string }>;
  /** Currently selected project id (or the no-project id / null). */
  selectedId: string | null;
  onPick: (id: string) => void;
  /** When set, renders a "No project" choice bound to this id. */
  noProjectId?: string;
  onStartNewProject?: () => void;
};

export type AddMenuLegacySection = {
  /** Omit when no ears engine exists — mirrors the old mic's render gate. */
  dictation?: {
    listening: boolean;
    toggle: () => void;
    disabled?: boolean;
  };
  /** Voice call — omit when the surface has no call affordance. */
  call?: {
    onSelect: () => void;
    disabled?: boolean;
  };
  promptSnippets?: {
    onSelect: () => void;
    disabled?: boolean;
  };
  /** Opens the existing composer options panel ("Model & tuning…"). */
  onOpenModelTuning?: () => void;
  /** One-click smart enhance + an intents flyout (the old split control). */
  enhance?: {
    onEnhance: (intent: EnhanceIntent) => void;
    disabled?: boolean;
    loading?: boolean;
  };
};

export function ComposerAddMenu({
  open,
  onClose,
  attach,
  projects,
  github,
  skills,
  connectors,
  legacy,
  footer,
}: {
  /** Host popover's open state — gates the lazy skills/connectors fetches. */
  open: boolean;
  /** Close the host popover (called before every leaf action). */
  onClose: () => void;
  attach: {
    onSelect: () => void;
    disabled?: boolean;
    /** Platform-aware shortcut hint (e.g. "⌘⇧A"). */
    hint?: string;
  };
  projects?: AddMenuProjectsSection;
  /** "Add from GitHub" — either a plain row (onSelect) or a flyout hosting
   *  the chat's linked-work rows (submenu). */
  github?:
    | {
        onSelect: () => void;
        disabled?: boolean;
      }
    | { submenu: ReactNode };
  skills?: {
    /** Insert `/skill <id> ` into the composer for argument editing. */
    onPickSkill: (skill: SkillOption) => void;
  };
  connectors?: boolean;
  legacy?: AddMenuLegacySection;
  /** Surface-specific rows appended below the legacy group (chat: Model &
   *  tuning, Branch, Response options). */
  footer?: ReactNode;
}) {
  const skillData = useComposerSkills(open && Boolean(skills));
  const connectorData = useComposerConnectors(open && Boolean(connectors));

  return (
    <>
      <AddMenuRow
        icon="ph:paperclip"
        label="Add files or photos"
        hint={attach.hint}
        ariaLabel="Attach images, videos, or files"
        disabled={attach.disabled}
        onSelect={() => {
          onClose();
          attach.onSelect();
        }}
      />
      {projects ? (
        <PopoverSubmenu icon="ph:archive" label="Add to project" minWidth={220}>
          {projects.projects.length === 0 ? (
            <MenuNote>No projects yet.</MenuNote>
          ) : (
            projects.projects.map((p) => (
              <AddMenuRow
                key={p.id}
                icon="ph:folder"
                label={p.name}
                role="menuitemradio"
                checked={projects.selectedId === p.id}
                onSelect={() => {
                  onClose();
                  projects.onPick(p.id);
                }}
              />
            ))
          )}
          {projects.noProjectId ? (
            <AddMenuRow
              icon="ph:folder-simple-dashed"
              label="No project"
              role="menuitemradio"
              checked={projects.selectedId === projects.noProjectId}
              onSelect={() => {
                onClose();
                projects.onPick(projects.noProjectId!);
              }}
            />
          ) : null}
          {projects.onStartNewProject ? (
            <>
              <PopoverSeparator />
              <AddMenuRow
                icon="ph:plus"
                label="Start a new project"
                onSelect={() => {
                  onClose();
                  projects.onStartNewProject!();
                }}
              />
            </>
          ) : null}
        </PopoverSubmenu>
      ) : null}
      {github ? (
        "submenu" in github ? (
          <PopoverSubmenu icon="ph:github-logo" label="Add from GitHub" minWidth={260}>
            {github.submenu}
          </PopoverSubmenu>
        ) : (
          <AddMenuRow
            icon="ph:github-logo"
            label="Add from GitHub"
            disabled={github.disabled}
            onSelect={() => {
              onClose();
              github.onSelect();
            }}
          />
        )
      ) : null}
      {skills || connectors ? <PopoverSeparator /> : null}
      {skills ? (
        <PopoverSubmenu icon="ph:puzzle-piece" label="Skills" minWidth={230}>
          {skillData.loading ? <MenuNote>Loading skills…</MenuNote> : null}
          {skillData.loaded && skillData.skills.length === 0 ? (
            <MenuNote>No skills installed yet.</MenuNote>
          ) : null}
          {skillData.skills.map((s) => (
            <AddMenuRow
              key={s.id}
              icon="ph:puzzle-piece"
              label={s.name || s.id}
              title={s.description}
              onSelect={() => {
                onClose();
                skills.onPickSkill(s);
              }}
            />
          ))}
          <PopoverSeparator />
          <AddMenuRow
            icon="ph:wrench"
            label="Manage skills"
            onSelect={() => {
              onClose();
              openSkillsTab();
            }}
          />
          <AddMenuRow
            icon="ph:storefront"
            label="Browse skills"
            onSelect={() => {
              onClose();
              openMarketplace();
            }}
          />
        </PopoverSubmenu>
      ) : null}
      {connectors ? (
        <PopoverSubmenu icon="ph:plugs" label="Connectors" minWidth={230}>
          {connectorData.loading ? <MenuNote>Loading connectors…</MenuNote> : null}
          {connectorData.loaded && connectorData.connectors.length === 0 ? (
            <MenuNote>No connectors configured yet.</MenuNote>
          ) : null}
          {connectorData.connectors.map((c) => (
            <AddMenuRow
              key={c.id}
              icon="ph:plug"
              label={c.id}
              hint={c.transport}
              title={c.target}
              onSelect={() => {
                onClose();
                openMarketplace();
              }}
            />
          ))}
          <PopoverSeparator />
          <AddMenuRow
            icon="ph:wrench"
            label="Manage connectors"
            onSelect={() => {
              onClose();
              openMarketplace();
            }}
          />
        </PopoverSubmenu>
      ) : null}
      {legacy ? (
        <>
          <PopoverSeparator />
          {legacy.dictation ? (
            <AddMenuRow
              icon="ph:microphone"
              label={legacy.dictation.listening ? "Stop dictation" : "Voice message"}
              role="menuitemcheckbox"
              checked={legacy.dictation.listening}
              ariaLabel={legacy.dictation.listening ? "Stop dictation" : "Dictate your message"}
              ariaPressed={legacy.dictation.listening}
              live={legacy.dictation.listening}
              disabled={legacy.dictation.disabled}
              onSelect={() => {
                onClose();
                legacy.dictation!.toggle();
              }}
            />
          ) : null}
          {legacy.call ? (
            <AddMenuRow
              icon="ph:phone"
              label="Start a call"
              ariaLabel="Voice call"
              disabled={legacy.call.disabled}
              onSelect={() => {
                onClose();
                legacy.call!.onSelect();
              }}
            />
          ) : null}
          {legacy.promptSnippets ? (
            <AddMenuRow
              icon="ph:chat-centered-text"
              label="Prompt snippets"
              hint="/"
              disabled={legacy.promptSnippets.disabled}
              onSelect={() => {
                onClose();
                legacy.promptSnippets!.onSelect();
              }}
            />
          ) : null}
          {legacy.onOpenModelTuning ? (
            <AddMenuRow
              icon="ph:sliders-horizontal"
              label="Model & tuning…"
              onSelect={() => {
                onClose();
                legacy.onOpenModelTuning!();
              }}
            />
          ) : null}
          {legacy.enhance ? (
            <>
              {/* Same split semantics the old sparkle control had: the main
                  item is one-click smart enhance; the flyout carries the
                  intent list (Clarify, Expand, …) — a true submenu now
                  instead of the old in-place view swap. */}
              <AddMenuRow
                icon="ph:sparkle"
                label={legacy.enhance.loading ? "Enhancing…" : "Enhance prompt"}
                live={legacy.enhance.loading}
                disabled={legacy.enhance.disabled && !legacy.enhance.loading}
                onSelect={() => {
                  onClose();
                  legacy.enhance!.onEnhance("auto");
                }}
              />
              <PopoverSubmenu
                icon="ph:sparkle-bold"
                label="Enhance options"
                disabled={legacy.enhance.disabled && !legacy.enhance.loading}
                minWidth={200}
              >
                {ENHANCE_INTENTS.map((intent) => (
                  <AddMenuRow
                    key={intent.id}
                    icon="ph:sparkle"
                    label={intent.label}
                    disabled={legacy.enhance!.disabled && !legacy.enhance!.loading}
                    onSelect={() => {
                      onClose();
                      legacy.enhance!.onEnhance(intent.id);
                    }}
                  />
                ))}
              </PopoverSubmenu>
            </>
          ) : null}
        </>
      ) : null}
      {footer}
    </>
  );
}
