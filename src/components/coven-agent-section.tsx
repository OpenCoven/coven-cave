"use client";

/**
 * AgentSection — one familiar's contribution to a run.
 *
 * Only rendered for familiars that have actually produced output: a queued
 * familiar lives in the run header's stepper, never as an empty pseudo-message
 * with a blinking caret (design proposal §2).
 */

import { useState, type ReactNode } from "react";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { MessageBubble } from "@/components/message-bubble";
import { HarnessFixActions } from "@/components/harness-fix-actions";
import { parseHarnessFailure } from "@/lib/harness-failure";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import { COVEN_RUN_STATUS, formatCovenDuration, type CovenRunAgent } from "@/lib/coven-run";
import { unrecognizedCovenBlocks } from "@/lib/coven-raw-output";
import type { NextPath } from "@/lib/next-paths";

/**
 * Tool activity: one quiet inset row, never a floating card.
 *
 * The stream carries tool *names* and the turn's duration but no tool output,
 * so this reports what ran and stops there — an expandable pane promising
 * output we never receive would be a disclosure that opens onto nothing.
 */
function ToolActivity({ agent }: { agent: CovenRunAgent }) {
  const calls = agent.reply.toolCalls ?? [];
  if (calls.length === 0) return null;
  const live = agent.status === "tool";
  const unique = [...new Set(calls)];
  const duration = agent.reply.durationMs ? ` · ${formatCovenDuration(agent.reply.durationMs)}` : "";
  return (
    <div className="coven-tool" data-live={live ? "true" : "false"}>
      <Icon name="ph:wrench" width={11} height={11} className="coven-tool__glyph" aria-hidden />
      <span className="coven-tool__label">{live ? "Running" : "Ran"}</span>
      <code className="coven-tool__cmd">{unique.join(", ")}</code>
      <span className="coven-tool__meta">
        {live ? "live…" : `${calls.length} call${calls.length === 1 ? "" : "s"}${duration}`}
      </span>
    </div>
  );
}

function RawOutputDisclosure({ blocks }: { blocks: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="coven-raw">
      <button
        type="button"
        className="coven-raw__toggle focus-ring"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="ph:warning" width={11} height={11} aria-hidden />
        Unrecognized structured block — kept out of the reply
        <span className="coven-raw__hint">{open ? "hide raw" : "view raw"}</span>
        <Icon
          name="ph:caret-down"
          width={10}
          height={10}
          className="coven-raw__chevron"
          data-open={open ? "true" : "false"}
          aria-hidden
        />
      </button>
      {open ? <pre className="coven-raw__body">{blocks.join("\n")}</pre> : null}
    </div>
  );
}

/** See the clamp note in {@link CovenAgentSection}. */
const CLAMP_MIN_CHARS = 200;

export type CovenSuggestion = { path: NextPath; onSelect: () => void };

/**
 * Typed suggestions (design proposal §10). The three kinds are visually
 * distinct so a destructive one never looks like a harmless one.
 */
function SuggestedActions({
  authorName,
  suggestions,
  disabled,
}: {
  authorName: string;
  suggestions: CovenSuggestion[];
  disabled: boolean;
}) {
  if (suggestions.length === 0) return null;
  return (
    <div className="coven-sugs">
      <span className="coven-sugs__kicker">Suggested by {authorName}</span>
      {/* The shared chip grid keys its uniform rows off data-count — a
          count-blind row pins 3+1 instead of 2+2. */}
      <div className="cave-next-paths coven-sugs__row" data-count={suggestions.length}>
        {suggestions.map(({ path, onSelect }, index) => (
          <button
            key={`${path.kind}:${index}`}
            type="button"
            className="coven-sug focus-ring"
            data-kind={path.kind}
            disabled={disabled}
            title={
              path.kind === "reply"
                ? "Sends as your next message to the coven"
                : "Opens the task board"
            }
            onClick={onSelect}
          >
            <Icon
              name={path.kind === "reply" ? "ph:arrow-bend-up-left" : "ph:arrow-square-out"}
              width={11}
              height={11}
              aria-hidden
            />
            {path.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function CovenAgentSection({
  agent,
  familiar,
  timestamp,
  hidden,
  /** A live turn elsewhere owns the viewport: settled prose soft-clamps. */
  clampable,
  showStop,
  onStop,
  onRetry,
  onSkip,
  onUseHarness,
  busy,
  visibleText,
  suggestions,
  mentionPills,
  onOpenUrl,
}: {
  agent: CovenRunAgent;
  familiar: ResolvedFamiliar | undefined;
  timestamp: string;
  hidden: boolean;
  clampable: boolean;
  showStop: boolean;
  onStop: () => void;
  onRetry: () => void;
  onSkip: (() => void) | null;
  onUseHarness: (runtime: string) => void;
  busy: boolean;
  visibleText: string;
  suggestions: CovenSuggestion[];
  mentionPills: ReactNode;
  onOpenUrl?: (url: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const meta = COVEN_RUN_STATUS[agent.status];
  const name = familiar?.display_name ?? agent.familiarId;
  const reply = agent.reply;
  const raw = unrecognizedCovenBlocks(reply.text);
  const settled = agent.status === "complete" || agent.status === "stopped";
  // Only clamp a reply long enough for clamping to buy anything.
  //
  // Decided from the text, not from layout: measuring the rendered box counts
  // the bubble's own hover chrome as "hidden content", so every settled reply
  // — including two-line ones that fit — reported an overflow and offered a
  // Show-full control that revealed nothing. Two lines of the ~50rem reading
  // measure is roughly 190 characters, so anything under that is already short
  // enough to leave alone; erring toward NOT clamping keeps the failure mode
  // "nothing was hidden" rather than "a control that lies".
  const clamped = clampable && settled && !expanded && visibleText.length > CLAMP_MIN_CHARS;
  const note =
    agent.status === "thinking"
      ? reply.activity ?? "Analyzing the prompt…"
      : agent.status === "stopped" && !visibleText.trim()
        ? "Stopped before the first token."
        : null;

  return (
    <section className="coven-section" data-hidden={hidden ? "true" : "false"} aria-hidden={hidden}>
      <div className="coven-section__head">
        <div className="coven-section__avatar" data-live={meta.live ? "true" : "false"}>
          {familiar ? (
            <FamiliarAvatar familiar={familiar} size="lg" title={name} />
          ) : (
            <Icon name="ph:sparkle" width={16} height={16} aria-hidden />
          )}
        </div>
        <span className="coven-section__name" title={familiar?.role}>
          {name}
        </span>
        <span
          className="coven-chip"
          data-tone={meta.tone}
          data-live={meta.live ? "true" : "false"}
          role="status"
          title={reply.activity ? `${meta.label} — ${reply.activity}` : meta.label}
        >
          <Icon name={meta.icon} width={10} height={10} aria-hidden />
          {meta.label}
        </span>
        <span className="coven-section__trail">
          <time className="coven-section__time" dateTime={reply.createdAt}>
            {timestamp}
          </time>
          {showStop ? (
            <button
              type="button"
              className="coven-section__stop focus-ring"
              title={`Stop ${name} — keeps what streamed`}
              onClick={onStop}
            >
              <Icon name="ph:stop-fill" width={8} height={8} aria-hidden />
              Stop
            </button>
          ) : null}
          {settled ? (
            <button
              type="button"
              className="coven-section__collapse focus-ring"
              aria-expanded={!collapsed}
              aria-label={`${collapsed ? "Expand" : "Collapse"} ${name}'s reply`}
              onClick={() => setCollapsed((value) => !value)}
            >
              <Icon
                name="ph:caret-down"
                width={10}
                height={10}
                className="coven-section__chevron"
                data-collapsed={collapsed ? "true" : "false"}
                aria-hidden
              />
            </button>
          ) : null}
        </span>
      </div>

      {collapsed ? null : (
        <div className="coven-section__body">
          <ToolActivity agent={agent} />
          {mentionPills}
          {note ? <p className="coven-section__note">{note}</p> : null}
          {visibleText.trim() ? (
            <div className="coven-section__prose" data-clamped={clamped ? "true" : "false"}>
              <MessageBubble
                role="assistant"
                label={name}
                content={visibleText}
                pending={agent.status === "streaming"}
                timestamp={reply.createdAt}
                showTimestamp={false}
                onOpenUrl={onOpenUrl}
              />
            </div>
          ) : null}
          {clamped ? (
            <button
              type="button"
              className="coven-section__more focus-ring"
              onClick={() => setExpanded(true)}
            >
              Show full reply
            </button>
          ) : null}

          {raw.length > 0 ? <RawOutputDisclosure blocks={raw} /> : null}

          {agent.status === "failed" ? (
            <div className="coven-failure" role="alert">
              <p className="coven-failure__title">
                <Icon name="ph:warning" width={13} height={13} aria-hidden />
                {name} failed
              </p>
              {/* The reason is mandatory: a failure card without one tells the
                  reader nothing they can act on. */}
              <p className="coven-failure__body">{reply.error ?? "The turn ended without a reply."}</p>
              <div className="coven-failure__actions">
                <Button size="xs" variant="primary" leadingIcon="ph:arrow-clockwise" onClick={onRetry} disabled={busy}>
                  Retry {name}
                </Button>
                {onSkip ? (
                  <Button size="xs" variant="secondary" onClick={onSkip} disabled={busy}>
                    Skip
                  </Button>
                ) : null}
                {(() => {
                  const failure = parseHarnessFailure(reply.error);
                  return failure ? (
                    <HarnessFixActions failure={failure} busy={busy} onUseHarness={onUseHarness} />
                  ) : null;
                })()}
              </div>
            </div>
          ) : null}

          <SuggestedActions authorName={name} suggestions={suggestions} disabled={busy} />
        </div>
      )}
    </section>
  );
}

export default CovenAgentSection;
