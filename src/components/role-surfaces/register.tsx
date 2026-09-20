"use client";

/**
 * Role Surface registration manifest.
 *
 * The ONLY place the initial rooms are named. The Cave shell imports this
 * module for its side effect and otherwise knows nothing about specific
 * roles — adding a future room (Sentinel's watchtower, Scribe's writing
 * desk, Navigator's chart room…) means adding a module + one register call
 * here, never editing shell code. The registry itself is open: any module
 * can call registerRoleSurface at import time and appear identically.
 *
 * Room components are code-split so their chunks load on first entry, not at
 * app boot. Research uses an effect loader to avoid delaying its first read
 * behind the Suspense retry throttle; other rooms use next/dynamic.
 */

import dynamic from "next/dynamic";
import { ResearcherSurfaceLoader } from "./researcher-surface-loader";
import { SkeletonRows } from "@/components/ui/skeleton";
import {
  registerRoleSurface,
  type RoleSurfaceContext,
  type RoleSurfaceContribution,
} from "@/lib/role-surfaces";
import { readRoleSurfaceState, writeRoleSurfaceState } from "@/lib/role-surface-state";
import { watchtowerStatus } from "./sentinel-watch";
import { deskSummary, scribeStatus } from "./scribe-craft";
import { chartRoomStatus } from "./navigator-charts";
import { researchEngineStatus } from "./researcher-status";
import {
  CODE_SURFACE_ID,
  INDEXER_SURFACE_ID,
  NAVIGATOR_SURFACE_ID,
  RESEARCHER_SURFACE_ID,
  SCRIBE_SURFACE_ID,
  SENTINEL_SURFACE_ID,
  X_COMMS_SURFACE_ID,
} from "./ids";

function RoomFallback() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-6" aria-hidden>
      <SkeletonRows count={6} />
    </div>
  );
}

const IndexerSurface = dynamic(
  () => import("./indexer-surface").then((m) => m.IndexerSurface),
  { ssr: false, loading: RoomFallback },
);
const SentinelSurface = dynamic(
  () => import("./sentinel-surface").then((m) => m.SentinelSurface),
  { ssr: false, loading: RoomFallback },
);
const ScribeSurface = dynamic(
  () => import("./scribe-surface").then((m) => m.ScribeSurface),
  { ssr: false, loading: RoomFallback },
);
const NavigatorSurface = dynamic(
  () => import("./navigator-surface").then((m) => m.NavigatorSurface),
  { ssr: false, loading: RoomFallback },
);
const CodeRoom = dynamic(
  () => import("./code-room").then((m) => m.CodeRoom),
  { ssr: false, loading: RoomFallback },
);
const XCommsSurface = dynamic(
  () => import("./x-comms-surface").then((m) => m.XCommsSurface),
  { ssr: false, loading: RoomFallback },
);

/** Flip the shared `drawerOpen` bit of a room's persisted state. The state
 *  hooks shallow-merge stored partials over their initial state, so partial
 *  writes from contributions are safe. */
function toggleDrawer(context: RoleSurfaceContext, surfaceId: string): void {
  const familiarId = context.activeFamiliar.id;
  const current = readRoleSurfaceState<{ drawerOpen?: boolean }>(familiarId, surfaceId) ?? {};
  writeRoleSurfaceState(familiarId, surfaceId, { ...current, drawerOpen: !current.drawerOpen });
}

function daemonNotices(context: RoleSurfaceContext): RoleSurfaceContribution["notifications"] {
  return context.runtimeState.daemonRunning
    ? []
    : [{ id: "daemon-offline", level: "warn" as const, message: "Daemon offline — live data may be stale." }];
}

registerRoleSurface({
  id: RESEARCHER_SURFACE_ID,
  role: "researcher",
  title: "Research Desk",
  iconName: "ph:detective",
  description: "Bounded research missions, evidence, and durable knowledge artifacts",
  accentHue: 278,
  priority: 30,
  shouldDisplay: () => true,
  getContributions(context) {
    const state = readRoleSurfaceState<{ lastLiveRunCount?: number | null }>(
      context.activeFamiliar.id,
      RESEARCHER_SURFACE_ID,
    );
    const status = researchEngineStatus(
      context.runtimeState.daemonRunning,
      state?.lastLiveRunCount ?? null,
    );
    return {
      notifications: daemonNotices(context),
      statusIndicators: [
        {
          id: "researcher.engine",
          label: status.label,
          tone: status.tone,
          detail: "Missions run through the familiar's real Flow sessions",
        },
      ],
    };
  },
  render: (context) => <ResearcherSurfaceLoader context={context} fallback={<RoomFallback />} />,
});

// The Coding familiar's room (cave-cc5r): the full Code workbench, granted by
// the "coder" role token — the Studio's Coding type or a role label carrying
// any of the aliases below. GitHub-item opens also land here, on the room's
// demand-loaded Activity / PRs / Issues / Reviews tabs.
//
// The id stays `code` while the title reads "Coding Desk" (cave-smaji), and
// that gap is deliberate: the id is a PERSISTED workspace mode (`surface:code`)
// that the `?mode=code` and `?mode=github` aliases resolve into, so renaming it
// would strand every stored last-surface and every saved link for a change no
// one can see.
registerRoleSurface({
  id: CODE_SURFACE_ID,
  role: "coder",
  aliases: ["coding", "developer", "engineer", "programmer", "software-engineer", "code"],
  title: "Coding Desk",
  iconName: "ph:code",
  description: "Multi-session coding workbench — diffs, files, terminals, branches, and GitHub",
  accentHue: 250,
  priority: 40,
  shouldDisplay: () => true,
  getContributions(context) {
    return {
      notifications: daemonNotices(context),
      statusIndicators: [
        {
          id: "code.engine",
          label: context.runtimeState.daemonRunning ? "workbench live" : "workbench offline",
          tone: context.runtimeState.daemonRunning ? "ok" : "warn",
          detail: "Sessions, diffs, and terminals ride the familiar's live daemon",
        },
      ],
    };
  },
  render: (context) => <CodeRoom context={context} />,
});

/**
 * X Comms — the X account room, with demo planning and live publishing.
 *
 * Gated on `xPublishEnabled` for the same reason every other X surface is
 * (`x-surface-gating.test.ts`): the capability mirrors a server-side rule, and
 * a room offering an approval an ungated familiar could never act on would be
 * a promise the Cave cannot keep.
 */
registerRoleSurface({
  id: X_COMMS_SURFACE_ID,
  role: "messenger",
  title: "X Comms",
  iconName: "ph:x-logo-bold",
  description: "Plan drafts and publish confirmed posts to X",
  accentHue: 38,
  priority: 18,
  shouldDisplay: (context) => context.activeFamiliar?.xPublishEnabled === true,
  getContributions() {
    return {
      statusIndicators: [
        {
          id: "x-comms.demo",
          label: "demo planning",
          tone: "warn",
          detail:
            "Demo approvals and slots stay local. Use Live publishing to publish to X with confirmation.",
        },
      ],
      notifications: [],
    } satisfies RoleSurfaceContribution;
  },
  render: (context) => <XCommsSurface context={context} />,
});

registerRoleSurface({
  id: SENTINEL_SURFACE_ID,
  role: "sentinel",
  // "watch" was a familiar Type until the vocabulary reduction (cave-lgcb);
  // these aliases keep the Watchtower reachable from Role labels like
  // "guardian-watch" now that the type no longer grants it.
  aliases: ["watch", "guardian"],
  title: "Watchtower",
  iconName: "ph:binoculars",
  description: "Alerts, session watch, and perimeter reachability",
  accentHue: 40,
  priority: 15,
  shouldDisplay: () => true,
  getContributions(context) {
    const state = readRoleSurfaceState<{ lastSummary?: { open: number; critical: number } | null }>(
      context.activeFamiliar.id,
      SENTINEL_SURFACE_ID,
    );
    const sweep = state?.lastSummary ?? null;
    const status = sweep ? watchtowerStatus(sweep) : null;
    return {
      commands: [
        {
          id: "sentinel.toggle-drawer",
          title: "Toggle watch log",
          hint: "⌘⇧D",
          run: (ctx) => toggleDrawer(ctx, SENTINEL_SURFACE_ID),
        },
      ],
      toolbarActions: [
        {
          id: "sentinel.drawer",
          title: "Watch log",
          iconName: "ph:list",
          run: (ctx) => toggleDrawer(ctx, SENTINEL_SURFACE_ID),
        },
      ],
      keyboardShortcuts: [
        {
          id: "sentinel.drawer.kbd",
          combo: "mod+shift+d",
          description: "Toggle the watch log drawer",
          run: (ctx) => toggleDrawer(ctx, SENTINEL_SURFACE_ID),
        },
      ],
      notifications: daemonNotices(context),
      statusIndicators: [
        status == null
          ? {
              id: "sentinel.alerts",
              label: "no sweep yet",
              tone: "muted" as const,
              detail: "Alert counts appear after the Watchtower's first escalation sweep",
            }
          : {
              id: "sentinel.alerts",
              label: status.label,
              tone: status.tone,
              detail: "Unresolved escalations across the Cave, from the shared Inbox store",
            },
      ],
    };
  },
  render: (context) => <SentinelSurface context={context} />,
});

registerRoleSurface({
  id: SCRIBE_SURFACE_ID,
  role: "scribe",
  aliases: ["editor", "writer", "writing"],
  title: "Writing Desk",
  iconName: "ph:feather",
  description: "Drafts, source material, and publishing into the Knowledge Vault",
  accentHue: 320,
  priority: 18,
  shouldDisplay: () => true,
  getContributions(context) {
    const state = readRoleSurfaceState<{ drafts?: Array<{ body?: string; publishedId?: string | null }> }>(
      context.activeFamiliar.id,
      SCRIBE_SURFACE_ID,
    );
    const drafts = (state?.drafts ?? []).map((d) => ({ body: d.body ?? "", publishedId: d.publishedId ?? null }));
    const status = scribeStatus(deskSummary(drafts));
    return {
      commands: [
        {
          id: "scribe.toggle-drawer",
          title: "Toggle published works",
          hint: "⌘⇧D",
          run: (ctx) => toggleDrawer(ctx, SCRIBE_SURFACE_ID),
        },
      ],
      toolbarActions: [
        {
          id: "scribe.drawer",
          title: "Published works",
          iconName: "ph:list",
          run: (ctx) => toggleDrawer(ctx, SCRIBE_SURFACE_ID),
        },
      ],
      keyboardShortcuts: [
        {
          id: "scribe.drawer.kbd",
          combo: "mod+shift+d",
          description: "Toggle the published works drawer",
          run: (ctx) => toggleDrawer(ctx, SCRIBE_SURFACE_ID),
        },
      ],
      notifications: daemonNotices(context),
      statusIndicators: [
        {
          id: "scribe.desk",
          label: status.label,
          tone: status.tone,
          detail: "Local drafts on the desk; publishing writes real Knowledge Vault entries",
        },
      ],
    };
  },
  render: (context) => <ScribeSurface context={context} />,
});

registerRoleSurface({
  id: NAVIGATOR_SURFACE_ID,
  role: "navigator",
  aliases: ["planner", "planning", "navigation"],
  title: "Chart Room",
  iconName: "ph:compass",
  description: "The board as a course — flow, graph, orchestration, and what's owed",
  accentHue: 105,
  priority: 22,
  shouldDisplay: () => true,
  getContributions(context) {
    const state = readRoleSurfaceState<{ lastCounts?: { running: number; blocked: number } | null }>(
      context.activeFamiliar.id,
      NAVIGATOR_SURFACE_ID,
    );
    const counts = state?.lastCounts ?? null;
    const status = counts ? chartRoomStatus(counts) : null;
    return {
      commands: [
        {
          id: "navigator.toggle-drawer",
          title: "Toggle voyage log",
          hint: "⌘⇧D",
          run: (ctx) => toggleDrawer(ctx, NAVIGATOR_SURFACE_ID),
        },
      ],
      toolbarActions: [
        {
          id: "navigator.drawer",
          title: "Voyage log",
          iconName: "ph:list",
          run: (ctx) => toggleDrawer(ctx, NAVIGATOR_SURFACE_ID),
        },
      ],
      keyboardShortcuts: [
        {
          id: "navigator.drawer.kbd",
          combo: "mod+shift+d",
          description: "Toggle the voyage log drawer",
          run: (ctx) => toggleDrawer(ctx, NAVIGATOR_SURFACE_ID),
        },
      ],
      notifications: daemonNotices(context),
      statusIndicators: [
        status == null
          ? {
              id: "navigator.course",
              label: "course unplotted",
              tone: "muted" as const,
              detail: "Lane counts appear after the Chart Room's first board read",
            }
          : {
              id: "navigator.course",
              label: status.label,
              tone: status.tone,
              detail: "Cards charted for this familiar (or unassigned) on the real board",
            },
      ],
    };
  },
  render: (context) => <NavigatorSurface context={context} />,
});

registerRoleSurface({
  id: INDEXER_SURFACE_ID,
  role: "indexer",
  aliases: ["archivist", "indexing", "memory", "reflection"],
  title: "The Archive",
  iconName: "ph:tree-structure",
  description: "Long-term knowledge, memory, indexes, and provenance",
  accentHue: 158,
  priority: 10,
  shouldDisplay: () => true,
  getContributions(context) {
    const state = readRoleSurfaceState<{ tags?: Record<string, string[]> }>(
      context.activeFamiliar.id,
      INDEXER_SURFACE_ID,
    );
    const taggedCount = Object.values(state?.tags ?? {}).filter((tags) => tags.length > 0).length;
    return {
      commands: [
        {
          id: "indexer.toggle-drawer",
          title: "Toggle indexing activity",
          hint: "⌘⇧D",
          run: (ctx) => toggleDrawer(ctx, INDEXER_SURFACE_ID),
        },
      ],
      toolbarActions: [
        {
          id: "indexer.drawer",
          title: "Indexing activity",
          iconName: "ph:list",
          run: (ctx) => toggleDrawer(ctx, INDEXER_SURFACE_ID),
        },
      ],
      keyboardShortcuts: [
        {
          id: "indexer.drawer.kbd",
          combo: "mod+shift+d",
          description: "Toggle the indexing activity drawer",
          run: (ctx) => toggleDrawer(ctx, INDEXER_SURFACE_ID),
        },
      ],
      notifications: daemonNotices(context),
      statusIndicators: [
        {
          id: "indexer.tagged",
          label: `${taggedCount} tagged`,
          tone: taggedCount > 0 ? "ok" : "muted",
          detail: "Memories carrying local semantic tags",
        },
      ],
    };
  },
  render: (context) => <IndexerSurface context={context} />,
});
