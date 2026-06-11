"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { workflowToGraph } from "@/lib/workflow-graph";
import {
  dryRunWorkflow,
  listWorkflows,
  validateWorkflow,
  type WorkflowDryRunPlan,
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

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    if (workflows.length === 0) {
      setSelectedWorkflowId(null);
      setSelectedNodeId(null);
      return;
    }
    if (selectedWorkflowId && workflows.some((workflow) => workflow.id === selectedWorkflowId)) {
      return;
    }
    setSelectedWorkflowId(workflows[0]?.id ?? null);
    setSelectedNodeId(null);
  }, [selectedWorkflowId, workflows]);

  const selectedWorkflow = useMemo(
    () => workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? null,
    [selectedWorkflowId, workflows],
  );

  const selectedAction = action?.id === selectedWorkflow?.id ? action : null;

  const selectedDryRun = useMemo<WorkflowDryRunPlan | undefined>(() => {
    if (selectedAction?.kind !== "dry-run") return undefined;
    return selectedAction.result as WorkflowDryRunPlan;
  }, [selectedAction]);

  const selectedGraph = useMemo(() => {
    if (!selectedWorkflow) return null;
    return workflowToGraph(selectedWorkflow, selectedDryRun);
  }, [selectedDryRun, selectedWorkflow]);

  const selectedNode = useMemo(
    () => selectedGraph?.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [selectedGraph, selectedNodeId],
  );

  useEffect(() => {
    if (!selectedNodeId) return;
    if (!selectedGraph?.nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [selectedGraph, selectedNodeId]);

  const runValidate = async (workflow: WorkflowSummary) => {
    setBusyId(`${workflow.id}:validate`);
    try {
      const result = await validateWorkflow(workflow.path ? { path: workflow.path } : { id: workflow.id });
      setAction({ id: workflow.id, kind: "validate", result });
    } finally {
      setBusyId(null);
    }
  };

  const runDryRun = async (workflow: WorkflowSummary) => {
    setBusyId(`${workflow.id}:dry-run`);
    try {
      const result = await dryRunWorkflow({ id: workflow.id, inputs: {} });
      setAction({ id: workflow.id, kind: "dry-run", result });
    } finally {
      setBusyId(null);
    }
  };

  const selectWorkflow = (workflow: WorkflowSummary) => {
    setSelectedWorkflowId(workflow.id);
    setSelectedNodeId(null);
  };

  return (
    <WorkflowStudio
      workflows={workflows}
      selectedWorkflow={selectedWorkflow}
      selectedNode={selectedNode}
      action={selectedAction}
      busyId={busyId}
      loaded={loaded}
      refreshing={refreshing}
      error={error}
      onRefresh={() => void load(true)}
      onSelectWorkflow={selectWorkflow}
      onSelectNode={(node) => setSelectedNodeId(node.id)}
      onClearNode={() => setSelectedNodeId(null)}
      onValidate={(workflow) => void runValidate(workflow)}
      onDryRun={(workflow) => void runDryRun(workflow)}
    />
  );
}
