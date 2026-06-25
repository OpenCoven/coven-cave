"use client";

import { useState } from "react";
import { Icon } from "@/lib/icon";

export type FlowTab = "editor" | "executions";

export type FlowToolbarProps = {
  name: string;
  active: boolean;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  tab: FlowTab;
  saving: boolean;
  executing: boolean;
  manualDataRedacted: boolean;
  productionDataRedacted: boolean;
  /** A live agent-session run is in progress — show Stop instead of Execute. */
  running: boolean;
  onRename: (name: string) => void;
  onToggleActive: () => void;
  onTab: (tab: FlowTab) => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleExecutionDataRedaction: (mode: "manual" | "production") => void;
  onSave: () => void;
  onExecute: () => void;
  onStop: () => void;
};

export function FlowToolbar(props: FlowToolbarProps) {
  return (
    <header className="flow-toolbar">
      <div className="flow-toolbar-left">
        <span className="flow-toolbar-mark" aria-hidden>
          <Icon name="ph:flow-arrow" width={16} />
        </span>
        <NameField value={props.name} onCommit={props.onRename} />
        <button
          type="button"
          className={`flow-status-button${props.active ? " is-on" : ""}`}
          role="switch"
          aria-checked={props.active}
          aria-label={props.active ? "Deactivate flow triggers" : "Activate flow triggers"}
          onClick={props.onToggleActive}
          title={props.active ? "Active — triggers armed" : "Inactive — triggers off"}
        >
          <span className="flow-status-dot" aria-hidden />
        </button>
        {props.dirty && <span className="flow-toolbar-dirty" title="Unsaved changes">●</span>}
      </div>

      <nav className="flow-toolbar-tabs" aria-label="Flow view">
        <button
          type="button"
          className={`flow-tab${props.tab === "editor" ? " is-active" : ""}`}
          aria-current={props.tab === "editor"}
          onClick={() => props.onTab("editor")}
        >
          Editor
        </button>
        <button
          type="button"
          className={`flow-tab${props.tab === "executions" ? " is-active" : ""}`}
          aria-current={props.tab === "executions"}
          onClick={() => props.onTab("executions")}
        >
          Executions
        </button>
      </nav>

      <div className="flow-toolbar-right">
        <button
          type="button"
          className="flow-toolbar-icon"
          onClick={props.onUndo}
          disabled={!props.canUndo}
          title="Undo"
          aria-label="Undo"
        >
          <Icon name="ph:arrow-counter-clockwise" width={15} />
        </button>
        <button
          type="button"
          className="flow-toolbar-icon"
          onClick={props.onRedo}
          disabled={!props.canRedo}
          title="Redo"
          aria-label="Redo"
        >
          <Icon name="ph:arrow-clockwise" width={15} />
        </button>
        <button
          type="button"
          className={`flow-toolbar-redaction${props.manualDataRedacted ? " is-on" : ""}`}
          role="switch"
          aria-checked={props.manualDataRedacted}
          aria-label={props.manualDataRedacted ? "Store manual execution data" : "Redact manual execution data"}
          title={props.manualDataRedacted ? "Manual data redacted" : "Manual data stored"}
          onClick={() => props.onToggleExecutionDataRedaction("manual")}
        >
          <Icon name="ph:database-bold" width={14} />
        </button>
        <button
          type="button"
          className={`flow-toolbar-redaction${props.productionDataRedacted ? " is-on" : ""}`}
          role="switch"
          aria-checked={props.productionDataRedacted}
          aria-label={props.productionDataRedacted ? "Store production execution data" : "Redact production execution data"}
          title={props.productionDataRedacted ? "Production data redacted" : "Production data stored"}
          onClick={() => props.onToggleExecutionDataRedaction("production")}
        >
          <Icon name="ph:lock-simple" width={14} />
        </button>

        <button
          type="button"
          className="flow-toolbar-save"
          onClick={props.onSave}
          disabled={props.saving || !props.dirty}
        >
          {props.saving ? "Saving…" : "Save"}
        </button>
        {props.running ? (
          <button type="button" className="flow-toolbar-stop" onClick={props.onStop}>
            <span className="flow-toolbar-stop-spinner" aria-hidden />
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="flow-toolbar-execute"
            onClick={props.onExecute}
            disabled={props.executing}
          >
            <Icon name="ph:play" width={13} />
            {props.executing ? "Running…" : "Execute"}
          </button>
        )}
      </div>
    </header>
  );
}

function NameField({ value, onCommit }: { value: string; onCommit: (name: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [seed, setSeed] = useState(value);
  if (seed !== value) {
    setSeed(value);
    setDraft(value);
  }
  return (
    <input
      className="flow-toolbar-name"
      size={Math.max(8, Math.min(28, draft.length + 1))}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft.trim() && draft !== value && onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
      }}
      aria-label="Flow name"
    />
  );
}
