"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import type { WorkflowSummary } from "@/lib/workflows";

type WorkflowLibraryProps = {
  workflows: WorkflowSummary[];
  selectedWorkflow: WorkflowSummary | null;
  loaded: boolean;
  refreshing: boolean;
  error: string | null;
  dirty: boolean;
  onRefresh: () => void;
  onSelectWorkflow: (workflow: WorkflowSummary) => void;
  onCreateRequest: () => void;
  onDuplicate: (workflow: WorkflowSummary) => void;
  onDelete: (workflow: WorkflowSummary) => void;
};

const validationLabels: Record<NonNullable<WorkflowSummary["validation_state"]>, string> = {
  valid: "Ready",
  warning: "Warnings",
  invalid: "Blocked",
  unknown: "Unknown",
};

/**
 * A workflow is "personal" when its manifest lives under the user's private
 * Coven home (`storage: "personal"`, i.e. `~/.coven/workflows`). Everything
 * else — repo templates and role-declared placeholders — reads as a shared
 * public template. The library groups by this so the two never blur together.
 */
function isPersonal(workflow: WorkflowSummary): boolean {
  return workflow.storage === "personal";
}

function matchesQuery(workflow: WorkflowSummary, query: string): boolean {
  const haystack = [
    workflow.id,
    workflow.name,
    workflow.summary,
    workflow.familiar,
    workflow.pattern,
    ...(workflow.tags ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

export function WorkflowLibrary({
  workflows,
  selectedWorkflow,
  loaded,
  refreshing,
  error,
  dirty,
  onRefresh,
  onSelectWorkflow,
  onCreateRequest,
  onDuplicate,
  onDelete,
}: WorkflowLibraryProps) {
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return workflows;
    return workflows.filter((workflow) => matchesQuery(workflow, trimmed));
  }, [query, workflows]);

  const groups = useMemo(() => {
    const personal: WorkflowSummary[] = [];
    const templates: WorkflowSummary[] = [];
    for (const workflow of visible) {
      (isPersonal(workflow) ? personal : templates).push(workflow);
    }
    return { personal, templates };
  }, [visible]);

  const renderItem = (workflow: WorkflowSummary) => {
    const active = selectedWorkflow?.id === workflow.id;
    const validationState = workflow.validation_state ?? "unknown";
    const personal = isPersonal(workflow);
    return (
      <button
        key={`${workflow.id}:${workflow.path ?? ""}`}
        type="button"
        className={`workflow-library-item${active ? " is-active" : ""}`}
        onClick={() => onSelectWorkflow(workflow)}
      >
        <span className="workflow-library-item-title">
          <span className="workflow-library-item-name">{workflow.name ?? workflow.id}</span>
          {active && dirty && <span className="workflow-dirty-dot" title="Unsaved changes" />}
          <span
            className={`workflow-origin-dot workflow-origin-dot-${personal ? "personal" : "public"}`}
            title={
              personal
                ? "Personal — private to you (~/.coven/workflows)"
                : "Template — shared in the repo (workflows/)"
            }
            aria-label={personal ? "Personal workflow" : "Public template"}
          />
        </span>
        <span className="workflow-library-item-meta">
          <span className={`workflow-health workflow-health-${validationState}`} />
          {validationLabels[validationState]} · v{workflow.version}
          {workflow.pattern ? ` · ${workflow.pattern}` : ""}
        </span>
        {workflow.summary && <span className="workflow-library-item-summary">{workflow.summary}</span>}
      </button>
    );
  };

  return (
    <aside className="workflow-library" aria-label="Workflow library">
      <div className="workflow-panel-heading">
        <div>
          <p className="workflow-eyebrow">Library</p>
          <h2>Workflows</h2>
        </div>
        <div className="workflow-library-actions">
          <button
            type="button"
            className="workflow-icon-button"
            onClick={onCreateRequest}
            title="New workflow"
            aria-label="New workflow"
          >
            <Icon name="ph:plus-bold" width={14} />
          </button>
          <button
            type="button"
            className="workflow-icon-button"
            onClick={onRefresh}
            disabled={refreshing}
            title={refreshing ? "Refreshing workflows" : "Refresh workflows"}
            aria-label={refreshing ? "Refreshing workflows" : "Refresh workflows"}
          >
            <Icon name="ph:arrows-clockwise-bold" width={14} className={refreshing ? "animate-spin" : undefined} />
          </button>
        </div>
      </div>

      <label className="workflow-search">
        <Icon name="ph:magnifying-glass" width={13} />
        <input
          type="search"
          value={query}
          placeholder="Search id, tag, familiar…"
          aria-label="Search workflows"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {!loaded ? (
        <div className="workflow-library-state">Loading workflow manifests...</div>
      ) : error ? (
        <div className="workflow-library-state workflow-library-state-error">Workflows unavailable: {error}</div>
      ) : workflows.length === 0 ? (
        <div className="workflow-library-state">
          No WORKFLOW.md or .workflow.yaml manifests found.
          <button type="button" className="workflow-primary-button" onClick={onCreateRequest}>
            <Icon name="ph:plus-bold" width={13} />
            New workflow
          </button>
        </div>
      ) : (
        <div className="workflow-library-list">
          {visible.length === 0 && (
            <div className="workflow-library-state">No workflows match “{query.trim()}”.</div>
          )}
          {groups.personal.length > 0 && (
            <section className="workflow-library-group" aria-label="Personal workflows">
              <p className="workflow-library-group-heading">
                <span className="workflow-origin-dot workflow-origin-dot-personal" aria-hidden />
                Personal
                <span className="workflow-library-group-count">{groups.personal.length}</span>
              </p>
              {groups.personal.map(renderItem)}
            </section>
          )}
          {groups.templates.length > 0 && (
            <section className="workflow-library-group" aria-label="Public templates">
              <p className="workflow-library-group-heading">
                <span className="workflow-origin-dot workflow-origin-dot-public" aria-hidden />
                Templates
                <span className="workflow-library-group-count">{groups.templates.length}</span>
              </p>
              {groups.templates.map(renderItem)}
            </section>
          )}
        </div>
      )}

      {selectedWorkflow && (
        <div className="workflow-library-footer">
          <button type="button" onClick={() => onDuplicate(selectedWorkflow)} title="Duplicate selected workflow">
            <Icon name="ph:copy" width={13} />
            Duplicate
          </button>
          <button
            type="button"
            className="workflow-danger-button"
            onClick={() => onDelete(selectedWorkflow)}
            title="Delete selected workflow"
          >
            <Icon name="ph:trash" width={13} />
            Delete
          </button>
        </div>
      )}
    </aside>
  );
}
