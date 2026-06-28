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

function SurfaceFallback() {
  // Fills the surface area while the chunk loads so the layout doesn't jump.
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-6" aria-hidden>
      <SkeletonRows count={6} />
    </div>
  );
}

export const ComuxView = dynamic(
  () => import("@/components/comux-view").then((m) => m.ComuxView),
  { ssr: false, loading: SurfaceFallback },
);

export const GitHubView = dynamic(
  () => import("@/components/github-view").then((m) => m.GitHubView),
  { ssr: false, loading: SurfaceFallback },
);

export const FlowView = dynamic(
  () => import("@/components/flow/flow-view").then((m) => m.FlowView),
  { ssr: false, loading: SurfaceFallback },
);

export const EvalsView = dynamic(
  () => import("@/components/evals/evals-view").then((m) => m.EvalsView),
  { ssr: false, loading: SurfaceFallback },
);

export const CalendarView = dynamic(
  () => import("@/components/calendar-view").then((m) => m.CalendarView),
  { ssr: false, loading: SurfaceFallback },
);
