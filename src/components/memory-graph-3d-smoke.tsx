"use client";

import { useMemo, useState } from "react";
import { MemoryGraph3D } from "@/components/memory-graph-3d";
import { buildMemoryGraphModel } from "@/lib/memory-graph-3d-model";
import type { Familiar } from "@/lib/types";

const now = new Date().toISOString();

const familiarsList: Familiar[] = [
  { id: "nova", display_name: "Nova", role: "Guide", icon: "ph:sparkle" },
  { id: "cody", display_name: "Cody", role: "Builder", icon: "ph:terminal-window" },
  { id: "sage", display_name: "Sage", role: "Research", icon: "ph:brain" },
];

const covenEntries = [
  {
    id: "smoke-nova-1",
    familiar_id: "nova",
    title: "Nova remembers the constellation architecture",
    path: "/Users/buns/.coven/memory/nova/constellation.md",
    updated_at: now,
    excerpt: "Anchor familiar hubs and keep the list as the retrieval surface.",
  },
  {
    id: "smoke-cody-1",
    familiar_id: "cody",
    title: "Cody records the graph implementation plan",
    path: "/Users/buns/.coven/memory/cody/graph.md",
    updated_at: now,
    excerpt: "Use a dedicated memory graph model and Three.js viewer.",
  },
  {
    id: "smoke-sage-1",
    familiar_id: "sage",
    title: "Sage notes radial layout constraints",
    path: "/Users/buns/.coven/memory/sage/layout.md",
    updated_at: now,
    excerpt: "Avoid free-floating force scatter for dense memory views.",
  },
];

const fileEntries = [
  {
    root: "workspace",
    rootLabel: "Workspace memory",
    relPath: "2026-06-08.md",
    fullPath: "/Users/buns/.openclaw/workspace/memory/2026-06-08.md",
    size: 2400,
    modified: now,
  },
];

export function MemoryGraph3DSmoke() {
  const [selectedFamiliarId, setSelectedFamiliarId] = useState("all");
  const familiars = useMemo(() => new Map(familiarsList.map((familiar) => [familiar.id, familiar])), []);
  const graph = useMemo(
    () =>
      buildMemoryGraphModel({
        familiars: familiarsList,
        covenEntries,
        fileEntries,
        familiarFilter: selectedFamiliarId,
      }),
    [selectedFamiliarId],
  );

  return (
    <main className="h-screen w-screen bg-[var(--bg-base)] p-6 text-[var(--text-primary)]">
      <div className="h-full overflow-hidden border border-[var(--border-hairline)]">
        <MemoryGraph3D
          graph={graph}
          familiars={familiars}
          selectedFamiliarId={selectedFamiliarId}
          onSelectFamiliar={setSelectedFamiliarId}
          onOpenMemoryFile={() => {}}
        />
      </div>
    </main>
  );
}
