"use client";

/**
 * chart-room-band — the briefing row and the position band beneath it.
 *
 * One collapsed line always says where you stand; opening it reveals three
 * panels — the decision owed, project stats, and the structural repairs the
 * room would make. One panel is open at a time and the other two fall away to
 * spines carrying only their headline number, so the row reads as one falloff
 * rather than three competing chips.
 *
 * Each panel flips to explain what it is for, because a panel that needs a
 * paragraph of chrome to be legible has failed, and one that needs none but
 * offers it on request has not.
 */

import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "@/lib/icon";
import { relativeTime } from "@/lib/relative-time";
import { ChartDot } from "./chart-room-parts";
import type { ChartDecision, ChartProposal } from "./chart-room-model";

export type BandPanelId = "owed" | "stats" | "proposes";

export type ProjectProgress = {
  id: string;
  name: string;
  color: string | null;
  total: number;
  shipped: number;
  late: number;
  running: number;
  waiting: number;
  percent: number;
};

const EXPLAINERS: Record<BandPanelId, { icon: IconName; title: string; lines: string[] }> = {
  owed: {
    icon: "ph:signpost",
    title: "The owed decision",
    lines: [
      "The card the room thinks is most worth your attention — the one with the most work stacked behind it.",
      "**Mark answered** clears `needs a human` on the real card, for every surface.",
      "The second button jumps to that work in whichever lens you are in.",
      "Only one shows here — the rest queue in the ledger.",
    ],
  },
  stats: {
    icon: "ph:chart-line-up",
    title: "Project stats",
    lines: [
      "Left: a **diff, not a feed** — only what moved since you were last here. A line reading zero is dropped, never shown as a green tick.",
      "Right: one bar per project, filled by how many cards reached **Done**. A bar turns **amber** the moment any card in it goes overdue.",
      "Pick a project up top to narrow both halves to it.",
    ],
  },
  proposes: {
    icon: "ph:sparkle",
    title: "Repairs proposed",
    lines: [
      "**Structural faults only** — a loop, an edge running backwards, a leg stalled behind something late.",
      "Nothing applies itself. Apply or dismiss, and every accept is one undo away.",
      "Silent when the chart is sound. No proposal means nothing is broken.",
    ],
  },
};

/** **…** marks the one phrase in an explainer line worth emphasising. */
function emphasise(line: string): ReactNode[] {
  return line
    .split("**")
    .map((part, index) => (index % 2 ? <strong key={index}>{part}</strong> : <span key={index}>{part}</span>));
}

export function ChartRoomBand({
  open,
  openPanel,
  briefLine,
  proposals,
  decisions,
  owedIndex,
  overdueCount,
  changes,
  progress,
  flipped,
  answering,
  projectColor,
  projectName,
  onToggleOpen,
  onOpenPanel,
  onFlip,
  onOwedPrev,
  onOwedNext,
  onAnswer,
  onReveal,
  onCompare,
  onOpenStats,
  onApplyProposal,
  onShowProposal,
  onDismissProposal,
}: {
  open: boolean;
  openPanel: BandPanelId | null;
  briefLine: string;
  proposals: readonly ChartProposal[];
  decisions: readonly ChartDecision[];
  owedIndex: number;
  overdueCount: number;
  changes: ReadonlyArray<{ n: string; label: string; tone: "up" | "warn" | "accent" | "plain" }>;
  progress: readonly ProjectProgress[];
  flipped: BandPanelId | null;
  answering: boolean;
  projectColor: (id: string | null) => string | null;
  projectName: (id: string | null) => string;
  onToggleOpen: () => void;
  onOpenPanel: (panel: BandPanelId) => void;
  onFlip: (panel: BandPanelId | null) => void;
  onOwedPrev: () => void;
  onOwedNext: () => void;
  onAnswer: (id: string) => void;
  onReveal: (id: string) => void;
  onCompare: () => void;
  onOpenStats: () => void;
  onApplyProposal: (proposal: ChartProposal) => void;
  onShowProposal: (proposal: ChartProposal) => void;
  onDismissProposal: (proposal: ChartProposal) => void;
}) {
  const owed = decisions[owedIndex] ?? null;
  const summaries: Record<BandPanelId, string> = {
    owed: decisions.length > 0 ? `${decisions.length} owed` : "none owed",
    stats: `${progress.reduce((total, project) => total + project.total, 0)} steps`,
    proposes: proposals.length > 0 ? `${proposals.length} proposed` : "none",
  };

  const order: BandPanelId[] = ["owed", "stats", "proposes"];
  const openIndex = openPanel == null ? -1 : order.indexOf(openPanel);

  const panelStyle = (panel: BandPanelId): CSSProperties => {
    const distance = openIndex < 0 ? 1 : Math.abs(order.indexOf(panel) - openIndex);
    const fall = openIndex < 0 ? 1 : Math.max(0, (order.length + 1 - distance) / order.length);
    return { "--cr-fall": fall.toFixed(3) } as CSSProperties;
  };

  return (
    <div className="cr-brief">
      <div
        className="cr-brief__row"
        data-open={open}
        onClick={(event) => {
          if (!(event.target as HTMLElement).closest("button")) onToggleOpen();
        }}
      >
        <button type="button" className="cr-brief__lead focus-ring" aria-expanded={open} onClick={onToggleOpen}>
          <Icon name={open ? "ph:caret-down" : "ph:caret-right"} width={12} height={12} aria-hidden />
          <span className="cr-node__top">
            <Icon name="ph:compass-rose" width={13} height={13} aria-hidden />
            <span className="cr-eyebrow cr-eyebrow--accent">Briefing</span>
          </span>
          <span className="cr-head__rule" />
          <span className="cr-brief__line">{briefLine}</span>
        </button>
        <span className="cr-brief__counts">
          <span className="cr-count" data-tone={proposals.length > 0 ? "accent" : undefined}>
            <Icon name="ph:sparkle" width={10} height={10} aria-hidden /> {proposals.length} proposed
          </span>
          <span className="cr-count" data-tone={decisions.length > 0 ? "accent" : undefined}>
            <Icon name="ph:scales" width={10} height={10} aria-hidden /> {decisions.length} owed
          </span>
          <span className="cr-count" data-tone={overdueCount > 0 ? "warn" : undefined}>
            <Icon name="ph:warning-diamond" width={10} height={10} aria-hidden /> {overdueCount} overdue
          </span>
          {owed ? (
            <button
              type="button"
              className="cr-btn cr-btn--primary focus-ring"
              disabled={answering}
              title={`Mark "${owed.question}" answered`}
              onClick={() => onAnswer(owed.stepId)}
            >
              <Icon name="ph:check" width={11} height={11} aria-hidden /> Answered
            </button>
          ) : null}
        </span>
      </div>

      {open ? (
        <section className="cr-overlay" aria-label="Current position">
          <div className="cr-band">
            {/* ── Decision owed ─────────────────────────────────────────── */}
            <Panel
              id="owed"
              icon="ph:signpost"
              title={owed ? "Decision owed · yours to make" : "No decision owed"}
              open={openPanel === "owed"}
              flipped={flipped === "owed"}
              summary={summaries.owed}
              style={panelStyle("owed")}
              onOpen={() => onOpenPanel("owed")}
              onFlip={() => onFlip(flipped === "owed" ? null : "owed")}
              head={
                owed && decisions.length > 1 && openPanel === "owed" ? (
                  <>
                    <button
                      type="button"
                      className="cr-owed__nav focus-ring"
                      aria-label="Previous owed decision"
                      onClick={onOwedPrev}
                    >
                      <Icon name="ph:caret-left" width={10} height={10} aria-hidden />
                    </button>
                    <span className="cr-mono">
                      {owedIndex + 1}/{decisions.length}
                    </span>
                    <button
                      type="button"
                      className="cr-owed__nav focus-ring"
                      aria-label="Next owed decision"
                      onClick={onOwedNext}
                    >
                      <Icon name="ph:caret-right" width={10} height={10} aria-hidden />
                    </button>
                  </>
                ) : null
              }
              footer={
                owed ? (
                  <>
                    <button
                      type="button"
                      className="cr-btn cr-btn--primary focus-ring"
                      disabled={answering}
                      onClick={() => onAnswer(owed.stepId)}
                    >
                      <Icon name="ph:check" width={11} height={11} aria-hidden />
                      {answering ? "Answering…" : "Mark answered"}
                    </button>
                    <button type="button" className="cr-btn focus-ring" onClick={onCompare}>
                      Open the ledger
                    </button>
                    <span className="cr-lens__spacer" />
                    <button
                      type="button"
                      className="cr-btn cr-btn--quiet focus-ring"
                      onClick={() => onReveal(owed.stepId)}
                    >
                      Show it in the flow <Icon name="ph:arrow-up-right" width={9} height={9} aria-hidden />
                    </button>
                  </>
                ) : null
              }
            >
              {owed ? (
                <>
                  <p className="cr-owed__question">{owed.question}</p>
                  <p className="cr-owed__framing">
                    {owed.framing ??
                      "The card carries no notes. Open it and write down what the call actually is — a question nobody wrote down is a question nobody answers."}
                  </p>
                  <div className="cr-owed__impact">
                    <span className="cr-eyebrow">
                      {owed.blocking.length === 0
                        ? "Nothing waits on this"
                        : `${owed.blocking.length} step${owed.blocking.length > 1 ? "s" : ""} wait on this`}
                    </span>
                    {owed.blocking.slice(0, 3).map((step) => (
                      <span key={step.id} className="cr-node__top">
                        <ChartDot color={projectColor(step.project)} />
                        <span className="cr-chain__title">{step.title}</span>
                      </span>
                    ))}
                    <span className="cr-mono">
                      {projectName(owed.project)} · waiting {relativeTime(owed.updatedAt)}
                    </span>
                  </div>
                </>
              ) : (
                <p className="cr-owed__framing">
                  Nothing is waiting on you in this scope. Every open card has a lane, and the chart has no
                  question owed.
                </p>
              )}
            </Panel>

            {/* ── Project stats ─────────────────────────────────────────── */}
            <Panel
              id="stats"
              icon="ph:chart-line-up"
              title="Project stats"
              open={openPanel === "stats"}
              flipped={flipped === "stats"}
              summary={summaries.stats}
              style={panelStyle("stats")}
              onOpen={() => onOpenPanel("stats")}
              onFlip={() => onFlip(flipped === "stats" ? null : "stats")}
              head={
                openPanel === "stats" ? (
                  <button
                    type="button"
                    className="cr-icon-btn focus-ring"
                    aria-label="Show all project stats"
                    title="Show every project at full size"
                    onClick={onOpenStats}
                  >
                    <Icon name="ph:arrows-out-simple" width={11} height={11} aria-hidden />
                  </button>
                ) : null
              }
            >
              <div className="cr-stats__grid">
                <div className="cr-stats__col">
                  <span className="cr-eyebrow">
                    <Icon name="ph:arrows-clockwise" width={10} height={10} aria-hidden /> Since yesterday
                  </span>
                  {changes.length === 0 ? (
                    <span className="cr-help__body">Nothing moved since you were last here.</span>
                  ) : (
                    <ul>
                      {changes.map((change) => (
                        <li key={change.label} className="cr-change">
                          <span className="cr-change__n" data-tone={change.tone === "plain" ? undefined : change.tone}>
                            {change.n}
                          </span>
                          <span>{change.label}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="cr-stats__col">
                  <span className="cr-eyebrow">
                    <Icon name="ph:path" width={10} height={10} aria-hidden /> Progress to done
                  </span>
                  <ul>
                    {progress.slice(0, 5).map((project) => (
                      <li key={project.id} className="cr-progress">
                        <span className="cr-node__top">
                          <ChartDot color={project.color} />
                          <span className="cr-chain__title">{project.name}</span>
                          <span className="cr-mono">
                            {project.late > 0 ? `${project.late} late` : `${project.total} steps`}
                          </span>
                        </span>
                        <span className="cr-progress__track">
                          <span
                            className="cr-progress__bar"
                            style={
                              {
                                "--cr-pct": `${project.percent}%`,
                                ...(project.late > 0
                                  ? {}
                                  : project.color
                                    ? { "--cr-bar": project.color }
                                    : {}),
                              } as CSSProperties
                            }
                            data-late={project.late > 0}
                          />
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Panel>

            {/* ── Repairs proposed ──────────────────────────────────────── */}
            <Panel
              id="proposes"
              icon="ph:sparkle"
              title="Repairs proposed"
              open={openPanel === "proposes"}
              flipped={flipped === "proposes"}
              summary={summaries.proposes}
              style={panelStyle("proposes")}
              onOpen={() => onOpenPanel("proposes")}
              onFlip={() => onFlip(flipped === "proposes" ? null : "proposes")}
            >
              {proposals.length === 0 ? (
                <span className="cr-help__body">
                  <Icon name="ph:check-circle" width={15} height={15} aria-hidden /> Nothing to repair. The room
                  is quiet when the chart is sound.
                </span>
              ) : (
                <ul className="cr-proposals">
                  {proposals.map((proposal) => (
                    <li key={proposal.id} className="cr-proposal">
                      <span className="cr-proposal__icon" data-kind={proposal.kind}>
                        <Icon
                          name={
                            proposal.kind === "cycle"
                              ? "ph:arrows-clockwise"
                              : proposal.kind === "backwards"
                                ? "ph:arrow-u-up-left"
                                : proposal.kind === "unblocked"
                                  ? "ph:arrow-right"
                                  : "ph:warning-diamond"
                          }
                          width={12}
                          height={12}
                          aria-hidden
                        />
                      </span>
                      <span className="cr-proposal__main">
                        <span className="cr-proposal__text">{proposal.text}</span>
                        <span className="cr-proposal__actions">
                          <button
                            type="button"
                            className="cr-btn cr-btn--primary focus-ring"
                            onClick={() => onApplyProposal(proposal)}
                          >
                            <Icon name="ph:check" width={10} height={10} aria-hidden /> {proposal.actionLabel}
                          </button>
                          <button
                            type="button"
                            className="cr-btn cr-btn--quiet focus-ring"
                            onClick={() => onShowProposal(proposal)}
                          >
                            <Icon name="ph:crosshair-simple" width={10} height={10} aria-hidden /> Show me
                          </button>
                          <span className="cr-lens__spacer" />
                          <button
                            type="button"
                            className="cr-btn cr-btn--quiet focus-ring"
                            onClick={() => onDismissProposal(proposal)}
                          >
                            Dismiss
                          </button>
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Panel({
  id,
  icon,
  title,
  open,
  flipped,
  summary,
  style,
  head,
  footer,
  children,
  onOpen,
  onFlip,
}: {
  id: BandPanelId;
  icon: IconName;
  title: string;
  open: boolean;
  flipped: boolean;
  summary: string;
  style: CSSProperties;
  head?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  onOpen: () => void;
  onFlip: () => void;
}) {
  const explainer = EXPLAINERS[id];
  return (
    <div className={`cr-panel cr-panel--${id}`} data-open={open} style={style}>
      <div className="cr-panel__inner">
        <div className="cr-panel__face" data-hidden={flipped}>
          {!open ? (
            <>
              <Icon name={icon} width={96} height={96} aria-hidden className="cr-panel__mark" />
              <button
                type="button"
                className="cr-panel__hit focus-ring"
                aria-label={`Open ${explainer.title.toLowerCase()}`}
                onClick={onOpen}
              />
            </>
          ) : null}
          <header className="cr-panel__head">
            <Icon name={icon} width={13} height={13} aria-hidden />
            <h3 className="cr-panel__title">{title}</h3>
            {head}
            {open ? (
              <button
                type="button"
                className="cr-flip focus-ring"
                title="Flip the card over — what this panel is for and how to read it"
                onClick={onFlip}
              >
                <Icon name="ph:arrows-clockwise" width={10} height={10} aria-hidden /> More
              </button>
            ) : null}
          </header>
          {open ? <div className="cr-panel__body">{children}</div> : <span className="cr-panel__summary">{summary}</span>}
          {open && footer ? <div className="cr-panel__foot">{footer}</div> : null}
        </div>

        <div className="cr-panel__face cr-panel__back" data-hidden={!flipped}>
          <header className="cr-panel__head">
            <Icon name={explainer.icon} width={12} height={12} aria-hidden />
            <span className="cr-eyebrow cr-eyebrow--accent">{explainer.title}</span>
            <button type="button" className="cr-btn cr-btn--quiet focus-ring" onClick={onFlip}>
              ← Back
            </button>
          </header>
          <ul className="cr-panel__body">
            {explainer.lines.map((line) => (
              <li key={line} className="cr-panel__explainer">
                <Icon name="ph:caret-right" width={11} height={11} aria-hidden />
                <span>{emphasise(line)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
