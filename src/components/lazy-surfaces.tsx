"use client";

// Code-splitting boundary for heavy, mode-gated workspace surfaces.
//
// These surfaces are only ever *rendered* when their nav mode is active, but a
// static `import` still ships their code (and their heavy transitive deps) in
// the always-loaded main bundle. Routing them through `next/dynamic` moves each
// into its own chunk that the browser fetches on first open instead of at app
// boot. Notably this pulls `@xyflow/react` (FlowView) and
// `@uiw/react-codemirror` (ComuxView → code-editor) out of the shared bundle.
//
// `ssr: false` is safe: the whole app is client-rendered (`workspace.tsx` is a
// client component) and these surfaces are interactive-only.

import dynamic from "next/dynamic";
import { SkeletonRows } from "@/components/ui/skeleton";
import { markStart, markEnd } from "@/lib/perf/marks";

function SurfaceFallback() {
  // Fills the surface area while the chunk loads so the layout doesn't jump.
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-6" aria-hidden>
      <SkeletonRows count={6} />
    </div>
  );
}

// Wrap a lazy loader so the chunk's fetch+parse time is recorded as a
// `surface-load:<name>` perf measure (visible in the ?perf=1 overlay). This is
// the runtime cost of code-splitting these surfaces — worth watching so a
// lazy chunk doesn't grow into a noticeable open-delay.
function timed<C>(name: string, loader: () => Promise<C>): () => Promise<C> {
  return () => {
    markStart(`surface-load:${name}`);
    return loader().then((component) => {
      markEnd(`surface-load:${name}`);
      return component;
    });
  };
}

// (cave-c3yt) The retired ComuxView and FlowView surfaces are fully deleted —
// the standalone Code surface is gone (the chat code rail is the file/terminal
// host; it owns PTY teardown on session switch in chat-surface.tsx) and the
// Flow experience lives on feature/automations-flow (its /api/flows engine +
// webhooks remain live under src/lib/flow + src/lib/server).

export const GitHubView = dynamic(
  timed("github", () => import("@/components/github-view").then((m) => m.GitHubView)),
  { ssr: false, loading: SurfaceFallback },
);

export const CalendarView = dynamic(
  timed("calendar", () => import("@/components/calendar-view").then((m) => m.CalendarView)),
  { ssr: false, loading: SurfaceFallback },
);

export const BoardView = dynamic(
  timed("board", () => import("@/components/board-view").then((m) => m.BoardView)),
  { ssr: false, loading: SurfaceFallback },
);

export const MarketplaceView = dynamic(
  timed("marketplace", () => import("@/components/marketplace-view").then((m) => m.MarketplaceViewSurface)),
  { ssr: false, loading: SurfaceFallback },
);

export const AutomationsView = dynamic(
  timed("automations", () => import("@/components/automations-view").then((m) => m.AutomationsView)),
  { ssr: false, loading: SurfaceFallback },
);

export const FamiliarWorkQueueView = dynamic(
  timed("familiar-work-queue", () =>
    import("@/components/familiar-work-queue-view").then((m) => m.FamiliarWorkQueueView),
  ),
  { ssr: false, loading: SurfaceFallback },
);

// BrowserPane's imperative handle crosses this boundary as the regular
// `handleRef` prop — next/dynamic does not forward element refs (cave-masj).
export const BrowserPane = dynamic(
  timed("browser", () => import("@/components/browser-pane").then((m) => m.BrowserPane)),
  { ssr: false, loading: SurfaceFallback },
);
