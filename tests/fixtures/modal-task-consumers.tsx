import type { ReactNode } from "react";
import { BoardInspector } from "@/components/board-inspector";
import { CalendarView } from "@/components/calendar-view";
import { NavigatorSurface } from "@/components/role-surfaces/navigator-surface";
import { XPublishPanel } from "@/components/role-surfaces/x-publish-panel";
import { Modal } from "@/components/ui/modal";
import type { RoleSurfaceContext } from "@/lib/role-surfaces";
import { taskReviewCard, taskReviewItem, taskReviewProjects } from "./modal-task-data";
import "@/styles/board.css";

const noop = () => {};
const context: RoleSurfaceContext = {
  activeFamiliar: { id: "fixture-review", display_name: "Review familiar", role: "Navigator" }, activePerson: null, currentThread: null,
  runtimeState: { daemonRunning: false, sessions: [], activeSessionId: null },
  memory: { listEntries: async () => [], readFile: async () => null }, tools: { listTools: async () => [] }, plugins: { listPlugins: async () => [] },
  openUrl: noop, openSession: noop, focusCard: noop, refreshTasks: noop,
};

export function modalTaskFixtures(onClose: () => void): Record<string, ReactNode> {
  return {
    "scoped-long": <div style={{ position: "fixed", inset: 0, overflow: "auto" }}><div style={{ position: "relative", minHeight: "2000px" }}><Modal open scope="container" title="Long document inside a scrolling pane" onClose={onClose} footerActions={<button onClick={onClose}>Close document</button>}>{Array.from({ length: 100 }, (_, index) => <p key={index}>Review section {index + 1}. Preserve authored decisions and record the next action.</p>)}<p>Final scoped document section.</p></Modal></div></div>,
    "board-approval": <BoardInspector card={taskReviewCard} familiars={[]} sessions={[]} projects={taskReviewProjects} onClose={onClose} onPatch={() => false} onMoveStatus={noop} onDelete={async () => {}} onCardReplaced={noop} />,
    "calendar-detail": <CalendarView items={[taskReviewItem]} familiars={[]} onOpenItem={noop} onComplete={noop} onDismiss={noop} onSnooze={noop} />,
    "navigator-stats": <div style={{ position: "fixed", inset: 0, display: "flex", minHeight: 0 }}><NavigatorSurface context={context} /></div>,
    "x-publish-confirm": <XPublishPanel familiarId="fixture-review" />,
  };
}
