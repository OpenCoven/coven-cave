"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Icon } from "@/lib/icon";
import type { IconName } from "@/lib/icon";
import { EmptyState } from "@/components/ui/empty-state";
import { EvalLoopPanel } from "@/components/eval-loop-panel";
import { RetroRunsView } from "@/components/retro-runs-view";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { SessionRow } from "@/lib/types";
import type { RetroRun, RetroRunsSnapshot } from "@/lib/retro-runs";
import {
  deriveThreadEvalState,
  rollupEvalGroup,
  suiteRunBlockReason,
  type EvalSuite,
  type EvalCase,
  type EvalGroup,
  type EvalRun,
  type Grader,
  type GraderKind,
  type ManualEvalQueueItem,
  type ThreadEvalSnapshot,
  type ThreadEvalState,
} from "@/lib/evals/eval-model";
import { runSuite, type RunProgress } from "@/lib/evals/eval-runner";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import { arrayContentEqual } from "@/lib/array-content-equal";
import { useMinuteTick } from "@/lib/use-minute-tick";
import {
  instantiateTemplate,
  templatesByCategory,
  type EvalTemplate,
} from "@/lib/evals/eval-templates";
import { Modal } from "@/components/ui/modal";
import { EvalsInsightsPanel } from "@/components/evals/evals-insights-panel";
import { EvalGroupsPanel } from "@/components/evals/eval-groups-panel";
import { RunCompare } from "@/components/evals/run-compare";
import "@/styles/evals.css";

type Props = {
  familiars: ResolvedFamiliar[];
  activeFamiliarId?: string | null;
};

type GraderKindOption = { kind: GraderKind; label: string; hint: string; valueless?: boolean };
type EvalsTab = "overview" | "insights" | "suites" | "runs" | "compare" | "loops" | "threads" | "groups";
type RetroApiResponse =
  | { ok: true; snapshot: RetroRunsSnapshot }
  | { ok: false; snapshot?: RetroRunsSnapshot; error?: string };

const EMPTY_RETRO_SNAPSHOT: RetroRunsSnapshot = {
  generatedAt: new Date(0).toISOString(),
  summary: {
    totalRuns: 0,
    accepted: 0,
    reverted: 0,
    runningFamiliars: 0,
    familiarsWithData: 0,
    trackCounts: { synthesis: 0, prompt: 0, memory: 0 },
    lastRun: null,
  },
  familiars: [],
  runs: [],
};

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

/** Open a migrated eval-discuss thread back in the chat surface. */
function openEvalThread(session: SessionRow) {
  window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "chat" } }));
  window.dispatchEvent(
    new CustomEvent("cave:agents-open-session", {
      detail: { sessionId: session.id, familiarId: session.familiarId },
    }),
  );
}

export function EvalsView({ familiars, activeFamiliarId }: Props) {
  const [suites, setSuites] = useState<EvalSuite[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // On small screens the suite rail collapses into a drawer; this tracks whether
  // it's open. It's a no-op on desktop (the CSS only reacts to it under the
  // narrow breakpoint), so it can be toggled freely.
  const [railOpen, setRailOpen] = useState(false);
  const [draft, setDraft] = useState<EvalSuite | null>(null);
  const [savedJson, setSavedJson] = useState<string>("");
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [allRuns, setAllRuns] = useState<EvalRun[]>([]);
  const [groups, setGroups] = useState<EvalGroup[]>([]);
  const [threadSnapshots, setThreadSnapshots] = useState<ThreadEvalSnapshot[]>([]);
  const [queue, setQueue] = useState<ManualEvalQueueItem[]>([]);
  const [evalThreads, setEvalThreads] = useState<SessionRow[]>([]);
  const [retroSnapshot, setRetroSnapshot] = useState<RetroRunsSnapshot>(EMPTY_RETRO_SNAPSHOT);
  const [tab, setTab] = useState<EvalsTab>("overview");
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  useMinuteTick(); // keep relative-time labels (last run, freshness) current between polls

  const dirty = useMemo(() => (draft ? JSON.stringify(draft) !== savedJson : false), [draft, savedJson]);

  // The Evals page is fixated on ONE familiar: the workspace-selected one
  // (`activeFamiliarId`), falling back to the first familiar. There is no
  // per-page picker — everything below is scoped to this single familiar so
  // the surface only ever shows that familiar's suites, runs, loops, and
  // threads.
  const familiarId = activeFamiliarId || familiars[0]?.id || "";
  const activeFamiliar = useMemo(
    () => familiars.find((f) => f.id === familiarId) ?? null,
    [familiars, familiarId],
  );
  const familiarName = activeFamiliar?.display_name || familiarId || "Familiar";

  // Scope every data slice to the active familiar.
  const scopedSuites = useMemo(
    () => suites.filter((s) => s.familiarId === familiarId),
    [suites, familiarId],
  );
  const scopedAllRuns = useMemo(
    () => allRuns.filter((r) => r.familiarId === familiarId),
    [allRuns, familiarId],
  );
  const scopedThreadSnapshots = useMemo(
    () => threadSnapshots.filter((t) => t.familiarId === familiarId),
    [threadSnapshots, familiarId],
  );
  const scopedGroups = useMemo(
    () => groups.filter((g) => g.members.some((m) => m.familiarId === familiarId)),
    [groups, familiarId],
  );
  const scopedEvalThreads = useMemo(
    () => evalThreads.filter((t) => t.familiarId === familiarId),
    [evalThreads, familiarId],
  );

  const blockReason = draft ? suiteRunBlockReason({ ...draft, familiarId }, familiarId) : "Select a suite";
  const activeGroup = scopedGroups[0] ?? null;
  const activeGroupStates = useMemo(
    () => activeGroup ? deriveEvalGroupStates(activeGroup, scopedThreadSnapshots) : [],
    [activeGroup, scopedThreadSnapshots],
  );
  const activeGroupRollup = useMemo(
    () => activeGroup ? rollupEvalGroup(activeGroup, activeGroupStates) : null,
    [activeGroup, activeGroupStates],
  );
  // Each group rolls up against its OWN derived thread states. A shared union
  // would make every group that has no thread members (rollupEvalGroup's
  // size===0 fallthrough) count every other group's threads.
  const groupStatesById = useMemo(
    () => new Map(scopedGroups.map((g) => [g.id, deriveEvalGroupStates(g, scopedThreadSnapshots)])),
    [scopedGroups, scopedThreadSnapshots],
  );
  const activeLoopState = retroSnapshot.familiars.find((familiar) => familiar.familiarId === familiarId) ?? null;
  const analysis = useMemo(
    () => deriveEvalsAnalysis({
      suites: scopedSuites,
      allRuns: scopedAllRuns,
      selectedRuns: runs,
      activeLoopState,
      activeGroupRollup,
      queueCount: queue.length,
    }),
    [activeGroupRollup, scopedAllRuns, queue.length, activeLoopState, runs, scopedSuites],
  );

  // Load suites and grouped eval metadata once.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [suitesRes, allRunsRes, groupsRes, threadStatesRes, queueRes, retroRes, sessionsRes] = await Promise.all([
          fetch("/api/evals/suites"),
          fetch("/api/evals/runs"),
          fetch("/api/evals/groups"),
          fetch("/api/evals/thread-states"),
          fetch("/api/evals/queue"),
          fetch("/api/retro-runs"),
          fetch("/api/sessions/list"),
        ]);
        const data = (await suitesRes.json()) as { ok: boolean; suites?: EvalSuite[] };
        const allRunsData = (await allRunsRes.json()) as { ok: boolean; runs?: EvalRun[] };
        const groupsData = (await groupsRes.json()) as { ok: boolean; groups?: EvalGroup[] };
        const threadStatesData = (await threadStatesRes.json()) as { ok: boolean; snapshots?: ThreadEvalSnapshot[] };
        const queueData = (await queueRes.json()) as { ok: boolean; queue?: ManualEvalQueueItem[] };
        const retroData = (await retroRes.json()) as RetroApiResponse;
        const sessionsData = (await sessionsRes.json()) as { ok: boolean; sessions?: SessionRow[] };
        if (!alive) return;
        const list = data.suites ?? [];
        setSuites(list);
        setAllRuns(allRunsData.runs ?? []);
        setGroups(groupsData.groups ?? []);
        setThreadSnapshots(threadStatesData.snapshots ?? []);
        setQueue(queueData.queue ?? []);
        setRetroSnapshot(retroData.snapshot ?? EMPTY_RETRO_SNAPSHOT);
        // Eval-discuss chat threads, migrated out of the chat list into the Evals page.
        setEvalThreads((sessionsData.sessions ?? []).filter((s) => s.origin === "eval"));
        // Selection is handled by the familiar-scoped effect below so it always
        // lands on a suite that belongs to the active familiar.
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the selected suite in sync with the active familiar. On first load and
  // whenever the workspace familiar changes, select that familiar's first suite
  // (or clear the editor when it has none). Deliberately NOT keyed on `suites`,
  // so creating/saving a suite doesn't re-trigger a reselect and clobber the
  // in-progress draft.
  useEffect(() => {
    if (!loaded) return;
    if (draft && draft.familiarId === familiarId) return;
    const mine = suites.filter((s) => s.familiarId === familiarId);
    if (mine.length) {
      selectSuite(mine[0]);
    } else {
      setSelectedId(null);
      setDraft(null);
      setRuns([]);
      setTab("overview");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, familiarId]);

  const reloadGroups = useCallback(() => {
    void (async () => {
      try {
        const res = await fetch("/api/evals/groups");
        const data = (await res.json()) as { ok: boolean; groups?: EvalGroup[] };
        setGroups(data.groups ?? []);
      } catch {
        // leave the current list in place on a transient failure
      }
    })();
  }, []);

  // Live snapshot refresh for the time-sensitive slices only — run history,
  // groups, thread freshness, the manual queue, the eval-loop snapshot, and
  // eval chat threads. Deliberately excludes suites/draft/selection so a
  // background poll never clobbers an unsaved suite the user is editing.
  // Each slice updates independently (allSettled) so one failing endpoint
  // doesn't wipe the others, and a transient failure leaves state untouched.
  const refreshSnapshot = useCallback(async () => {
    const [runsR, groupsR, threadsR, queueR, retroR, sessionsR] = await Promise.allSettled([
      fetch("/api/evals/runs"),
      fetch("/api/evals/groups"),
      fetch("/api/evals/thread-states"),
      fetch("/api/evals/queue"),
      fetch("/api/retro-runs"),
      fetch("/api/sessions/list"),
    ]);
    const readJson = async (r: PromiseSettledResult<Response>): Promise<unknown> => {
      if (r.status !== "fulfilled") return null;
      try { return await r.value.json(); } catch { return null; }
    };
    // Each poll rebuilds fresh arrays from JSON; guard every setter with a
    // structural equality check so an unchanged snapshot returns the previous
    // reference and doesn't re-render the whole surface + re-aggregate every
    // tick (this poll runs every 30s even when idle).
    const runsData = (await readJson(runsR)) as { ok?: boolean; runs?: EvalRun[] } | null;
    if (runsData?.ok && Array.isArray(runsData.runs)) {
      const next = runsData.runs;
      setAllRuns((prev) => (arrayContentEqual(prev, next) ? prev : next));
    }
    const groupsData = (await readJson(groupsR)) as { ok?: boolean; groups?: EvalGroup[] } | null;
    if (groupsData?.ok && Array.isArray(groupsData.groups)) {
      const next = groupsData.groups;
      setGroups((prev) => (arrayContentEqual(prev, next) ? prev : next));
    }
    const threadsData = (await readJson(threadsR)) as { ok?: boolean; snapshots?: ThreadEvalSnapshot[] } | null;
    if (threadsData?.ok && Array.isArray(threadsData.snapshots)) {
      const next = threadsData.snapshots;
      setThreadSnapshots((prev) => (arrayContentEqual(prev, next) ? prev : next));
    }
    const queueData = (await readJson(queueR)) as { ok?: boolean; queue?: ManualEvalQueueItem[] } | null;
    if (queueData?.ok && Array.isArray(queueData.queue)) {
      const next = queueData.queue;
      setQueue((prev) => (arrayContentEqual(prev, next) ? prev : next));
    }
    const retroData = (await readJson(retroR)) as RetroApiResponse | null;
    if (retroData?.ok && retroData.snapshot) setRetroSnapshot(retroData.snapshot);
    const sessionsData = (await readJson(sessionsR)) as { ok?: boolean; sessions?: SessionRow[] } | null;
    if (sessionsData?.ok && Array.isArray(sessionsData.sessions)) {
      const next = sessionsData.sessions.filter((s) => s.origin === "eval");
      setEvalThreads((prev) => (arrayContentEqual(prev, next) ? prev : next));
    }
  }, []);

  // Poll the live snapshot so running-loop counts, thread freshness, and queue
  // depth stay current without a reload: fast while something is actively
  // running or queued, slower when idle. Pauses on hidden tabs; refreshes on
  // focus. The initial hydrate (and suite/selection state) stays untouched.
  const liveActivity = running || retroSnapshot.summary.runningFamiliars > 0 || queue.length > 0;
  usePausablePoll(() => { void refreshSnapshot(); }, liveActivity ? 5000 : 30_000);

  const selectSuite = useCallback((suite: EvalSuite) => {
    setSelectedId(suite.id);
    setRailOpen(false); // close the drawer after picking a suite (small screens)
    setDraft(structuredClone(suite));
    setSavedJson(JSON.stringify(suite));
    setExpandedRunId(null);
    setTab("suites");
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
    const suite = { ...newSuite(), familiarId };
    setSuites((prev) => [suite, ...prev]);
    setSelectedId(suite.id);
    setDraft(suite);
    setSavedJson(""); // unsaved
    setRuns([]);
    setTab("suites");
  }, [familiarId]);

  const createFromTemplate = useCallback(
    (template: EvalTemplate) => {
      const suite = instantiateTemplate(template, {
        makeId: freshId,
        now: nowIso(),
        familiarId,
      });
      setSuites((prev) => [suite, ...prev]);
      setSelectedId(suite.id);
      setDraft(suite);
      setSavedJson(""); // unsaved until the user saves
      setRuns([]);
      setTab("suites");
      setShowTemplates(false);
    },
    [familiarId],
  );

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
        // Persist ownership by the active familiar so the suite stays scoped.
        body: JSON.stringify({ suite: { ...draft, familiarId, updatedAt: nowIso() } }),
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
  }, [draft, familiarId]);

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
      // A stopped run is a truncated/partial result — don't record it or its
      // depressed pass rate into history (trends / compare / insights).
      if (controller.signal.aborted) return;
      setRuns((prev) => [result, ...prev]);
      setAllRuns((prev) => [result, ...prev.filter((run) => run.id !== result.id)]);
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

  const queueStaleGroup = useCallback(async () => {
    if (!activeGroup || activeGroupStates.length === 0) return;
    const res = await fetch("/api/evals/queue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ group: activeGroup, states: activeGroupStates }),
    });
    const data = (await res.json()) as { ok: boolean; queued?: ManualEvalQueueItem[] };
    if (data.ok && data.queued) setQueue((prev) => [...data.queued!, ...prev]);
  }, [activeGroup, activeGroupStates]);

  return (
    // .evals-host establishes the `evals` inline-size query container so the
    // surface collapses by PANE width (drag-to-split) rather than viewport width.
    <div className="evals-host">
    <div className={`evals evals-unified${railOpen ? " evals--rail-open" : ""}`}>
      {/* Narrow-pane drawer toggle — reveals the suite rail (which collapses
          off-canvas below the narrow container breakpoint). Hidden on desktop via CSS. */}
      <button
        type="button"
        className="evals-rail-toggle"
        onClick={() => setRailOpen((open) => !open)}
        aria-expanded={railOpen}
        aria-controls="evals-rail"
      >
        <Icon name={railOpen ? "ph:x" : "ph:list-bullets-bold"} width={14} aria-hidden />
        <span>Suites</span>
        <span className="evals-rail-toggle-count">{scopedSuites.length}</span>
      </button>
      {/* Backdrop closes the drawer; only interactive while open on small screens. */}
      <div
        className="evals-rail-backdrop"
        onClick={() => setRailOpen(false)}
        aria-hidden
      />
      <aside id="evals-rail" className="evals-rail">
        <div className="evals-rail-head">
          <div>
            <span className="evals-rail-title">Suites</span>
            <span className="evals-rail-subtitle">{scopedSuites.length} for {familiarName}</span>
          </div>
          <div className="evals-rail-actions">
            <button
              type="button"
              className="evals-icon-btn"
              onClick={() => setShowTemplates(true)}
              title="New suite from template"
              aria-label="New suite from template"
            >
              <Icon name="ph:sparkle" width={14} />
            </button>
            <button type="button" className="evals-icon-btn" onClick={createSuite} title="New blank eval suite" aria-label="New blank eval suite">
              <Icon name="ph:plus" width={14} />
            </button>
          </div>
        </div>
        {scopedSuites.length === 0 ? (
          <p className="evals-rail-empty">No suites yet for {familiarName}. Create one to start evaluating.</p>
        ) : (
          <ul className="evals-suite-list">
            {scopedSuites.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={`evals-suite-row${s.id === selectedId ? " is-active" : ""}`}
                  onClick={() => selectSuite(s)}
                >
                  <span className="evals-suite-name">{s.name}</span>
                  <span className="evals-suite-meta">
                    <Icon name="ph:list-bullets-bold" width={12} aria-hidden />
                    {s.cases.length} case{s.cases.length === 1 ? "" : "s"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {scopedEvalThreads.length > 0 && (
          <div className="evals-threads">
            <div className="evals-threads-head">
              <span>Discussion threads</span>
              <span className="evals-threads-count">{scopedEvalThreads.length}</span>
            </div>
            <ul className="evals-thread-list">
              {scopedEvalThreads.map((thread) => (
                <li key={thread.id}>
                  <button
                    type="button"
                    className="evals-thread-row"
                    onClick={() => openEvalThread(thread)}
                    title="Open this eval discussion in chat"
                  >
                    <Icon name="ph:chat-circle-dots" width={13} aria-hidden />
                    <span className="evals-thread-title">{thread.title || "Eval discussion"}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>

      <section className="evals-main">
        <header className="evals-toolbar evals-unified-toolbar">
          <div className="evals-title-block">
            {/* The page is fixated on ONE familiar — shown here as the fixed
                subject rather than a picker. Change familiars from the workspace
                sidebar to re-scope the whole surface. */}
            <div className="evals-subject" aria-label={`Evaluating ${familiarName}`}>
              {activeFamiliar ? <FamiliarAvatar familiar={activeFamiliar} size="md" /> : null}
              <span className="evals-subject-text">
                <span className="evals-subject-kicker">Evals</span>
                <b className="evals-subject-name">{familiarName}</b>
              </span>
            </div>
            {draft ? (
              <input
                className="evals-name-input"
                value={draft.name}
                onChange={(e) => patchDraft({ name: e.target.value })}
                aria-label="Suite name"
              />
            ) : null}
            <span className="evals-title-meta">
              {draft
                ? `${draft.cases.length} case${draft.cases.length === 1 ? "" : "s"} · ${runs.length} run${runs.length === 1 ? "" : "s"}`
                : loaded ? "Choose or create a suite to begin." : "Loading…"}
            </span>
          </div>
          <div className="evals-command-stack">
            <div className="evals-toolbar-actions">
              <button type="button" className="evals-btn" onClick={save} disabled={!draft || saving || !dirty}>
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
                  disabled={!draft || Boolean(blockReason)}
                  title={blockReason ?? `Run this suite against ${familiarName}`}
                >
                  <Icon name="ph:play" width={13} /> Run
                </button>
              )}
            </div>
          </div>
        </header>

        <EvalsAnalysisSummary analysis={analysis} />

        <div className="evals-toolbar-tabs evals-section-tabs" role="tablist" aria-label="Evals sections">
          {([
            ["overview", "Overview"],
            ["insights", "Insights"],
            ["suites", "Suites"],
            ["runs", `Runs${runs.length ? ` (${runs.length})` : ""}`],
            ["compare", "Compare"],
            ["loops", "Loops"],
            ["threads", "Thread freshness"],
            ["groups", "Groups"],
          ] as Array<[EvalsTab, string]>).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={`evals-tab${tab === id ? " is-active" : ""}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>

        <div className="evals-tab-panel">
          {tab === "overview" ? (
            <EvalsOverview
              analysis={analysis}
              draft={draft}
              runs={runs}
              recentLoopRuns={(activeLoopState?.runs ?? []).slice(0, 5)}
              activeLoopState={activeLoopState}
              activeGroupRollup={activeGroupRollup}
              onOpenSuite={() => setTab("suites")}
              onOpenRuns={() => setTab("runs")}
            />
          ) : tab === "insights" ? (
            <EvalsInsightsPanel suite={draft} runs={scopedAllRuns} />
          ) : tab === "suites" ? (
            draft ? (
              <SuiteEditor draft={draft} patchDraft={patchDraft} patchCase={patchCase} patchGrader={patchGrader} setDraft={setDraft} />
            ) : (
              <EmptyState
                icon="ph:flask"
                headline="Run evals on your familiars"
                subtitle="Build a suite of test cases, grade each answer with deterministic checks or an LLM judge, and track pass rates over time."
                actions={
                  <>
                    <button type="button" className="evals-btn evals-btn-primary" onClick={() => setShowTemplates(true)}>
                      <Icon name="ph:sparkle" width={14} /> Start from template
                    </button>
                    <button type="button" className="evals-btn" onClick={createSuite}>
                      <Icon name="ph:plus" width={14} /> Blank suite
                    </button>
                  </>
                }
              />
            )
          ) : tab === "runs" ? (
            <RunsPanel
              runs={runs}
              progress={progress}
              running={running}
              expandedRunId={expandedRunId}
              onToggle={(id) => setExpandedRunId((cur) => (cur === id ? null : id))}
            />
          ) : tab === "compare" ? (
            <RunCompare runs={draft ? scopedAllRuns.filter((r) => r.suiteId === draft.id) : scopedAllRuns} />
          ) : tab === "loops" ? (
            <LoopAnalysisPanel
              familiarId={familiarId}
              familiarName={familiarName}
              snapshot={retroSnapshot}
              activeLoopState={activeLoopState}
            />
          ) : tab === "threads" ? (
            <ThreadFreshnessPanel
              group={activeGroup}
              states={activeGroupStates}
              rollup={activeGroupRollup}
              queuedCount={queue.length}
              onQueue={queueStaleGroup}
            />
          ) : (
            <EvalGroupsPanel
              groups={scopedGroups}
              statesById={groupStatesById}
              familiars={activeFamiliar ? [activeFamiliar] : []}
              onChanged={reloadGroups}
            />
          )}
        </div>
      </section>

      <TemplateGallery
        open={showTemplates}
        onClose={() => setShowTemplates(false)}
        onPick={createFromTemplate}
      />
    </div>
    </div>
  );
}

// ---- Template gallery ------------------------------------------------------

function TemplateGallery({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (template: EvalTemplate) => void;
}) {
  const groups = useMemo(() => templatesByCategory(), []);
  const total = useMemo(() => groups.reduce((n, g) => n + g.templates.length, 0), [groups]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      breadcrumb={["Evals", "Templates"]}
      ariaLabel="Eval suite templates"
    >
      <p className="evals-tpl-intro">
        Start from a ready-made suite, then tweak the cases and graders. {total} templates across {groups.length} categories.
      </p>
      <div className="evals-tpl-groups">
        {groups.map((group) => (
          <section key={group.category} className="evals-tpl-group" aria-label={group.label}>
            <h3 className="evals-tpl-group-title">{group.label}</h3>
            <div className="evals-tpl-grid">
              {group.templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className="evals-tpl-card"
                  onClick={() => onPick(template)}
                  title={`Use the “${template.name}” template`}
                >
                  <span className="evals-tpl-card-icon">
                    <Icon name={template.icon as IconName} width={18} aria-hidden />
                  </span>
                  <span className="evals-tpl-card-body">
                    <b className="evals-tpl-card-name">{template.name}</b>
                    <small className="evals-tpl-card-desc">{template.description}</small>
                    <span className="evals-tpl-card-meta">
                      {template.cases.length} case{template.cases.length === 1 ? "" : "s"}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Modal>
  );
}

function deriveEvalGroupStates(group: EvalGroup, snapshots: ThreadEvalSnapshot[]): ThreadEvalState[] {
  return group.members
    .filter((member) => member.kind === "thread")
    .map((member) => {
      const snapshot = snapshots.find((item) => item.threadId === member.id && (!member.familiarId || item.familiarId === member.familiarId)) ?? null;
      return deriveThreadEvalState(snapshot, {
        threadId: member.id,
        familiarId: member.familiarId ?? snapshot?.familiarId ?? "",
        latestTurnId: member.latestTurnId,
        inputHash: member.inputHash,
        rubricVersion: group.rubricVersion || snapshot?.rubricVersion,
        confidenceRubricVersion: member.confidenceRubricVersion,
        skillsVersion: member.skillsVersion,
        permissionsHash: member.permissionsHash,
        responseConfidenceEventIds: member.responseConfidenceEventIds,
        ttlMs: group.stalePolicy.ttlMs,
        groupUpdatedAt: group.updatedAt,
      });
    });
}

type EvalGroupRollup = ReturnType<typeof rollupEvalGroup>;

type EvalsAnalysis = {
  suiteCount: number;
  totalSuiteRuns: number;
  selectedSuiteRuns: number;
  latestPassRate: number | null;
  passTrend: number | null;
  loopRuns: number;
  loopAccepted: number;
  loopReverted: number;
  runningFamiliars: number;
  staleThreads: number;
  blockedThreads: number;
  queuedCount: number;
};

function deriveEvalsAnalysis({
  suites,
  allRuns,
  selectedRuns,
  activeLoopState,
  activeGroupRollup,
  queueCount,
}: {
  suites: EvalSuite[];
  allRuns: EvalRun[];
  selectedRuns: EvalRun[];
  activeLoopState: RetroRunsSnapshot["familiars"][number] | null;
  activeGroupRollup: EvalGroupRollup | null;
  queueCount: number;
}): EvalsAnalysis {
  const sortedSelectedRuns = [...selectedRuns].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  const latestPassRate = sortedSelectedRuns[0]?.summary.passRate ?? null;
  const previousPassRate = sortedSelectedRuns[1]?.summary.passRate ?? null;
  // Loop metrics come from THIS familiar's slice, not the cross-familiar total.
  const loopRuns = activeLoopState?.runs.length ?? 0;
  return {
    suiteCount: suites.length,
    totalSuiteRuns: allRuns.length,
    selectedSuiteRuns: selectedRuns.length,
    latestPassRate,
    passTrend: latestPassRate != null && previousPassRate != null ? latestPassRate - previousPassRate : null,
    loopRuns,
    loopAccepted: activeLoopState?.totalAccepted ?? 0,
    loopReverted: activeLoopState?.totalReverted ?? 0,
    runningFamiliars: activeLoopState?.running ? 1 : 0,
    staleThreads: (activeGroupRollup?.staleThreads ?? 0) + (activeGroupRollup?.neverRunThreads ?? 0),
    blockedThreads: activeGroupRollup?.blockedThreads ?? 0,
    queuedCount: queueCount,
  };
}

function passRateLabel(value: number | null): string {
  return value == null ? "No runs" : pct(value);
}

function trendLabel(value: number | null): string {
  if (value == null) return "No trend";
  if (Math.abs(value) < 0.005) return "flat";
  return `${value > 0 ? "+" : ""}${Math.round(value * 100)} pts`;
}

function downloadRetroSnapshot(snapshot: RetroRunsSnapshot) {
  const payload = JSON.stringify(snapshot, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `coven-evals-loop-snapshot-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function EvalsAnalysisSummary({ analysis }: { analysis: EvalsAnalysis }) {
  return (
    <section className="evals-analysis-summary" aria-label="Evals analysis summary">
      <AnalysisCard icon="ph:flask" label="Suites" value={String(analysis.suiteCount)} detail={`${analysis.totalSuiteRuns} recorded runs`} />
      <AnalysisCard icon="ph:chart-bar-bold" label="Latest suite pass" value={passRateLabel(analysis.latestPassRate)} detail={trendLabel(analysis.passTrend)} />
      <AnalysisCard icon="ph:arrows-clockwise-bold" label="Loop accept/revert" value={`${analysis.loopAccepted}/${analysis.loopReverted}`} detail={`${analysis.loopRuns} loop runs`} />
      <AnalysisCard icon="ph:clock-countdown" label="Thread freshness" value={`${analysis.staleThreads} stale`} detail={`${analysis.blockedThreads} blocked · ${analysis.queuedCount} queued`} />
      <AnalysisCard icon="ph:heartbeat" label="Loop status" value={analysis.runningFamiliars > 0 ? "Running" : "Idle"} detail="this familiar's eval loop" />
    </section>
  );
}

function AnalysisCard({ icon, label, value, detail }: { icon: IconName; label: string; value: string; detail: string }) {
  return (
    <article className="evals-analysis-card">
      <Icon name={icon} width={16} aria-hidden />
      <span>{label}</span>
      <b>{value}</b>
      <small>{detail}</small>
    </article>
  );
}

function EvalsOverview({
  analysis,
  draft,
  runs,
  recentLoopRuns,
  activeLoopState,
  activeGroupRollup,
  onOpenSuite,
  onOpenRuns,
}: {
  analysis: EvalsAnalysis;
  draft: EvalSuite | null;
  runs: EvalRun[];
  recentLoopRuns: RetroRun[];
  activeLoopState: RetroRunsSnapshot["familiars"][number] | null;
  activeGroupRollup: EvalGroupRollup | null;
  onOpenSuite: () => void;
  onOpenRuns: () => void;
}) {
  const latestRun = runs[0] ?? null;
  return (
    <div className="evals-overview">
      <section className="evals-analysis-panel evals-overview-hero">
        <div className="evals-section-head">
          <span className="evals-group-kicker">Evaluation focus</span>
          <b>{draft?.name ?? "No suite selected"}</b>
          <button type="button" className="evals-btn" onClick={onOpenSuite}>
            <Icon name="ph:pencil-simple" width={13} /> Edit suite
          </button>
        </div>
        <div className="evals-overview-hero-grid">
          <div className="evals-focus-score">
            <span>Latest pass rate</span>
            <b>{passRateLabel(analysis.latestPassRate)}</b>
            <small>{analysis.passTrend == null ? "Run twice to establish a trend." : `${trendLabel(analysis.passTrend)} since previous run.`}</small>
          </div>
          <div className="evals-focus-copy">
            <p>
              {draft?.description?.trim()
                ? draft.description
                : "Build repeatable cases, run them against a familiar, then compare regressions before promoting behavior changes."}
            </p>
            <div className="evals-focus-actions">
              <button type="button" className="evals-btn evals-btn-primary" onClick={onOpenRuns}>
                <Icon name="ph:chart-bar-bold" width={13} /> Review runs
              </button>
              <span className="evals-focus-pill">{draft ? `${draft.cases.length} case${draft.cases.length === 1 ? "" : "s"}` : "No suite"}</span>
              <span className="evals-focus-pill">{latestRun ? `${latestRun.summary.passed}/${latestRun.summary.total} passed` : "No run history"}</span>
            </div>
          </div>
        </div>
      </section>
      <section className="evals-analysis-panel">
        <div className="evals-section-head">
          <span className="evals-group-kicker">Attention queue</span>
          <b>{analysis.staleThreads + analysis.blockedThreads + analysis.runningFamiliars} active signals</b>
        </div>
        <ul className="evals-insight-list">
          <li>{analysis.latestPassRate == null ? "No suite runs yet." : `Latest selected-suite pass rate is ${passRateLabel(analysis.latestPassRate)}.`}</li>
          <li>{analysis.passTrend == null ? "Run the suite twice to establish trend." : `Pass-rate trend is ${trendLabel(analysis.passTrend)}.`}</li>
          <li>{analysis.staleThreads > 0 ? `${analysis.staleThreads} thread eval snapshots need review.` : "Grouped thread eval snapshots are fresh where configured."}</li>
          <li>{activeLoopState?.running ? `${activeLoopState.familiarName} has an eval loop running.` : "No selected familiar eval loop is currently running."}</li>
        </ul>
      </section>
      <section className="evals-analysis-panel">
        <div className="evals-section-head">
          <span className="evals-group-kicker">Group health</span>
          <b>{activeGroupRollup ? `${activeGroupRollup.totalThreads} threads` : "No group"}</b>
        </div>
        <p className="evals-analysis-copy">
          {activeGroupRollup
            ? `${activeGroupRollup.freshThreads} fresh, ${activeGroupRollup.staleThreads} stale, ${activeGroupRollup.neverRunThreads} never run, ${activeGroupRollup.blockedThreads} blocked.`
            : "Create an eval group to connect thread freshness, stale reasons, and manual queueing."}
        </p>
      </section>
      <section className="evals-analysis-panel evals-overview-wide">
        <div className="evals-section-head">
          <span className="evals-group-kicker">Recent eval-loop runs</span>
          <b>{recentLoopRuns.length ? `${recentLoopRuns.length} newest` : "No loop runs"}</b>
        </div>
        <LoopRunList runs={recentLoopRuns} />
      </section>
    </div>
  );
}

function LoopAnalysisPanel({
  familiarId,
  familiarName,
  snapshot,
  activeLoopState,
}: {
  familiarId: string;
  familiarName: string;
  snapshot: RetroRunsSnapshot;
  activeLoopState: RetroRunsSnapshot["familiars"][number] | null;
}) {
  return (
    <div className="evals-loop-analysis">
      <section className="evals-analysis-panel">
        <div className="evals-section-head">
          <span className="evals-group-kicker">Loop analysis</span>
          <b>{activeLoopState?.familiarName ?? familiarName}</b>
          <button type="button" className="evals-btn" onClick={() => downloadRetroSnapshot(snapshot)} disabled={snapshot.runs.length === 0}>
            <Icon name="ph:floppy-disk-bold" width={13} /> Export loop snapshot
          </button>
        </div>
        <div className="evals-loop-metrics">
          <ThreadEvalDetail label="Accepted" value={String(activeLoopState?.totalAccepted ?? 0)} />
          <ThreadEvalDetail label="Reverted" value={String(activeLoopState?.totalReverted ?? 0)} />
          <ThreadEvalDetail label="Runs" value={String(activeLoopState?.runs.length ?? 0)} />
          <ThreadEvalDetail label="Status" value={activeLoopState?.running ? "running" : "idle"} />
        </div>
        <LoopRunList runs={(activeLoopState?.runs ?? []).slice(0, 8)} />
      </section>
      {familiarId ? (
        <section className="evals-analysis-panel evals-loop-control">
          <EvalLoopPanel familiarId={familiarId} familiarName={familiarName} />
        </section>
      ) : (
        <EmptyState compact icon="ph:user" headline="Select a familiar to run eval loops." />
      )}
      {familiarId ? <RetroRunsView familiarId={familiarId} embedded /> : null}
    </div>
  );
}

function ThreadFreshnessPanel({
  group,
  states,
  rollup,
  queuedCount,
  onQueue,
}: {
  group: EvalGroup | null;
  states: ThreadEvalState[];
  rollup: EvalGroupRollup | null;
  queuedCount: number;
  onQueue: () => void;
}) {
  return (
    <div className="evals-thread-freshness">
      <section className="evals-analysis-panel">
        <div className="evals-section-head">
          <span className="evals-group-kicker">Thread freshness</span>
          <b>{rollup ? `${rollup.runnableThreadIds.length} runnable stale evals` : "No group configured"}</b>
        </div>
        <p className="evals-analysis-copy">
          Thread freshness compares evaluated-through turn, latest turn, rubric versions, confidence events, skills, permissions, and group policy.
        </p>
      </section>
      <EvalGroupPanel group={group} states={states} rollup={rollup} queuedCount={queuedCount} onQueue={onQueue} />
    </div>
  );
}

function LoopRunList({ runs }: { runs: RetroRun[] }) {
  if (runs.length === 0) return <p className="evals-runs-empty">No eval-loop runs recorded yet.</p>;
  return (
    <ul className="evals-loop-run-list">
      {runs.map((run) => (
        <li key={run.id} className="evals-loop-run">
          <span className={`evals-chip${run.outcome === "ACCEPT" ? " is-pass" : " is-fail"}`}>{run.outcome === "ACCEPT" ? "ACCEPT" : "REVERT"}</span>
          <b>{run.familiarName}</b>
          <span>{run.track} · iteration {run.iteration}</span>
          <small>{run.changeSummary}</small>
        </li>
      ))}
    </ul>
  );
}

function EvalGroupPanel({
  group,
  states,
  rollup,
  queuedCount,
  onQueue,
}: {
  group: EvalGroup | null;
  states: ThreadEvalState[];
  rollup: ReturnType<typeof rollupEvalGroup> | null;
  queuedCount: number;
  onQueue: () => void;
}) {
  if (!group || !rollup) {
    return (
      <div className="evals-group-panel">
        <div>
          <span className="evals-group-kicker">Eval group</span>
          <b>No groups yet</b>
        </div>
        <span className="evals-group-muted">Create a group to track thread freshness and queue stale evals.</span>
      </div>
    );
  }

  const runnable = rollup.runnableThreadIds.length;
  return (
    <div className="evals-group-panel">
      <div className="evals-group-summary">
        <span className="evals-group-kicker">Eval group</span>
        <b>{group.name}</b>
        <span className="evals-group-muted">
          {rollup.freshThreads} fresh · {rollup.staleThreads} stale · {rollup.neverRunThreads} never run · {rollup.blockedThreads} blocked · {queuedCount} queued
        </span>
      </div>
      <div className="evals-group-states" aria-label="Thread eval states">
        {states.map((state) => (
          <article key={`${state.familiarId}:${state.threadId}`} className={`evals-thread-state is-${state.status}`}>
            <div className="evals-thread-state-head">
              <span>{state.threadId}</span>
              <b>{state.status}</b>
            </div>
            <div className="evals-thread-detail-grid" aria-label={`Thread eval detail for ${state.threadId}`}>
              <ThreadEvalDetail label="Evaluated through" value={state.details.evaluatedThroughTurnId ?? "never"} />
              <ThreadEvalDetail label="Latest turn" value={state.details.latestTurnId ?? "unknown"} />
              <ThreadEvalDetail
                label="Confidence events"
                value={`${state.details.snapshotResponseConfidenceEventCount}->${state.details.responseConfidenceEventCount}`}
              />
              <ThreadEvalDetail
                label="Rubric"
                value={versionPair(state.details.snapshotRubricVersion, state.details.rubricVersion)}
              />
            </div>
            {state.staleReasons.length > 0 ? (
              <div className="evals-thread-reasons" aria-label={`Stale reasons for ${state.threadId}`}>
                {state.staleReasons.map((reason) => (
                  <em key={reason} className="evals-stale-reason">{reason}</em>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
      <button type="button" className="evals-btn evals-btn-primary" onClick={onQueue} disabled={runnable === 0}>
        <Icon name="ph:play" width={13} /> Run stale evals
      </button>
    </div>
  );
}

function ThreadEvalDetail({ label, value }: { label: string; value: string }) {
  return (
    <span className="evals-thread-detail">
      <small>{label}</small>
      <b>{value}</b>
    </span>
  );
}

function versionPair(snapshot: string | undefined, current: string | undefined): string {
  if (!snapshot && !current) return "unknown";
  if (!snapshot) return current ?? "unknown";
  if (!current || current === snapshot) return snapshot;
  return `${snapshot}->${current}`;
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
      <section className="evals-suite-config" aria-label="Suite configuration">
        <div className="evals-section-head">
          <span className="evals-group-kicker">Suite contract</span>
          <b>Readiness</b>
        </div>
        <div className="evals-suite-config-body">
          <label className="evals-field evals-field-stack">
            <span>Description</span>
            <textarea
              className="evals-desc"
              value={draft.description ?? ""}
              placeholder="What does this suite check? (optional)"
              onChange={(e) => patchDraft({ description: e.target.value })}
              rows={4}
              aria-label="Suite description"
            />
          </label>
          <label className="evals-field">
            <span>Pass-rate SLA (%)</span>
            <input
              type="number"
              min={0}
              max={100}
              value={draft.slaMinPassRate != null ? Math.round(draft.slaMinPassRate * 100) : ""}
              onChange={(e) => {
                const pct = e.target.value === "" ? undefined : Number(e.target.value);
                patchDraft({
                  slaMinPassRate: pct == null || Number.isNaN(pct) ? undefined : Math.min(1, Math.max(0, pct / 100)),
                });
              }}
              aria-label="Pass-rate SLA percent"
            />
          </label>
          <div className="evals-contract-stats" aria-label="Suite contract summary">
            <ThreadEvalDetail label="Cases" value={String(draft.cases.length)} />
            <ThreadEvalDetail label="Checks" value={String(draft.cases.reduce((total, item) => total + item.graders.length, 0))} />
          </div>
        </div>
      </section>
      <div className="evals-cases">
        <div className="evals-cases-head">
          <div>
            <span className="evals-group-kicker">Cases</span>
            <b>Prompt checks</b>
          </div>
          <button type="button" className="evals-add-case" onClick={addCase}>
            <Icon name="ph:plus" width={14} /> Add case
          </button>
        </div>
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
  // Only show 100% when it truly is: Math.round would render 99.5% as "100%"
  // on a run that actually failed a case.
  return `${n >= 1 ? 100 : Math.min(99, Math.round(n * 100))}%`;
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
      {runs.map((r, i) => {
        const open = r.id === expandedRunId;
        const passed = r.summary.passRate >= 0.999;
        // Runs render newest-first, so the chronologically previous run is the
        // NEXT list entry. Surfaces the trend at a glance without opening
        // Insights; the oldest run has no baseline so it gets no chip.
        const prev = runs[i + 1];
        const deltaPts = prev ? Math.round((r.summary.passRate - prev.summary.passRate) * 100) : null;
        return (
          <article className={`evals-run${open ? " is-open" : ""}`} key={r.id}>
            <button type="button" className="evals-run-head" onClick={() => onToggle(r.id)} aria-expanded={open}>
              <span className={`evals-run-rate${passed ? " is-pass" : r.summary.passRate >= 0.5 ? " is-mid" : " is-fail"}`}>{pct(r.summary.passRate)}</span>
              <span className="evals-run-meta">
                <span className="evals-run-count">
                  {r.summary.passed}/{r.summary.total} passed
                  {deltaPts !== null ? (
                    <span
                      className={`evals-run-delta${deltaPts > 0 ? " is-up" : deltaPts < 0 ? " is-down" : " is-flat"}`}
                      title="Pass-rate change vs the previous run"
                    >
                      {deltaPts > 0 ? `+${deltaPts}` : deltaPts} pts
                    </span>
                  ) : null}
                </span>
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
