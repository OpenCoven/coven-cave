"use client";

import "@/styles/flow.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/lib/icon";
import type { Familiar } from "@/lib/types";
import { catalogNode, createNode } from "@/lib/flow/flow-catalog";
import {
  addConnectedNode,
  connect,
  disconnect,
  duplicateNode,
  emptyFlow,
  flowPublishStatus,
  flowRunRedactsData,
  flowDraftReducer,
  initialFlowDraft,
  moveNodes,
  nodeExecutionChangedSinceSnapshot,
  publishFlow,
  removeNode,
  renameFlow,
  renameNode,
  setActive,
  setExecutionDataRedaction,
  setNodeDisplayNote,
  setNodeExecutionSettings,
  setNodeNotes,
  setNodeParam,
  setNodePinnedData,
  setPinnedDataForNodes,
  spliceNodeOnEdge,
  tidyFlowLayout,
  toggleNodeDisabled,
  unpublishFlow,
  updateSticky,
  type FlowDoc,
  type FlowDraftAction,
  type FlowDraftState,
  type FlowLayoutOrientation,
  type FlowNodeSettings,
  type FlowParamValue,
  type FlowPosition,
  type FlowStickyData,
} from "@/lib/flow/flow-doc";
import { buildPromptFlow, flowNameFromPrompt } from "@/lib/flow/flow-prompt";
import { flowPublishBlockReason, flowRunBlockReason } from "@/lib/flow/flow-compile";
import { finalizeFlowSteps, phasesFromRunSteps, selectNodeRunData } from "@/lib/flow/flow-progress";
import {
  clearFlowRuns,
  deleteFlow,
  listenFlowWebhookTest,
  listFlowRuns,
  listFlows,
  recordFlowRun,
  runFlow,
  saveFlow,
  updateFlowRun,
  type FlowRunRecord,
} from "@/lib/flows";
import { FlowCanvas, type FlowConnectFrom } from "./flow-canvas";
import { FlowExecutions } from "./flow-executions";
import { FlowLibrary } from "./flow-library";
import { FlowTemplateGallery } from "./flow-template-gallery";
import { FLOW_TEMPLATES, instantiateTemplate } from "@/lib/flow/flow-templates";
import { FlowToolbar, type FlowTab } from "./flow-toolbar";
import { NodeCatalogPanel } from "./node-catalog-panel";
import { NodeDetailView, type NodeDetailOption } from "./node-detail-view";
import { FlowRunSteps } from "./flow-run-steps";
import { useFlowRun } from "./use-flow-run";

type CatalogIntent =
  | { kind: "add"; position: FlowPosition }
  | { kind: "connect"; from: FlowConnectFrom; position: FlowPosition }
  | { kind: "splice"; edgeId: string };

function slugifyFlowId(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "flow"
  );
}

export function FlowView() {
  const confirm = useConfirm();
  const [flows, setFlows] = useState<FlowDoc[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftState, setDraftState] = useState<FlowDraftState | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [tab, setTab] = useState<FlowTab>("editor");
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [viewResetKey, setViewResetKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [onboardingPrompt, setOnboardingPrompt] = useState("");
  const [runs, setRuns] = useState<FlowRunRecord[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [familiars, setFamiliars] = useState<Familiar[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [templateGalleryOpen, setTemplateGalleryOpen] = useState(false);
  const [layoutOrientation, setLayoutOrientation] = useState<FlowLayoutOrientation>("horizontal");
  // The run currently overlaid on the canvas (live session, or a finished run
  // whose final state we keep painted until the user switches flows).
  const [activeRun, setActiveRun] = useState<FlowRunRecord | null>(null);

  // Live per-node phases parsed from the active run's agent-session transcript.
  const progress = useFlowRun(activeRun);
  const running = activeRun?.status === "running" && !progress.done;
  const displayedPhases = useMemo(
    () => activeRun ? (progress.markersFound ? progress.phases : phasesFromRunSteps(activeRun.steps)) : null,
    [activeRun, progress.markersFound, progress.phases],
  );

  // What picking a catalog node should do: drop it free, wire it to a dragged
  // handle, or splice it into an edge.
  const catalogIntentRef = useRef<CatalogIntent>({ kind: "add", position: { x: 160, y: 160 } });
  const mountedRef = useRef(true);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doc = draftState?.doc ?? null;
  const dirty = draftState?.dirty ?? false;
  const publishBlock = useMemo(() => doc ? flowPublishBlockReason(doc) : { ok: false }, [doc]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, []);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 6000);
  }, []);

  const dispatchDraft = useCallback((action: FlowDraftAction) => {
    setDraftState((current) => {
      if (action.type === "reset") return initialFlowDraft(action.doc);
      if (!current) return current;
      return flowDraftReducer(current, action);
    });
  }, []);

  /** Apply a pure FlowDoc mutation to the current draft. */
  const mutate = useCallback(
    (fn: (doc: FlowDoc) => FlowDoc) => {
      setDraftState((current) => {
        if (!current) return current;
        return flowDraftReducer(current, { type: "apply", next: fn(current.doc) });
      });
    },
    [],
  );

  const loadFlows = useCallback(async (selectFirst = false) => {
    try {
      const result = await listFlows();
      if (!mountedRef.current) return result.flows ?? [];
      const list = result.flows ?? [];
      setFlows(list);
      if (selectFirst && list.length > 0 && !selectedId) {
        setSelectedId(list[0].id);
        dispatchDraft({ type: "reset", doc: list[0] });
      }
      return list;
    } finally {
      if (mountedRef.current) setLoaded(true);
    }
  }, [dispatchDraft, selectedId]);

  const loadRuns = useCallback(async (flowId: string) => {
    setRunsLoading(true);
    try {
      const result = await listFlowRuns(flowId);
      if (!mountedRef.current) return;
      const list = result.ok ? result.runs : [];
      setRuns(list);
      // Resume the live overlay if the newest run is still running and we aren't
      // already tracking one (e.g. returning to a flow whose execution is live).
      const top = list[0];
      if (top?.status === "running" && top.sessionId) {
        setActiveRun((current) => current ?? top);
      }
    } finally {
      if (mountedRef.current) setRunsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFlows(true);
    void (async () => {
      try {
        const response = await fetch("/api/familiars", { cache: "no-store" });
        const result = (await response.json()) as { ok: boolean; familiars?: Familiar[] };
        if (result.ok && mountedRef.current) setFamiliars(result.familiars ?? []);
      } catch {
        // familiar choices are an enhancement
      }
      try {
        const response = await fetch("/api/capabilities", { cache: "no-store" });
        const result = (await response.json()) as { ok: boolean; coven_skills?: Array<{ id: string }> };
        if (result.ok && mountedRef.current) setSkills((result.coven_skills ?? []).map((s) => s.id));
      } catch {
        // skill autocomplete is an enhancement
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load runs whenever the selected flow changes.
  useEffect(() => {
    if (selectedId) void loadRuns(selectedId);
  }, [selectedId, loadRuns]);

  // When the live run's markers report every node resolved, finalize it once:
  // freeze the overlay at its final colours and persist the verdict + steps.
  useEffect(() => {
    if (!activeRun || activeRun.status !== "running" || !progress.done) return;
    const { steps, status } = finalizeFlowSteps(activeRun.steps, progress.steps, { redactDetails: activeRun.redacted });
    const finishedAt = new Date().toISOString();
    const finalized: FlowRunRecord = { ...activeRun, status, steps, finishedAt };
    setActiveRun(finalized); // status flips off "running" → polling stops
    void updateFlowRun(activeRun.id, { status, steps, finishedAt }).then(() => {
      if (selectedId) void loadRuns(selectedId);
    });
    showNotice(status === "succeeded" ? "Flow finished." : "Flow finished with a failed step.");
  }, [progress.done, progress.steps, activeRun, selectedId, loadRuns, showNotice]);

  const familiarOptions = useMemo<NodeDetailOption[]>(
    () =>
      familiars
        .map((f) => ({
          value: f.id,
          label: f.display_name && f.display_name !== f.id ? `${f.display_name} (${f.id})` : f.id,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [familiars],
  );
  const skillOptions = useMemo<NodeDetailOption[]>(
    () => skills.map((id) => ({ value: id, label: id })),
    [skills],
  );

  const selectedNode = useMemo(
    () => (doc && selectedNodeId ? doc.nodes.find((n) => n.id === selectedNodeId) ?? null : null),
    [doc, selectedNodeId],
  );

  // Input/output data shown in the detail view, from the live transcript or
  // persisted run-step detail when inspecting a historical execution.
  const selectedRunData = useMemo(() => {
    if (!doc || !selectedNode || !activeRun) return null;
    const runDataSteps = progress.markersFound ? progress.steps : activeRun.steps;
    if (!progress.markersFound && !runDataSteps.some((step) => step.detail?.trim())) return null;
    const runData = selectNodeRunData(doc.edges, runDataSteps, selectedNode.id);
    return {
      ...runData,
      stale: nodeExecutionChangedSinceSnapshot(doc, activeRun.flowSnapshot, selectedNode.id),
    };
  }, [doc, selectedNode, activeRun, progress.markersFound, progress.steps]);

  const staleNodeIds = useMemo(() => {
    if (!doc || !activeRun?.flowSnapshot) return {};
    return Object.fromEntries(
      doc.nodes.map((node) => [
        node.id,
        nodeExecutionChangedSinceSnapshot(doc, activeRun.flowSnapshot, node.id),
      ]),
    );
  }, [doc, activeRun?.flowSnapshot]);

  const uniqueId = useCallback(
    (base: string) => {
      const taken = new Set(flows.map((f) => f.id));
      if (!taken.has(base)) return base;
      let n = 2;
      while (taken.has(`${base}-${n}`)) n += 1;
      return `${base}-${n}`;
    },
    [flows],
  );

  const confirmDiscard = useCallback(async () => {
    if (!dirty) return true;
    return confirm({
      title: "Discard unsaved changes?",
      body: "Your edits to this flow will be lost.",
      confirmLabel: "Discard",
      danger: true,
    });
  }, [confirm, dirty]);

  const selectFlow = useCallback(
    async (id: string) => {
      if (id === selectedId) return;
      if (!(await confirmDiscard())) return;
      const flow = flows.find((f) => f.id === id);
      if (!flow) return;
      setSelectedId(id);
      setSelectedNodeId(null);
      setActiveRun(null);
      setTab("editor");
      dispatchDraft({ type: "reset", doc: flow });
    },
    [confirmDiscard, dispatchDraft, flows, selectedId],
  );

  const fromTemplate = useCallback(
    async (templateId: string) => {
      if (!(await confirmDiscard())) return;
      const template = FLOW_TEMPLATES.find((t) => t.id === templateId);
      if (!template) return;
      const now = new Date().toISOString();
      const id = uniqueId(templateId);
      const flow = instantiateTemplate(template, id, now);
      const result = await saveFlow(flow);
      if (!result.ok || !result.flow) {
        showNotice(result.error ?? "couldn't create from template");
        return;
      }
      await loadFlows();
      setSelectedId(result.flow.id);
      setSelectedNodeId(null);
      setActiveRun(null);
      setTab("editor");
      dispatchDraft({ type: "reset", doc: result.flow });
      setTemplateGalleryOpen(false);
      showNotice(`Created from template: ${result.flow.name}`);
    },
    [confirmDiscard, dispatchDraft, loadFlows, saveFlow, showNotice, uniqueId],
  );

  const createFlow = useCallback(async () => {
    if (!(await confirmDiscard())) return;
    const now = new Date().toISOString();
    const id = uniqueId("flow");
    let flow = emptyFlow(id, "My Flow", now);
    // Seed a Manual Trigger so the canvas opens with a starting point.
    const trigger = createNode(flow, "trigger.manual", { x: 120, y: 160 });
    if (trigger) flow = { ...flow, nodes: [trigger] };
    const result = await saveFlow(flow);
    if (!result.ok || !result.flow) {
      showNotice(result.error ?? "couldn't create the flow");
      return;
    }
    await loadFlows();
    setSelectedId(result.flow.id);
    setSelectedNodeId(null);
    setActiveRun(null);
    setTab("editor");
    dispatchDraft({ type: "reset", doc: result.flow });
    showNotice("New flow created.");
  }, [confirmDiscard, dispatchDraft, loadFlows, saveFlow, showNotice, uniqueId]);

  const createFlowFromPrompt = useCallback(async (prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    if (!(await confirmDiscard())) return;
    const now = new Date().toISOString();
    const id = uniqueId(slugifyFlowId(flowNameFromPrompt(trimmed)));
    const flow = buildPromptFlow(id, trimmed, now);
    const result = await saveFlow(flow);
    if (!result.ok || !result.flow) {
      showNotice(result.error ?? "couldn't create the flow");
      return;
    }
    await loadFlows();
    setSelectedId(result.flow.id);
    setSelectedNodeId(null);
    setActiveRun(null);
    setTab("editor");
    dispatchDraft({ type: "reset", doc: result.flow });
    showNotice("Flow created from prompt.");
  }, [confirmDiscard, dispatchDraft, loadFlows, saveFlow, showNotice, uniqueId]);

  const duplicateFlow = useCallback(
    async (id: string) => {
      const source = flows.find((f) => f.id === id);
      if (!source) return;
      const now = new Date().toISOString();
      const copyId = uniqueId(`${slugifyFlowId(source.name)}-copy`);
      const copy: FlowDoc = {
        ...source,
        id: copyId,
        name: `${source.name} copy`,
        active: false,
        createdAt: now,
        updatedAt: now,
      };
      const result = await saveFlow(copy);
      if (!result.ok || !result.flow) {
        showNotice(result.error ?? "duplicate failed");
        return;
      }
      await loadFlows();
      setSelectedId(result.flow.id);
      setActiveRun(null);
      dispatchDraft({ type: "reset", doc: result.flow });
      showNotice(`Duplicated as ${result.flow.name}.`);
    },
    [dispatchDraft, flows, loadFlows, saveFlow, showNotice, uniqueId],
  );

  const removeFlow = useCallback(
    async (id: string) => {
      const flow = flows.find((f) => f.id === id);
      if (!flow) return;
      if (!(await confirm({ title: `Delete “${flow.name}”?`, body: "This flow file is removed.", confirmLabel: "Delete", danger: true }))) {
        return;
      }
      const result = await deleteFlow(id);
      if (!result.ok) {
        showNotice(result.error ?? "delete failed");
        return;
      }
      const next = await loadFlows();
      if (selectedId === id) {
        const first = next[0] ?? null;
        setSelectedId(first?.id ?? null);
        setSelectedNodeId(null);
        if (first) dispatchDraft({ type: "reset", doc: first });
        else setDraftState(null);
      }
      showNotice(`Deleted ${flow.name}.`);
    },
    [confirm, deleteFlow, dispatchDraft, flows, loadFlows, selectedId, showNotice],
  );

  const save = useCallback(async () => {
    if (!doc) return;
    setSaving(true);
    try {
      const result = await saveFlow(doc);
      if (!result.ok || !result.flow) {
        showNotice(result.error ?? "save failed");
        return;
      }
      dispatchDraft({ type: "mark-saved", doc: result.flow });
      setFlows((current) => {
        const without = current.filter((f) => f.id !== result.flow!.id);
        return [result.flow!, ...without];
      });
      showNotice("Flow saved.");
    } finally {
      setSaving(false);
    }
  }, [dispatchDraft, doc, saveFlow, showNotice]);

  const persistFlow = useCallback(async (next: FlowDoc, message: string) => {
    setSaving(true);
    try {
      const result = await saveFlow(next);
      if (!result.ok || !result.flow) {
        showNotice(result.error ?? "save failed");
        return;
      }
      dispatchDraft({ type: "mark-saved", doc: result.flow });
      setFlows((current) => {
        const without = current.filter((f) => f.id !== result.flow!.id);
        return [result.flow!, ...without];
      });
      showNotice(message);
    } finally {
      setSaving(false);
    }
  }, [dispatchDraft, saveFlow, showNotice]);

  const publish = useCallback(() => {
    if (!doc) return;
    const block = flowPublishBlockReason(doc);
    if (!block.ok) {
      showNotice(block.reason ?? "this flow can't be published yet");
      return;
    }
    void persistFlow(publishFlow(doc, new Date().toISOString()), "Flow published. Production triggers use this version.");
  }, [doc, persistFlow, showNotice]);

  const unpublish = useCallback(() => {
    if (!doc) return;
    void persistFlow(unpublishFlow(doc), "Flow unpublished. Production triggers are disabled.");
  }, [doc, persistFlow]);

  const execute = useCallback(async (nodeId?: string, flowSnapshot?: FlowDoc) => {
    if (!doc) return;
    const runDoc = flowSnapshot ?? doc;
    const block = flowRunBlockReason(runDoc, nodeId);
    if (!block.ok) {
      showNotice(block.reason ?? "this flow can't run yet");
      return;
    }
    setExecuting(true);
    try {
      // Persist first so the run executes the latest graph.
      if (dirty && !flowSnapshot) {
        const saved = await saveFlow(doc);
        if (saved.ok && saved.flow) dispatchDraft({ type: "mark-saved", doc: saved.flow });
      }
      const result = await runFlow(runDoc.id, nodeId, flowSnapshot);
      if (result.unavailable) {
        // No daemon to spawn a session — record an honest local preview so the
        // run still lands in history, and tell the user nothing executed.
        await recordFlowRun({
          flowId: runDoc.id,
          flowName: runDoc.name,
          status: "preview",
          mode: "manual",
          redacted: flowRunRedactsData(runDoc, "manual") || undefined,
          startedAt: new Date().toISOString(),
          steps: [],
          summary: nodeId ? `preview only — daemon offline (${nodeId})` : "preview only — daemon offline",
          source: "cave",
          flowSnapshot: runDoc,
        });
        await loadRuns(runDoc.id);
        setTab("executions");
        showNotice("Daemon offline — recorded a preview (no execution).");
        return;
      }
      if (!result.ok) {
        showNotice(result.error ?? "couldn't start the flow");
        return;
      }
      if (result.run && result.sessionId) {
        // Live session run — overlay it on the canvas and stay on the editor so
        // the nodes light up as the agent works through them.
        setActiveRun(result.run);
        setSelectedNodeId(null);
        setTab("editor");
        showNotice(nodeId ? "Running selected step — upstream nodes will light up first." : "Running — watch the nodes light up, or open the session in Chat.");
      } else {
        showNotice("Execution started.");
      }
      await loadRuns(runDoc.id);
    } catch (err) {
      showNotice(err instanceof Error ? err.message : "run failed");
    } finally {
      setExecuting(false);
    }
  }, [dirty, dispatchDraft, doc, loadRuns, recordFlowRun, runFlow, saveFlow, showNotice]);

  const executeNode = useCallback((nodeId: string) => void execute(nodeId), [execute]);

  const stop = useCallback(async () => {
    if (!activeRun) return;
    if (activeRun.sessionId) {
      await fetch(`/api/sessions/${encodeURIComponent(activeRun.sessionId)}/kill`, { method: "POST" }).catch(
        () => undefined,
      );
    }
    const finishedAt = new Date().toISOString();
    const stopped: FlowRunRecord = { ...activeRun, status: "failed", finishedAt, summary: "stopped" };
    setActiveRun(stopped);
    void updateFlowRun(activeRun.id, { status: "failed", finishedAt, summary: "stopped" }).then(() => {
      if (selectedId) void loadRuns(selectedId);
    });
    showNotice("Flow stopped.");
  }, [activeRun, loadRuns, selectedId, showNotice]);

  const openSession = useCallback((sessionId: string) => {
    if (typeof window !== "undefined") window.location.hash = `chat-${sessionId}`;
  }, []);

  const inspectRun = useCallback((run: FlowRunRecord) => {
    setActiveRun(run);
    setSelectedNodeId(
      run.steps.find((step) => step.status === "failed")?.id ?? run.steps[0]?.id ?? null,
    );
    setTab("editor");
    showNotice("Inspecting execution on the canvas.");
  }, [showNotice]);

  const retryRun = useCallback((run: FlowRunRecord, mode: "current" | "original") => {
    const flowSnapshot = mode === "original" ? run.flowSnapshot : undefined;
    if (mode === "original" && !flowSnapshot) {
      showNotice("This execution does not have an original workflow snapshot.");
      return;
    }
    setActiveRun(run);
    setSelectedNodeId(null);
    void execute(undefined, flowSnapshot);
  }, [execute, showNotice]);

  const loadRunData = useCallback((run: FlowRunRecord) => {
    const detailByNodeId = Object.fromEntries(
      run.steps
        .filter((step) => step.detail?.trim())
        .map((step) => [step.id, step.detail?.trim() ?? ""]),
    );
    if (Object.keys(detailByNodeId).length === 0) {
      showNotice("No stored execution data to copy.");
      return;
    }
    mutate((d) => setPinnedDataForNodes(d, detailByNodeId));
    setActiveRun(run);
    setSelectedNodeId(
      run.steps.find((step) => step.status === "failed")?.id ??
        run.steps.find((step) => step.detail?.trim())?.id ??
        null,
    );
    setTab("editor");
    const detailCount = Object.keys(detailByNodeId).length;
    showNotice(`Pinned execution data for ${detailCount} node${detailCount === 1 ? "" : "s"}.`);
  }, [mutate, showNotice]);

  // ---- Canvas / node mutation handlers ----
  const requestAdd = useCallback((position: FlowPosition) => {
    catalogIntentRef.current = { kind: "add", position };
    setCatalogOpen(true);
  }, []);

  const requestConnectToNew = useCallback((from: FlowConnectFrom, position: FlowPosition) => {
    catalogIntentRef.current = { kind: "connect", from, position };
    setCatalogOpen(true);
  }, []);

  const requestInsertEdge = useCallback((edgeId: string) => {
    catalogIntentRef.current = { kind: "splice", edgeId };
    setCatalogOpen(true);
  }, []);

  const pickNode = useCallback(
    (type: string) => {
      const intent = catalogIntentRef.current;
      setCatalogOpen(false);
      setDraftState((current) => {
        if (!current) return current;
        const doc = current.doc;
        const def = catalogNode(type);
        const inHandle = def?.inputs[0]?.id ?? "in";
        const outHandle = def?.outputs[0]?.id ?? "main";

        // Splicing positions the node at the edge's midpoint; otherwise use the
        // intent's drop point.
        let position: FlowPosition;
        if (intent.kind === "splice") {
          const edge = doc.edges.find((e) => e.id === intent.edgeId);
          const src = edge && doc.nodes.find((n) => n.id === edge.source);
          const tgt = edge && doc.nodes.find((n) => n.id === edge.target);
          position =
            src && tgt
              ? { x: (src.position.x + tgt.position.x) / 2, y: (src.position.y + tgt.position.y) / 2 }
              : { x: 200, y: 200 };
        } else {
          position = intent.position;
        }

        const node = createNode(doc, type, position);
        if (!node) return current;

        // Sticky notes have no ports — never wire them, just drop them.
        let next: FlowDoc;
        if (def?.sticky || intent.kind === "add") {
          next = { ...doc, nodes: [...doc.nodes, node] };
        } else if (intent.kind === "connect") {
          next = addConnectedNode(doc, node, intent.from, inHandle, outHandle);
        } else {
          next = spliceNodeOnEdge(doc, intent.edgeId, node, inHandle, outHandle);
        }

        // Stagger the next plain add so repeated picks don't stack exactly.
        catalogIntentRef.current = { kind: "add", position: { x: position.x + 40, y: position.y + 40 } };
        setSelectedNodeId(node.id);
        return flowDraftReducer(current, { type: "apply", next });
      });
    },
    [],
  );

  const onConnect = useCallback(
    (s: string, sh: string, t: string, th: string) => mutate((d) => connect(d, s, sh, t, th)),
    [mutate],
  );
  const onDisconnect = useCallback((edgeId: string) => mutate((d) => disconnect(d, edgeId)), [mutate]);
  const onRemoveNode = useCallback(
    (id: string) => {
      mutate((d) => removeNode(d, id));
      setSelectedNodeId((current) => (current === id ? null : current));
    },
    [mutate],
  );
  const onMoveNodes = useCallback((positions: Record<string, FlowPosition>) => mutate((d) => moveNodes(d, positions)), [mutate]);
  const tidy = useCallback(() => {
    mutate((d) => tidyFlowLayout(d, layoutOrientation));
    setViewResetKey((key) => key + 1);
  }, [layoutOrientation, mutate]);
  const setAndApplyLayoutOrientation = useCallback((orientation: FlowLayoutOrientation) => {
    setLayoutOrientation(orientation);
    mutate((d) => tidyFlowLayout(d, orientation));
    setViewResetKey((key) => key + 1);
  }, [mutate]);
  const onRenameNode = useCallback((id: string, name: string) => mutate((d) => renameNode(d, id, name)), [mutate]);
  const onChangeParam = useCallback(
    (id: string, key: string, value: FlowParamValue) => mutate((d) => setNodeParam(d, id, key, value)),
    [mutate],
  );
  const onChangeNotes = useCallback((id: string, notes: string) => mutate((d) => setNodeNotes(d, id, notes)), [mutate]);
  const onToggleDisplayNote = useCallback(
    (id: string) => mutate((d) => {
      const node = d.nodes.find((n) => n.id === id);
      return setNodeDisplayNote(d, id, node?.displayNote !== true);
    }),
    [mutate],
  );
  const onChangeSettings = useCallback(
    (id: string, patch: Partial<FlowNodeSettings>) => mutate((d) => setNodeExecutionSettings(d, id, patch)),
    [mutate],
  );
  const onPinData = useCallback((id: string, data: string) => mutate((d) => setNodePinnedData(d, id, data)), [mutate]);
  const onDuplicateNode = useCallback((id: string) => {
    if (!doc) return;
    const result = duplicateNode(doc, id);
    if (!result.nodeId) return;
    dispatchDraft({ type: "apply", next: result.doc });
    setSelectedNodeId(result.nodeId);
  }, [dispatchDraft, doc]);
  const onToggleDisabled = useCallback((id: string) => mutate((d) => toggleNodeDisabled(d, id)), [mutate]);
  const listenWebhookTest = useCallback(
    async (id: string) => {
      if (!doc) return null;
      const result = await listenFlowWebhookTest(doc, id);
      if (!result.ok || !result.testUrlPath || !result.expiresAt) {
        showNotice(result.error ?? "couldn't listen for test event");
        return null;
      }
      const origin = typeof window === "undefined" ? "" : window.location.origin;
      showNotice("Listening for test event for 120 seconds.");
      return { testUrl: `${origin}${result.testUrlPath}`, expiresAt: result.expiresAt };
    },
    [doc, showNotice],
  );
  const onChangeSticky = useCallback(
    (id: string, patch: Partial<FlowStickyData>) => mutate((d) => updateSticky(d, id, patch)),
    [mutate],
  );

  if (loaded && flows.length === 0 && !doc) {
    return (
      <div className="flow-view flow-view-onboarding">
        <EmptyState
          icon="ph:flow-arrow"
          headline="Build a flow"
          subtitle="Wire triggers, familiars, skills, and logic on a freeform canvas — an n8n-style automation editor for your coven."
          actions={
            <div className="flow-onboarding-actions">
              <form
                className="flow-onboarding-prompt"
                aria-label="Create flow from prompt"
                onSubmit={(event) => {
                  event.preventDefault();
                  void createFlowFromPrompt(onboardingPrompt);
                }}
              >
                <textarea
                  aria-label="Flow prompt"
                  value={onboardingPrompt}
                  onChange={(event) => setOnboardingPrompt(event.target.value)}
                  placeholder="Describe a flow to create"
                  rows={3}
                />
                <button
                  type="submit"
                  className="flow-toolbar-execute"
                  disabled={onboardingPrompt.trim().length === 0}
                >
                  <Icon name="ph:sparkle" width={14} /> Create
                </button>
              </form>
              <button type="button" className="flow-toolbar-save" onClick={createFlow}>
                <Icon name="ph:plus" width={14} /> Blank
              </button>
            </div>
          }
        />
        <FlowTemplateGallery
          isEmpty
          onUse={(id) => void fromTemplate(id)}
          onClose={() => void createFlow()}
        />
      </div>
    );
  }

  return (
    <div className="flow-view">
      <FlowLibrary
        flows={flows}
        selectedId={selectedId}
        loading={!loaded}
        onSelect={(id) => void selectFlow(id)}
        onCreate={() => void createFlow()}
        onCreateFromPrompt={(prompt) => void createFlowFromPrompt(prompt)}
        onDuplicate={(id) => void duplicateFlow(id)}
        onDelete={(id) => void removeFlow(id)}
        onTemplate={() => setTemplateGalleryOpen(true)}
      />

      {templateGalleryOpen && (
        <div className="flow-template-overlay" role="dialog" aria-modal aria-label="Flow templates">
          <div className="flow-template-overlay-backdrop" onClick={() => setTemplateGalleryOpen(false)} />
          <div className="flow-template-overlay-panel">
            <FlowTemplateGallery
              onUse={(id) => void fromTemplate(id)}
              onClose={() => setTemplateGalleryOpen(false)}
            />
          </div>
        </div>
      )}

      <div className="flow-main">
        {doc ? (
          <>
            <FlowToolbar
              name={doc.name}
              active={doc.active}
              dirty={dirty}
              canUndo={(draftState?.past.length ?? 0) > 0}
              canRedo={(draftState?.future.length ?? 0) > 0}
              tab={tab}
              saving={saving}
              executing={executing}
              manualDataRedacted={flowRunRedactsData(doc, "manual")}
              productionDataRedacted={flowRunRedactsData(doc, "production")}
              publishStatus={flowPublishStatus(doc)}
              publishBlockReason={publishBlock.ok ? undefined : publishBlock.reason}
              onRename={(name) => mutate((d) => renameFlow(d, name))}
              onToggleActive={() => mutate((d) => setActive(d, !d.active))}
              onToggleExecutionDataRedaction={(mode) => mutate((d) => setExecutionDataRedaction(d, mode, !flowRunRedactsData(d, mode)))}
              onPublish={publish}
              onUnpublish={unpublish}
              onTab={setTab}
              onUndo={() => dispatchDraft({ type: "undo" })}
              onRedo={() => dispatchDraft({ type: "redo" })}
              onSave={() => void save()}
              onExecute={() => void execute()}
              running={running}
              onStop={() => void stop()}
            />

            {notice && <div className="flow-notice" role="status">{notice}</div>}

            {tab === "editor" ? (
              <div className="flow-editor">
                <FlowCanvas
                  doc={doc}
                  selectedNodeId={selectedNodeId}
                  phases={displayedPhases}
                  staleNodeIds={staleNodeIds}
                  activeNodeId={running ? progress.activeNodeId : null}
                  viewResetKey={viewResetKey}
                  layoutOrientation={layoutOrientation}
                  onSelectNode={setSelectedNodeId}
                  onOpenNode={setSelectedNodeId}
                  onConnect={onConnect}
                  onDisconnect={onDisconnect}
                  onRemoveNode={onRemoveNode}
                  onMoveNodes={onMoveNodes}
                  onRequestAdd={requestAdd}
                  onConnectToNew={requestConnectToNew}
                  onInsertEdge={requestInsertEdge}
                  onTidy={tidy}
                  onLayoutOrientation={setAndApplyLayoutOrientation}
                  onStickyText={(id, text) => onChangeSticky(id, { text })}
                  onStickySize={(id, width, height) => onChangeSticky(id, { width, height })}
                />
                {activeRun && activeRun.steps.length > 0 && (
                  <FlowRunSteps
                    doc={doc}
                    run={activeRun}
                    progress={progress}
                    running={running}
                    selectedNodeId={selectedNodeId}
                    onSelectNode={setSelectedNodeId}
                    onOpenSession={openSession}
                    onStop={() => void stop()}
                  />
                )}
                {selectedNode && (
                  <NodeDetailView
                    node={selectedNode}
                    def={catalogNode(selectedNode.type)}
                    familiarOptions={familiarOptions}
                    skillOptions={skillOptions}
                    runData={selectedRunData}
                    onRename={(name) => onRenameNode(selectedNode.id, name)}
                    onChangeParam={(key, value) => onChangeParam(selectedNode.id, key, value)}
                    onChangeNotes={(notes) => onChangeNotes(selectedNode.id, notes)}
                    onToggleDisplayNote={() => onToggleDisplayNote(selectedNode.id)}
                    onChangeSettings={(patch) => onChangeSettings(selectedNode.id, patch)}
                    onToggleDisabled={() => onToggleDisabled(selectedNode.id)}
                    onExecuteNode={() => void executeNode(selectedNode.id)}
                    onPinData={(data) => onPinData(selectedNode.id, data)}
                    onDuplicate={() => onDuplicateNode(selectedNode.id)}
                    onListenWebhookTest={() => listenWebhookTest(selectedNode.id)}
                    onChangeSticky={(patch) => onChangeSticky(selectedNode.id, patch)}
                    onDelete={() => onRemoveNode(selectedNode.id)}
                    onClose={() => setSelectedNodeId(null)}
                  />
                )}
              </div>
            ) : (
              <FlowExecutions
                runs={runs}
                loading={runsLoading}
                onInspectRun={inspectRun}
                onRetryRun={retryRun}
                onLoadRunData={loadRunData}
                onOpenSession={openSession}
                onClear={() => {
                  if (selectedId) {
                    void clearFlowRuns(selectedId).then(() => setRuns([]));
                  }
                }}
              />
            )}

            {/* Skill autocomplete options shared by NDV skill fields. */}
            <datalist id="flow-skill-options">
              {skillOptions.map((option) => (
                <option key={option.value} value={option.value} />
              ))}
            </datalist>
          </>
        ) : (
          <div className="flow-main-empty">
            <EmptyState icon="ph:flow-arrow" headline="Select a flow" subtitle="Pick a flow on the left, or create a new one." />
          </div>
        )}
      </div>

      <NodeCatalogPanel open={catalogOpen} onPick={pickNode} onClose={() => setCatalogOpen(false)} />
    </div>
  );
}
