"use client";

/**
 * Research Desk — a five-tab control plane over real familiar sessions.
 *
 * The surface is a tab host (cave-dl74): Prompt (mission intake), Desk
 * (mission list + detail + evidence ledger), Library (artifacts), Studio
 * (generations), Resources (saved links). Flow remains the executor, Knowledge
 * remains the durable artifact vault, and the familiar's real session remains
 * the escape hatch for direct steering.
 *
 * The tab-host contract below is fixed in Phase A — tab components receive
 * `research` (the shared useResearchMissions instance), `context` (the role
 * surface context) and `onNavigate` (cross-tab jumps, optionally selecting a
 * mission or preselecting a Prompt mode). B agents build on it, not around it.
 */

// Surface sheets ride with this mode-gated component instead of the root
// globals.css so the home first-load stays inside the CSS bundle budget
// (#3264 pattern; the desk sheet carries the tab strip, then one per tab).
import "@/styles/globals/surface-research-desk.css";
import "@/styles/globals/surface-research-prompt.css";
import "@/styles/globals/surface-research-library.css";
import "@/styles/globals/surface-research-studio.css";
import "@/styles/globals/surface-research-resources.css";
import { useCallback, useEffect, useState } from "react";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import type { ResearchMissionMode, ResearchMissionStatus } from "@/lib/research-missions";
import type { RoleSurfaceContext } from "@/lib/role-surfaces";
import { ResearchTabDesk } from "./research-tab-desk";
import { ResearchTabLibrary } from "./research-tab-library";
import { ResearchTabPrompt } from "./research-tab-prompt";
import { ResearchTabResources } from "./research-tab-resources";
import { ResearchTabStudio } from "./research-tab-studio";
import { useResearchMissions } from "./use-research-missions";

export type ResearchDeskTab = "prompt" | "desk" | "library" | "studio" | "resources";

export type ResearchTabNavigateOptions = {
  /** Select this mission (research.select) before switching tabs. */
  missionId?: string;
  /** Preselect a composer mode on the Prompt tab (deep loop = "autoresearch"). */
  mode?: ResearchMissionMode;
};

export type ResearchTabNavigate = (tab: ResearchDeskTab, opts?: ResearchTabNavigateOptions) => void;

/** Shared prop contract for every tab component (fixed in Phase A). */
export type ResearchTabProps = {
  research: ReturnType<typeof useResearchMissions>;
  context: RoleSurfaceContext;
  onNavigate: ResearchTabNavigate;
};

const TAB_STORAGE_KEY = "cave:research:tab";

const TAB_IDS: readonly ResearchDeskTab[] = ["prompt", "desk", "library", "studio", "resources"];

const TAB_LABELS: Record<ResearchDeskTab, string> = {
  prompt: "Prompt",
  desk: "Desk",
  library: "Library",
  studio: "Studio",
  resources: "Resources",
};

/** Missions the engine is actively working — the header's "N runs live". */
const LIVE_STATUSES: ReadonlySet<ResearchMissionStatus> = new Set(["running", "planning", "queued"]);

function isResearchDeskTab(value: string | null): value is ResearchDeskTab {
  return value !== null && (TAB_IDS as readonly string[]).includes(value);
}

/** Stored tab preference; SSR-safe (the surface loads with ssr:false, but the
 *  guard keeps the module import-safe under node --test / prerender). */
function readStoredTab(): ResearchDeskTab | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(TAB_STORAGE_KEY);
    return isResearchDeskTab(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function ResearcherSurface({ context }: { context: RoleSurfaceContext }) {
  const research = useResearchMissions(context.activeFamiliar.id);
  const [tab, setTab] = useState<ResearchDeskTab | null>(readStoredTab);
  const [promptMode, setPromptMode] = useState<ResearchMissionMode | null>(null);

  // No stored preference: land on the desk when missions exist (or are still
  // loading — the desk shows its own loading state), otherwise start at the
  // Prompt intake. Only explicit selections persist, so the default keeps
  // tracking reality instead of freezing the first visit's answer.
  const activeTab: ResearchDeskTab =
    tab ?? (research.loading || research.missions.length > 0 ? "desk" : "prompt");

  const selectTab = useCallback((next: ResearchDeskTab) => {
    setTab(next);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(TAB_STORAGE_KEY, next);
    } catch {
      // Private mode / quota — selection still works for the session.
    }
  }, []);

  const select = research.select;
  const onNavigate = useCallback<ResearchTabNavigate>((next, opts) => {
    if (opts?.missionId) select(opts.missionId);
    if (opts?.mode !== undefined) setPromptMode(opts.mode);
    selectTab(next);
  }, [select, selectTab]);

  // A routed Prompt mode is one-shot: once the Prompt tab has rendered with it
  // (its effects consume initialMode before this parent effect runs), clear it
  // so later manual visits to the tab never re-apply a stale mode.
  useEffect(() => {
    if (activeTab === "prompt" && promptMode !== null) setPromptMode(null);
  }, [activeTab, promptMode]);

  // Engine status, derived honestly from the daemon + live mission count.
  const daemonRunning = context.runtimeState.daemonRunning;
  const liveCount = research.missions.filter((mission) => LIVE_STATUSES.has(mission.status)).length;
  const engineStatus = daemonRunning
    ? `Engine ready · ${liveCount} run${liveCount === 1 ? "" : "s"} live`
    : "Engine offline · runs stay retryable";

  // Checkpoint dot on the Desk tab label — only while the desk is not looking.
  const checkpointWaiting = research.missions.some((mission) => mission.status === "checkpoint");
  const deskBadge = checkpointWaiting && activeTab !== "desk";

  const tabItems: Array<TabItem<ResearchDeskTab>> = TAB_IDS.map((id) => ({
    id,
    label: id === "desk" && deskBadge ? (
      <span className="research-desk__tab-flag">
        {TAB_LABELS[id]}
        <span className="research-desk__tab-dot" aria-hidden />
        <span className="sr-only"> — a run is waiting at a checkpoint</span>
      </span>
    ) : TAB_LABELS[id],
  }));

  return (
    <div className="research-desk">
      <div className="research-desk__tabs">
        <Tabs<ResearchDeskTab>
          items={tabItems}
          value={activeTab}
          onChange={selectTab}
          ariaLabel="Research desk views"
          idPrefix="research-desk"
          size="sm"
          bordered={false}
        />
        <span
          className="research-desk__engine"
          data-tone={daemonRunning ? "ok" : "warn"}
          role="status"
        >
          <i className="research-desk__engine-dot" aria-hidden />
          {engineStatus}
        </span>
      </div>

      <div
        role="tabpanel"
        id={`research-desk-panel-${activeTab}`}
        aria-labelledby={`research-desk-tab-${activeTab}`}
        className="research-desk__panel"
      >
        {activeTab === "prompt" ? (
          <ResearchTabPrompt
            research={research}
            context={context}
            onNavigate={onNavigate}
            initialMode={promptMode ?? undefined}
          />
        ) : activeTab === "desk" ? (
          <ResearchTabDesk research={research} context={context} onNavigate={onNavigate} />
        ) : activeTab === "library" ? (
          <ResearchTabLibrary research={research} context={context} onNavigate={onNavigate} />
        ) : activeTab === "studio" ? (
          <ResearchTabStudio research={research} context={context} onNavigate={onNavigate} />
        ) : (
          <ResearchTabResources research={research} context={context} onNavigate={onNavigate} />
        )}
      </div>
    </div>
  );
}
