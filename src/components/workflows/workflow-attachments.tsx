"use client";

import { Icon } from "@/lib/icon";
import type { WorkflowSummary } from "@/lib/workflows";

type WorkflowAttachmentsProps = {
  workflow: WorkflowSummary | null;
};

const attachmentSections = [
  { title: "Familiars", icon: "ph:mask-happy-bold", value: (workflow: WorkflowSummary) => workflow.familiar ?? "Unassigned" },
  { title: "Roles", icon: "ph:users-three-bold", value: (workflow: WorkflowSummary) => workflow.permissions?.join(", ") || "No role bindings" },
  { title: "Boards", icon: "ph:kanban-bold", value: () => "No board attachment" },
  { title: "Projects", icon: "ph:folder-open", value: () => "No project attachment" },
] as const;

export function WorkflowAttachments({ workflow }: WorkflowAttachmentsProps) {
  return (
    <section className="workflow-panel workflow-attachments" aria-label="Workflow attachments">
      <div className="workflow-panel-heading">
        <div>
          <p className="workflow-eyebrow">Attachments</p>
          <h2>Cave bindings</h2>
        </div>
      </div>
      <div className="workflow-attachment-list">
        {attachmentSections.map((section) => (
          <article key={section.title} className="workflow-attachment-row">
            <div>
              <h3>
                <Icon name={section.icon} width={13} />
                {section.title}
              </h3>
              <p>{workflow ? section.value(workflow) : "Select a workflow"}</p>
            </div>
            <button type="button" disabled title="Persistence pending daemon API">
              Save
            </button>
          </article>
        ))}
      </div>
      <p className="workflow-muted">Persistence pending daemon API</p>
    </section>
  );
}
