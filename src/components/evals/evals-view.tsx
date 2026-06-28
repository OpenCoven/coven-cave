"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Icon } from "@/lib/icon";
import { EmptyState } from "@/components/ui/empty-state";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import {
  suiteRunBlockReason,
  type EvalSuite,
  type EvalCase,
  type EvalRun,
  type Grader,
  type GraderKind,
} from "@/lib/evals/eval-model";
import { runSuite, type RunProgress } from "@/lib/evals/eval-runner";
import "@/styles/evals.css";

type Props = {
  familiars: ResolvedFamiliar[];
  activeFamiliarId?: string | null;
};

type GraderKindOption = { kind: GraderKind; label: string; hint: string; valueless?: boolean };

const GRADER_OPTIONS: GraderKindOption[] = [
  { kind: "contains", label: "Contains", hint: "substring the answer must include" },
  { kind: "not_contains", label: "Excludes", hint: "substring the answer must NOT include" },
  { kind: "equals", label: "Equals", hint: "exact expected answer (trimmed)" },
  { kind: "regex", label: "Matches regex", hint: "regular expression" },
  { kind: "json_has", label: "JSON has path", hint: "e.g. result.items.0.id" },
  { kind: "latency_under", label: "Latency under", hint: "milliseconds" },
  { kind: "llm_judge", label: "LLM judge", hint: "rubric the judge grades against", valueless: true },
];

function nowIso(): string {
  return new Date().toISOString();
}

function freshId(prefix: string): string {
  try {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  } catch {
    return `${prefix}-${Date.now().toString(36)}`;
  }
}

function newSuite(): EvalSuite {
  return {
    id: freshId("suite"),
    name: "Untitled suite",
    description: "",
    cases: [newCase()],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function newCase(): EvalCase {
  return { id: freshId("case"), name: "New case", input: "", graders: [{ kind: "contains", value: "" }] };
}

export function EvalsView({ familiars, activeFamiliarId }: Props) {
  const [suites, setSuites] = useState<EvalSuite[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EvalSuite | null>(null);
  const [savedJson, setSavedJson] = useState<string>("");
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [tab, setTab] = useState<"editor" | "runs">("editor");
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const dirty = useMemo(() => (draft ? JSON.stringify(draft) !== savedJson : false), [draft, savedJson]);
  const familiarId = draft?.familiarId || activeFamiliarId || familiars[0]?.id || "";
  const blockReason = draft ? suiteRunBlockReason({ ...draft, familiarId }, familiarId) : "Select a suite";

  // Load suites once.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/evals/suites");
        const data = (await res.json()) as { ok: boolean; suites?: EvalSuite[] };
        if (!alive) return;
        const list = data.suites ?? [];
        setSuites(list);
        if (list.length) selectSuite(list[0]);
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectSuite = useCallback((suite: EvalSuite) => {
    setSelectedId(suite.id);
    setDraft(structuredClone(suite));
    setSavedJson(JSON.stringify(suite));
    setExpandedRunId(null);
    setTab("editor");
    void (async () => {
      try {
        const res = await fetch(`/api/evals/runs?suiteId=${encodeURIComponent(suite.id)}`);
        const data = (await res.json()) as { ok: boolean; runs?: EvalRun[] };
        setRuns(data.runs ?? []);
      } catch {
        setRuns([]);
      }
    })();
  }, []);

  const createSuite = useCallback(() => {
    const suite = newSuite();
    setSuites((prev) => [suite, ...prev]);
    setSelectedId(suite.id);
    setDraft(suite);
    setSavedJson(""); // unsaved
    setRuns([]);
    setTab("editor");
  }, []);

  const patchDraft = useCallback((patch: Partial<EvalSuite>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }, []);

  const patchCase = useCallback((idx: number, patch: Partial<EvalCase>) => {
    setDraft((d) => {
      if (!d) return d;
      const cases = d.cases.map((c, i) => (i === idx ? { ...c, ...patch } : c));
      return { ...d, cases };
    });
  }, []);

  const patchGrader = useCallback((ci: number, gi: number, patch: Partial<Grader>) => {
    setDraft((d) => {
      if (!d) return d;
      const cases = d.cases.map((c, i) => {
        if (i !== ci) return c;
        return { ...c, graders: c.graders.map((g, j) => (j === gi ? { ...g, ...patch } : g)) };
      });
      return { ...d, cases };
    });
  }, []);

  const save = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch("/api/evals/suites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ suite: { ...draft, updatedAt: nowIso() } }),
      });
      const data = (await res.json()) as { ok: boolean; suite?: EvalSuite };
      if (data.ok && data.suite) {
        const saved = data.suite;
        setDraft(saved);
        setSavedJson(JSON.stringify(saved));
        setSuites((prev) => {
          const without = prev.filter((s) => s.id !== saved.id);
          return [saved, ...without];
        });
      }
    } finally {
      setSaving(false);
    }
  }, [draft]);

  const remove = useCallback(async () => {
    if (!draft) return;
    await fetch(`/api/evals/suites?id=${encodeURIComponent(draft.id)}`, { method: "DELETE" });
    setSuites((prev) => {
      const next = prev.filter((s) => s.id !== draft.id);
      if (next.length) selectSuite(next[0]);
      else {
        setSelectedId(null);
        setDraft(null);
      }
      return next;
    });
  }, [draft, selectSuite]);

  const run = useCallback(async () => {
    if (!draft || blockReason) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setTab("runs");
    setProgress({ index: 0, total: draft.cases.length, results: [], phase: "running" });
    try {
      const famName = familiars.find((f) => f.id === familiarId)?.display_name;
      const result = await runSuite({
        suite: draft,
        familiarId,
        familiarName: famName,
        signal: controller.signal,
        onProgress: setProgress,
      });
      setRuns((prev) => [result, ...prev]);
      setExpandedRunId(result.id);
      // Persist (best-effort; desktop-only route).
      void fetch("/api/evals/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ run: result }),
      }).catch(() => {});
    } finally {
      setRunning(false);
      setProgress(null);
      abortRef.current = null;
    }
  }, [draft, blockReason, familiarId, familiars]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  if (loaded && suites.length === 0 && !draft) {
    return (
      <div className="evals evals-empty">
        <EmptyState
          icon="ph:flask"
          headline="Run evals on your familiars"
          subtitle="Build a suite of test cases, grade each answer with deterministic checks or an LLM judge, and track pass rates over time."
          actions={
            <button type="button" className="evals-btn evals-btn-primary" onClick={createSuite}>
              <Icon name="ph:plus" width={14} /> New eval suite
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="evals">
      <aside className="evals-rail">
        <div className="evals-rail-head">
          <span className="evals-rail-title">Evals</span>
          <button type="button" className="evals-icon-btn" onClick={createSuite} title="New eval suite" aria-label="New eval suite">
            <Icon name="ph:plus" width={14} />
          </button>
        </div>
        <ul className="evals-suite-list">
          {suites.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className={`evals-suite-row${s.id === selectedId ? " is-active" : ""}`}
                onClick={() => selectSuite(s)}
              >
                <span className="evals-suite-name">{s.name}</span>
                <span className="evals-suite-meta">{s.cases.length} case{s.cases.length === 1 ? "" : "s"}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {draft ? (
        <section className="evals-main">
          <header className="evals-toolbar">
            <input
              className="evals-name-input"
              value={draft.name}
              onChange={(e) => patchDraft({ name: e.target.value })}
              aria-label="Suite name"
            />
            <label className="evals-familiar-pick">
              <span className="evals-familiar-label">Familiar</span>
              <select
                value={familiarId}
                onChange={(e) => patchDraft({ familiarId: e.target.value })}
                aria-label="Familiar to evaluate"
              >
                {familiars.length === 0 && <option value="">No familiars</option>}
                {familiars.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.display_name}
                  </option>
                ))}
              </select>
            </label>
            <div className="evals-toolbar-tabs" role="tablist" aria-label="Suite view">
              <button type="button" role="tab" aria-selected={tab === "editor"} className={`evals-tab${tab === "editor" ? " is-active" : ""}`} onClick={() => setTab("editor")}>
                Editor
              </button>
              <button type="button" role="tab" aria-selected={tab === "runs"} className={`evals-tab${tab === "runs" ? " is-active" : ""}`} onClick={() => setTab("runs")}>
                Runs{runs.length ? ` (${runs.length})` : ""}
              </button>
            </div>
            <div className="evals-toolbar-actions">
              <button type="button" className="evals-btn" onClick={save} disabled={saving || !dirty}>
                {saving ? "Saving…" : dirty ? "Save" : "Saved"}
              </button>
              {running ? (
                <button type="button" className="evals-btn evals-btn-stop" onClick={stop}>
                  <span className="evals-spinner" aria-hidden /> Stop
                </button>
              ) : (
                <button
                  type="button"
                  className="evals-btn evals-btn-primary"
                  onClick={run}
                  disabled={Boolean(blockReason)}
                  title={blockReason ?? "Run this suite against the familiar"}
                >
                  <Icon name="ph:play" width={13} /> Run
                </button>
              )}
            </div>
          </header>

          {tab === "editor" ? (
            <SuiteEditor draft={draft} patchDraft={patchDraft} patchCase={patchCase} patchGrader={patchGrader} setDraft={setDraft} />
          ) : (
            <RunsPanel
              runs={runs}
              progress={progress}
              running={running}
              expandedRunId={expandedRunId}
              onToggle={(id) => setExpandedRunId((cur) => (cur === id ? null : id))}
            />
          )}
        </section>
      ) : null}
    </div>
  );
}

// ---- Editor ----------------------------------------------------------------

function SuiteEditor({
  draft,
  patchDraft,
  patchCase,
  patchGrader,
  setDraft,
}: {
  draft: EvalSuite;
  patchDraft: (patch: Partial<EvalSuite>) => void;
  patchCase: (idx: number, patch: Partial<EvalCase>) => void;
  patchGrader: (ci: number, gi: number, patch: Partial<Grader>) => void;
  setDraft: Dispatch<SetStateAction<EvalSuite | null>>;
}) {
  const addCase = () => setDraft((d) => (d ? { ...d, cases: [...d.cases, newCase()] } : d));
  const removeCase = (idx: number) =>
    setDraft((d) => (d ? { ...d, cases: d.cases.filter((_, i) => i !== idx) } : d));
  const addGrader = (ci: number) =>
    setDraft((d) =>
      d ? { ...d, cases: d.cases.map((c, i) => (i === ci ? { ...c, graders: [...c.graders, { kind: "contains", value: "" } as Grader] } : c)) } : d,
    );
  const removeGrader = (ci: number, gi: number) =>
    setDraft((d) =>
      d ? { ...d, cases: d.cases.map((c, i) => (i === ci ? { ...c, graders: c.graders.filter((_, j) => j !== gi) } : c)) } : d,
    );

  return (
    <div className="evals-editor">
      <textarea
        className="evals-desc"
        value={draft.description ?? ""}
        placeholder="What does this suite check? (optional)"
        onChange={(e) => patchDraft({ description: e.target.value })}
        rows={2}
        aria-label="Suite description"
      />
      <div className="evals-cases">
        {draft.cases.map((c, ci) => (
          <article className="evals-case" key={c.id}>
            <div className="evals-case-head">
              <span className="evals-case-num">{ci + 1}</span>
              <input
                className="evals-case-name"
                value={c.name}
                onChange={(e) => patchCase(ci, { name: e.target.value })}
                aria-label={`Case ${ci + 1} name`}
              />
              <button type="button" className="evals-icon-btn" onClick={() => removeCase(ci)} title="Delete case" aria-label="Delete case">
                <Icon name="ph:trash" width={13} />
              </button>
            </div>
            <textarea
              className="evals-case-input"
              value={c.input}
              placeholder="Prompt to send to the familiar"
              onChange={(e) => patchCase(ci, { input: e.target.value })}
              rows={2}
              aria-label={`Case ${ci + 1} input`}
            />
            <div className="evals-graders">
              {c.graders.map((g, gi) => (
                <GraderRow
                  key={gi}
                  grader={g}
                  onChange={(patch) => patchGrader(ci, gi, patch)}
                  onRemove={() => removeGrader(ci, gi)}
                />
              ))}
              <button type="button" className="evals-add-grader" onClick={() => addGrader(ci)}>
                <Icon name="ph:plus" width={12} /> Add check
              </button>
            </div>
          </article>
        ))}
      </div>
      <button type="button" className="evals-add-case" onClick={addCase}>
        <Icon name="ph:plus" width={14} /> Add case
      </button>
    </div>
  );
}

function GraderRow({ grader, onChange, onRemove }: { grader: Grader; onChange: (patch: Partial<Grader>) => void; onRemove: () => void }) {
  const opt = GRADER_OPTIONS.find((o) => o.kind === grader.kind) ?? GRADER_OPTIONS[0];
  const showCase = grader.kind === "contains" || grader.kind === "not_contains" || grader.kind === "equals" || grader.kind === "regex";
  return (
    <div className="evals-grader">
      <select
        className="evals-grader-kind"
        value={grader.kind}
        onChange={(e) => onChange({ kind: e.target.value as GraderKind })}
        aria-label="Check type"
      >
        {GRADER_OPTIONS.map((o) => (
          <option key={o.kind} value={o.kind}>
            {o.label}
          </option>
        ))}
      </select>
      {opt.valueless ? (
        <input
          className="evals-grader-value"
          value={grader.rubric ?? ""}
          placeholder={opt.hint}
          onChange={(e) => onChange({ rubric: e.target.value })}
          aria-label="Judge rubric"
        />
      ) : (
        <input
          className="evals-grader-value"
          value={grader.value}
          placeholder={opt.hint}
          inputMode={grader.kind === "latency_under" ? "numeric" : "text"}
          onChange={(e) => onChange({ value: e.target.value })}
          aria-label="Expected value"
        />
      )}
      {showCase && (
        <label className="evals-grader-ci" title="Case-insensitive">
          <input type="checkbox" checked={grader.caseInsensitive ?? false} onChange={(e) => onChange({ caseInsensitive: e.target.checked })} />
          Aa
        </label>
      )}
      <button type="button" className="evals-icon-btn" onClick={onRemove} title="Remove check" aria-label="Remove check">
        <Icon name="ph:x" width={12} />
      </button>
    </div>
  );
}

// ---- Runs ------------------------------------------------------------------

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function RunsPanel({
  runs,
  progress,
  running,
  expandedRunId,
  onToggle,
}: {
  runs: EvalRun[];
  progress: RunProgress | null;
  running: boolean;
  expandedRunId: string | null;
  onToggle: (id: string) => void;
}) {
  if (running && progress) {
    return (
      <div className="evals-runs">
        <div className="evals-progress">
          <div className="evals-progress-head">
            <span className="evals-spinner" aria-hidden /> Running case {Math.min(progress.index + 1, progress.total)} of {progress.total}
          </div>
          <div className="evals-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.results.length}>
            <span style={{ width: pct(progress.total ? progress.results.length / progress.total : 0) }} />
          </div>
          {progress.results.length > 0 && <ResultTable results={progress.results} />}
        </div>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="evals-runs">
        <p className="evals-runs-empty">No runs yet. Press <strong>Run</strong> to evaluate this suite.</p>
      </div>
    );
  }

  return (
    <div className="evals-runs">
      {runs.map((r) => {
        const open = r.id === expandedRunId;
        const passed = r.summary.passRate >= 0.999;
        return (
          <article className={`evals-run${open ? " is-open" : ""}`} key={r.id}>
            <button type="button" className="evals-run-head" onClick={() => onToggle(r.id)} aria-expanded={open}>
              <span className={`evals-run-rate${passed ? " is-pass" : r.summary.passRate >= 0.5 ? " is-mid" : " is-fail"}`}>{pct(r.summary.passRate)}</span>
              <span className="evals-run-meta">
                <span className="evals-run-count">{r.summary.passed}/{r.summary.total} passed</span>
                <span className="evals-run-sub">{r.familiarName ?? r.familiarId} · {new Date(r.startedAt).toLocaleString()} · {Math.round(r.summary.avgLatencyMs)}ms avg</span>
              </span>
              <Icon name={open ? "ph:caret-up" : "ph:caret-down"} width={14} />
            </button>
            {open && <ResultTable results={r.results} />}
          </article>
        );
      })}
    </div>
  );
}

function ResultTable({ results }: { results: EvalRun["results"] }) {
  return (
    <ul className="evals-result-list">
      {results.map((res) => (
        <li className={`evals-result${res.pass ? " is-pass" : " is-fail"}`} key={res.caseId}>
          <div className="evals-result-head">
            <span className={`evals-chip${res.pass ? " is-pass" : " is-fail"}`}>{res.pass ? "PASS" : "FAIL"}</span>
            <span className="evals-result-name">{res.name}</span>
            <span className="evals-result-stats">{pct(res.score)} · {Math.round(res.latencyMs)}ms</span>
          </div>
          {res.error ? (
            <p className="evals-result-error">{res.error}</p>
          ) : (
            <>
              <pre className="evals-result-output">{res.output || "(empty response)"}</pre>
              <ul className="evals-grader-results">
                {res.graders.map((g, i) => (
                  <li key={i} className={g.pass ? "is-pass" : "is-fail"}>
                    <Icon name={g.pass ? "ph:check" : "ph:x"} width={11} />
                    <span className="evals-grader-result-label">{g.label}</span>
                    <span className="evals-grader-result-detail">{g.detail}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
