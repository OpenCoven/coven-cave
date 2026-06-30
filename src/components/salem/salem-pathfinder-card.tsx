"use client";

import { useState } from "react";
import { Icon } from "@/lib/icon";
import { copyText } from "@/lib/clipboard";
import type { IconName } from "@/lib/icon";
import { sanitizeCard } from "@/lib/salem/pathfinder-card";
import type { SalemPathfinderAction, SalemPathfinderCard } from "@/lib/salem/pathfinder-types";
import { openExternalUrl } from "@/lib/open-external";

// Renders a deterministic Salem pathfinder card in Cave's operational UI
// language: a compact card with a why-line, a numbered checklist (copyable
// commands), links, blockers, and one primary + lower-emphasis secondary
// actions. `density:"slim"` (setup) hides links/blockers so the user stays in
// place; `density:"full"` (home) shows everything. Emoji-free — icons only.

type Props = {
  card: SalemPathfinderCard;
  density?: "full" | "slim";
  /** cave-route action. Falls back to in-app hash/href navigation if omitted. */
  onRoute?: (target: string) => void;
  /** run-doctor action — wired in the Setup entry (PR2). Hidden if omitted. */
  onRunDoctor?: () => void;
  /**
   * save-board-checklist action — wired in the Home entry (PR3). Hidden if
   * omitted. Returns truthy on success so the card can show saved/failed state.
   * The card requires an explicit confirm click before invoking this.
   */
  onSave?: (card: SalemPathfinderCard) => Promise<boolean> | void;
  /** Built-in follow-up affordance. Hidden if omitted. */
  onFollowUp?: () => void;
  /**
   * Local feedback capture (PR4). Hidden if omitted. Only fires on explicit
   * user action; a correction note is optional and only sent on submit.
   */
  onFeedback?: (feedback: { helpful: boolean; correctionNote?: string }) => void;
};

const ACTION_ICON: Record<SalemPathfinderAction["kind"], IconName> = {
  "cave-route": "ph:arrow-right-bold",
  "copy-command": "ph:copy",
  "run-doctor": "ph:wrench",
  "save-board-checklist": "ph:kanban",
  "external-link": "ph:arrow-square-out",
};

function CommandBlock({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await copyText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — leave the command visible to copy by hand */
    }
  };
  return (
    <div className="salem-pf__cmd">
      <code className="salem-pf__cmd-text">{command}</code>
      <button type="button" className="salem-pf__cmd-copy" onClick={copy} aria-label={copied ? "Copied" : "Copy command"}>
        <Icon name={copied ? "ph:check" : "ph:copy"} width={12} aria-hidden />
      </button>
    </div>
  );
}

export function SalemPathfinderCard({ card, density = "full", onRoute, onRunDoctor, onSave, onFollowUp, onFeedback }: Props) {
  const safe = sanitizeCard(card);
  const [saveState, setSaveState] = useState<"idle" | "confirm" | "saving" | "saved" | "error">("idle");
  const [feedback, setFeedback] = useState<"idle" | "correct" | "sent">("idle");
  const [correction, setCorrection] = useState("");

  const sendFeedback = (helpful: boolean, correctionNote?: string) => {
    onFeedback?.({ helpful, correctionNote: correctionNote?.trim() || undefined });
    setFeedback("sent");
  };

  // Save-to-Board requires an explicit confirm: first click arms, second saves.
  const handleSave = async () => {
    if (!onSave) return;
    if (saveState === "idle") {
      setSaveState("confirm");
      return;
    }
    if (saveState === "confirm") {
      setSaveState("saving");
      try {
        const ok = await onSave(safe);
        setSaveState(ok === false ? "error" : "saved");
      } catch {
        setSaveState("error");
      }
    }
  };
  const SAVE_LABEL: Record<string, string> = {
    idle: "Save to Board",
    confirm: "Confirm — save to Board",
    saving: "Saving…",
    saved: "Saved to Board",
    error: "Save failed — retry",
  };
  const slim = density === "slim";

  const runAction = (a: SalemPathfinderAction) => {
    switch (a.kind) {
      case "copy-command":
        if (a.target) void copyText(a.target);
        return;
      case "external-link":
        if (a.target) openExternalUrl(a.target);
        return;
      case "cave-route":
        if (!a.target) return;
        if (onRoute) onRoute(a.target);
        else if (a.target.startsWith("#")) window.location.hash = a.target.slice(1);
        else window.location.assign(a.target);
        return;
      case "run-doctor":
        onRunDoctor?.();
        return;
      case "save-board-checklist":
        onSave?.(safe);
        return;
    }
  };

  // Drop actions whose handler isn't wired at this entry point (honest UI:
  // don't show Save/Run-doctor buttons that do nothing).
  const actionEnabled = (a: SalemPathfinderAction) =>
    (a.kind !== "save-board-checklist" || !!onSave) && (a.kind !== "run-doctor" || !!onRunDoctor);

  const renderAction = (a: SalemPathfinderAction, primary: boolean, key: string) => {
    if (!actionEnabled(a)) return null;
    if (a.kind === "save-board-checklist") {
      return (
        <button
          key={key}
          type="button"
          className={`salem-pf__action salem-pf__action--save`}
          data-save-state={saveState}
          onClick={() => void handleSave()}
          disabled={saveState === "saving" || saveState === "saved"}
        >
          <Icon name={saveState === "saved" ? "ph:check" : ACTION_ICON[a.kind]} width={12} aria-hidden />
          <span>{SAVE_LABEL[saveState]}</span>
        </button>
      );
    }
    return (
      <button
        key={key}
        type="button"
        className={`salem-pf__action${primary ? " salem-pf__action--primary" : ""}`}
        onClick={() => runAction(a)}
      >
        <Icon name={ACTION_ICON[a.kind]} width={12} aria-hidden />
        <span>{a.label}</span>
      </button>
    );
  };

  return (
    <div className="salem-pf" data-confidence={safe.confidence} aria-label={`Recommended path: ${safe.title}`}>
      <div className="salem-pf__head">
        <span className="salem-pf__eyebrow">Recommended path</span>
        <h4 className="salem-pf__title">{safe.title}</h4>
        <p className="salem-pf__why">{safe.why}</p>
      </div>

      {safe.assumptions.length > 0 ? (
        <ul className="salem-pf__assumptions">
          {safe.assumptions.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      ) : null}

      <ol className="salem-pf__steps">
        {safe.steps.map((s) => (
          <li key={s.id} className="salem-pf__step" data-status={s.status ?? "ready"}>
            <div className="salem-pf__step-title">{s.title}</div>
            <div className="salem-pf__step-body">{s.body}</div>
            {s.command ? <CommandBlock command={s.command} /> : null}
          </li>
        ))}
      </ol>

      {!slim && safe.blockers.length > 0 ? (
        <ul className="salem-pf__blockers">
          {safe.blockers.map((b, i) => (
            <li key={i}>
              <span className="salem-pf__blocker-label">{b.label}</span> — {b.suggestion}
            </li>
          ))}
        </ul>
      ) : null}

      {!slim && safe.links.length > 0 ? (
        <div className="salem-pf__links">
          {safe.links.map((l, i) => (
            <button key={i} type="button" className="salem-pf__link" onClick={() => openExternalUrl(l.url)}>
              <Icon name="ph:arrow-square-out" width={11} aria-hidden />
              <span>{l.label}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="salem-pf__actions">
        {renderAction(safe.primaryAction, true, "primary")}
        {safe.secondaryActions.map((a, i) => renderAction(a, false, `sec-${i}`))}
        {onFollowUp ? (
          <button type="button" className="salem-pf__action" onClick={onFollowUp}>
            <Icon name="ph:chat-circle-dots" width={12} aria-hidden />
            <span>Ask a follow-up</span>
          </button>
        ) : null}
      </div>

      {onFeedback ? (
        <div className="salem-pf__feedback">
          {feedback === "sent" ? (
            <span className="salem-pf__feedback-thanks">Thanks — noted locally.</span>
          ) : feedback === "correct" ? (
            <div className="salem-pf__feedback-correct">
              <input
                className="salem-pf__feedback-input"
                value={correction}
                onChange={(e) => setCorrection(e.target.value)}
                placeholder="Suggest a better path (optional)…"
                aria-label="Suggest a better path"
              />
              <button type="button" className="salem-pf__action" onClick={() => sendFeedback(false, correction)}>
                Submit
              </button>
            </div>
          ) : (
            <>
              <span className="salem-pf__feedback-label">Was this helpful?</span>
              <button type="button" className="salem-pf__feedback-btn" aria-label="Helpful" onClick={() => sendFeedback(true)}>
                <Icon name="ph:thumbs-up" width={13} aria-hidden />
              </button>
              <button type="button" className="salem-pf__feedback-btn" aria-label="Not helpful" onClick={() => setFeedback("correct")}>
                <Icon name="ph:thumbs-down" width={13} aria-hidden />
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
