"use client";

/**
 * chart-room-step-sheet — one step, opened.
 *
 * The recommendation first, then the fields that write the real card (title,
 * lane, owner, project), then the connections that write the room's chart.
 * Both link triggers are full-width slots rather than inline chips: an empty
 * dependency is a place something goes, and it should look like one.
 */

import { useRef, type CSSProperties } from "react";
import { Icon } from "@/lib/icon";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { ChartDot, ChartSelect, StateTag } from "./chart-room-parts";
import {
  CHART_STAGES,
  ancestorsOf,
  nextStage,
  previousStage,
  stageIndex,
  stepRecommendation,
  type ChartProposalAction,
  type ChartStageId,
  type ChartStep,
} from "./chart-room-model";

type PickerGroup = { stage: string; options: Array<{ step: ChartStep; recommended: boolean; reason: string }> };

/**
 * Dependency candidates grouped by lane in board order, recommended first.
 * Upstream is recommended for "waits on" and downstream for "connects to", so
 * either link keeps the flow running forward.
 */
function pickerGroups(
  step: ChartStep,
  steps: readonly ChartStep[],
  direction: "upstream" | "downstream",
): PickerGroup[] {
  const here = stageIndex(step.stage);
  const ancestors = direction === "downstream" ? ancestorsOf(steps, step.id) : new Set<string>();
  return CHART_STAGES.map((stage, index) => {
    const options = steps
      .filter((other) => other.id !== step.id && other.stage === stage.id)
      .filter((other) => (direction === "upstream" ? other.needs !== step.id : !ancestors.has(other.id)))
      .map((other) => {
        const forward = direction === "upstream" ? index < here : index > here;
        const sameProject = other.project != null && other.project === step.project;
        return {
          step: other,
          recommended: forward,
          reason: sameProject
            ? `same project, ${direction}`
            : direction === "upstream"
              ? "upstream"
              : "downstream",
          rank: forward ? (sameProject ? 0 : 1) : 2,
        };
      })
      .sort((a, b) => a.rank - b.rank)
      .map(({ step: option, recommended, reason }) => ({ step: option, recommended, reason }));
    return { stage: stage.name, options };
  }).filter((group) => group.options.length > 0);
}

export function ChartRoomStepSheet({
  step,
  steps,
  familiars,
  projects,
  upstreamOpen,
  downstreamOpen,
  saving,
  projectColor,
  onClose,
  onTitle,
  onStage,
  onOwner,
  onProject,
  onNeeds,
  onConnect,
  onCut,
  onSelect,
  onToggleUpstream,
  onToggleDownstream,
  onRecommendation,
  onDelete,
  onFocusCard,
}: {
  step: ChartStep;
  steps: readonly ChartStep[];
  familiars: ReadonlyArray<{ id: string; name: string; role?: string }>;
  projects: ReadonlyArray<{ id: string; name: string }>;
  upstreamOpen: boolean;
  downstreamOpen: boolean;
  saving: boolean;
  projectColor: (id: string | null) => string | null;
  onClose: () => void;
  onTitle: (title: string) => void;
  onStage: (stage: ChartStageId) => void;
  onOwner: (familiarId: string) => void;
  onProject: (projectId: string) => void;
  onNeeds: (needs: string | null) => void;
  onConnect: (dependantId: string) => void;
  onCut: (dependantId: string) => void;
  onSelect: (id: string) => void;
  onToggleUpstream: () => void;
  onToggleDownstream: () => void;
  onRecommendation: (action: ChartProposalAction) => void;
  onDelete: () => void;
  onFocusCard: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(true, dialogRef, { onEscape: onClose });

  const upstream = step.needs ? steps.find((other) => other.id === step.needs) : undefined;
  const downstream = steps.filter((other) => other.needs === step.id);
  const recommendation = stepRecommendation(step, steps);
  const before = previousStage(step.stage);
  const after = nextStage(step.stage);
  const owner = familiars.find((familiar) => familiar.id === step.owner);

  return (
    <div className="cr-modal">
      <button type="button" className="cr-modal__scrim" aria-label="Close step" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Step — ${step.title}`}
        className="cr-modal__dialog cr-modal__dialog--sheet"
      >
        <header className="cr-modal__head">
          <ChartDot color={projectColor(step.project)} large />
          <StateTag state={step.state} />
          <span className="cr-mono">{owner?.name ?? "unassigned"}</span>
          <span className="cr-lens__spacer" />
          <button type="button" className="cr-icon-btn focus-ring" aria-label="Close" onClick={onClose}>
            <Icon name="ph:x" width={13} height={13} aria-hidden />
          </button>
        </header>

        <div className="cr-modal__body">
          <input
            className="cr-sheet__title focus-ring"
            value={step.title}
            aria-label="Step title"
            onChange={(event) => onTitle(event.target.value)}
          />

          <div className="cr-sheet__rec">
            <Icon name="ph:sparkle" width={13} height={13} aria-hidden />
            <span className="cr-help__text">
              <span className="cr-eyebrow cr-eyebrow--accent">What to do with it</span>
              <span className="cr-help__body">{recommendation.text}</span>
            </span>
            {recommendation.action && recommendation.actionLabel ? (
              <button
                type="button"
                className="cr-btn cr-btn--primary focus-ring"
                disabled={saving}
                onClick={() => onRecommendation(recommendation.action as ChartProposalAction)}
              >
                <Icon name="ph:check" width={10} height={10} aria-hidden /> {recommendation.actionLabel}
              </button>
            ) : null}
          </div>

          <div className="cr-sheet__fields">
            <span className="cr-eyebrow">Owner</span>
            <ChartSelect
              value={step.owner ?? ""}
              label="Owner"
              onChange={onOwner}
              disabled={saving}
              options={[
                { value: "", label: "— unassigned" },
                ...familiars.map((familiar) => ({ value: familiar.id, label: familiar.name })),
              ]}
            />
            <span className="cr-eyebrow">Project</span>
            <ChartSelect
              value={step.project ?? ""}
              label="Project"
              onChange={onProject}
              disabled={saving}
              options={[
                { value: "", label: "— none" },
                ...projects.map((project) => ({ value: project.id, label: project.name })),
              ]}
            />
          </div>

          <div className="cr-sheet__stage">
            <span className="cr-eyebrow">Lane</span>
            <button
              type="button"
              className="cr-sheet__arrow focus-ring"
              aria-label="Move a lane back"
              disabled={before == null || saving}
              onClick={() => before && onStage(before.id)}
            >
              <Icon name="ph:caret-left" width={13} height={13} aria-hidden />
            </button>
            <button
              type="button"
              className="cr-sheet__neighbour focus-ring"
              disabled={before == null || saving}
              onClick={() => before && onStage(before.id)}
            >
              {before?.name ?? "— start"}
            </button>
            <span className="cr-sheet__stage-current">
              <span className="cr-eyebrow cr-eyebrow--accent">{CHART_STAGES[stageIndex(step.stage)]?.name}</span>
              <span className="cr-mono">
                lane {stageIndex(step.stage) + 1} of {CHART_STAGES.length}
              </span>
            </span>
            <button
              type="button"
              className="cr-sheet__neighbour focus-ring"
              disabled={after == null || saving}
              onClick={() => after && onStage(after.id)}
            >
              {after?.name ?? "end —"}
            </button>
            <button
              type="button"
              className="cr-sheet__arrow focus-ring"
              aria-label="Move a lane forward"
              disabled={after == null || saving}
              onClick={() => after && onStage(after.id)}
            >
              <Icon name="ph:caret-right" width={13} height={13} aria-hidden />
            </button>
          </div>

          <div className="cr-conn">
            <span className="cr-conn__label">
              <Icon name="ph:flow-arrow" width={12} height={12} aria-hidden />
              <span className="cr-eyebrow">Connections</span>
              <span className="cr-mono">
                {upstream ? "1 upstream" : "no upstream"} · {downstream.length || "no"} downstream
              </span>
            </span>

            <span className="cr-conn__label">
              <Icon name="ph:arrow-bend-left-up" width={11} height={11} aria-hidden />
              <span className="cr-eyebrow">Waits on</span>
            </span>
            {upstream ? (
              <span className="cr-conn__current">
                <span className="cr-chain__title">{upstream.title}</span>
                <StateTag state={upstream.state} />
                <button
                  type="button"
                  className="cr-icon-btn cr-icon-btn--danger focus-ring"
                  aria-label="Unlink"
                  onClick={() => onNeeds(null)}
                >
                  <Icon name="ph:x" width={11} height={11} aria-hidden />
                </button>
              </span>
            ) : null}
            <button
              type="button"
              className="cr-conn__trigger focus-ring"
              aria-expanded={upstreamOpen}
              onClick={onToggleUpstream}
            >
              <Icon name="ph:link" width={11} height={11} aria-hidden />
              {upstream ? "Relink" : "Link a dependency"}
              <span className="cr-lens__spacer" />
              <Icon name={upstreamOpen ? "ph:caret-up" : "ph:caret-down"} width={10} height={10} aria-hidden />
            </button>
            {upstreamOpen ? (
              <Picker
                groups={pickerGroups(step, steps, "upstream")}
                selectedId={step.needs ?? null}
                projectColor={projectColor}
                onPick={(id) => onNeeds(id)}
                note="Recommended = an earlier lane, so the flow still runs forward. Or drag from a step's right-edge dot."
              />
            ) : null}

            <span className="cr-conn__label">
              <Icon name="ph:arrow-bend-right-down" width={11} height={11} aria-hidden />
              <span className="cr-eyebrow">Connects to</span>
              <span className="cr-mono">
                {downstream.length > 0
                  ? "these can't start until this one lands"
                  : "nothing is waiting on this step"}
              </span>
            </span>
            {downstream.map((other) => (
              <span
                key={other.id}
                className="cr-conn__downstream"
                style={
                  projectColor(other.project)
                    ? ({ "--cr-dot": projectColor(other.project) as string } as CSSProperties)
                    : undefined
                }
              >
                <ChartDot color={projectColor(other.project)} />
                <button type="button" className="cr-conn__jump focus-ring" onClick={() => onSelect(other.id)}>
                  {other.title}
                </button>
                <StateTag state={other.state} />
                <button
                  type="button"
                  className="cr-icon-btn cr-icon-btn--danger focus-ring"
                  aria-label={`Cut the connection to ${other.title}`}
                  onClick={() => onCut(other.id)}
                >
                  <Icon name="ph:x" width={11} height={11} aria-hidden />
                </button>
              </span>
            ))}
            <button
              type="button"
              className="cr-conn__trigger focus-ring"
              aria-expanded={downstreamOpen}
              onClick={onToggleDownstream}
            >
              <Icon name="ph:plus" width={11} height={11} aria-hidden />
              {downstream.length > 0 ? "Connect another step" : "Connect a step"}
              <span className="cr-lens__spacer" />
              <Icon name={downstreamOpen ? "ph:caret-up" : "ph:caret-down"} width={10} height={10} aria-hidden />
            </button>
            {downstreamOpen ? (
              <Picker
                groups={pickerGroups(step, steps, "downstream")}
                selectedId={null}
                projectColor={projectColor}
                onPick={(id) => onConnect(id)}
                note="Recommended = a later lane. A step this one already waits on is never offered, so connecting cannot close a loop."
              />
            ) : null}
          </div>
        </div>

        <div className="cr-modal__foot">
          <button type="button" className="cr-btn focus-ring" onClick={onFocusCard}>
            <Icon name="ph:kanban" width={11} height={11} aria-hidden /> Open on the board
          </button>
          <span className="cr-lens__spacer" />
          <button
            type="button"
            className="cr-btn focus-ring"
            disabled={saving}
            title="Remove this card from the board and cut every link into it"
            onClick={onDelete}
          >
            <Icon name="ph:trash" width={11} height={11} aria-hidden /> Remove
          </button>
        </div>
      </div>
    </div>
  );
}

function Picker({
  groups,
  selectedId,
  projectColor,
  onPick,
  note,
}: {
  groups: readonly PickerGroup[];
  selectedId: string | null;
  projectColor: (id: string | null) => string | null;
  onPick: (id: string) => void;
  note: string;
}) {
  if (groups.length === 0) {
    return (
      <div className="cr-picker">
        <p className="cr-scope__note">No other step to link to yet.</p>
      </div>
    );
  }
  return (
    <div className="cr-picker" role="listbox" aria-label="Choose a step">
      {groups.map((group) => (
        <div key={group.stage} className="cr-picker__group">
          <span className="cr-eyebrow">
            {group.stage} <span className="cr-mono">{group.options.length}</span>
          </span>
          {group.options.map((option) => (
            <button
              key={option.step.id}
              type="button"
              role="option"
              aria-selected={option.step.id === selectedId}
              className="cr-picker__option focus-ring"
              onClick={() => onPick(option.step.id)}
            >
              <ChartDot color={projectColor(option.step.project)} />
              <span className="cr-picker__title">{option.step.title}</span>
              {option.recommended ? <span className="cr-picker__reason">▸ {option.reason}</span> : null}
            </button>
          ))}
        </div>
      ))}
      <p className="cr-scope__note">{note}</p>
    </div>
  );
}
