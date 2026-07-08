"use client";

import { memo, useState } from "react";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";

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
  publishStatus: "unpublished" | "published" | "changed";
  publishBlockReason?: string;
  /** A live agent-session run is in progress — show Stop instead of Execute. */
  running: boolean;
  onRename: (name: string) => void;
  onToggleActive: () => void;
  onTab: (tab: FlowTab) => void;
  onUndo: () => void;
  onRedo: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onSave: () => void;
  onExecute: () => void;
  onStop: () => void;
};

function FlowToolbarImpl(props: FlowToolbarProps) {
  const publishLabel = props.publishStatus === "changed"
    ? "Publish changes"
    : props.publishStatus === "published"
      ? "Published"
      : "Publish";
  return (
    <header className="flow-toolbar">
      <div className="flow-toolbar-left">
        <span className="flow-toolbar-mark" aria-hidden>
          <Icon name="ph:flow-arrow" width={16} />
        </span>
        <NameField value={props.name} onCommit={props.onRename} />
        <Button
          variant="secondary"
          size="xs"
          className={`flow-status-toggle${props.active ? " is-on" : ""}`}
          role="switch"
          aria-checked={props.active}
          aria-label={props.active ? "Deactivate flow triggers" : "Activate flow triggers"}
          onClick={props.onToggleActive}
          title={props.active ? "Triggers armed — flow runs automatically" : "Triggers off — manual runs only"}
        >
          {props.active ? "Active" : "Inactive"}
        </Button>
      </div>

      <nav className="flow-toolbar-tabs" aria-label="Flow view">
        <Button
          variant="ghost"
          size="xs"
          className={`flow-tab${props.tab === "editor" ? " is-active" : ""}`}
          aria-current={props.tab === "editor"}
          onClick={() => props.onTab("editor")}
        >
          Editor
        </Button>
        <Button
          variant="ghost"
          size="xs"
          className={`flow-tab${props.tab === "executions" ? " is-active" : ""}`}
          aria-current={props.tab === "executions"}
          onClick={() => props.onTab("executions")}
        >
          Executions
        </Button>
      </nav>

      <div className="flow-toolbar-right">
        <IconButton
          icon="ph:arrow-counter-clockwise"
          size="sm"
          className="flow-toolbar-icon"
          onClick={props.onUndo}
          disabled={!props.canUndo}
          title="Undo"
          aria-label="Undo"
        />
        <IconButton
          icon="ph:arrow-clockwise"
          size="sm"
          className="flow-toolbar-icon"
          onClick={props.onRedo}
          disabled={!props.canRedo}
          title="Redo"
          aria-label="Redo"
        />
        <span className="flow-toolbar-divider" aria-hidden />
        <span className={`flow-toolbar-publish-status flow-toolbar-publish-status-${props.publishStatus}`}>
          {props.publishStatus === "unpublished"
            ? "Unpublished"
            : props.publishStatus === "changed"
              ? "Unpublished changes"
              : "Published"}
        </span>
        <Button
          variant="primary"
          size="xs"
          leadingIcon={props.publishStatus === "published" ? "ph:pause" : "ph:cloud-arrow-up-bold"}
          className="flow-toolbar-publish"
          onClick={props.publishStatus === "published" ? props.onUnpublish : props.onPublish}
          disabled={props.saving || Boolean(props.publishBlockReason)}
          title={props.publishStatus === "published"
            ? "Unpublish production version"
            : props.publishBlockReason ?? "Publish current draft to production"}
        >
          {props.saving ? "Saving…" : publishLabel}
        </Button>

        <Button
          variant="secondary"
          size="xs"
          className="flow-toolbar-save"
          onClick={props.onSave}
          disabled={props.saving || !props.dirty}
        >
          {props.saving ? "Saving…" : "Save"}
        </Button>
        {props.running ? (
          <Button variant="danger" size="xs" className="flow-toolbar-stop" onClick={props.onStop}>
            <span className="flow-toolbar-stop-spinner" aria-hidden />
            Stop
          </Button>
        ) : (
          <Button
            variant="primary"
            size="xs"
            leadingIcon="ph:play"
            className="flow-toolbar-execute"
            onClick={props.onExecute}
            disabled={props.executing}
            title="Run the current draft once, right now — publishing is what arms its trigger"
          >
            {props.executing ? "Running…" : "Execute"}
          </Button>
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

// Memoized: the toolbar's props are primitives + stable callbacks from
// FlowView, so a run-poll tick or a detail-panel keystroke doesn't re-render
// the whole header row.
export const FlowToolbar = memo(FlowToolbarImpl);
