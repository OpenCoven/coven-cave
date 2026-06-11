"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/lib/icon";
import {
  dryRunWorkflow,
  listWorkflows,
  validateWorkflow,
  workflowIssueSummary,
  type WorkflowDryRunPlan,
  type WorkflowSummary,
  type WorkflowValidationResult,
} from "@/lib/workflows";

type WorkflowActionState = {
  id: string;
  kind: "validate" | "dry-run";
  result: WorkflowValidationResult | WorkflowDryRunPlan;
};

export function WorkflowsView() {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [action, setAction] = useState<WorkflowActionState | null>(null);

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

  const validCount = workflows.filter((workflow) => workflow.validation_state === "valid").length;
  const blockedCount = workflows.filter((workflow) => workflow.validation_state === "invalid").length;

  return (
    <div className="flex h-full min-w-0 flex-col bg-background text-foreground">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1180px] px-4 pb-12 sm:px-8">
          <div className="pb-4 pt-5">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h2 className="text-[18px] font-semibold text-[var(--text-primary)]">
                  Workflows
                </h2>
                <p className="mt-1 max-w-3xl text-[12px] text-muted-foreground">
                  CWF-01 manifests discovered by the Coven daemon. Cave reads the canonical
                  workflow files and keeps display-only graph state in WORKFLOW.cave.json sidecars.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void load(true)}
                disabled={refreshing}
                className="focus-ring flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[12px] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                <Icon
                  name="ph:arrows-clockwise-bold"
                  width={12}
                  className={refreshing ? "animate-spin" : undefined}
                />
                <span>{refreshing ? "Refreshing" : "Refresh"}</span>
              </button>
            </div>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
            <SummaryTile icon="ph:git-branch-bold" label="Discovered" value={loaded ? workflows.length.toString() : "…"} />
            <SummaryTile icon="ph:check-circle-bold" label="Valid" value={loaded ? validCount.toString() : "…"} />
            <SummaryTile icon="ph:warning" label="Blocked" value={loaded ? blockedCount.toString() : "…"} />
            <SummaryTile icon="ph:file-code" label="Source" value="Disk" />
          </div>

          {!loaded ? (
            <WorkflowSkeleton />
          ) : error ? (
            <div className="rounded-lg border border-border bg-card px-4 py-6 text-[13px] text-muted-foreground">
              Workflows unavailable: {error}
            </div>
          ) : workflows.length === 0 ? (
            <div className="rounded-lg border border-border bg-card px-4 py-8 text-center">
              <Icon name="ph:git-branch-bold" width={20} className="mx-auto mb-2 text-muted-foreground" />
              <p className="text-[13px] font-medium text-foreground">No workflow manifests found</p>
              <p className="mx-auto mt-1 max-w-xl text-[12px] text-muted-foreground">
                Add a WORKFLOW.md directory workflow or a .workflow.yaml file under a discovered workflow root.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {workflows.map((workflow) => (
                <WorkflowRow
                  key={`${workflow.id}:${workflow.path ?? ""}`}
                  workflow={workflow}
                  busyId={busyId}
                  action={action?.id === workflow.id ? action : null}
                  onValidate={() => void runValidate(workflow)}
                  onDryRun={() => void runDryRun(workflow)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryTile({
  icon,
  label,
  value,
}: {
  icon: Parameters<typeof Icon>[0]["name"];
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
        <Icon name={icon} width={11} />
        <span>{label}</span>
      </div>
      <div className="mt-1 text-[18px] font-semibold text-foreground">{value}</div>
    </div>
  );
}

function WorkflowRow({
  workflow,
  busyId,
  action,
  onValidate,
  onDryRun,
}: {
  workflow: WorkflowSummary;
  busyId: string | null;
  action: WorkflowActionState | null;
  onValidate: () => void;
  onDryRun: () => void;
}) {
  const issues = "issues" in (action?.result ?? {}) ? (action?.result.issues ?? []) : [];
  return (
    <article className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[14px] font-semibold text-foreground">{workflow.name ?? workflow.id}</h3>
            <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {workflow.id}
            </span>
            {workflow.version && (
              <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                v{workflow.version}
              </span>
            )}
          </div>
          {workflow.summary && (
            <p className="mt-1 text-[12px] text-muted-foreground">{workflow.summary}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
            {workflow.familiar && <Pill icon="ph:sparkle" label={workflow.familiar} />}
            {workflow.pattern && <Pill icon="ph:list-bullets" label={workflow.pattern} />}
            {workflow.validation_state && <Pill icon="ph:check-circle" label={workflow.validation_state} />}
            {workflow.path && <Pill icon="ph:folder-open" label={workflow.path} />}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={onValidate}
            disabled={busyId !== null}
            className="focus-ring flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[12px] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            <Icon name="ph:check-circle-bold" width={12} />
            <span>{busyId === `${workflow.id}:validate` ? "Validating" : "Validate"}</span>
          </button>
          <button
            type="button"
            onClick={onDryRun}
            disabled={busyId !== null}
            className="focus-ring flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[12px] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            <Icon name="ph:rocket-bold" width={12} />
            <span>{busyId === `${workflow.id}:dry-run` ? "Planning" : "Dry-run"}</span>
          </button>
        </div>
      </div>
      {action && (
        <div className="mt-3 rounded-md border border-border bg-background px-3 py-2 text-[11px] text-muted-foreground">
          <div className="font-medium text-foreground">
            {action.kind === "validate" ? "Validation" : "Dry-run preview"}:{" "}
            {action.result.ok ? "ready" : "blocked"}
          </div>
          <div className="mt-1">
            {action.result.error ?? workflowIssueSummary(issues)}
          </div>
        </div>
      )}
    </article>
  );
}

function Pill({ icon, label }: { icon: Parameters<typeof Icon>[0]["name"]; label: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-background px-1.5 py-0.5">
      <Icon name={icon} width={10} className="shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}

function WorkflowSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="h-[86px] animate-pulse rounded-lg border border-border bg-card" />
      ))}
    </div>
  );
}
