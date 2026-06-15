"use client";

import { useState } from "react";
import { Icon } from "@/lib/icon";
import type { IconName } from "@/lib/icon";
import { sanitizeCard } from "@/lib/salem/pathfinder-card";
import type { SalemPathfinderAction, SalemPathfinderCard } from "@/lib/salem/pathfinder-types";

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
  /** save-board-checklist action — wired in the Home entry (PR3). Hidden if omitted. */
  onSave?: (card: SalemPathfinderCard) => void;
  /** Built-in follow-up affordance. Hidden if omitted. */
  onFollowUp?: () => void;
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
      await navigator.clipboard.writeText(command);
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

export function SalemPathfinderCard({ card, density = "full", onRoute, onRunDoctor, onSave, onFollowUp }: Props) {
  const safe = sanitizeCard(card);
  const slim = density === "slim";

  const runAction = (a: SalemPathfinderAction) => {
    switch (a.kind) {
      case "copy-command":
        if (a.target) navigator.clipboard?.writeText(a.target).catch(() => {});
        return;
      case "external-link":
        if (a.target) window.open(a.target, "_blank", "noopener,noreferrer");
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

  const renderAction = (a: SalemPathfinderAction, primary: boolean, key: string) =>
    actionEnabled(a) ? (
      <button
        key={key}
        type="button"
        className={`salem-pf__action${primary ? " salem-pf__action--primary" : ""}`}
        onClick={() => runAction(a)}
      >
        <Icon name={ACTION_ICON[a.kind]} width={12} aria-hidden />
        <span>{a.label}</span>
      </button>
    ) : null;

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
            <a key={i} className="salem-pf__link" href={l.url} target="_blank" rel="noopener noreferrer">
              <Icon name="ph:arrow-square-out" width={11} aria-hidden />
              <span>{l.label}</span>
            </a>
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
    </div>
  );
}
