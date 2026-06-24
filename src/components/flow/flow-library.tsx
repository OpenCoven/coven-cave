"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Icon } from "@/lib/icon";
import { RelativeTime } from "@/components/ui/relative-time";
import type { FlowDoc } from "@/lib/flows";

export type FlowLibraryProps = {
  flows: FlowDoc[];
  selectedId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onCreateFromPrompt: (prompt: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
};

export function FlowLibrary(props: FlowLibraryProps) {
  const [query, setQuery] = useState("");
  const [promptDraft, setPromptDraft] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return props.flows;
    return props.flows.filter((flow) => `${flow.name} ${flow.id}`.toLowerCase().includes(q));
  }, [props.flows, query]);

  function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = promptDraft.trim();
    if (!prompt) return;
    props.onCreateFromPrompt(prompt);
    setPromptDraft("");
  }

  return (
    <aside className="flow-library" aria-label="Flows">
      <div className="flow-library-head">
        <span className="flow-library-title">Flows</span>
        <button type="button" className="flow-library-new" onClick={props.onCreate} title="New flow">
          <Icon name="ph:plus" width={14} /> New
        </button>
      </div>
      <div className="flow-library-search">
        <Icon name="ph:magnifying-glass" width={13} aria-hidden />
        <input
          type="text"
          placeholder="Search flows…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <form className="flow-library-prompt" aria-label="Create flow from prompt" onSubmit={submitPrompt}>
        <textarea
          value={promptDraft}
          onChange={(event) => setPromptDraft(event.target.value)}
          placeholder="Describe a flow to create"
          rows={3}
        />
        <button type="submit" className="flow-library-prompt-submit" disabled={promptDraft.trim().length === 0}>
          <Icon name="ph:sparkle" width={13} /> Create
        </button>
      </form>

      {props.loading && props.flows.length === 0 ? (
        <ul className="flow-library-list">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flow-library-row flow-library-skeleton" aria-hidden />
          ))}
        </ul>
      ) : filtered.length === 0 ? (
        <p className="flow-library-empty">
          {props.flows.length === 0 ? "No flows yet — create your first one." : "No flows match your search."}
        </p>
      ) : (
        <ul className="flow-library-list">
          {filtered.map((flow) => (
            <li
              key={flow.id}
              className={`flow-library-row${flow.id === props.selectedId ? " is-active" : ""}`}
            >
              <button type="button" className="flow-library-select" onClick={() => props.onSelect(flow.id)}>
                <span className="flow-library-row-name">{flow.name}</span>
                <span className="flow-library-row-meta">
                  {flow.active && <span className="flow-library-active-dot" title="Active" />}
                  {flow.nodes.length} node{flow.nodes.length === 1 ? "" : "s"} ·{" "}
                  <RelativeTime iso={flow.updatedAt} fallback="new" />
                </span>
              </button>
              <span className="flow-library-row-actions">
                <button
                  type="button"
                  className="flow-library-row-action"
                  onClick={() => props.onDuplicate(flow.id)}
                  title="Duplicate"
                  aria-label={`Duplicate ${flow.name}`}
                >
                  <Icon name="ph:copy" width={13} />
                </button>
                <button
                  type="button"
                  className="flow-library-row-action flow-library-row-danger"
                  onClick={() => props.onDelete(flow.id)}
                  title="Delete"
                  aria-label={`Delete ${flow.name}`}
                >
                  <Icon name="ph:trash" width={13} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
