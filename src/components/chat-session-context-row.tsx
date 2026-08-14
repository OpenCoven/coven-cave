"use client";

// ── ChatSessionContextRow ─────────────────────────────────────────────────────
// The slim machine-readable band under the session title (Chat.dc.html 2a ③).
//
// Everything human — the title, the lifecycle verbs — stays in the header above
// in Inter/Garamond. Everything a machine decided lives here in mono: which
// project and branch the session runs against, which model answers, which
// working directory it runs in, and on the right, what the last run cost.
//
// Chips are honest: a fact with no value renders no chip (see chatContextChips).
// Only the project chip is interactive — it opens the same shared project
// picker the kebab uses, anchored to itself.

import { useRef, useState, type RefObject } from "react";

import { ProjectPickerPopover } from "@/components/project-picker";
import { Icon } from "@/lib/icon";
import {
  chatContextChips,
  chatContextStats,
  type ChatContextChip,
  type ChatContextStat,
  type ChatContextTurn,
} from "@/lib/chat-session-context";
import type { CaveProject } from "@/lib/cave-projects";
import type { TurnUsage } from "@/lib/usage-format";
import { Popover, PopoverBody } from "@/components/ui/popover";

function ChipBody({ chip }: { chip: ChatContextChip }) {
  return (
    <>
      <span className={`cave-chat-context-chip__glyph is-${chip.tint}`} aria-hidden>
        <Icon name={chip.icon} width={10} aria-hidden />
      </span>
      <span className="cave-chat-context-chip__key">{chip.label}</span>
      <span className="cave-chat-context-chip__value">{chip.value}</span>
    </>
  );
}

function StatBody({ stat }: { stat: ChatContextStat }) {
  // One tint class on the root; the dot, value and meter fill read it as a
  // custom property, so a new tint never has to be threaded through four
  // child class names.
  return (
    <>
      <span className="cave-chat-context-stat__dot" aria-hidden />
      <span className="cave-chat-context-stat__key">{stat.label}</span>
      <span className="cave-chat-context-stat__value">{stat.value}</span>
      {stat.percent != null ? (
        <span className="cave-chat-context-stat__meter" aria-hidden>
          <span
            className="cave-chat-context-stat__fill"
            style={{ width: `${Math.max(3, Math.min(100, stat.percent))}%` }}
          />
        </span>
      ) : null}
    </>
  );
}

function StatPopover({ stat }: { stat: ChatContextStat }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  if (!stat.detail) {
    return (
      <span className={`cave-chat-context-stat is-${stat.tint}`} title={stat.title}>
        <StatBody stat={stat} />
      </span>
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`cave-chat-context-stat cave-chat-context-stat--action focus-ring is-${stat.tint}`}
        title={stat.title}
        aria-label={`${stat.detail.heading} details`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <StatBody stat={stat} />
      </button>
      <Popover
        open={open}
        onOpenChange={setOpen}
        anchorRef={triggerRef}
        placement="bottom-end"
        minWidth={320}
        className="cave-chat-context-popover"
        ariaLabel={`${stat.detail.heading} details`}
      >
        <PopoverBody className="cave-chat-context-breakdown">
          <div className={`cave-chat-context-breakdown__heading is-${stat.tint}`}>
            <span className="cave-chat-context-stat__dot" aria-hidden />
            <span>{stat.detail.heading}</span>
            <span className="cave-chat-context-breakdown__total">{stat.value}</span>
          </div>
          {stat.id === "context" ? (
            <div className="cave-chat-context-breakdown__bar" aria-hidden>
              {stat.detail.rows.map((row) => (
                <span
                  key={row.id}
                  className={`cave-chat-context-breakdown__segment is-${row.tint}`}
                  style={{ width: `${Math.max(0, Math.min(100, row.percent ?? 0))}%` }}
                />
              ))}
            </div>
          ) : null}
          <div className="cave-chat-context-breakdown__rows">
            {stat.detail.rows.map((row) => (
              <div key={row.id} className={`cave-chat-context-breakdown__row is-${row.tint}`}>
                <span className="cave-chat-context-stat__dot" aria-hidden />
                <span className="cave-chat-context-breakdown__label">{row.label}</span>
                <span className="cave-chat-context-breakdown__value">{row.value}</span>
              </div>
            ))}
          </div>
          {stat.detail.note ? (
            <div className="cave-chat-context-breakdown__note">{stat.detail.note}</div>
          ) : null}
        </PopoverBody>
      </Popover>
    </>
  );
}

function StatCell({ stat }: { stat: ChatContextStat }) {
  return (
    <StatPopover stat={stat} />
  );
}

function ContextChip({
  chip,
  pickerAvailable,
  pickerOpen,
  projectRef,
  onToggleProject,
}: {
  chip: ChatContextChip;
  pickerAvailable: boolean;
  pickerOpen: boolean;
  projectRef: RefObject<HTMLButtonElement | null>;
  onToggleProject: () => void;
}) {
  if (chip.id === "project" && pickerAvailable) {
    return (
      <button
        ref={projectRef}
        type="button"
        className="cave-chat-context-chip cave-chat-context-chip--action focus-ring"
        title={`${chip.title} — click to change`}
        aria-haspopup="dialog"
        aria-expanded={pickerOpen}
        onClick={onToggleProject}
      >
        <ChipBody chip={chip} />
        <Icon name="ph:caret-down" width={8} aria-hidden />
      </button>
    );
  }

  return (
    <span className="cave-chat-context-chip" title={chip.title}>
      <ChipBody chip={chip} />
    </span>
  );
}

export function ChatSessionContextRow({
  projectName,
  projectRoot,
  runtime,
  harness,
  branch,
  model,
  turns,
  usage,
  costUsd,
  durationMs,
  projects = [],
  projectId = null,
  onProjectChange,
  onAddProject,
}: {
  projectName?: string | null;
  projectRoot?: string | null;
  runtime?: string | null;
  harness?: string | null;
  branch?: string | null;
  model?: string | null;
  turns?: ChatContextTurn[];
  usage?: TurnUsage;
  costUsd?: number;
  durationMs?: number;
  /** Enables the project chip's picker; without these it renders as a fact. */
  projects?: CaveProject[];
  projectId?: string | null;
  onProjectChange?: (value: string) => void;
  onAddProject?: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const projectRef = useRef<HTMLButtonElement | null>(null);
  const chips = chatContextChips({ projectName, projectRoot, runtime, harness, branch, model });
  const stats = chatContextStats({ turns, usage, costUsd, durationMs, model });
  // An empty row is chrome for nothing — a brand-new session with no project,
  // no branch and no run yet renders nothing at all.
  if (!chips.length && !stats.length) return null;
  const pickerAvailable = Boolean(onProjectChange) && (projects.length > 0 || Boolean(onAddProject));

  return (
    <div className="cave-chat-context-row" role="group" aria-label="Session context">
      <div className="cave-chat-context-row__chips">
        {chips.map((chip) => (
          <ContextChip
            key={chip.id}
            chip={chip}
            pickerAvailable={pickerAvailable}
            pickerOpen={pickerOpen}
            projectRef={projectRef}
            onToggleProject={() => setPickerOpen((value) => !value)}
          />
        ))}
      </div>
      <div className="cave-chat-context-row__stats">
        {stats.map((stat) => (
          <StatCell key={stat.id} stat={stat} />
        ))}
      </div>
      {pickerAvailable ? (
        <ProjectPickerPopover
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          anchorRef={projectRef}
          projects={projects}
          value={projectId}
          onChange={(value) => onProjectChange?.(value)}
          onAddProject={onAddProject}
          placement="bottom-start"
          ariaLabel="Project for this chat"
        />
      ) : null}
    </div>
  );
}
