"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/lib/icon";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

// ── Types ─────────────────────────────────────────────────────────────────────

type VaultStatus = "resolved" | "env-only" | "unresolved" | "error" | "no-ref";

type Mapping = {
  key: string;
  ref: string | null;
  description: string | null;
  required: boolean;
  status: VaultStatus;
  hasValue: boolean;
  error?: string;
};

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_META: Record<VaultStatus, { label: string; color: string; icon: string }> = {
  resolved:   { label: "1Password",   color: "var(--color-success)", icon: "ph:vault" },
  "env-only": { label: "env only",    color: "oklch(0.75 0.15 80)", icon: "ph:file-text" },
  unresolved: { label: "unresolved",  color: "var(--color-danger)", icon: "ph:warning" },
  error:      { label: "error",       color: "var(--color-danger)", icon: "ph:x-circle" },
  "no-ref":   { label: "no ref",      color: "var(--text-muted)", icon: "ph:minus" },
};

function StatusBadge({ status }: { status: VaultStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className="vault-status-badge"
      style={{ color: meta.color, borderColor: `${meta.color}40` }}
      title={status}
    >
      <Icon name={meta.icon as Parameters<typeof Icon>[0]["name"]} width={10} />
      {meta.label}
    </span>
  );
}

// ── Add/Edit form ─────────────────────────────────────────────────────────────

function AddMappingForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: Mapping;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [key, setKey]         = useState(initial?.key ?? "");
  const [ref, setRef]         = useState(initial?.ref ?? "op://");
  const [desc, setDesc]       = useState(initial?.description ?? "");
  const [required, setReq]    = useState(initial?.required ?? false);
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/vault", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, ref, description: desc || undefined, required }),
      });
      const j = await res.json() as { ok: boolean; error?: string };
      if (!j.ok) throw new Error(j.error ?? "Failed to save");
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="vault-add-form" onSubmit={handleSubmit}>
      <div className="vault-add-row">
        <label className="vault-add-label">
          Env var name
          <input
            className="vault-add-input"
            value={key}
            onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))}
            placeholder="GITHUB_PAT"
            required
            disabled={!!initial}
          />
        </label>
        <label className="vault-add-label" style={{ flex: 2 }}>
          1Password reference
          <input
            className="vault-add-input vault-ref-input"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="op://Personal/GitHub PAT/credential"
            required
          />
        </label>
      </div>
      <label className="vault-add-label">
        Description (optional)
        <input
          className="vault-add-input"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="What this secret is for"
        />
      </label>
      <div className="vault-add-footer">
        <label className="vault-required-check">
          <input type="checkbox" checked={required} onChange={(e) => setReq(e.target.checked)} />
          Required
        </label>
        {err && <span className="vault-err">{err}</span>}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button type="button" className="vault-btn" onClick={onCancel}>Cancel</button>
          <button type="submit" className="vault-btn vault-btn--primary" disabled={busy}>
            {busy ? "Saving…" : initial ? "Update" : "Add mapping"}
          </button>
        </div>
      </div>
    </form>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function VaultPanel() {
  const [mappings, setMappings]     = useState<Mapping[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [adding, setAdding]         = useState(false);
  const [editing, setEditing]       = useState<Mapping | null>(null);
  const [deleting, setDeleting]     = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/vault", { cache: "no-store" });
      const j = await res.json() as { ok: boolean; mappings?: Mapping[]; error?: string };
      if (!j.ok) throw new Error(j.error ?? "Couldn't load vault mappings.");
      setMappings(j.mappings ?? []);
      setError(null);
    } catch (e) {
      // Previously swallowed — a failed fetch left a bare "No mappings yet"
      // that read as "you have none" rather than "something broke".
      setError(e instanceof Error ? e.message : "Couldn't load vault mappings.");
    }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  async function handleDelete(key: string) {
    setDeleting(key);
    try {
      await fetch("/api/vault", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key }),
      });
      await load();
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="vault-panel">
      {/* Header */}
      <div className="vault-header">
        <div className="vault-header-title">
          <Icon name="ph:vault" width={14} />
          Secret Vault
        </div>
        <span className="vault-header-sub">env vars → 1Password references</span>
        <button
          type="button"
          className="vault-btn vault-btn--primary"
          style={{ marginLeft: "auto" }}
          onClick={() => { setAdding(true); setEditing(null); }}
          disabled={adding}
        >
          <Icon name="ph:plus" width={12} />
          Add mapping
        </button>
        <button
          type="button"
          className="vault-btn"
          onClick={load}
          title="Refresh"
        >
          <Icon name="ph:arrows-clockwise" width={12} />
        </button>
      </div>

      {/* Add form */}
      {(adding || editing) && (
        <div className="vault-add-wrapper">
          <AddMappingForm
            initial={editing ?? undefined}
            onSaved={() => { setAdding(false); setEditing(null); void load(); }}
            onCancel={() => { setAdding(false); setEditing(null); }}
          />
        </div>
      )}

      {/* Mapping list */}
      {loading ? (
        <SkeletonRows count={3} className="vault-skeleton" />
      ) : error ? (
        <ErrorState
          compact
          headline="Couldn't load the vault"
          subtitle={error}
          actions={
            <Button size="xs" leadingIcon="ph:arrow-clockwise" onClick={() => void load()}>
              Retry
            </Button>
          }
        />
      ) : mappings.length === 0 ? (
        <EmptyState
          compact
          icon="ph:vault"
          headline="No mappings yet"
          subtitle="Add one to pull secrets from 1Password automatically."
          actions={
            <Button
              size="xs"
              leadingIcon="ph:plus"
              onClick={() => { setAdding(true); setEditing(null); }}
              disabled={adding}
            >
              Add mapping
            </Button>
          }
        />
      ) : (
        <div className="vault-list">
          {mappings.map((m) => (
            <div key={m.key} className={`vault-row${m.status === "error" || m.status === "unresolved" ? " vault-row--warn" : ""}`}>
              <div className="vault-row-main">
                <code className="vault-row-key">{m.key}</code>
                <StatusBadge status={m.status} />
                {m.required && <span className="vault-required-pill">required</span>}
              </div>
              {m.ref && (
                <div className="vault-row-ref">{m.ref}</div>
              )}
              {m.description && (
                <div className="vault-row-desc">{m.description}</div>
              )}
              {m.error && (
                <div className="vault-row-error">{m.error}</div>
              )}
              <div className="vault-row-actions">
                <button
                  type="button"
                  className="vault-action-btn"
                  title="Edit"
                  onClick={() => { setEditing(m); setAdding(false); }}
                >
                  <Icon name="ph:pencil-simple" width={11} />
                </button>
                <button
                  type="button"
                  className="vault-action-btn vault-action-btn--danger"
                  title="Remove mapping"
                  disabled={deleting === m.key}
                  onClick={() => void handleDelete(m.key)}
                >
                  <Icon name="ph:trash" width={11} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer note */}
      <div className="vault-footer-note">
        Secrets are never stored on disk — resolved live via <code>op read</code> and
        cached in process memory. Requires 1Password desktop app + CLI authed.
      </div>
    </div>
  );
}
