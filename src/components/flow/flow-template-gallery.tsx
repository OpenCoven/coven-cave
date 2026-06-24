"use client";

// FlowTemplateGallery — a modal/overlay showing pre-built flow templates.
//
// Shown in two contexts:
//   1. Empty-state: when there are no flows yet, replaces the bare "New flow" empty state.
//   2. On-demand: via the "From template" button in the FlowLibrary header.
//
// Each card shows the template name, category badge, description, and a
// "Use template" button. Clicking creates a new flow from the template,
// saves it to disk, and calls onSelect with the new flow id.

import { useState } from "react";
import { Icon } from "@/lib/icon";
import { FLOW_TEMPLATES, type FlowTemplate } from "@/lib/flow/flow-templates";

const CATEGORY_LABEL: Record<FlowTemplate["category"], string> = {
  research: "Research",
  automation: "Automation",
  review: "Review",
  notification: "Notification",
  data: "Data",
  chat: "Chat",
};

const CATEGORY_COLOR: Record<FlowTemplate["category"], string> = {
  research: "var(--color-violet-500, #9a8ecd)",
  automation: "var(--color-teal-500, #5aa37a)",
  review: "var(--color-blue-500, #6b8fbf)",
  notification: "var(--color-amber-500, #d98b3f)",
  data: "var(--color-green-600, #7c9b70)",
  chat: "var(--color-violet-400, #b8aee8)",
};

export type FlowTemplateGalleryProps = {
  /** Called when the user picks a template and instantiation succeeds. */
  onUse: (templateId: string) => void | Promise<void>;
  /** Called when the user closes the gallery without picking. */
  onClose?: () => void;
  /** Whether this is the primary empty-state (no close button shown). */
  isEmpty?: boolean;
};

export function FlowTemplateGallery({ onUse, onClose, isEmpty }: FlowTemplateGalleryProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<FlowTemplate["category"] | "all">("all");

  const categories = Array.from(
    new Set(FLOW_TEMPLATES.map((t) => t.category)),
  ) as FlowTemplate["category"][];

  const visible =
    filter === "all" ? FLOW_TEMPLATES : FLOW_TEMPLATES.filter((t) => t.category === filter);

  async function handleUse(template: FlowTemplate) {
    if (busy) return;
    setBusy(template.id);
    try {
      await onUse(template.id);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flow-template-gallery">
      {/* Header */}
      <div className="flow-template-gallery-header">
        <div className="flow-template-gallery-title">
          <Icon name="ph:squares-four" width={18} aria-hidden />
          {isEmpty ? "Start from a template" : "Flow templates"}
        </div>
        <div className="flow-template-gallery-header-right">
          {!isEmpty && (
            <button
              type="button"
              className="flow-template-gallery-blank"
              onClick={onClose}
              title="Start blank instead"
            >
              Start blank
            </button>
          )}
          {onClose && !isEmpty && (
            <button
              type="button"
              className="flow-template-gallery-close"
              onClick={onClose}
              aria-label="Close gallery"
            >
              <Icon name="ph:x" width={15} />
            </button>
          )}
        </div>
      </div>

      {/* Category filter pills */}
      <div className="flow-template-gallery-filters">
        <button
          type="button"
          className={`flow-template-filter-pill${filter === "all" ? " is-active" : ""}`}
          onClick={() => setFilter("all")}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            className={`flow-template-filter-pill${filter === cat ? " is-active" : ""}`}
            onClick={() => setFilter(cat)}
          >
            {CATEGORY_LABEL[cat]}
          </button>
        ))}
      </div>

      {/* Template grid */}
      <div className="flow-template-gallery-grid">
        {visible.map((template) => (
          <div key={template.id} className="flow-template-card">
            {/* Icon tile */}
            <div
              className="flow-template-card-icon"
              style={{ background: `${template.accent}22`, color: template.accent }}
            >
              <Icon name={template.icon as any} width={22} />
            </div>

            {/* Body */}
            <div className="flow-template-card-body">
              <div className="flow-template-card-top">
                <span className="flow-template-card-name">{template.name}</span>
                <span
                  className="flow-template-card-badge"
                  style={{ color: CATEGORY_COLOR[template.category] }}
                >
                  {CATEGORY_LABEL[template.category]}
                </span>
              </div>
              <p className="flow-template-card-desc">{template.description}</p>
              <div className="flow-template-card-meta">
                <span className="flow-template-card-nodes">
                  {template.graph.nodes.length} node{template.graph.nodes.length !== 1 ? "s" : ""}
                </span>
              </div>
            </div>

            {/* Action */}
            <button
              type="button"
              className="flow-template-card-use"
              disabled={busy === template.id}
              onClick={() => void handleUse(template)}
            >
              {busy === template.id ? (
                <Icon name="ph:circle-notch-bold" width={13} className="flow-template-card-spinner" />
              ) : (
                <Icon name="ph:arrow-right-bold" width={13} />
              )}
              Use template
            </button>
          </div>
        ))}
      </div>

      {isEmpty && (
        <div className="flow-template-gallery-blank-row">
          <button
            type="button"
            className="flow-template-gallery-blank-btn"
            onClick={onClose}
          >
            <Icon name="ph:plus" width={14} />
            Start with a blank flow instead
          </button>
        </div>
      )}
    </div>
  );
}
