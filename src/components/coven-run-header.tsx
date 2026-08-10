"use client";

/**
 * RunStatusHeader — the sticky strip that owns a run's orchestration story.
 *
 * Mode, the ordered agent sequence with each familiar's live status, progress,
 * elapsed time, Pause and a scoped Stop, all in one place at the top of the run
 * and visible while the transcript scrolls beneath it. Before this, those
 * answers were scattered across the page in prose (design proposal §2).
 */

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { Popover, PopoverBody, PopoverItem } from "@/components/ui/popover";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import {
  COVEN_RUN_STATUS,
  covenModeIcon,
  covenModeLabel,
  covenRunElapsedMs,
  covenRunProgressLabel,
  formatCovenDuration,
  type CovenRun,
  type CovenRunAgent,
} from "@/lib/coven-run";
import { covenStopItems, type CovenStopScope } from "@/lib/coven-stop-scope";

/**
 * A live run's elapsed time, ticked once a second.
 *
 * Kept inside the header so the per-second update repaints one strip rather
 * than the whole transcript, and derived from the persisted timestamps so a
 * settled run reads the same after a reload as it did when it finished.
 */
function useCovenElapsed(run: CovenRun): string {
  const [now, setNow] = useState(() => Date.now());
  const active = run.active;
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  if (!active) return formatCovenDuration(covenRunElapsedMs(run.agents.map((a) => a.reply)));
  const starts = run.agents
    .map((a) => Date.parse(a.reply.createdAt))
    .filter((value) => Number.isFinite(value));
  if (starts.length === 0) return formatCovenDuration(0);
  return formatCovenDuration(now - Math.min(...starts));
}

function AgentStep({
  agent,
  familiar,
  showArrow,
  focused,
  paused,
  onFocus,
}: {
  agent: CovenRunAgent;
  familiar: ResolvedFamiliar | undefined;
  showArrow: boolean;
  focused: boolean;
  paused: boolean;
  onFocus: () => void;
}) {
  const meta = COVEN_RUN_STATUS[agent.status];
  const name = familiar?.display_name ?? agent.familiarId;
  const detail = agent.reply.activity ? ` · ${agent.reply.activity}` : "";
  // Authoritative accessible name. The visible name is `display: none` below
  // 960px, which removes it from the accessibility tree — without this the chip
  // would announce only its status at exactly the widths where the visual label
  // is already gone.
  const label = focused
    ? `${name} — ${meta.label} · focused — click to show all`
    : `${name} — ${meta.label}${detail} · click to focus their replies`;
  return (
    <li className="coven-step">
      {showArrow ? (
        <Icon name="ph:caret-right" width={10} height={10} className="coven-step__arrow" aria-hidden />
      ) : null}
      <button
        type="button"
        className="coven-step__chip focus-ring"
        data-tone={meta.tone}
        data-live={meta.live && !paused ? "true" : "false"}
        aria-pressed={focused}
        aria-label={label}
        title={label}
        onClick={onFocus}
      >
        {familiar ? (
          <FamiliarAvatar familiar={familiar} size="sm" className="coven-step__avatar" />
        ) : (
          <span className="coven-step__avatar" aria-hidden />
        )}
        <span className="coven-step__name">{name}</span>
        <Icon name={meta.icon} width={11} height={11} className="coven-step__glyph" aria-hidden />
      </button>
    </li>
  );
}

export function CovenRunHeader({
  run,
  byId,
  focusId,
  onFocus,
  paused,
  pausePending,
  onPause,
  onResume,
  onStop,
}: {
  run: CovenRun;
  byId: Map<string, ResolvedFamiliar>;
  focusId: string | null;
  onFocus: (familiarId: string | null) => void;
  paused: boolean;
  /** Pause requested; the current reply is still finishing. */
  pausePending: boolean;
  onPause: () => void;
  onResume: () => void;
  onStop: (scope: CovenStopScope) => void;
}) {
  const [stopOpen, setStopOpen] = useState(false);
  const stopRef = useRef<HTMLButtonElement | null>(null);
  const elapsed = useCovenElapsed(run);
  const roundRobin = run.mode === "round-robin";
  const current = run.agents.find((agent) => COVEN_RUN_STATUS[agent.status].live);
  const currentName = current ? byId.get(current.familiarId)?.display_name ?? current.familiarId : null;
  const stopItems = covenStopItems({
    mode: run.mode,
    currentName,
    hasQueued: run.counts.queued > 0,
  });
  const progress = covenRunProgressLabel(run, { paused });

  return (
    <div className="coven-run__header">
      <span className="coven-run__mode" title={
        roundRobin
          ? "Round robin — one familiar at a time, in roster order"
          : "Broadcast — all familiars at once"
      }>
        <Icon name={covenModeIcon(run.mode)} width={12} height={12} aria-hidden />
        {covenModeLabel(run.mode)}
      </span>

      <ul className="coven-run__sequence" aria-label="Agent sequence">
        {run.agents.map((agent, index) => (
          <AgentStep
            key={agent.reply.id}
            agent={agent}
            familiar={byId.get(agent.familiarId)}
            showArrow={roundRobin && index > 0}
            focused={focusId === agent.familiarId}
            paused={paused}
            onFocus={() => onFocus(focusId === agent.familiarId ? null : agent.familiarId)}
          />
        ))}
      </ul>

      {/* Agent-level transitions only — never a token-by-token announcement. */}
      <span className="coven-run__progress" aria-live="polite">{progress}</span>

      <span className="coven-run__controls">
        <span className="coven-run__elapsed" title="Elapsed">{elapsed}</span>
        {run.active ? (
          <>
            {roundRobin && (paused || run.counts.queued > 0) ? (
              <button
                type="button"
                className="coven-run__control focus-ring"
                data-armed={paused || pausePending ? "true" : "false"}
                title={
                  paused
                    ? "Resume the queue"
                    : "Finish the current reply, then hold the queue"
                }
                onClick={paused ? onResume : onPause}
              >
                <Icon
                  name={paused ? "ph:play-fill" : "ph:pause-fill"}
                  width={10}
                  height={10}
                  aria-hidden
                />
                {paused ? "Resume" : pausePending ? "Pausing…" : "Pause"}
              </button>
            ) : null}
            <button
              ref={stopRef}
              type="button"
              className="coven-run__control coven-run__control--stop focus-ring"
              aria-haspopup="menu"
              aria-expanded={stopOpen}
              onClick={() => setStopOpen((open) => !open)}
            >
              <Icon name="ph:stop-fill" width={9} height={9} aria-hidden />
              Stop
              <Icon name="ph:caret-down" width={9} height={9} aria-hidden />
            </button>
            <Popover
              open={stopOpen}
              onOpenChange={setStopOpen}
              anchorRef={stopRef}
              placement="bottom-end"
              ariaLabel="Stop this run"
              minWidth={252}
            >
              {/* No confirmation dialog: every scope keeps its output, so a
                  second click would be friction without safety. The copy is
                  the warning. */}
              <PopoverBody role="menu" ariaLabel="Stop this run">
                {stopItems.map((item) => (
                  <PopoverItem
                    key={item.scope}
                    danger={item.danger}
                    onSelect={() => {
                      setStopOpen(false);
                      onStop(item.scope);
                    }}
                  >
                    <span className="coven-stop__item">
                      <span className="coven-stop__label">{item.label}</span>
                      <span className="coven-stop__detail">{item.detail}</span>
                    </span>
                  </PopoverItem>
                ))}
              </PopoverBody>
            </Popover>
          </>
        ) : null}
      </span>
    </div>
  );
}

export default CovenRunHeader;
