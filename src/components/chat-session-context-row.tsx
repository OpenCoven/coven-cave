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

import { useRef, useState } from "react";

import { ProjectPickerPopover } from "@/components/project-picker";
import { Icon } from "@/lib/icon";
import {
  chatContextChips,
  chatContextStats,
  type ChatContextChip,
  type ChatContextStat,
} from "@/lib/chat-session-context";
import type { CaveProject } from "@/lib/cave-projects";
import type { TurnUsage } from "@/lib/usage-format";

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

function StatCell({ stat }: { stat: ChatContextStat }) {
  return (
    <span className="cave-chat-context-stat" title={stat.title}>
      <span className={`cave-chat-context-stat__dot is-${stat.tint}`} aria-hidden />
      <span className="cave-chat-context-stat__key">{stat.label}</span>
      <span className={`cave-chat-context-stat__value is-${stat.tint}`}>{stat.value}</span>
      {stat.percent != null ? (
        <span className="cave-chat-context-stat__meter" aria-hidden>
          <span
            className={`cave-chat-context-stat__fill is-${stat.tint}`}
            style={{ width: `${Math.max(3, Math.min(100, stat.percent))}%` }}
          />
        </span>
      ) : null}
    </span>
  );
}

export function ChatSessionContextRow({
  projectName,
  projectRoot,
  runtime,
  branch,
  model,
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
  branch?: string | null;
  model?: string | null;
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
  const chips = chatContextChips({ projectName, projectRoot, runtime, branch, model });
  const stats = chatContextStats({ usage, costUsd, durationMs, model });
  // An empty row is chrome for nothing — a brand-new session with no project,
  // no branch and no run yet renders nothing at all.
  if (!chips.length && !stats.length) return null;
  const pickerAvailable = Boolean(onProjectChange) && (projects.length > 0 || Boolean(onAddProject));

  return (
    <div className="cave-chat-context-row" aria-label="Session context">
      <div className="cave-chat-context-row__chips">
        {chips.map((chip) =>
          chip.id === "project" && pickerAvailable ? (
            <button
              key={chip.id}
              ref={projectRef}
              type="button"
              className="cave-chat-context-chip cave-chat-context-chip--action focus-ring"
              title={`${chip.title} — click to change`}
              aria-haspopup="dialog"
              aria-expanded={pickerOpen}
              onClick={() => setPickerOpen((v) => !v)}
            >
              <ChipBody chip={chip} />
              <Icon name="ph:caret-down" width={8} aria-hidden />
            </button>
          ) : (
            <span key={chip.id} className="cave-chat-context-chip" title={chip.title}>
              <ChipBody chip={chip} />
            </span>
          ),
        )}
      </div>
      <span className="cave-chat-context-row__spacer" />
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
