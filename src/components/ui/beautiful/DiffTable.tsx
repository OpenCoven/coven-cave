"use client";

import { useEffect, useState } from "react";

/* ─────────────────────────────────────────────────────────
 * DIFF TABLE
 * The proposed edit plays once and rests on the completed diff.
 * ───────────────────────────────────────────────────────── */

function useStage(steps: number[]) {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (stage >= steps.length) return;
    const t = setTimeout(() => setStage((s) => s + 1), steps[stage]);
    return () => clearTimeout(t);
  }, [stage, steps]);
  return stage;
}

const ROWS = [
  { id: "Rocky Road", dept: "Classic", email: "aurora-scoops", removed: true },
  { id: "Bubblegum", dept: "Retro", email: "kumo-creamery", removed: true },
  { id: "Mint Chip", dept: "Classic", email: "maple-orbit", removed: false },
];

const DOT: Record<string, string> = {
  Classic: "bg-bui-accent",
  Retro: "bg-bui-ink-3",
  Seasonal: "bg-bui-orange",
};

export function DiffTable() {
  const stage = useStage([800, 1000, 1000]);
  // 0 plain · 1 red tint · 2 completed diff
  const tinted = stage >= 2;
  const added = stage >= 3;

  return (
    <div className="w-full max-w-95">
      <div className="relative overflow-hidden rounded-bui-card bg-bui-surface shadow-bui-card">
        <div className="primitive-card-bar flex items-center justify-between border-b border-bui-line">
          <span className="text-[length:var(--text-base)] font-medium text-bui-ink">Proposed menu cleanup</span>
        </div>

        <table className="w-full table-fixed border-collapse text-left">
          <colgroup>
            <col className="w-[34%]" />
            <col className="w-[30%]" />
            <col className="w-[36%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-bui-line">
              {["Flavor", "Category", "Supplier"].map((h) => (
                <th key={h} className="primitive-table-cell text-[length:var(--text-sm)] font-medium text-bui-ink-3">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => {
              const out = row.removed && tinted;
              return (
                <tr
                  key={row.id}
                  className="border-b border-bui-line transition-colors duration-400 last:border-0 hover:bg-bui-hover"
                  style={{ background: out ? "var(--bui-red-tint)" : undefined }}
                >
                  <td
                    className="primitive-table-cell text-[length:var(--text-base)] font-medium tabular-nums transition-colors duration-400"
                    style={{ color: out ? "var(--bui-red)" : "var(--bui-ink)" }}
                  >
                    {row.id}
                  </td>
                  <td className="primitive-table-cell">
                    <span
                      className="inline-flex h-5.5 items-center gap-1.5 rounded-full bg-bui-inset px-2 text-[length:var(--text-sm)] font-medium shadow-bui-hairline transition-opacity duration-400"
                      style={{ opacity: out ? 0.55 : 1 }}
                    >
                      <span className={`size-1.5 rounded-full ${DOT[row.dept]}`} />
                      <span className="text-bui-ink-2">{row.dept}</span>
                    </span>
                  </td>
                  <td
                    className="primitive-table-cell text-[length:var(--text-base)] whitespace-nowrap transition-colors duration-400"
                    style={{
                      color: out ? "var(--bui-red)" : "var(--bui-ink-2)",
                      textDecorationLine: out ? "line-through" : "none",
                      textDecorationColor: "color-mix(in srgb, var(--bui-red) 50%, transparent)",
                    }}
                  >
                    {row.email}
                  </td>
                </tr>
              );
            })}
            {/* added row */}
            <tr>
              <td colSpan={3} className="p-0">
                <div
                  className="grid transition-[grid-template-rows,opacity] duration-400"
                  style={{
                    gridTemplateRows: added ? "1fr" : "0fr",
                    opacity: added ? 1 : 0,
                    transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
                  }}
                >
                  <div className="overflow-hidden [background:var(--bui-green-tint)]!">
                    <div className="grid grid-cols-[34%_30%_36%] items-center border-t border-bui-line">
                      <span className="primitive-table-cell text-[length:var(--text-base)] font-medium text-bui-green tabular-nums">
                        Pistachio
                      </span>
                      <span className="primitive-table-cell">
                        <span className="inline-flex h-5.5 items-center gap-1.5 rounded-full bg-bui-surface px-2 text-[length:var(--text-sm)] font-medium shadow-bui-hairline">
                          <span className="size-1.5 rounded-full bg-bui-green" />
                          <span className="text-bui-ink-2">Seasonal</span>
                        </span>
                      </span>
                      <span className="primitive-table-cell text-[length:var(--text-base)] text-bui-green">
                        maple-orbit
                      </span>
                    </div>
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
