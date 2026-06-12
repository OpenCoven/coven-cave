"use client";

import { useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/lib/icon";
import type { WorkflowRoleSummary, WorkflowSummary } from "@/lib/workflows";

type WorkflowAttachmentsProps = {
  workflow: WorkflowSummary | null;
  roles: WorkflowRoleSummary[];
  onAttachRole: (role: WorkflowRoleSummary, attach: boolean) => void;
  onUpdateMeta: (patch: Partial<WorkflowSummary>) => void;
  onScheduleRequest: () => void;
};

function AttachmentSection({
  icon,
  title,
  count,
  action,
  children,
}: {
  icon: IconName;
  title: string;
  count?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <article className="workflow-attachment-row">
      <div className="workflow-attachment-head">
        <button
          type="button"
          className="workflow-attachment-toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon
            name={open ? "ph:caret-down" : "ph:caret-right"}
            width={11}
            className="workflow-attachment-caret"
          />
          <Icon name={icon} width={13} />
          <span>{title}</span>
          {count && <span className="workflow-attachment-count">{count}</span>}
        </button>
        {action}
      </div>
      {open && <div className="workflow-attachment-body">{children}</div>}
    </article>
  );
}

/**
 * Cave bindings for the selected workflow. Familiars persist into the
 * manifest (`familiar:` field), roles persist into ROLE.md `workflows:`
 * lists; boards/projects remain visibly pending until an API owns them.
 * Every section collapses independently; bodies span the panel's full width.
 */
export function WorkflowAttachments({
  workflow,
  roles,
  onAttachRole,
  onUpdateMeta,
  onScheduleRequest,
}: WorkflowAttachmentsProps) {
  const attachedRoles = workflow
    ? roles.filter((role) => role.workflows.includes(workflow.id)).length
    : 0;

  return (
    <section className="workflow-panel workflow-attachments" aria-label="Workflow attachments">
      <div className="workflow-panel-heading">
        <div>
          <p className="workflow-eyebrow">Attachments</p>
          <h2>Cave bindings</h2>
        </div>
        <button
          type="button"
          className="workflow-icon-button"
          disabled={!workflow}
          onClick={onScheduleRequest}
          title="Schedule as automation"
          aria-label="Schedule as automation"
        >
          <Icon name="ph:clock-countdown" width={14} />
        </button>
      </div>

      <div className="workflow-attachment-list">
        <AttachmentSection icon="ph:mask-happy" title="Familiars" count={workflow?.familiar ?? undefined}>
          {workflow ? (
            <label className="workflow-field workflow-field-inline">
              <span className="sr-only">Familiar binding</span>
              <input
                type="text"
                key={workflow.familiar ?? ""}
                defaultValue={workflow.familiar ?? ""}
                placeholder="Unassigned — saved into the manifest"
                onBlur={(event) => {
                  const next = event.target.value.trim();
                  if (next !== (workflow.familiar ?? "")) {
                    onUpdateMeta({ familiar: next || undefined });
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                }}
              />
            </label>
          ) : (
            <p>Select a workflow</p>
          )}
        </AttachmentSection>

        <AttachmentSection
          icon="ph:users-three"
          title="Roles"
          count={workflow && roles.length > 0 ? `${attachedRoles} attached` : undefined}
        >
          {!workflow ? (
            <p>Select a workflow</p>
          ) : roles.length === 0 ? (
            <p>No roles discovered — create one under a familiar workspace.</p>
          ) : (
            <ul className="workflow-role-list">
              {roles.map((role) => {
                const attached = role.workflows.includes(workflow.id);
                return (
                  <li key={`${role.familiar}:${role.id}`}>
                    <label className="workflow-role-toggle">
                      <input
                        type="checkbox"
                        checked={attached}
                        onChange={() => onAttachRole(role, !attached)}
                      />
                      <span className="workflow-role-emoji" aria-hidden="true">
                        {role.emoji ?? ""}
                      </span>
                      <span className="workflow-role-name">{role.name}</span>
                      <span className="workflow-role-familiar">{role.familiar}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </AttachmentSection>

        <AttachmentSection
          icon="ph:kanban"
          title="Boards"
          action={
            <button type="button" disabled title="Persistence pending daemon API">
              Save
            </button>
          }
        >
          <p>No board attachment</p>
        </AttachmentSection>

        <AttachmentSection
          icon="ph:folder-open"
          title="Projects"
          action={
            <button type="button" disabled title="Persistence pending daemon API">
              Save
            </button>
          }
        >
          <p>No project attachment</p>
        </AttachmentSection>
      </div>
      <p className="workflow-muted">Boards/Projects: persistence pending daemon API</p>
    </section>
  );
}
