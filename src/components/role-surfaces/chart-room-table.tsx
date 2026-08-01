"use client";

/**
 * chart-room-table — the Table lens, in three shapes.
 *
 * The same filtered rows every time: the table edits them in place, the gantt
 * shows when each can actually start, and the board shows where each one sits.
 * Every edit is a real write to the card behind the row — except the dependency
 * column, which writes the room's own chart.
 */

import type { CSSProperties } from "react";
import { Icon } from "@/lib/icon";
import { ChartDot, ChartSelect, StateTag } from "./chart-room-parts";
import {
  CHART_STAGES,
  ganttRows,
  stageName,
  type ChartSortKey,
  type ChartStageId,
  type ChartStep,
} from "./chart-room-model";

export type TableMode = "table" | "gantt" | "board";

const COLUMNS: Array<{ key: ChartSortKey; label: string; width: string }> = [
  { key: "project", label: "Project", width: "150px" },
  { key: "stage", label: "Stage", width: "120px" },
  { key: "title", label: "Step", width: "auto" },
  { key: "state", label: "State", width: "120px" },
  { key: "needs", label: "Waits on", width: "200px" },
  { key: "owner", label: "Owner", width: "90px" },
];

export function ChartRoomTable({
  mode,
  rows,
  allSteps,
  sortKey,
  sortDirection,
  collapsedColumns,
  familiars,
  projects,
  projectColor,
  ownerName,
  onSort,
  onOpen,
  onTitle,
  onProject,
  onStage,
  onOwner,
  onNeeds,
  onRemove,
  onToggleColumn,
}: {
  mode: TableMode;
  rows: readonly ChartStep[];
  allSteps: readonly ChartStep[];
  sortKey: ChartSortKey;
  sortDirection: 1 | -1;
  collapsedColumns: readonly ChartStageId[];
  familiars: ReadonlyArray<{ id: string; name: string }>;
  projects: ReadonlyArray<{ id: string; name: string }>;
  projectColor: (id: string | null) => string | null;
  ownerName: (id: string | null) => string;
  onSort: (key: ChartSortKey) => void;
  onOpen: (id: string) => void;
  onTitle: (id: string, title: string) => void;
  onProject: (id: string, projectId: string) => void;
  onStage: (id: string, stage: ChartStageId) => void;
  onOwner: (id: string, familiarId: string) => void;
  onNeeds: (id: string, needs: string | null) => void;
  onRemove: (id: string) => void;
  onToggleColumn: (stage: ChartStageId) => void;
}) {
  if (mode === "table") {
    return (
      <table className="cr-table">
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th key={column.key} style={{ width: column.width }}>
                <button
                  type="button"
                  className="cr-sort focus-ring"
                  aria-sort={
                    sortKey === column.key ? (sortDirection === 1 ? "ascending" : "descending") : undefined
                  }
                  onClick={() => onSort(column.key)}
                >
                  {column.label}
                  <Icon
                    name={sortKey === column.key && sortDirection === -1 ? "ph:caret-up" : "ph:caret-down"}
                    width={10}
                    height={10}
                    aria-hidden
                  />
                </button>
              </th>
            ))}
            <th className="cr-table__gutter" />
          </tr>
        </thead>
        <tbody>
          {rows.map((step) => (
            <tr key={step.id} data-owed={step.needsHuman}>
              <td>
                <span className="cr-node__top">
                  <ChartDot color={projectColor(step.project)} />
                  <ChartSelect
                    value={step.project ?? ""}
                    label={`Project for ${step.title}`}
                    onChange={(next) => onProject(step.id, next)}
                    options={[
                      { value: "", label: "— none" },
                      ...projects.map((project) => ({ value: project.id, label: project.name })),
                    ]}
                  />
                </span>
              </td>
              <td>
                <ChartSelect
                  value={step.stage}
                  label={`Lane for ${step.title}`}
                  onChange={(next) => onStage(step.id, next as ChartStageId)}
                  options={CHART_STAGES.map((stage) => ({ value: stage.id, label: stage.name }))}
                />
              </td>
              <td>
                <span className="cr-node__top">
                  <button
                    type="button"
                    className="cr-icon-btn focus-ring"
                    aria-label={`Open ${step.title}`}
                    onClick={() => onOpen(step.id)}
                  >
                    <Icon name="ph:arrows-out-simple" width={11} height={11} aria-hidden />
                  </button>
                  <input
                    className="cr-cell-input"
                    value={step.title}
                    aria-label="Step title"
                    onChange={(event) => onTitle(step.id, event.target.value)}
                    onDoubleClick={() => onOpen(step.id)}
                  />
                </span>
              </td>
              <td>
                <StateTag state={step.state} />
              </td>
              <td>
                <ChartSelect
                  value={step.needs ?? ""}
                  accent={step.needs != null}
                  label={`What ${step.title} waits on`}
                  onChange={(next) => onNeeds(step.id, next === "" ? null : next)}
                  options={[
                    { value: "", label: "— nothing" },
                    ...allSteps
                      .filter((other) => other.id !== step.id)
                      .map((other) => ({ value: other.id, label: other.title })),
                  ]}
                />
              </td>
              <td>
                <ChartSelect
                  value={step.owner ?? ""}
                  label={`Owner of ${step.title}`}
                  onChange={(next) => onOwner(step.id, next)}
                  options={[
                    { value: "", label: "— unassigned" },
                    ...familiars.map((familiar) => ({ value: familiar.id, label: familiar.name })),
                  ]}
                />
              </td>
              <td>
                <button
                  type="button"
                  className="cr-icon-btn cr-icon-btn--danger focus-ring"
                  aria-label={`Remove ${step.title}`}
                  onClick={() => onRemove(step.id)}
                >
                  <Icon name="ph:trash" width={11} height={11} aria-hidden />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (mode === "gantt") {
    const { rows: bars, span } = ganttRows(rows);
    return (
      <>
        <div className="cr-gantt">
          <div className="cr-gantt__cols">
            {Array.from({ length: span }, (_, index) => (
              <span key={index} className="cr-gantt__col">
                {index === 0 ? "can start now" : `+${index}`}
              </span>
            ))}
          </div>
          {bars.map((bar) => (
            <div key={bar.step.id} className="cr-gantt__row">
              <button
                type="button"
                className="cr-gantt__label focus-ring"
                onClick={() => onOpen(bar.step.id)}
              >
                <ChartDot color={projectColor(bar.step.project)} />
                <span className="cr-chain__title">{bar.step.title}</span>
                <span className="cr-mono">{stageName(bar.step.stage)}</span>
              </button>
              <span className="cr-gantt__track">
                <span
                  className="cr-gantt__bar"
                  data-state={bar.step.state}
                  style={
                    {
                      "--cr-left": `${bar.left}%`,
                      "--cr-width": `${bar.width}%`,
                      ...(projectColor(bar.step.project)
                        ? { "--cr-bar": projectColor(bar.step.project) as string }
                        : {}),
                    } as CSSProperties
                  }
                >
                  <span className="cr-gantt__bar-label">
                    {bar.step.state === "overdue" ? "late" : bar.step.state === "done" ? "landed" : bar.step.state}
                  </span>
                </span>
                {bar.linkAt != null ? (
                  <span className="cr-gantt__link" style={{ "--cr-left": `${bar.linkAt}%` } as CSSProperties} />
                ) : null}
              </span>
              <span className="cr-gantt__when">{bar.when}</span>
            </div>
          ))}
        </div>
        <p className="cr-note">
          Bars are placed by dependency depth, not by a date nobody entered — a step starts where its blocker
          ends. The faint connector marks where it is waiting.
        </p>
      </>
    );
  }

  const columnWidths = CHART_STAGES.map((stage) =>
    collapsedColumns.includes(stage.id) ? "44px" : "minmax(0,1fr)",
  ).join(" ");

  return (
    <>
      <div className="cr-board" style={{ "--cr-board-cols": columnWidths } as CSSProperties}>
        {CHART_STAGES.map((stage) => {
          const cards = rows.filter((step) => step.stage === stage.id);
          const collapsed = collapsedColumns.includes(stage.id);
          return (
            <div key={stage.id} className="cr-board__col" data-collapsed={collapsed}>
              <span className="cr-board__head" data-filled={cards.length > 0}>
                <span className="cr-board__name">{stage.name}</span>
                <span className="cr-mono">{cards.length}</span>
                <button
                  type="button"
                  className="cr-icon-btn focus-ring"
                  aria-label={`${collapsed ? "Expand" : "Collapse"} ${stage.name}`}
                  aria-expanded={!collapsed}
                  onClick={() => onToggleColumn(stage.id)}
                >
                  <Icon
                    name={collapsed ? "ph:arrows-out-line-horizontal" : "ph:arrows-in-line-horizontal"}
                    width={10}
                    height={10}
                    aria-hidden
                  />
                </button>
              </span>
              {collapsed ? (
                <button type="button" className="cr-board__collapsed focus-ring" onClick={() => onToggleColumn(stage.id)}>
                  {cards.length} steps
                </button>
              ) : cards.length === 0 ? (
                <span className="cr-mono">empty</span>
              ) : (
                cards.map((step) => {
                  const upstream = step.needs ? allSteps.find((other) => other.id === step.needs) : undefined;
                  return (
                    <button
                      key={step.id}
                      type="button"
                      className="cr-board__card focus-ring"
                      style={
                        projectColor(step.project)
                          ? ({ "--cr-dot": projectColor(step.project) as string } as CSSProperties)
                          : undefined
                      }
                      onClick={() => onOpen(step.id)}
                    >
                      <span className="cr-node__top">
                        <ChartDot color={projectColor(step.project)} />
                        <StateTag state={step.state} />
                        <span className="cr-mono">{ownerName(step.owner)}</span>
                      </span>
                      <span className="cr-chain__node-title">{step.title}</span>
                      {upstream ? (
                        <span className="cr-node__need">
                          <Icon name="ph:arrow-bend-left-up" width={9} height={9} aria-hidden />
                          <span>waits on {upstream.title}</span>
                        </span>
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
          );
        })}
      </div>
      <p className="cr-note">
        The same rows the table is filtering, dealt into the board&apos;s own lanes. Collapse the ones you
        aren&apos;t working.
      </p>
    </>
  );
}
