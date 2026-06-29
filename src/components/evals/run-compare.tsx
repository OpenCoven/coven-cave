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
    return <div className="evals-empty">Need at least two runs to compare.</div>;
  }

  const before = ordered.find((r) => r.id === beforeId) ?? ordered[1];
  const after = ordered.find((r) => r.id === afterId) ?? ordered[0];
  const rows = diffRuns(before, after);
  const shown = onlyChanged
    ? rows.filter((r) => r.status !== "pass")
    : rows;

  const label = (r: EvalRun) =>
    `${new Date(r.startedAt).toLocaleString()} · ${Math.round(r.summary.passRate * 100)}%`;

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
    </div>
  );
}
