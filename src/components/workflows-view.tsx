"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Familiar } from "@/lib/types";
import { workflowToGraph } from "@/lib/workflow-graph";
import {
  createWorkflowFromTemplate,
  duplicateWorkflow,
  slugifyWorkflowId,
  workflowToManifest,
} from "@/lib/workflow-edit";
import {
  initialWorkflowDraft,
  workflowDraftReducer,
  type WorkflowDraftAction,
  type WorkflowDraftState,
} from "@/lib/workflow-draft";
import {
  attachWorkflowToRole,
  isPublicTemplate,
  loadWorkflowLayout,
  saveWorkflowLayout,
  deleteWorkflow,
  dryRunWorkflow,
  listWorkflowRoles,
  listWorkflowRuns,
  listWorkflows,
  recordWorkflowRun,
  runWorkflow,
  saveWorkflow,
  scheduleWorkflow,
  validateWorkflow,
  type WorkflowDryRunPlan,
  type WorkflowPattern,
  type WorkflowRoleSummary,
  type WorkflowRunRecord,
  type WorkflowScheduleRecurrence,
  type WorkflowSummary,
} from "@/lib/workflows";
import {
  WorkflowStudio,
  type WorkflowStudioActionState,
} from "./workflows/workflow-studio";

export function WorkflowsView() {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [action, setAction] = useState<WorkflowStudioActionState | null>(null);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [draftState, setDraftState] = useState<WorkflowDraftState | null>(null);
  const [runs, setRuns] = useState<WorkflowRunRecord[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [familiars, setFamiliars] = useState<Familiar[]>([]);
  const [roles, setRoles] = useState<WorkflowRoleSummary[]>([]);
  const [engineUnavailable, setEngineUnavailable] = useState(false);
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The draft is the single editing surface; selection changes re-seed it.
  const draft = draftState?.draft ?? null;
  const dirty = draftState?.dirty ?? false;

  const dispatchDraft = useCallback((actionInput: WorkflowDraftAction) => {
    setDraftState((current) => {
      if (actionInput.type === "reset") {
        return initialWorkflowDraft(actionInput.workflow);
      }
      if (!current) return current;
      return workflowDraftReducer(current, actionInput);
    });
  }, []);

  const load = useCallback(async (refresh = false) => {
    setRefreshing(refresh);
    if (!refresh) setLoaded(false);
    try {
      const result = await listWorkflows();
      if (!result.ok) {
        setWorkflows([]);
        setError(result.error ?? "workflows unavailable");
      } else {
        setWorkflows(result.workflows ?? []);
        setError(null);
      }
    } catch (err) {
      setWorkflows([]);
      setError(err instanceof Error ? err.message : "workflow fetch failed");
    } finally {
      setLoaded(true);
      setRefreshing(false);
    }
  }, []);

  const loadLayout = useCallback(async (workflowId: string) => {
    setNodePositions(null);
    try {
      const result = await loadWorkflowLayout(workflowId);
      if (result.ok) setNodePositions(result.positions);
    } catch {
      // layout is a display preference; the layered default always works
    }
  }, []);

  const loadRuns = useCallback(async (workflowId: string) => {
    setRunsLoading(true);
    try {
      const result = await listWorkflowRuns(workflowId);
      setRuns(result.ok ? result.runs : []);
    } catch {
      setRuns([]);
    } finally {
      setRunsLoading(false);
    }
  }, []);

  const loadRoles = useCallback(async () => {
    try {
      const result = await listWorkflowRoles();
      if (result.ok) setRoles(result.roles);
    } catch {
      // roles are an enhancement; the studio works without them
    }
  }, []);

  const loadFamiliars = useCallback(async () => {
    try {
      const response = await fetch("/api/familiars", { cache: "no-store" });
      const result = await response.json() as { ok: boolean; familiars?: Familiar[] };
      if (result.ok) setFamiliars(result.familiars ?? []);
    } catch {
      // familiar choices are an enhancement; existing manifest bindings remain selectable
    }
  }, []);

  useEffect(() => {
    void load(false);
    void loadFamiliars();
    void loadRoles();
  }, [load, loadFamiliars, loadRoles]);

  // Keep a valid selection as the library changes; seed the draft for it.
  useEffect(() => {
    if (workflows.length === 0) {
      setSelectedWorkflowId(null);
      setSelectedNodeId(null);
      setDraftState(null);
      return;
    }
    const current = workflows.find((workflow) => workflow.id === selectedWorkflowId);
    if (current) return;
    const next = workflows[0];
    setSelectedWorkflowId(next.id);
    setSelectedNodeId(null);
    setDraftState(initialWorkflowDraft(next));
    void loadRuns(next.id);
    void loadLayout(next.id);
  }, [loadRuns, selectedWorkflowId, workflows]);

  const selectedDryRun = useMemo<WorkflowDryRunPlan | undefined>(() => {
    if (action?.kind !== "dry-run" || action.id !== draft?.id) return undefined;
    return action.result as WorkflowDryRunPlan;
  }, [action, draft?.id]);

  const selectedGraph = useMemo(() => {
    if (!draft) return null;
    return workflowToGraph(draft, selectedDryRun, nodePositions);
  }, [draft, nodePositions, selectedDryRun]);

  const selectedNode = useMemo(
    () => selectedGraph?.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [selectedGraph, selectedNodeId],
  );

  const familiarOptions = useMemo(() => {
    const options = new Map<string, string>();
    const add = (id: string | undefined | null, label?: string) => {
      const trimmed = id?.trim();
      if (!trimmed) return;
      options.set(trimmed, label?.trim() || trimmed);
    };
    for (const familiar of familiars) {
      add(familiar.id, familiar.display_name && familiar.display_name !== familiar.id
        ? `${familiar.display_name} (${familiar.id})`
        : familiar.id);
    }
    for (const workflow of workflows) add(workflow.familiar);
    for (const role of roles) add(role.familiar);
    add(draft?.familiar);
    return [...options.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [draft?.familiar, familiars, roles, workflows]);

  useEffect(() => {
    if (!selectedNodeId) return;
    if (!selectedGraph?.nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [selectedGraph, selectedNodeId]);

  // Transient notices (schedule confirmations, run feedback) self-expire.
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 6000);
  }, []);
  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);

  const confirmDiscard = useCallback((): boolean => {
    if (!dirty) return true;
    return window.confirm("Discard unsaved workflow changes?");
  }, [dirty]);

  const selectWorkflow = (workflow: WorkflowSummary) => {
    if (workflow.id === selectedWorkflowId) return;
    if (!confirmDiscard()) return;
    setSelectedWorkflowId(workflow.id);
    setSelectedNodeId(null);
    setDraftState(initialWorkflowDraft(workflow));
    setEngineUnavailable(false);
    void loadRuns(workflow.id);
    void loadLayout(workflow.id);
  };

  const runValidate = async (workflow: WorkflowSummary) => {
    setBusyId(`${workflow.id}:validate`);
    try {
      const result = await validateWorkflow(
        dirty
          ? { manifest: workflowToManifest(workflow) }
          : workflow.path
            ? { path: workflow.path }
            : { id: workflow.id },
      );
      setAction({ id: workflow.id, kind: "validate", result });
    } finally {
      setBusyId(null);
    }
  };

  const runDryRun = async (workflow: WorkflowSummary) => {
    setBusyId(`${workflow.id}:dry-run`);
    try {
      const result = await dryRunWorkflow(
        dirty ? { manifest: workflowToManifest(workflow) } : { id: workflow.id, inputs: {} },
      );
      setAction({ id: workflow.id, kind: "dry-run", result });
      // Snapshot the plan into run history so the runs panel reflects it.
      await recordWorkflowRun({
        workflowId: workflow.id,
        version: workflow.version,
        kind: "dry-run",
        status: result.ok ? "plan" : "blocked",
        startedAt: new Date().toISOString(),
        steps: (result.steps ?? []).map((step) => ({
          id: step.id,
          kind: step.kind,
          status: step.status,
        })),
        summary: dirty ? "plan snapshot (unsaved draft)" : "plan snapshot",
        source: "cave",
      });
      void loadRuns(workflow.id);
    } finally {
      setBusyId(null);
    }
  };

  const runPlay = async (workflow: WorkflowSummary) => {
    setBusyId(`${workflow.id}:play`);
    try {
      const result = await runWorkflow({ id: workflow.id });
      if (result.unavailable) {
        setEngineUnavailable(true);
        showNotice("Daemon workflow engine unavailable — Play stays guarded.");
        return;
      }
      if (!result.ok) {
        showNotice(result.error ?? "workflow run failed");
        return;
      }
      showNotice("Execution accepted by daemon.");
      void loadRuns(workflow.id);
    } catch (err) {
      showNotice(err instanceof Error ? err.message : "workflow run failed");
    } finally {
      setBusyId(null);
    }
  };

  const runSave = async (workflow: WorkflowSummary) => {
    // Templates are read-only. Saving an edit forks a *new* personal workflow
    // under ~/.coven and leaves the repo template untouched. The fork takes a
    // distinct id (`<id>-personal`): the runtime's library is public-wins on id
    // collisions, so a same-id personal copy would be shadowed and invisible.
    // A manifest is routed to ~/.coven unless `visibility.public === true`, so
    // the fork clears that flag.
    const forking = isPublicTemplate(workflow);
    setBusyId(`${workflow.id}:save`);
    try {
      let manifest = workflowToManifest(workflow);
      if (forking) {
        const forkId = uniqueId(`${slugifyWorkflowId(workflow.id)}-personal`);
        const visibility = {
          ...(manifest.visibility && typeof manifest.visibility === "object"
            ? (manifest.visibility as Record<string, unknown>)
            : {}),
          public: false,
          personal: true,
        };
        manifest = { ...manifest, id: forkId, visibility };
      }
      const result = await saveWorkflow(manifest);
      if (!result.ok) {
        showNotice(result.error ?? "save failed");
        return;
      }
      const saved = result.workflow ?? workflow;
      if (result.validation) {
        setAction({ id: saved.id, kind: "validate", result: result.validation });
      }
      setDraftState(initialWorkflowDraft(saved));
      setSelectedWorkflowId(saved.id);
      showNotice(forking ? `Forked to a personal copy: ${saved.id} — the template stays untouched.` : "Workflow saved.");
      void load(true);
      if (forking) void loadRuns(saved.id);
    } finally {
      setBusyId(null);
    }
  };

  const uniqueId = useCallback(
    (base: string): string => {
      const taken = new Set(workflows.map((workflow) => workflow.id));
      if (!taken.has(base)) return base;
      let n = 2;
      while (taken.has(`${base}-${n}`)) n += 1;
      return `${base}-${n}`;
    },
    [workflows],
  );

  const handleCreate = async (input: { name: string; pattern: WorkflowPattern; familiar?: string }) => {
    if (!confirmDiscard()) return;
    const id = uniqueId(slugifyWorkflowId(input.name));
    const workflow = createWorkflowFromTemplate({
      id,
      name: input.name.trim() || id,
      pattern: input.pattern,
      familiar: input.familiar?.trim() || undefined,
    });
    const result = await saveWorkflow(workflowToManifest(workflow));
    if (!result.ok) {
      showNotice(result.error ?? "workflow create failed");
      return;
    }
    await load(true);
    const saved = result.workflow ?? workflow;
    setSelectedWorkflowId(saved.id);
    setSelectedNodeId(null);
    setDraftState(initialWorkflowDraft(saved));
    void loadRuns(saved.id);
    showNotice(`Created ${saved.id} from the ${input.pattern} pattern.`);
  };

  const handleDuplicate = async (workflow: WorkflowSummary) => {
    const id = uniqueId(`${slugifyWorkflowId(workflow.id)}-copy`);
    const copy = duplicateWorkflow(workflow, id);
    const result = await saveWorkflow(workflowToManifest(copy));
    if (!result.ok) {
      showNotice(result.error ?? "duplicate failed");
      return;
    }
    await load(true);
    setSelectedWorkflowId(id);
    setSelectedNodeId(null);
    setDraftState(initialWorkflowDraft(result.workflow ?? copy));
    void loadRuns(id);
    showNotice(`Duplicated as ${id}.`);
  };

  const handleDelete = async (workflow: WorkflowSummary) => {
    if (isPublicTemplate(workflow)) {
      showNotice("Templates are read-only — duplicate to make an editable copy.");
      return;
    }
    if (!window.confirm(`Delete workflow \`${workflow.id}\`? The manifest file is removed.`)) return;
    const result = await deleteWorkflow(
      workflow.path ? { path: workflow.path } : { id: workflow.id },
    );
    if (!result.ok) {
      showNotice(result.error ?? "delete failed");
      return;
    }
    setSelectedWorkflowId(null);
    setDraftState(null);
    await load(true);
    showNotice(`Deleted ${workflow.id}.`);
  };

  const handleAttachRole = async (role: WorkflowRoleSummary, attach: boolean) => {
    if (!draft) return;
    const result = await attachWorkflowToRole({
      roleId: role.id,
      familiar: role.familiar,
      workflowId: draft.id,
      attach,
    });
    if (!result.ok) {
      showNotice(result.error ?? "role update failed");
      return;
    }
    setRoles((current) =>
      current.map((entry) =>
        entry.id === role.id && entry.familiar === role.familiar
          ? { ...entry, workflows: result.workflows ?? entry.workflows }
          : entry,
      ),
    );
    showNotice(attach ? `Attached to role ${role.name}.` : `Detached from role ${role.name}.`);
  };

  const handleSavePositions = (positions: Record<string, { x: number; y: number }>) => {
    if (!draft) return;
    setNodePositions(positions);
    void saveWorkflowLayout(draft.id, positions).catch(() => undefined);
  };

  const handleSchedule = async (fireAt: string, recurrence: WorkflowScheduleRecurrence) => {
    if (!draft) return;
    const result = await scheduleWorkflow({ workflow: draft, fireAt, recurrence });
    showNotice(
      result.ok
        ? "Scheduled — the reminder lives on the Automations surface."
        : result.error ?? "schedule failed",
    );
  };

  return (
    <WorkflowStudio
      workflows={workflows}
      selectedWorkflow={draft}
      selectedNode={selectedNode}
      action={action && action.id === draft?.id ? action : null}
      busyId={busyId}
      loaded={loaded}
      refreshing={refreshing}
      error={error}
      dirty={dirty}
      canUndo={(draftState?.past.length ?? 0) > 0}
      canRedo={(draftState?.future.length ?? 0) > 0}
      runs={runs}
      runsLoading={runsLoading}
      familiarOptions={familiarOptions}
      roles={roles}
      engineUnavailable={engineUnavailable}
      notice={notice}
      savedPositions={nodePositions}
      onRefresh={() => void load(true)}
      onSelectWorkflow={selectWorkflow}
      onSelectNode={(node) => setSelectedNodeId(node.id)}
      onClearNode={() => setSelectedNodeId(null)}
      onValidate={(workflow) => void runValidate(workflow)}
      onDryRun={(workflow) => void runDryRun(workflow)}
      onPlay={(workflow) => void runPlay(workflow)}
      onSave={(workflow) => void runSave(workflow)}
      onUndo={() => dispatchDraft({ type: "undo" })}
      onRedo={() => dispatchDraft({ type: "redo" })}
      onAddStep={(kind) => dispatchDraft({ type: "add-step", kind })}
      onUpdateStep={(id, patch) => dispatchDraft({ type: "update-step", id, patch })}
      onUpdateMeta={(patch) => dispatchDraft({ type: "update-meta", patch })}
      onRemoveStep={(id) => dispatchDraft({ type: "remove-step", id })}
      onConnect={(source, target) => dispatchDraft({ type: "connect", source, target })}
      onSavePositions={handleSavePositions}
      onDisconnect={(source, target) => dispatchDraft({ type: "disconnect", source, target })}
      onCreate={(input) => void handleCreate(input)}
      onDuplicate={(workflow) => void handleDuplicate(workflow)}
      onDelete={(workflow) => void handleDelete(workflow)}
      onAttachRole={(role, attach) => void handleAttachRole(role, attach)}
      onSchedule={(fireAt, recurrence) => void handleSchedule(fireAt, recurrence)}
    />
  );
}
