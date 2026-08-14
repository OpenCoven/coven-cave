"use client";

/**
 * chart-room-orchestration — the Orchestration lens.
 *
 * Four lanes and the edges between them: who is accountable, the step and what
 * it waits on, the capability it draws on, and what is stopped on you. Click
 * any node to lock the map onto it — the focused subgraph gathers at the top of
 * every lane and the rest dims.
 *
 * Capability edges only exist where a card's own labels name a real workflow or
 * skill; the board records no other association, and the room does not invent
 * one. A lane with nothing in it says so rather than filling with examples.
 */

import type { CSSProperties } from "react";
import { Icon } from "@/lib/icon";
import { StateTag } from "./chart-room-parts";
import {
  capabilitiesForStep,
  laneOrder,
  stageName,
  type ChartCapability,
  type ChartLock,
  type ChartStep,
} from "./chart-room-model";

const FAMILIAR_H = 48;
const STEP_H = 46;
const CAPABILITY_H = 32;
const HUMAN_H = 60;
const FAMILIAR_PITCH = FAMILIAR_H + 10;
const STEP_PITCH = STEP_H + 6;
const CAPABILITY_PITCH = CAPABILITY_H + 6;
const HUMAN_PITCH = HUMAN_H + 8;

const WIDE = { familiar: 220, gap1: 110, step: 620, gap2: 110, capability: 290, gap3: 70, human: 212 };
const NARROW = { familiar: 190, gap1: 100, step: 460, gap2: 100, capability: 240, gap3: 60, human: 170 };

export type OrchestrationFamiliar = { id: string; name: string; role: string };

export function ChartRoomOrchestration({
  steps,
  familiars,
  capabilities,
  lock,
  live,
  expandedCanvas,
  ownerName,
  onLock,
  onOpenStep,
}: {
  steps: readonly ChartStep[];
  familiars: readonly OrchestrationFamiliar[];
  capabilities: readonly ChartCapability[];
  lock: ChartLock | null;
  /** Ids the lock keeps at full strength. */
  live: ReadonlySet<string>;
  expandedCanvas: boolean;
  ownerName: (id: string | null) => string;
  onLock: (next: ChartLock | null) => void;
  onOpenStep: (id: string) => void;
}) {
  const width = expandedCanvas ? WIDE : NARROW;
  const x = {
    familiarRight: width.familiar,
    step: width.familiar + width.gap1,
    stepRight: width.familiar + width.gap1 + width.step,
    capability: width.familiar + width.gap1 + width.step + width.gap2,
    human:
      width.familiar + width.gap1 + width.step + width.gap2 + width.capability + width.gap3,
  };
  const canvasWidth = x.human + width.human;
  const columns = `${width.familiar}px ${width.gap1}px ${width.step}px ${width.gap2}px ${width.capability}px ${width.gap3}px ${width.human}px`;

  const laneFamiliars = familiars.filter((familiar) => steps.some((step) => step.owner === familiar.id));
  const laneCapabilities = capabilities.filter((capability) =>
    steps.some((step) => capabilitiesForStep(step, capabilities).some((used) => used.id === capability.id)),
  );
  const laneHumans = steps.filter((step) => step.needsHuman && step.state !== "done");

  const familiarOrder = laneOrder(laneFamiliars, (familiar) =>
    steps.some((step) => step.owner === familiar.id && live.has(step.id)),
  );
  const stepOrder = laneOrder(steps, (step) => live.has(step.id));
  const capabilityOrder = laneOrder(laneCapabilities, (capability) =>
    steps.some(
      (step) =>
        live.has(step.id) && capabilitiesForStep(step, capabilities).some((used) => used.id === capability.id),
    ),
  );
  const humanOrder = laneOrder(laneHumans, (step) => live.has(step.id));

  const centre = (order: Record<string, number>, id: string, pitch: number, height: number): number =>
    (order[id] ?? 0) * pitch + height / 2;

  const edges: Array<{ id: string; d: string; lane: string; dim: boolean; width: number; dash?: string }> = [];
  for (const step of steps) {
    const on = live.has(step.id);
    const stepY = centre(stepOrder, step.id, STEP_PITCH, STEP_H);

    if (step.owner != null && familiarOrder[step.owner] !== undefined) {
      const familiarY = centre(familiarOrder, step.owner, FAMILIAR_PITCH, FAMILIAR_H);
      edges.push({
        id: `f:${step.id}`,
        lane: "familiar",
        dim: !on,
        width: on ? 1.3 : 1,
        d: `M${x.familiarRight} ${familiarY} C${x.familiarRight + 46} ${familiarY}, ${x.step - 46} ${stepY}, ${x.step} ${stepY}`,
      });
    }

    for (const capability of capabilitiesForStep(step, capabilities)) {
      if (capabilityOrder[capability.id] === undefined) continue;
      const capabilityY = centre(capabilityOrder, capability.id, CAPABILITY_PITCH, CAPABILITY_H);
      edges.push({
        id: `c:${step.id}:${capability.id}`,
        lane: "capability",
        dim: !on,
        width: 1.1,
        d: `M${x.stepRight} ${stepY} C${x.stepRight + 46} ${stepY}, ${x.capability - 46} ${capabilityY}, ${x.capability} ${capabilityY}`,
      });
    }

    if (step.needsHuman && humanOrder[step.id] !== undefined) {
      const humanY = centre(humanOrder, step.id, HUMAN_PITCH, HUMAN_H);
      edges.push({
        id: `h:${step.id}`,
        lane: "human",
        dim: !on,
        width: on ? 1.6 : 1,
        dash: "5 4",
        d: `M${x.stepRight} ${stepY} C${x.stepRight + 150} ${stepY}, ${x.human - 150} ${humanY}, ${x.human} ${humanY}`,
      });
    }

    if (step.needs != null && stepOrder[step.needs] !== undefined) {
      const upstreamY = centre(stepOrder, step.needs, STEP_PITCH, STEP_H);
      edges.push({
        id: `d:${step.id}`,
        lane: "dependency",
        dim: !on,
        width: 1.3,
        d: `M${x.step - 14} ${upstreamY} C${x.step - 30} ${upstreamY}, ${x.step - 30} ${stepY}, ${x.step - 14} ${stepY}`,
      });
    }
  }

  const canvasHeight = Math.max(
    laneFamiliars.length * FAMILIAR_PITCH,
    steps.length * STEP_PITCH,
    laneCapabilities.length * CAPABILITY_PITCH,
    laneHumans.length * HUMAN_PITCH,
    1,
  );

  const gridStyle = { "--cr-orch-cols": columns } as CSSProperties;
  const slot = (position: number, pitch: number): CSSProperties =>
    ({ "--cr-slot-y": `${position * pitch}px` }) as CSSProperties;
  const lane = (count: number, pitch: number): CSSProperties =>
    ({ "--cr-lane-h": `${count * pitch}px` }) as CSSProperties;
  const row = (height: number): CSSProperties => ({ "--cr-row-h": `${height}px` }) as CSSProperties;

  const toggle = (next: ChartLock) =>
    onLock(lock != null && lock.kind === next.kind && lock.id === next.id ? null : next);

  return (
    <>
      <div className="cr-orch__heads" style={gridStyle}>
        <span className="cr-orch__head" data-lane="familiar">
          Accountable
        </span>
        <span />
        <span className="cr-orch__head" data-lane="step">
          Step · dependencies
        </span>
        <span />
        <span className="cr-orch__head" data-lane="capability">
          Capability
        </span>
        <span />
        <span className="cr-orch__head" data-lane="human">
          On you
        </span>
      </div>

      <div className="cr-flow__canvas">
        <svg
          className="cr-flow__edges"
          width={canvasWidth}
          height={canvasHeight}
          viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
          fill="none"
          aria-hidden
        >
          {edges.map((edge) => (
            <path
              key={edge.id}
              className="cr-orch__edge"
              data-lane={edge.lane}
              data-dim={edge.dim}
              d={edge.d}
              strokeWidth={edge.width}
              strokeDasharray={edge.dash}
              strokeLinecap="round"
              fill="none"
            />
          ))}
        </svg>

        <div className="cr-orch__grid" style={gridStyle}>
          <ul className="cr-orch__lane" style={lane(laneFamiliars.length, FAMILIAR_PITCH)}>
            {laneFamiliars.map((familiar) => {
              const mine = steps.filter((step) => step.owner === familiar.id);
              const late = mine.filter((step) => step.state === "overdue").length;
              const owed = mine.filter((step) => step.needsHuman).length;
              return (
                <li
                  key={familiar.id}
                  className="cr-orch__slot"
                  style={slot(familiarOrder[familiar.id] ?? 0, FAMILIAR_PITCH)}
                >
                  <button
                    type="button"
                    className="cr-orch__row focus-ring"
                    data-lane="familiar"
                    data-dim={!mine.some((step) => live.has(step.id))}
                    aria-pressed={lock?.kind === "familiar" && lock.id === familiar.id}
                    style={row(FAMILIAR_H)}
                    onClick={() => toggle({ kind: "familiar", id: familiar.id })}
                  >
                    <span className="cr-node__top">
                      <Icon name="ph:user-circle" width={13} height={13} aria-hidden />
                      <span className="cr-chain__title">{familiar.name}</span>
                      <span className="cr-mono">{familiar.role}</span>
                    </span>
                    <span className="cr-mono">
                      {mine.length} steps
                      {late > 0 ? ` · ${late} late` : ""}
                      {owed > 0 ? ` · ${owed} owed` : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <span />

          <ul className="cr-orch__lane" style={lane(steps.length, STEP_PITCH)}>
            {steps.map((step) => {
              const used = capabilitiesForStep(step, capabilities);
              return (
                <li key={step.id} className="cr-orch__slot" style={slot(stepOrder[step.id] ?? 0, STEP_PITCH)}>
                  <button
                    type="button"
                    className="cr-orch__row focus-ring"
                    data-lane="step"
                    data-dim={!live.has(step.id)}
                    aria-pressed={lock?.kind === "step" && lock.id === step.id}
                    style={row(STEP_H)}
                    onClick={() => toggle({ kind: "step", id: step.id })}
                    onDoubleClick={() => onOpenStep(step.id)}
                  >
                    <span className="cr-node__top">
                      <span className="cr-chain__title">{step.title}</span>
                      <StateTag state={step.state} />
                      {step.needsHuman ? (
                        <Icon name="ph:hand-palm" width={12} height={12} aria-hidden />
                      ) : null}
                    </span>
                    <span className="cr-node__foot">
                      <span>{stageName(step.stage)}</span>
                      <span>{ownerName(step.owner)}</span>
                      <span className="cr-mono">{used.map((capability) => capability.name).join(" · ")}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <span />

          <ul className="cr-orch__lane" style={lane(laneCapabilities.length, CAPABILITY_PITCH)}>
            {laneCapabilities.map((capability) => {
              const users = steps.filter((step) =>
                capabilitiesForStep(step, capabilities).some((used) => used.id === capability.id),
              );
              return (
                <li
                  key={capability.id}
                  className="cr-orch__slot"
                  style={slot(capabilityOrder[capability.id] ?? 0, CAPABILITY_PITCH)}
                >
                  <button
                    type="button"
                    className="cr-orch__row focus-ring"
                    data-lane="capability"
                    data-dim={!users.some((step) => live.has(step.id))}
                    aria-pressed={lock?.kind === "capability" && lock.id === capability.id}
                    style={row(CAPABILITY_H)}
                    onClick={() => toggle({ kind: "capability", id: capability.id })}
                  >
                    <span className="cr-node__top">
                      <span className="cr-orch__kind" data-kind={capability.kind}>
                        {capability.kind}
                      </span>
                      <span className="cr-chain__title">{capability.name}</span>
                      <span className="cr-mono">{users.length}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <span />

          <ul className="cr-orch__lane" style={lane(laneHumans.length, HUMAN_PITCH)}>
            {laneHumans.map((step) => (
              <li key={step.id} className="cr-orch__slot" style={slot(humanOrder[step.id] ?? 0, HUMAN_PITCH)}>
                <button
                  type="button"
                  className="cr-orch__row focus-ring"
                  data-lane="human"
                  data-dim={!live.has(step.id)}
                  aria-pressed={lock?.kind === "step" && lock.id === step.id}
                  style={row(HUMAN_H)}
                  onClick={() => toggle({ kind: "step", id: step.id })}
                >
                  <span className="cr-node__top">
                    <Icon name="ph:warning-diamond" width={11} height={11} aria-hidden />
                    <span className="cr-eyebrow">Owed by you</span>
                  </span>
                  <span className="cr-node__rec-line">{step.notes.trim() || step.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
