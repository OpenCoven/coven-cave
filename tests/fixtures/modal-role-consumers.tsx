import type { ReactNode } from "react";
import { ChartRoomStepSheet } from "@/components/role-surfaces/chart-room-step-sheet";
import type { ChartStep } from "@/components/role-surfaces/chart-room-model";
import { SlotPicker } from "@/components/role-surfaces/x-comms/slot-picker";
import { XPublishRecovery, XPublishError } from "@/components/role-surfaces/x-publish-recovery";
import { MobileHandoffModal } from "@/components/mobile-handoff-modal";
import "@/styles/globals/surface-chart-room.css";
import "@/styles/globals/surface-role-workspaces.css";
import "@/styles/globals/surface-x-comms.css";

const noop = () => {};
const step: ChartStep = {
  id: "fixture-review",
  title: "Review the extended project plan and record unresolved dependencies",
  notes: "Synthetic layout fixture. No task is created, changed or dispatched.",
  stage: "inbox",
  state: "queued",
  owner: null,
  project: null,
  needs: [],
  edges: [],
  external: [],
  needsHuman: false,
  labels: [],
  endDate: null,
  updatedAt: "2026-10-24T12:00:00.000Z",
};
const now = Date.parse("2026-10-24T12:00:00.000Z");

export function modalRoleFixtures(onClose: () => void): Record<string, ReactNode> {
  return {
    "chart-step": <div className="role-surface-room role-surface-room--chart" style={{ position: "fixed", inset: 0 }}><ChartRoomStepSheet
      step={step}
      steps={[{ ...step, id: "upstream", title: "Review the source evidence", stage: "backlog" }, step, { ...step, id: "downstream", title: "Review the resulting changes", stage: "review" }]}
      familiars={[{ id: "fixture", name: "Review familiar" }]}
      projects={[{ id: "fixture", name: "Project planning and dependency review" }]}
      upstreamOpen
      downstreamOpen
      saving={false}
      projectColor={() => null}
      onClose={onClose}
      onTitle={noop}
      onStage={noop}
      onOwner={noop}
      onProject={noop}
      onLink={noop}
      onUnlink={noop}
      onConnect={noop}
      onCut={noop}
      onSelect={noop}
      onToggleUpstream={noop}
      onToggleDownstream={noop}
      onRecommendation={noop}
      onDelete={noop}
      onFocusCard={noop}
    /></div>,
    "slot-picker": <SlotPicker now={now} picked={now + 3_600_000 * 3} onPick={noop} onCancel={onClose} onUse={noop} />,
    "x-recovery": <XPublishRecovery
      error={new XPublishError("Synthetic connection recovery", "not-connected")}
      busy={false}
      connectionSettings={<div><p>Your draft stays available while you review connection settings.</p><label>Connected account <input value="Fixture account" readOnly /></label></div>}
    />,
    "mobile-handoff-off": <MobileHandoffModal open mobileModeEnabled={false} onMobileModeChange={noop} onClose={onClose} />,
  };
}
