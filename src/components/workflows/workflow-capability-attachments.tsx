"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "@/lib/icon";
import { Popover, PopoverBody } from "@/components/ui/popover";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import type { WorkflowHttpCall, WorkflowSummary } from "@/lib/workflows";
import {
  inheritedWorkflowPermissions,
  type SkillPermissionInfo,
} from "@/lib/workflow-permissions";

type SkillEntry = { id: string; name: string; description?: string; familiar?: string; permissions?: string[] };
type McpEntry = { id: string; transport: string; target?: string };

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

function toggle(list: string[] | undefined, id: string): string[] {
  const set = new Set(list ?? []);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  return [...set];
}

function newId(prefix: string): string {
  try {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  } catch {
    return `${prefix}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  }
}

/** A removable attachment chip. */
function Chip({ label, title, onRemove, badge }: { label: string; title?: string; onRemove: () => void; badge?: string }) {
  return (
    <span className="workflow-attach-chip" title={title}>
      <span className="workflow-attach-chip-label">{label}</span>
      {badge && <span className="workflow-attach-chip-badge" title={title}>{badge}</span>}
      <button type="button" className="workflow-attach-chip-x" onClick={onRemove} aria-label={`Remove ${label}`}>
        <Icon name="ph:x" width={10} />
      </button>
    </span>
  );
}

/** Popover-driven multi-select picker. */
function AttachPicker<T extends { id: string }>({
  label,
  icon,
  items,
  selected,
  onToggle,
  renderItem,
  emptyText,
}: {
  label: string;
  icon: IconName;
  items: T[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  renderItem: (item: T) => { title: string; subtitle?: string };
  emptyText: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => {
      const r = renderItem(it);
      return `${it.id} ${r.title} ${r.subtitle ?? ""}`.toLowerCase().includes(q);
    });
  }, [items, query, renderItem]);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="workflow-attach-add"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={label}
      >
        <Icon name="ph:plus" width={11} />
        Add
      </button>
      <Popover open={open} onOpenChange={setOpen} anchorRef={anchorRef} placement="bottom-end" minWidth={260} ariaLabel={label}>
        <PopoverBody className="workflow-attach-picker">
          <div className="workflow-attach-search">
            <Icon name="ph:magnifying-glass" width={12} />
            <input
              autoFocus
              value={query}
              placeholder={`Search ${label.toLowerCase()}…`}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={`Search ${label}`}
            />
          </div>
          <ul className="workflow-attach-options" role="listbox" aria-label={label}>
            {filtered.length === 0 ? (
              <li className="workflow-attach-empty">{items.length === 0 ? emptyText : "No matches"}</li>
            ) : (
              filtered.map((item) => {
                const r = renderItem(item);
                const on = selected.has(item.id);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={on}
                      className={`workflow-attach-option${on ? " is-on" : ""}`}
                      onClick={() => onToggle(item.id)}
                    >
                      <Icon name={on ? "ph:check-circle-fill" : icon} width={14} />
                      <span className="workflow-attach-option-text">
                        <span className="workflow-attach-option-title">{r.title}</span>
                        {r.subtitle && <span className="workflow-attach-option-sub">{r.subtitle}</span>}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </PopoverBody>
      </Popover>
    </>
  );
}

function Section({
  icon,
  title,
  count,
  action,
  children,
}: {
  icon: IconName;
  title: string;
  count?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <article className="workflow-attachment-row">
      <div className="workflow-attachment-head">
        <span className="workflow-attachment-title">
          <Icon name={icon} width={13} />
          <span>{title}</span>
          {count && <span className="workflow-attachment-count">{count}</span>}
        </span>
        {action}
      </div>
      <div className="workflow-attachment-body">{children}</div>
    </article>
  );
}

/** API-call add/edit dialog. */
function ApiCallDialog({
  call,
  onSave,
  onClose,
}: {
  call: WorkflowHttpCall | null;
  onSave: (call: WorkflowHttpCall) => void;
  onClose: () => void;
}) {
  const [method, setMethod] = useState(call?.method ?? "GET");
  const [url, setUrl] = useState(call?.url ?? "");
  const [name, setName] = useState(call?.name ?? "");
  const [note, setNote] = useState(call?.note ?? "");
  const valid = url.trim().length > 0;
  return (
    <Modal
      open
      onClose={onClose}
      breadcrumb={["API calls", call ? "Edit" : "Add"]}
      footerActions={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!valid}
            onClick={() =>
              onSave({
                id: call?.id ?? newId("call"),
                method: method.trim() || undefined,
                url: url.trim(),
                name: name.trim() || undefined,
                note: note.trim() || undefined,
              })
            }
          >
            {call ? "Save" : "Add call"}
          </Button>
        </>
      }
    >
      <div className="workflow-apicall-form">
        <label className="workflow-field">
          <span>Method</span>
          <select value={method} onChange={(e) => setMethod(e.target.value)} aria-label="HTTP method">
            {HTTP_METHODS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="workflow-field">
          <span>URL</span>
          <input value={url} placeholder="https://api.example.com/v1/…" onChange={(e) => setUrl(e.target.value)} aria-label="Request URL" />
        </label>
        <label className="workflow-field">
          <span>Name (optional)</span>
          <input value={name} placeholder="e.g. Create issue" onChange={(e) => setName(e.target.value)} aria-label="Call name" />
        </label>
        <label className="workflow-field">
          <span>Note (optional)</span>
          <input value={note} placeholder="What this call does" onChange={(e) => setNote(e.target.value)} aria-label="Call note" />
        </label>
        <p className="workflow-muted">Adds the <code>web.fetch</code> permission, shown as inherited below.</p>
      </div>
    </Modal>
  );
}

/**
 * The Skills / MCP / API-call attachment sections plus the inherited-permission
 * roll-up. Attaches at the workflow level (persisted via onUpdateMeta). Skills
 * contribute their declared permissions and API calls contribute web.fetch —
 * both surfaced read-only under "Inherited" so it's clear where each grant
 * comes from.
 */
export function WorkflowCapabilityAttachments({
  workflow,
  onUpdateMeta,
}: {
  workflow: WorkflowSummary;
  onUpdateMeta: (patch: Partial<WorkflowSummary>) => void;
}) {
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [mcp, setMcp] = useState<McpEntry[]>([]);
  const [editingCall, setEditingCall] = useState<WorkflowHttpCall | null>(null);
  const [addingCall, setAddingCall] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/skills/local")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d?.ok && Array.isArray(d.skills)) setSkills(d.skills as SkillEntry[]); })
      .catch(() => {});
    fetch("/api/mcp")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d?.ok && Array.isArray(d.servers)) setMcp(d.servers as McpEntry[]); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const skillsById = useMemo(() => new Map(skills.map((s) => [s.id, s])), [skills]);
  const skillName = (id: string) => skillsById.get(id)?.name ?? id;
  const resolveSkill = (id: string): SkillPermissionInfo | undefined => {
    const s = skillsById.get(id);
    return s ? { name: s.name, permissions: s.permissions } : undefined;
  };
  const inherited = inheritedWorkflowPermissions(workflow, resolveSkill);

  const attachedSkills = workflow.skills ?? [];
  const attachedMcp = workflow.mcp ?? [];
  const calls = workflow.http ?? [];

  const saveCall = (call: WorkflowHttpCall) => {
    const next = calls.some((c) => c.id === call.id)
      ? calls.map((c) => (c.id === call.id ? call : c))
      : [...calls, call];
    onUpdateMeta({ http: next });
    setEditingCall(null);
    setAddingCall(false);
  };

  return (
    <>
      <Section icon="ph:sparkle" title="Skills" count={attachedSkills.length ? `${attachedSkills.length} attached` : undefined}
        action={
          <AttachPicker
            label="Skills"
            icon="ph:sparkle"
            items={skills}
            selected={new Set(attachedSkills)}
            onToggle={(id) => onUpdateMeta({ skills: toggle(workflow.skills, id) })}
            renderItem={(s) => ({
              title: s.name,
              subtitle: [s.permissions?.length ? `${s.permissions.length} perm` : null, s.familiar].filter(Boolean).join(" · ") || s.description,
            })}
            emptyText="No skills discovered"
          />
        }>
        {attachedSkills.length === 0 ? (
          <p className="workflow-muted">No skills attached</p>
        ) : (
          <div className="workflow-chip-wrap">
            {attachedSkills.map((id) => {
              const perms = skillsById.get(id)?.permissions ?? [];
              return (
                <Chip
                  key={id}
                  label={skillName(id)}
                  badge={perms.length ? `🔒${perms.length}` : undefined}
                  title={perms.length ? `Grants: ${perms.join(", ")}` : undefined}
                  onRemove={() => onUpdateMeta({ skills: toggle(workflow.skills, id) })}
                />
              );
            })}
          </div>
        )}
      </Section>

      <Section icon="ph:plug-bold" title="MCP servers" count={attachedMcp.length ? `${attachedMcp.length} attached` : undefined}
        action={
          <AttachPicker
            label="MCP servers"
            icon="ph:plug-bold"
            items={mcp}
            selected={new Set(attachedMcp)}
            onToggle={(id) => onUpdateMeta({ mcp: toggle(workflow.mcp, id) })}
            renderItem={(m) => ({ title: m.id, subtitle: [m.transport, m.target].filter(Boolean).join(" · ") })}
            emptyText="No MCP servers in the registry"
          />
        }>
        {attachedMcp.length === 0 ? (
          <p className="workflow-muted">No MCP servers attached</p>
        ) : (
          <div className="workflow-chip-wrap">
            {attachedMcp.map((id) => (
              <Chip key={id} label={id} onRemove={() => onUpdateMeta({ mcp: toggle(workflow.mcp, id) })} />
            ))}
          </div>
        )}
      </Section>

      <Section icon="ph:globe" title="API calls" count={calls.length ? `${calls.length}` : undefined}
        action={
          <button type="button" className="workflow-attach-add" onClick={() => setAddingCall(true)}>
            <Icon name="ph:plus" width={11} />
            Add call
          </button>
        }>
        {calls.length === 0 ? (
          <p className="workflow-muted">No API calls</p>
        ) : (
          <ul className="workflow-apicall-list">
            {calls.map((call) => (
              <li key={call.id}>
                <button type="button" className="workflow-apicall-row" onClick={() => setEditingCall(call)}>
                  <span className={`workflow-apicall-method m-${(call.method ?? "GET").toLowerCase()}`}>{call.method ?? "GET"}</span>
                  <span className="workflow-apicall-url">{call.name ? `${call.name} · ` : ""}{call.url}</span>
                </button>
                <button
                  type="button"
                  className="workflow-attach-chip-x"
                  onClick={() => onUpdateMeta({ http: calls.filter((c) => c.id !== call.id) })}
                  aria-label={`Remove ${call.name ?? call.url}`}
                >
                  <Icon name="ph:x" width={10} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {inherited.length > 0 && (
        <Section icon="ph:key" title="Inherited permissions" count={`${inherited.length}`}>
          <div className="workflow-chip-wrap">
            {inherited.map((perm, i) => (
              <span key={`${perm.kind}-${perm.source}-${perm.permission}-${i}`} className="workflow-inherited-chip" title={`Inherited via ${perm.source}`}>
                <Icon name={perm.kind === "http" ? "ph:globe" : "ph:sparkle"} width={10} />
                <span className="workflow-inherited-perm">{perm.permission}</span>
                <span className="workflow-inherited-src">via {perm.source}</span>
              </span>
            ))}
          </div>
          <p className="workflow-muted">Read-only — granted automatically by an attached skill or API call.</p>
        </Section>
      )}

      {(addingCall || editingCall) && (
        <ApiCallDialog
          call={editingCall}
          onSave={saveCall}
          onClose={() => { setEditingCall(null); setAddingCall(false); }}
        />
      )}
    </>
  );
}
