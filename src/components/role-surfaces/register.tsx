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
import { INDEXER_SURFACE_ID, MESSENGER_SURFACE_ID, RESEARCHER_SURFACE_ID } from "./ids";

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
  description: "Discovery, synthesis, and source evaluation — the analyst's desk",
  accentHue: 278,
  priority: 30,
  shouldDisplay: () => true,
  getContributions(context) {
    const state = readRoleSurfaceState<{ evidence?: unknown[]; searchHistory?: string[] }>(
      context.activeFamiliar.id,
      RESEARCHER_SURFACE_ID,
    );
    const evidenceCount = state?.evidence?.length ?? 0;
    return {
      commands: [
        {
          id: "researcher.toggle-drawer",
          title: "Toggle reasoning trail",
          hint: "⌘⇧D",
          run: (ctx) => toggleDrawer(ctx, RESEARCHER_SURFACE_ID),
        },
        {
          id: "researcher.clear-search-history",
          title: "Clear search history",
          run: (ctx) => {
            const current = readRoleSurfaceState<object>(ctx.activeFamiliar.id, RESEARCHER_SURFACE_ID) ?? {};
            writeRoleSurfaceState(ctx.activeFamiliar.id, RESEARCHER_SURFACE_ID, {
              ...current,
              searchHistory: [],
            });
          },
        },
      ],
      toolbarActions: [
        {
          id: "researcher.drawer",
          title: "Reasoning trail",
          iconName: "ph:list",
          run: (ctx) => toggleDrawer(ctx, RESEARCHER_SURFACE_ID),
        },
      ],
      keyboardShortcuts: [
        {
          id: "researcher.drawer.kbd",
          combo: "mod+shift+d",
          description: "Toggle the reasoning trail drawer",
          run: (ctx) => toggleDrawer(ctx, RESEARCHER_SURFACE_ID),
        },
      ],
      notifications: daemonNotices(context),
      statusIndicators: [
        {
          id: "researcher.evidence",
          label: `${evidenceCount} evidence`,
          tone: evidenceCount > 0 ? "ok" : "muted",
          detail: "Collected evidence items",
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
