"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import { isPersonalWorkflow, isPublicTemplate, type WorkflowSummary } from "@/lib/workflows";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

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
  onImportRequest: () => void;
  onDuplicate: (workflow: WorkflowSummary) => void;
  onDelete: (workflow: WorkflowSummary) => void;
};

const validationLabels: Record<NonNullable<WorkflowSummary["validation_state"]>, string> = {
  valid: "Ready",
  warning: "Warnings",
  invalid: "Blocked",
  unknown: "Unknown",
};

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
  onImportRequest,
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
      (isPersonalWorkflow(workflow) ? personal : templates).push(workflow);
    }
    return { personal, templates };
  }, [visible]);

  const renderItem = (workflow: WorkflowSummary) => {
    const active = selectedWorkflow?.id === workflow.id;
    const validationState = workflow.validation_state ?? "unknown";
    const personal = isPersonalWorkflow(workflow);
    return (
      <button
        key={`${workflow.id}:${workflow.path ?? ""}`}
        type="button"
        className={`workflow-library-item${active ? " is-active" : ""}`}
        aria-pressed={active}
        onClick={() => onSelectWorkflow(workflow)}
      >
        <span className="workflow-library-item-title">
          <span className="workflow-library-item-name" title={workflow.name ?? workflow.id}>{workflow.name ?? workflow.id}</span>
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
      {/* The panel header ("Workflows" + collapse) supplies the title; this
          row just carries the create/refresh actions, right-aligned. */}
      <div className="workflow-library-toolbar">
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
            onClick={onImportRequest}
            title="Import workflow from a manifest"
            aria-label="Import workflow from a manifest"
          >
            <Icon name="ph:clipboard-text" width={14} />
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
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.preventDefault();
              setQuery("");
            }
          }}
        />
      </label>

      {!loaded ? (
        <SkeletonRows count={6} className="workflow-library-list" />
      ) : error ? (
        <div className="workflow-library-state workflow-library-state-error" role="alert">
          <span className="workflow-library-state-error-msg">
            <Icon name="ph:warning-circle" width={13} aria-hidden />
            Workflows unavailable: {error}
          </span>
          <button type="button" className="workflow-primary-button" onClick={onRefresh}>
            <Icon name="ph:arrow-clockwise" width={13} />
            Retry
          </button>
        </div>
      ) : workflows.length === 0 ? (
        <EmptyState
          icon="ph:graph"
          headline="No workflows yet"
          subtitle="No WORKFLOW.md or .workflow.yaml manifests found. Create one to chain steps into a repeatable run."
          actions={
            <Button variant="primary" leadingIcon="ph:plus" onClick={onCreateRequest}>
              New workflow
            </Button>
          }
        />
      ) : (
        <div className="workflow-library-list">
          {visible.length === 0 && (
            <EmptyState
              compact
              icon="ph:magnifying-glass"
              headline="No workflows match"
              subtitle={`Nothing matches “${query.trim()}”. Try a different term or clear the search.`}
            />
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
          {isPublicTemplate(selectedWorkflow) && (
            <p className="workflow-library-footer-note" title="Templates live in the repo (workflows/). Editing and saving forks a personal copy to ~/.coven; the template itself stays untouched.">
              <Icon name="ph:lock-simple" width={12} />
              Read-only template — edits fork a personal copy
            </p>
          )}
          <div className="workflow-library-footer-actions">
            <button type="button" onClick={() => onDuplicate(selectedWorkflow)} title="Duplicate selected workflow">
              <Icon name="ph:copy" width={13} />
              Duplicate
            </button>
            <button
              type="button"
              className="workflow-danger-button"
              disabled={isPublicTemplate(selectedWorkflow)}
              onClick={() => onDelete(selectedWorkflow)}
              title={
                isPublicTemplate(selectedWorkflow)
                  ? "Templates are read-only — duplicate to make an editable copy"
                  : "Delete selected workflow"
              }
            >
              <Icon name="ph:trash" width={13} />
              Delete
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
