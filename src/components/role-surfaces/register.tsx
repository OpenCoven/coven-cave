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
 * Room components are code-split via next/dynamic (mirroring
 * lazy-surfaces.tsx) so their chunks load on first entry, not at app boot.
 */

import dynamic from "next/dynamic";
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
import { reviewDeckStatus } from "./review-deck";
import {
  INDEXER_SURFACE_ID,
  MESSENGER_SURFACE_ID,
  NAVIGATOR_SURFACE_ID,
  RESEARCHER_SURFACE_ID,
  REVIEWER_SURFACE_ID,
  SCRIBE_SURFACE_ID,
  SENTINEL_SURFACE_ID,
} from "./ids";

function RoomFallback() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-6" aria-hidden>
      <SkeletonRows count={6} />
    </div>
  );
}

const ResearcherSurface = dynamic(
  () => import("./researcher-surface").then((m) => m.ResearcherSurface),
  { ssr: false, loading: RoomFallback },
);
const MessengerSurface = dynamic(
  () => import("./messenger-surface").then((m) => m.MessengerSurface),
  { ssr: false, loading: RoomFallback },
);
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
const ReviewerSurface = dynamic(
  () => import("./reviewer-surface").then((m) => m.ReviewerSurface),
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
    return {
      notifications: daemonNotices(context),
      statusIndicators: [
        {
          id: "researcher.engine",
          label: context.runtimeState.daemonRunning ? "research engine ready" : "research engine offline",
          tone: context.runtimeState.daemonRunning ? "ok" : "warn",
          detail: "Missions run through the familiar's real Flow sessions",
        },
      ],
    };
  },
  render: (context) => <ResearcherSurface context={context} />,
});

registerRoleSurface({
  id: MESSENGER_SURFACE_ID,
  role: "messenger",
  title: "Comms Operations",
  iconName: "ph:paper-plane-tilt",
  description: "Outbound and inbound communication across channels",
  accentHue: 210,
  priority: 20,
  shouldDisplay: () => true,
  getContributions(context) {
    const state = readRoleSurfaceState<{ drafts?: Array<{ status?: string }> }>(
      context.activeFamiliar.id,
      MESSENGER_SURFACE_ID,
    );
    const pending = (state?.drafts ?? []).filter((d) => d.status === "needs-approval").length;
    return {
      commands: [
        {
          id: "messenger.toggle-drawer",
          title: "Toggle delivery queue",
          hint: "⌘⇧D",
          run: (ctx) => toggleDrawer(ctx, MESSENGER_SURFACE_ID),
        },
      ],
      toolbarActions: [
        {
          id: "messenger.drawer",
          title: "Delivery queue",
          iconName: "ph:list",
          run: (ctx) => toggleDrawer(ctx, MESSENGER_SURFACE_ID),
        },
      ],
      keyboardShortcuts: [
        {
          id: "messenger.drawer.kbd",
          combo: "mod+shift+d",
          description: "Toggle the delivery queue drawer",
          run: (ctx) => toggleDrawer(ctx, MESSENGER_SURFACE_ID),
        },
      ],
      notifications: daemonNotices(context),
      statusIndicators: [
        {
          id: "messenger.approvals",
          label: pending > 0 ? `${pending} awaiting approval` : "approvals clear",
          tone: pending > 0 ? "warn" : "ok",
          detail: "Drafts requiring approval before any external send",
        },
      ],
    };
  },
  render: (context) => <MessengerSurface context={context} />,
});

registerRoleSurface({
  id: SENTINEL_SURFACE_ID,
  role: "sentinel",
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
  title: "Chart Room",
  iconName: "ph:compass",
  description: "Course lanes, scheduled legs, and real board moves",
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
  id: REVIEWER_SURFACE_ID,
  role: "reviewer",
  title: "Review Deck",
  iconName: "ph:git-diff",
  description: "Review queue, working-tree diffs, and pull-request context",
  accentHue: 0,
  priority: 26,
  shouldDisplay: () => true,
  getContributions(context) {
    const state = readRoleSurfaceState<{ lastCounts?: { queue: number; pullRequests: number } | null }>(
      context.activeFamiliar.id,
      REVIEWER_SURFACE_ID,
    );
    const counts = state?.lastCounts ?? null;
    const status = counts ? reviewDeckStatus(counts) : null;
    return {
      commands: [
        {
          id: "reviewer.toggle-drawer",
          title: "Toggle checkpoints",
          hint: "⌘⇧D",
          run: (ctx) => toggleDrawer(ctx, REVIEWER_SURFACE_ID),
        },
      ],
      toolbarActions: [
        {
          id: "reviewer.drawer",
          title: "Checkpoints",
          iconName: "ph:list",
          run: (ctx) => toggleDrawer(ctx, REVIEWER_SURFACE_ID),
        },
      ],
      keyboardShortcuts: [
        {
          id: "reviewer.drawer.kbd",
          combo: "mod+shift+d",
          description: "Toggle the checkpoints drawer",
          run: (ctx) => toggleDrawer(ctx, REVIEWER_SURFACE_ID),
        },
      ],
      notifications: daemonNotices(context),
      statusIndicators: [
        status == null
          ? {
              id: "reviewer.queue",
              label: "queue unread",
              tone: "muted" as const,
              detail: "Queue counts appear after the Review Deck's first pass over the sessions",
            }
          : {
              id: "reviewer.queue",
              label: status.label,
              tone: status.tone,
              detail: "Sessions carrying a PR, working changes, or a branch",
            },
      ],
    };
  },
  render: (context) => <ReviewerSurface context={context} />,
});

registerRoleSurface({
  id: INDEXER_SURFACE_ID,
  role: "indexer",
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
