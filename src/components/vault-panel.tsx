"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { UndoToast } from "@/components/ui/undo-toast";
import { useUndoDelete } from "@/lib/use-undo-delete";

// ── Types ─────────────────────────────────────────────────────────────────────

type VaultStatus = "resolved" | "encrypted" | "env-only" | "unresolved" | "error" | "no-ref";

type Mapping = {
  key: string;
  ref: string | null;
  storage: "1password" | "encrypted" | "dashlane" | null;
  description: string | null;
  required: boolean;
  status: VaultStatus;
  hasValue: boolean;
  error?: string;
};

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_META: Record<VaultStatus, { label: string; color: string; icon: string }> = {
  resolved:   { label: "1Password",   color: "var(--color-success)", icon: "ph:vault" },
  encrypted:  { label: "encrypted",   color: "var(--accent-presence)", icon: "ph:lock-key" },
  "env-only": { label: "env only",    color: "oklch(0.75 0.15 80)", icon: "ph:file-text" },
  unresolved: { label: "unresolved",  color: "var(--color-danger)", icon: "ph:warning" },
  error:      { label: "error",       color: "var(--color-danger)", icon: "ph:x-circle" },
  "no-ref":   { label: "no ref",      color: "var(--text-muted)", icon: "ph:minus" },
};

function StatusBadge({ status, storage }: { status: VaultStatus; storage?: Mapping["storage"] }) {
  const meta = STATUS_META[status];
  // "resolved" means a live ref read succeeded; label it by the backing
  // provider (1Password op:// vs Dashlane dl://) rather than a fixed string.
  const label = status === "resolved" && storage === "dashlane" ? "Dashlane" : meta.label;
  return (
    <span
      className="vault-status-badge"
      style={{ color: meta.color, borderColor: `${meta.color}40` }}
      title={status}
    >
      <Icon name={meta.icon as Parameters<typeof Icon>[0]["name"]} width={10} />
      {label}
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
  const [storage, setStorage] = useState<"1password" | "encrypted" | "dashlane">(
    initial?.storage === "encrypted" || initial?.status === "encrypted"
      ? "encrypted"
      : initial?.storage === "dashlane" || initial?.ref?.startsWith("dl://")
        ? "dashlane"
        : "1password",
  );
  const [secret, setSecret]   = useState("");
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
        body: JSON.stringify(storage === "encrypted"
          ? { key, storage: "encrypted", value: secret, description: desc || undefined, required }
          : { key, ref, description: desc || undefined, required }),
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
        <div className="vault-add-label" style={{ flex: 2 }}>
          Storage
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              className={`vault-btn${storage === "encrypted" ? " vault-btn--primary" : ""}`}
              onClick={() => setStorage("encrypted")}
            >
              Local encrypted
            </button>
            <button
              type="button"
              className={`vault-btn${storage === "1password" ? " vault-btn--primary" : ""}`}
              onClick={() => {
                setStorage("1password");
                if (!ref || ref === "dl://") setRef("op://");
              }}
            >
              1Password
            </button>
            <button
              type="button"
              className={`vault-btn${storage === "dashlane" ? " vault-btn--primary" : ""}`}
              onClick={() => {
                setStorage("dashlane");
                if (!ref || ref === "op://") setRef("dl://");
              }}
            >
              Dashlane
            </button>
          </div>
        </div>
      </div>
      {storage === "encrypted" ? (
        <label className="vault-add-label">
          Secret value
          <input
            className="vault-add-input"
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={initial ? "Enter a new value" : "Paste secret value"}
            required
          />
        </label>
      ) : (
        <label className="vault-add-label">
          {storage === "dashlane" ? "Dashlane reference" : "1Password reference"}
          <input
            className="vault-add-input vault-ref-input"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder={storage === "dashlane"
              ? "dl://GitHub PAT/username"
              : "op://Personal/GitHub PAT/credential"}
            required
          />
        </label>
      )}
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
  // Deferred + undoable delete: the row hides immediately, the DELETE fires only
  // after the undo window, and Undo restores it (recoverable, unlike a confirm).
  const { pending: deletePending, scheduleDelete, undo: undoDelete, commit: commitDelete } = useUndoDelete<Mapping>();
  const [mappings, setMappings]     = useState<Mapping[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [query, setQuery]           = useState("");
  const [adding, setAdding]         = useState(false);
  const [editing, setEditing]       = useState<Mapping | null>(null);
  const [copiedKey, setCopiedKey]   = useState<string | null>(null);

  async function handleCopyRef(key: string, ref: string) {
    try {
      await navigator.clipboard.writeText(ref);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1600);
    } catch {
      // Clipboard blocked (insecure context / permissions) — no-op.
    }
  }

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

  function handleDelete(key: string) {
    const mapping = mappings.find((m) => m.key === key);
    if (!mapping) return;
    scheduleDelete(mapping, `secret “${key}”`, async () => {
      setMappings((prev) => prev.filter((m) => m.key !== key));
      try {
        await fetch("/api/vault", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key }),
        });
      } finally {
        await load();
      }
    });
  }

  // Hide the row pending an undoable delete, then apply the text filter
  // (key / 1Password reference / description, case-insensitive).
  const visibleMappings = useMemo(() => {
    const afterPending = deletePending
      ? mappings.filter((m) => m.key !== deletePending.item.key)
      : mappings;
    const q = query.trim().toLowerCase();
    if (!q) return afterPending;
    return afterPending.filter((m) =>
      [m.key, m.ref ?? "", m.storage ?? "", m.description ?? ""].join(" ").toLowerCase().includes(q));
  }, [mappings, deletePending, query]);

  return (
    <div className="vault-panel">
      {/* Header */}
      <div className="vault-header">
        <div className="vault-header-title">
          <Icon name="ph:vault" width={14} />
          Secret Vault
        </div>
        <span className="vault-header-sub">env vars → encrypted local secrets, 1Password, or Dashlane references</span>
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
          subtitle="Add one to store a local encrypted secret or pull from 1Password."
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
        <>
          {mappings.length > 3 ? (
            <SearchInput
              value={query}
              onValueChange={setQuery}
              onClear={() => setQuery("")}
              placeholder="Filter secrets…"
              aria-label="Filter secrets"
              containerClassName="vault-filter"
            />
          ) : null}
          {visibleMappings.length === 0 ? (
            <div className="vault-footer-note">No secrets match “{query.trim()}”.</div>
          ) : (
        <div className="vault-list">
          {visibleMappings.map((m) => (
            <div key={m.key} className={`vault-row${m.status === "error" || m.status === "unresolved" ? " vault-row--warn" : ""}`}>
              <div className="vault-row-main">
                <code className="vault-row-key">{m.key}</code>
                <StatusBadge status={m.status} storage={m.storage} />
                {m.required && <span className="vault-required-pill">required</span>}
              </div>
              {m.ref && (
                <div className="vault-row-ref">{m.ref}</div>
              )}
              {m.storage === "encrypted" && !m.ref && (
                <div className="vault-row-ref">Local encrypted secret</div>
              )}
              {m.description && (
                <div className="vault-row-desc">{m.description}</div>
              )}
              {m.error && (
                <div className="vault-row-error">{m.error}</div>
              )}
              <div className="vault-row-actions">
                {m.ref && (
                  <button
                    type="button"
                    className="vault-action-btn"
                    title={copiedKey === m.key ? "Copied" : "Copy reference"}
                    aria-label={`Copy the 1Password reference for ${m.key}`}
                    onClick={() => void handleCopyRef(m.key, m.ref!)}
                  >
                    <Icon name={copiedKey === m.key ? "ph:check" : "ph:copy"} width={11} />
                  </button>
                )}
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
                  onClick={() => handleDelete(m.key)}
                >
                  <Icon name="ph:trash" width={11} />
                </button>
              </div>
            </div>
          ))}
        </div>
          )}
        </>
      )}

      {/* Footer note */}
      <div className="vault-footer-note">
        Local secrets are encrypted on disk with a machine-local Cave key. 1Password
        entries are resolved live via <code>op read</code> and cached in process memory.
      </div>

      {deletePending ? (
        <UndoToast
          key={deletePending.id}
          message={`Deleted ${deletePending.label}`}
          undoAriaLabel="Undo delete"
          onUndo={undoDelete}
          onDismiss={commitDelete}
        />
      ) : null}
    </div>
  );
}
