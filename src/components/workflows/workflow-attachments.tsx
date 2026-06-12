"use client";

import { Icon } from "@/lib/icon";
import type { WorkflowRoleSummary, WorkflowSummary } from "@/lib/workflows";

type WorkflowAttachmentsProps = {
  workflow: WorkflowSummary | null;
  roles: WorkflowRoleSummary[];
  onAttachRole: (role: WorkflowRoleSummary, attach: boolean) => void;
  onUpdateMeta: (patch: Partial<WorkflowSummary>) => void;
  onScheduleRequest: () => void;
};

/**
 * Cave bindings for the selected workflow. Familiars persist into the
 * manifest (`familiar:` field), roles persist into ROLE.md `workflows:`
 * lists; boards/projects remain visibly pending until an API owns them.
 */
export function WorkflowAttachments({
  workflow,
  roles,
  onAttachRole,
  onUpdateMeta,
  onScheduleRequest,
}: WorkflowAttachmentsProps) {
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
        <article className="workflow-attachment-row">
          <div>
            <h3>
              <Icon name="ph:mask-happy" width={13} />
              Familiars
            </h3>
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
          </div>
        </article>

        <article className="workflow-attachment-row">
          <div>
            <h3>
              <Icon name="ph:users-three" width={13} />
              Roles
            </h3>
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
                        <span className="workflow-role-name">
                          {role.emoji ? `${role.emoji} ` : ""}
                          {role.name}
                        </span>
                        <span className="workflow-role-familiar">{role.familiar}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </article>

        <article className="workflow-attachment-row">
          <div>
            <h3>
              <Icon name="ph:kanban" width={13} />
              Boards
            </h3>
            <p>No board attachment</p>
          </div>
          <button type="button" disabled title="Persistence pending daemon API">
            Save
          </button>
        </article>

        <article className="workflow-attachment-row">
          <div>
            <h3>
              <Icon name="ph:folder-open" width={13} />
              Projects
            </h3>
            <p>No project attachment</p>
          </div>
          <button type="button" disabled title="Persistence pending daemon API">
            Save
          </button>
        </article>
      </div>
      <p className="workflow-muted">Boards/Projects: persistence pending daemon API</p>
    </section>
  );
}
