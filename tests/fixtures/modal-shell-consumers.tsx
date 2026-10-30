import { useEffect, useRef, type ReactNode } from "react";
import { ChatThreadsSheet } from "@/components/chat-threads-sheet";
import { WorkspaceRailSheet } from "@/components/workspace-rail-sheet";
import { SkillRunSummary } from "@/components/skill-stage-card";
import { CaveHomeMigrationBannerTrigger } from "@/components/cave-home-migration-banner";
import { ShellBannersProvider, useShellBanners } from "@/lib/shell-banners";
import { useWorkspaceRailController } from "@/lib/use-workspace-rail-controller";
import { clearChatDebugState, publishChatDebugState } from "@/lib/chat-debug-store";
import { shellRoot, shellSessions, shellSkills } from "./modal-shell-data";
import "@/styles/chat-inner-rail.css";

const noop = () => {};
function MigrationBannerActions() {
  const { banners } = useShellBanners();
  return <>{banners.map(banner => banner.cta ? <button key={banner.id} onClick={banner.cta.onClick}>{banner.cta.label}</button> : null)}</>;
}
function RailFixture({ tab }: { tab: "files" | "changes" }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // Changes reads the ChatView bridge, rather than the rail controller's root.
    // Supply the same synthetic session so this fixture exercises populated data.
    const token = Symbol("modal-rail-fixture");
    publishChatDebugState(token, { sessionId: shellSessions[0].id, session: shellSessions[0], familiar: null, turns: [] });
    return () => clearChatDebugState(token);
  }, []);
  const controller = useWorkspaceRailController({ containerRef, projectRoot: shellRoot, sessionId: null, sessionRunning: false });
  return <div ref={containerRef} style={{ position: "fixed", inset: 0, width: "min(100%, 600px)" }}>
    <button disabled={!controller.mobileAvailable || controller.changeCount === null} onClick={() => { controller.rail.setActiveTab(tab); controller.setMobileOpen(true); }}>Open {tab} rail</button>
    <WorkspaceRailSheet controller={controller} familiar={null} sessionId={null} />
  </div>;
}
export function modalShellFixtures(onClose: () => void): Record<string, ReactNode> {
  return {
    "chat-threads": <ChatThreadsSheet open onClose={onClose} sessions={shellSessions} activeFamiliarId="fixture-review" activeSessionId={shellSessions[0].id} onOpenSession={noop} onDeleteSession={async () => {}} />,
    "run-skills": <SkillRunSummary skills={shellSkills} />,
    "migration-review": <ShellBannersProvider><MigrationBannerActions /><CaveHomeMigrationBannerTrigger /></ShellBannersProvider>,
    "rail-files": <RailFixture tab="files" />,
    "rail-changes": <RailFixture tab="changes" />,
    "rail-files-fullscreen": <RailFixture tab="files" />,
    "rail-changes-fullscreen": <RailFixture tab="changes" />,
  };
}
