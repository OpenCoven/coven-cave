"use client";

import { useMemo, useState } from "react";
import { diffRuns, type RunDiffStatus } from "@/lib/evals/eval-analytics";
import type { EvalRun } from "@/lib/evals/eval-model";

const STATUS_LABEL: Record<RunDiffStatus, string> = {
  regressed: "Regressed",
  fixed: "Fixed",
  fail: "Fail",
  added: "Added",
  removed: "Removed",
  pass: "Pass",
};

/**
 * Pick two runs (defaults: previous vs latest) and show a case-by-case diff,
 * regressions first. Optionally filter to only changed/failing rows.
 */
export function RunCompare({ runs }: { runs: EvalRun[] }) {
  const ordered = useMemo(
    () => [...runs].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)),
    [runs],
  );
  const [afterId, setAfterId] = useState(() => ordered[0]?.id ?? "");
  const [beforeId, setBeforeId] = useState(() => ordered[1]?.id ?? ordered[0]?.id ?? "");
  const [onlyChanged, setOnlyChanged] = useState(true);

  if (ordered.length < 2) {
    return (
      <div className="evals-empty">
        {ordered.length === 0
          ? "No runs yet — run this suite twice, then compare the results here."
          : "One run recorded. Run the suite again to compare results run-over-run."}
      </div>
    );
  }

  const before = ordered.find((r) => r.id === beforeId) ?? ordered[1];
  const after = ordered.find((r) => r.id === afterId) ?? ordered[0];
  const rows = diffRuns(before, after);
  const shown = onlyChanged
    ? rows.filter((r) => r.status !== "pass")
    : rows;

  // Headline verdict before the row detail: how many cases moved, and which way.
  const counts = new Map<RunDiffStatus, number>();
  for (const r of rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  const summary = (["regressed", "fixed", "added", "removed", "fail"] as RunDiffStatus[])
    .filter((s) => (counts.get(s) ?? 0) > 0)
    .map((s) => ({ status: s, count: counts.get(s)! }));

  const label = (r: EvalRun) =>
    `${new Date(r.startedAt).toLocaleString()} · ${r.summary.passRate >= 1 ? 100 : Math.min(99, Math.round(r.summary.passRate * 100))}%`;

  return (
    <div className="evals-compare">
      <div className="evals-compare__pickers">
        <label>
          Before{" "}
          <select value={beforeId} onChange={(e) => setBeforeId(e.target.value)} aria-label="Baseline run">
            {ordered.map((r) => (
              <option key={r.id} value={r.id}>{label(r)}</option>
            ))}
          </select>
        </label>
        <label>
          After{" "}
          <select value={afterId} onChange={(e) => setAfterId(e.target.value)} aria-label="Comparison run">
            {ordered.map((r) => (
              <option key={r.id} value={r.id}>{label(r)}</option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} /> Only changes
        </label>
      </div>

      {/* Verdict line: what moved between the two runs, before the row detail. */}
      <div className="evals-compare__summary" role="status">
        {summary.length === 0 ? (
          <span className="evals-compare__chip is-clean">No changes · all {rows.length} case{rows.length === 1 ? "" : "s"} identical</span>
        ) : (
          summary.map((s) => (
            <span key={s.status} className={`evals-compare__chip is-${s.status}`}>
              {s.count} {STATUS_LABEL[s.status].toLowerCase()}
            </span>
          ))
        )}
      </div>

      {shown.length === 0 ? (
        <p className="evals-compare__none">
          Untick “Only changes” to see all {rows.length} passing row{rows.length === 1 ? "" : "s"}.
        </p>
      ) : (
        <table className="evals-diff">
          <thead>
            <tr>
              <th>Case</th>
              <th>Before</th>
              <th>After</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.caseId} className={`evals-diff__row--${r.status}`}>
                <td>{r.name}</td>
                <td>{r.before == null ? "—" : r.before ? "Pass" : "Fail"}</td>
                <td>{r.after == null ? "—" : r.after ? "Pass" : "Fail"}</td>
                <td className="evals-diff__status">{STATUS_LABEL[r.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
