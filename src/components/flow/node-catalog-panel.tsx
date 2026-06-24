"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { searchCatalog } from "@/lib/flow/flow-catalog";

export type NodeCatalogPanelProps = {
  open: boolean;
  onPick: (type: string) => void;
  onClose: () => void;
};

/** n8n-style "add node" panel: searchable, grouped node library. */
export function NodeCatalogPanel({ open, onPick, onClose }: NodeCatalogPanelProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      // Focus the search the moment the panel opens (n8n behaviour).
      const id = setTimeout(() => inputRef.current?.focus(), 10);
      return () => clearTimeout(id);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const groups = useMemo(() => searchCatalog(query), [query]);
  const empty = groups.length === 0;

  if (!open) return null;

  return (
    <div className="flow-catalog-scrim" onClick={onClose}>
      <aside
        className="flow-catalog"
        role="dialog"
        aria-label="Add a node"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flow-catalog-head">
          <Icon name="ph:magnifying-glass" width={15} aria-hidden />
          <input
            ref={inputRef}
            className="flow-catalog-search"
            type="text"
            placeholder="Search nodes…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="button" className="flow-catalog-close" onClick={onClose} aria-label="Close">
            <Icon name="ph:x" width={14} />
          </button>
        </header>
        <div className="flow-catalog-body">
          {empty && <p className="flow-catalog-empty">No nodes match “{query}”.</p>}
          {groups.map((group) => (
            <section key={group.group} className="flow-catalog-group">
              <h3 className="flow-catalog-group-title">{group.group}</h3>
              <ul className="flow-catalog-list">
                {group.nodes.map((node) => (
                  <li key={node.type}>
                    <button type="button" className="flow-catalog-item" onClick={() => onPick(node.type)}>
                      <span className="flow-catalog-item-icon" style={{ background: node.accent }} aria-hidden>
                        <Icon name={node.icon} width={16} />
                      </span>
                      <span className="flow-catalog-item-text">
                        <span className="flow-catalog-item-label">{node.label}</span>
                        <span className="flow-catalog-item-desc">{node.description}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </aside>
    </div>
  );
}
