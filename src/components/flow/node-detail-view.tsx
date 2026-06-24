"use client";

import { useState } from "react";
import { Icon } from "@/lib/icon";
import { STICKY_COLORS, type FlowNodeType, type FlowParamField } from "@/lib/flow/flow-catalog";
import type { FlowNode, FlowParamValue, FlowStickyData } from "@/lib/flow/flow-doc";

export type NodeDetailOption = { value: string; label: string };

export type NodeDetailViewProps = {
  node: FlowNode;
  def: FlowNodeType | undefined;
  familiarOptions: NodeDetailOption[];
  skillOptions: NodeDetailOption[];
  onRename: (name: string) => void;
  onChangeParam: (key: string, value: FlowParamValue) => void;
  onChangeNotes: (notes: string) => void;
  onToggleDisabled: () => void;
  onChangeSticky: (patch: Partial<FlowStickyData>) => void;
  onDelete: () => void;
  onClose: () => void;
};

export function NodeDetailView(props: NodeDetailViewProps) {
  const { node, def } = props;
  if (def?.sticky || node.sticky) return <StickyDetail {...props} />;

  return (
    <aside className="flow-ndv" aria-label={`${node.name} settings`}>
      <header className="flow-ndv-head">
        <span className="flow-ndv-icon" style={{ background: def?.accent ?? "#7b7f87" }} aria-hidden>
          <Icon name={def?.icon ?? "ph:cube"} width={16} />
        </span>
        <NameField value={node.name} onCommit={props.onRename} />
        <button type="button" className="flow-ndv-close" onClick={props.onClose} aria-label="Close settings">
          <Icon name="ph:x" width={14} />
        </button>
      </header>
      <p className="flow-ndv-type">{def?.label ?? node.type}</p>
      {def?.description && <p className="flow-ndv-desc">{def.description}</p>}

      <div className="flow-ndv-fields">
        {(def?.params ?? []).length === 0 && (
          <p className="flow-ndv-no-params">This node has no parameters.</p>
        )}
        {(def?.params ?? []).map((field) => (
          <ParamRow
            key={field.key}
            field={field}
            value={node.params[field.key]}
            familiarOptions={props.familiarOptions}
            skillOptions={props.skillOptions}
            onChange={(value) => props.onChangeParam(field.key, value)}
          />
        ))}

        <label className="flow-ndv-field">
          <span className="flow-ndv-label">Notes</span>
          <textarea
            className="flow-ndv-textarea"
            rows={2}
            value={node.notes ?? ""}
            placeholder="Optional note shown on hover"
            onChange={(event) => props.onChangeNotes(event.target.value)}
          />
        </label>
      </div>

      <footer className="flow-ndv-foot">
        <button type="button" className="flow-ndv-action" onClick={props.onToggleDisabled}>
          <Icon name={node.disabled ? "ph:play" : "ph:pause"} width={13} />
          {node.disabled ? "Enable" : "Disable"}
        </button>
        <button type="button" className="flow-ndv-action flow-ndv-danger" onClick={props.onDelete}>
          <Icon name="ph:trash" width={13} />
          Delete
        </button>
      </footer>
    </aside>
  );
}

function ParamRow({
  field,
  value,
  familiarOptions,
  skillOptions,
  onChange,
}: {
  field: FlowParamField;
  value: FlowParamValue | undefined;
  familiarOptions: NodeDetailOption[];
  skillOptions: NodeDetailOption[];
  onChange: (value: FlowParamValue) => void;
}) {
  const str = value === undefined || value === null ? "" : String(value);
  return (
    <label className="flow-ndv-field">
      <span className="flow-ndv-label">{field.label}</span>
      {renderControl()}
      {field.help && <span className="flow-ndv-help">{field.help}</span>}
    </label>
  );

  function renderControl() {
    switch (field.control) {
      case "textarea":
        return (
          <textarea
            className="flow-ndv-textarea"
            rows={4}
            value={str}
            placeholder={field.placeholder}
            onChange={(event) => onChange(event.target.value)}
          />
        );
      case "code":
        return (
          <textarea
            className="flow-ndv-textarea flow-ndv-code"
            rows={5}
            spellCheck={false}
            value={str}
            placeholder={field.placeholder}
            onChange={(event) => onChange(event.target.value)}
          />
        );
      case "json":
        return (
          <textarea
            className="flow-ndv-textarea flow-ndv-code"
            rows={3}
            spellCheck={false}
            value={str}
            placeholder={field.placeholder ?? "{}"}
            onChange={(event) => onChange(event.target.value)}
          />
        );
      case "number":
        return (
          <input
            className="flow-ndv-input"
            type="number"
            value={str}
            onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))}
          />
        );
      case "boolean":
        return (
          <span className="flow-ndv-toggle">
            <input
              type="checkbox"
              checked={value === true}
              onChange={(event) => onChange(event.target.checked)}
            />
            <span>{value === true ? "On" : "Off"}</span>
          </span>
        );
      case "select":
        return (
          <select className="flow-ndv-input" value={str} onChange={(event) => onChange(event.target.value)}>
            {!field.default && <option value="">Choose…</option>}
            {(field.options ?? []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        );
      case "familiar":
        return (
          <select className="flow-ndv-input" value={str} onChange={(event) => onChange(event.target.value)}>
            <option value="">Choose a familiar…</option>
            {familiarOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        );
      case "skill":
        return (
          <input
            className="flow-ndv-input"
            list="flow-skill-options"
            value={str}
            placeholder="skill id"
            onChange={(event) => onChange(event.target.value)}
          />
        );
      default:
        return (
          <input
            className="flow-ndv-input"
            type="text"
            value={str}
            placeholder={field.placeholder}
            onChange={(event) => onChange(event.target.value)}
          />
        );
    }
  }
}

function StickyDetail(props: NodeDetailViewProps) {
  const sticky = props.node.sticky;
  return (
    <aside className="flow-ndv" aria-label="Sticky note settings">
      <header className="flow-ndv-head">
        <span className="flow-ndv-icon" style={{ background: "#c9b458" }} aria-hidden>
          <Icon name="ph:note" width={16} />
        </span>
        <span className="flow-ndv-name-static">Sticky note</span>
        <button type="button" className="flow-ndv-close" onClick={props.onClose} aria-label="Close settings">
          <Icon name="ph:x" width={14} />
        </button>
      </header>
      <div className="flow-ndv-fields">
        <label className="flow-ndv-field">
          <span className="flow-ndv-label">Text</span>
          <textarea
            className="flow-ndv-textarea"
            rows={5}
            value={sticky?.text ?? ""}
            onChange={(event) => props.onChangeSticky({ text: event.target.value })}
          />
        </label>
        <div className="flow-ndv-field">
          <span className="flow-ndv-label">Colour</span>
          <div className="flow-sticky-swatches">
            {STICKY_COLORS.map((color) => (
              <button
                key={color.key}
                type="button"
                className={`flow-sticky-swatch${sticky?.color === color.key ? " is-active" : ""}`}
                style={{ background: color.fill }}
                aria-label={color.label}
                aria-pressed={sticky?.color === color.key}
                onClick={() => props.onChangeSticky({ color: color.key })}
              />
            ))}
          </div>
        </div>
      </div>
      <footer className="flow-ndv-foot">
        <button type="button" className="flow-ndv-action flow-ndv-danger" onClick={props.onDelete}>
          <Icon name="ph:trash" width={13} />
          Delete
        </button>
      </footer>
    </aside>
  );
}

function NameField({ value, onCommit }: { value: string; onCommit: (name: string) => void }) {
  const [draft, setDraft] = useState(value);
  // Re-seed when switching nodes.
  const [seed, setSeed] = useState(value);
  if (seed !== value) {
    setSeed(value);
    setDraft(value);
  }
  return (
    <input
      className="flow-ndv-name"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft.trim() && draft !== value && onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
      }}
      aria-label="Node name"
    />
  );
}
