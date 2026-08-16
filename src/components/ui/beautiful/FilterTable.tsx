"use client";

import { useState } from "react";

/* ─────────────────────────────────────────────────────────
 * FILTER TABLE
 * Status chips directly filter the task table.
 * ───────────────────────────────────────────────────────── */

type Status = "todo" | "progress" | "done";

const FILTERS: { key: "all" | Status; label: string; dot?: string; count: number }[] = [
  { key: "all", label: "All", count: 5 },
  // CAVE PORT: upstream's three literals are status semantics rather than an
  // arbitrary categorical palette — to-do, in-flight, finished — so each maps
  // onto the token that already means that in Cave. This themes across all 12
  // palettes and both modes, and it is also more truthful than the hex was:
  // "Completed" is now the same green as every other success state in the app.
  // (Copilot Autofix reached the same three mappings independently in 6354f97.)
  { key: "todo", label: "To do", dot: "var(--bui-orange)", count: 2 },
  { key: "progress", label: "In Progress", dot: "var(--bui-accent)", count: 2 },
  { key: "done", label: "Completed", dot: "var(--bui-green)", count: 1 },
];

const ROWS: { task: string; date: string; status: Status; owner: string }[] = [
  { task: "Restock mango sorbet", date: "Dec 03", status: "todo", owner: "Mango Moon Gelato" },
  { task: "Churn black sesame", date: "Sep 22", status: "progress", owner: "Kumo Creamery" },
  { task: "Print summer menu", date: "Jan 02", status: "todo", owner: "Coral Coast Sorbet" },
  { task: "Taste-test batch 42", date: "Nov 08", status: "progress", owner: "Maple Orbit" },
  { task: "Order waffle cones", date: "Apr 14", status: "done", owner: "Aurora Scoops" },
];

const PILLS: Record<Status, { label: string; cls: string }> = {
  todo: { label: "To do", cls: "filter-status-todo" },
  progress: { label: "In Progress", cls: "filter-status-progress" },
  done: { label: "Completed", cls: "filter-status-done" },
};

export function FilterTable() {
  const [filter, setFilter] = useState<"all" | Status>("all");

  return (
    <div className="w-full max-w-105">
      {/* filter chips */}
      <div
        className="-mx-1 mb-1 flex items-center gap-1 overflow-x-auto px-1 py-1 [scrollbar-width:none]!"
      >
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(f.key)}
              className={`flex h-6.5 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[length:var(--text-sm)]
                font-medium transition-[background-color,box-shadow,color] duration-200
                ${active ? "bg-bui-surface text-bui-ink shadow-bui-btn" : "text-bui-ink-2 hover:bg-bui-hover"}`}
            >
              {f.dot && <span className="size-1.5 rounded-full" style={{ background: f.dot }} />}
              {f.label}
              <span
                className={`rounded-[4px] px-1 text-[length:var(--text-xs)] tabular-nums
                  ${active ? "bg-bui-field text-bui-ink-2" : "text-bui-ink-3"}`}
              >
                {f.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* table */}
      <div
        aria-label="Scrollable task table"
        className="overflow-x-auto rounded-bui-card bg-bui-surface shadow-bui-card [scrollbar-width:none]!"
        role="region"
        tabIndex={0}
      >
        <div className="min-w-[420px]">
          <div className="grid grid-cols-[1.3fr_0.6fr_0.95fr_0.9fr] border-b border-bui-line px-3 py-2 text-[length:var(--text-sm)] font-medium text-bui-ink-3">
            <span>Task name</span>
            <span>Date</span>
            <span>Status</span>
            <span>Advisor</span>
          </div>
          {ROWS.map((row) => {
            const shown = filter === "all" || row.status === filter;
            const pill = PILLS[row.status];
            return (
              <div
                key={row.task}
                className="grid transition-[grid-template-rows,opacity] duration-300"
                style={{
                  gridTemplateRows: shown ? "1fr" : "0fr",
                  opacity: shown ? 1 : 0,
                  transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
                }}
              >
                <div className="overflow-hidden">
                  <div
                    className="grid grid-cols-[1.3fr_0.6fr_0.95fr_0.9fr] items-center border-b
                      border-bui-line px-3 py-2 text-[length:var(--text-sm)] transition-colors duration-100
                      last:border-0 hover:bg-bui-hover"
                  >
                    <span className="truncate font-medium text-bui-ink">{row.task}</span>
                    <span className="text-bui-ink-2 tabular-nums">{row.date}</span>
                    <span>
                      <span
                        className={`inline-flex h-5 items-center rounded-[5px] px-1.5
                          text-[length:var(--text-xs)] font-medium ${pill.cls}`}
                      >
                        {pill.label}
                      </span>
                    </span>
                    <span className="truncate text-bui-ink-2">{row.owner}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
