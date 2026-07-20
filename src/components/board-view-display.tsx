"use client";

import { Skeleton } from "@/components/ui/skeleton";

export type ViewMode = "kanban" | "table" | "gantt";

/** Read a browser-only board preference, rejecting stale values from old builds. */
export function loadBoardPreference<T extends string>(
  key: string,
  fallback: T,
  valid: T[],
): T {
  if (typeof window === "undefined") return fallback;
  const value = localStorage.getItem(key) as T | null;
  return value !== null && valid.includes(value) ? value : fallback;
}

/** Pixel-matched first-load preview; the controller decides when it is shown. */
export function BoardKanbanSkeleton() {
  return (
    <div className="board-kanban-rail-wrap" aria-hidden>
      <div className="board-kanban-rail">
        {Array.from({ length: 4 }).map((_, column) => (
          <div key={column} className="board-kanban-column">
            <div className="board-kanban-column-header">
              <Skeleton variant="avatar" width={7} height={7} />
              <Skeleton variant="text" width={88} />
            </div>
            <div className="flex flex-col gap-2 p-3">
              {Array.from({ length: 3 - (column % 2) }).map((_, card) => (
                <Skeleton key={card} variant="card" height={66} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
