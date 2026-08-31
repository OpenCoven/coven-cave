"use client";

import "@/styles/vault-panel.css";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import { UndoToast } from "@/components/ui/undo-toast";
import { useUndoDelete } from "@/lib/use-undo-delete";
import {
  normalizeVaultKey,
  parseVaultPaste,
  VAULT_STORAGE_PROVIDERS,
  vaultStorageForValue,
  vaultStorageProvider,
  type VaultStorageId,
} from "@/lib/vault-storage";

// ── Types ─────────────────────────────────────────────────────────────────────

type VaultStatus =
  | "resolved"
  | "configured"
  | "encrypted"
  | "env-only"
  | "unresolved"
  | "error"
  | "no-ref";

type Mapping = {
  key: string;
  ref: string | null;
  storage: VaultStorageId | null;
  scope: "shared" | string[];
  description: string | null;
  required: boolean;
  status: VaultStatus;
  hasValue: boolean;
  error?: string;
};

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_META: Record<VaultStatus, { label: string; icon: string }> = {
  resolved:   { label: "resolved", icon: "ph:vault" },
  configured: { label: "configured", icon: "ph:vault" },
  encrypted:  { label: "encrypted", icon: "ph:lock-key" },
  "env-only": { label: "environment", icon: "ph:file-text" },
  unresolved: { label: "unresolved", icon: "ph:warning" },
  error:      { label: "error", icon: "ph:x-circle" },
  "no-ref":   { label: "no storage", icon: "ph:minus" },
};

function StatusBadge({ status, storage }: { status: VaultStatus; storage?: Mapping["storage"] }) {
  const meta = STATUS_META[status];
  const label = storage && (status === "resolved" || status === "configured")
    ? vaultStorageProvider(storage).shortLabel
    : meta.label;
  return (
    <span
      className={`vault-status-badge vault-status-badge--${status}`}
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
  familiarId,
  onSaved,
  onCancel,
}: {
  initial?: Mapping;
  familiarId?: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const initialStorage = initial?.storage ?? (
    initial?.ref ? vaultStorageForValue(initial.ref) : "encrypted"
  );
  const [key, setKey]         = useState(initial?.key ?? "");
  const [input, setInput]     = useState(initial?.ref ?? "");
  const [storage, setStorage] = useState<VaultStorageId>(initialStorage);
  const [desc, setDesc]       = useState(initial?.description ?? "");
  const [required, setReq]    = useState(initial?.required ?? false);
  const [showInput, setShowInput] = useState(false);
  const [inputVisibilityChanged, setInputVisibilityChanged] = useState(false);
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState<string | null>(null);
  const { announce } = useAnnouncer();

  const pasteResult = useMemo(
    () => storage === "environment"
      ? { entries: [], error: null, assignmentMode: false }
      : parseVaultPaste(input, key),
    [input, key, storage],
  );
  const isBatch = !initial && pasteResult.assignmentMode;
  const detectedStorage = pasteResult.entries.length === 1
    ? pasteResult.entries[0].storage
    : null;
  const activeStorage = storage === "environment"
    ? "environment"
    : detectedStorage ?? storage;

  function selectStorage(next: VaultStorageId) {
    setStorage(next);
    setErr(null);
    const provider = vaultStorageProvider(next);
    if (next === "encrypted") {
      setInput((current) => {
        const trimmed = current.trim();
        return trimmed.startsWith("op://") || trimmed.startsWith("dl://")
          ? ""
          : current;
      });
    }
    if (provider.referencePrefix) {
      setInput((current) => {
        const trimmed = current.trim();
        return trimmed.startsWith(provider.referencePrefix!)
          ? current
          : provider.referencePrefix!;
      });
    }
  }

  function toggleInputVisibility() {
    setShowInput((current) => !current);
    setInputVisibilityChanged(true);
  }

  async function pasteFromClipboard() {
    try {
      const value = await navigator.clipboard.readText();
      setInput(value);
      announce("Pasted from clipboard.");
    } catch {
      setErr("Clipboard access is unavailable. Paste into the field instead.");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (storage !== "environment" && pasteResult.error) {
      setErr(pasteResult.error);
      return;
    }
    setBusy(true); setErr(null);
    try {
      const scope = initial?.scope ?? (familiarId ? [familiarId] : undefined);
      const common = {
        description: desc || undefined,
        required,
        scope,
      };
      const singleEntry = pasteResult.entries[0];
      const payload = storage === "environment"
        ? {
            key,
            storage,
            ...common,
          }
        : isBatch
          ? {
              entries: pasteResult.entries.map((entry) => ({
                ...entry,
                ...common,
              })),
            }
          : {
              key: normalizeVaultKey(key),
              storage: activeStorage,
              value: activeStorage === "encrypted"
                ? singleEntry?.value ?? input
                : undefined,
              ref: activeStorage === "1password" || activeStorage === "dashlane"
                ? singleEntry?.ref ?? input.trim()
                : undefined,
              ...common,
            };
      const res = await fetch("/api/vault", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json() as { ok: boolean; error?: string };
      if (!j.ok) throw new Error(j.error ?? "Failed to save");
      announce(isBatch
        ? `Saved ${pasteResult.entries.length} Vault entries.`
        : `Saved ${normalizeVaultKey(key)}.`);
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
            className="vault-add-input focus-ring"
            value={key}
            onChange={(e) => setKey(normalizeVaultKey(e.target.value))}
            placeholder={isBatch ? "Detected from paste" : "GITHUB_PAT"}
            required={!isBatch}
            disabled={!!initial}
          />
        </label>
        <div className="vault-add-label [flex:2]!">
          Storage
          <div className="vault-provider-list">
            {VAULT_STORAGE_PROVIDERS.map((provider) => (
              <button
                key={provider.id}
                type="button"
                className={`vault-btn focus-ring${activeStorage === provider.id ? " vault-btn--primary" : ""}`}
                onClick={() => selectStorage(provider.id)}
                aria-pressed={activeStorage === provider.id}
                title={provider.description}
                disabled={isBatch}
              >
                {provider.shortLabel}
              </button>
            ))}
          </div>
          {!isBatch ? (
            <span className="vault-provider-description">
              {vaultStorageProvider(activeStorage).description}
            </span>
          ) : null}
        </div>
      </div>
      {storage !== "environment" ? (
        <label className="vault-add-label">
          Secret, secure reference, or .env entries
          <div className="vault-paste-field">
            <textarea
              className={`vault-add-input vault-paste-input focus-ring${showInput ? "" : " vault-paste-input--masked"}`}
              data-visibility-transition={inputVisibilityChanged ? (showInput ? "reveal" : "mask") : undefined}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={initial?.storage === "encrypted"
                ? "Leave blank to keep the current encrypted value"
                : "Paste a value, op:// or dl:// reference, or KEY=value lines"}
              required={!initial}
              rows={isBatch ? Math.min(8, Math.max(3, pasteResult.entries.length)) : 3}
              spellCheck={false}
            />
            <div className="vault-paste-actions">
              <button
                type="button"
                className="vault-btn focus-ring vault-paste-button"
                onClick={toggleInputVisibility}
                aria-pressed={showInput}
                aria-label={showInput ? "Hide secret text" : "Show secret text"}
              >
                {showInput ? "Hide" : "Show"}
              </button>
              <button
                type="button"
                className="vault-btn focus-ring vault-paste-button"
                onClick={() => void pasteFromClipboard()}
              >
                <Icon name="ph:clipboard-text" width={12} />
                Paste
              </button>
            </div>
          </div>
          {pasteResult.error ? (
            <span className="vault-err">{pasteResult.error}</span>
          ) : isBatch ? (
            <span className="vault-paste-summary">
              Detected {pasteResult.entries.length} entries:{" "}
              {pasteResult.entries.map((entry) => entry.key).join(", ")}
            </span>
          ) : detectedStorage ? (
            <span className="vault-paste-summary">
              Detected {vaultStorageProvider(detectedStorage).label}.
            </span>
          ) : null}
        </label>
      ) : (
        <div className="vault-environment-note">
          <Icon name="ph:terminal-window" width={14} />
          The Vault stores only this key's access and metadata. Its value stays in the
          launch environment or <code>.env.local</code>.
        </div>
      )}
      <label className="vault-add-label">
        Description (optional)
        <input
          className="vault-add-input focus-ring"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="What this secret is for"
        />
      </label>
      <div className="vault-add-footer">
        <label className="vault-required-check">
          <input
            className="focus-ring"
            type="checkbox"
            checked={required}
            onChange={(e) => setReq(e.target.checked)}
          />
          Required
        </label>
        {err && <span className="vault-err">{err}</span>}
        <div className="[margin-left:auto]! [display:flex]! [gap:6px]!">
          <button type="button" className="vault-btn focus-ring" onClick={onCancel}>Cancel</button>
          <button type="submit" className="vault-btn vault-btn--primary focus-ring" disabled={busy}>
            {busy ? "Saving…" : initial ? "Save changes" : isBatch ? "Save entries" : "Add mapping"}
          </button>
        </div>
      </div>
    </form>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function VaultPanel({ familiarId }: { familiarId?: string }) {
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
  const [grantBusyKey, setGrantBusyKey] = useState<string | null>(null);
  const [grantError, setGrantError] = useState<string | null>(null);
  const { announce } = useAnnouncer();

  async function handleCopyRef(key: string, ref: string) {
    try {
      await navigator.clipboard.writeText(ref);
      setCopiedKey(key);
      announce(`Copied the secure reference for ${key}.`);
      window.setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1600);
    } catch {
      announce(`Couldn't copy the secure reference for ${key}.`);
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

  async function updateFamiliarGrant(mapping: Mapping, granted: boolean) {
    if (!familiarId || mapping.scope === "shared") return;
    setGrantBusyKey(mapping.key);
    setGrantError(null);
    try {
      const response = await fetch("/api/vault", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: mapping.key,
          familiarId,
          action: granted ? "revoke" : "grant",
        }),
      });
      const payload = await response.json() as {
        ok?: boolean;
        scope?: Mapping["scope"];
        error?: string;
      };
      if (!response.ok || !payload.ok || !payload.scope) {
        throw new Error(payload.error || "Couldn't update the familiar grant.");
      }
      setMappings((current) => current.map((item) =>
        item.key === mapping.key ? { ...item, scope: payload.scope! } : item));
      announce(
        `${granted ? "Revoked" : "Granted"} ${mapping.key} ${granted ? "from" : "to"} ${familiarId}.`,
      );
    } catch (cause) {
      setGrantError(
        cause instanceof Error ? cause.message : "Couldn't update the familiar grant.",
      );
    } finally {
      setGrantBusyKey(null);
    }
  }

  // Hide the row pending an undoable delete, then apply the text filter
  // (key / provider reference / description, case-insensitive).
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
        <span className="vault-header-sub">
          {familiarId
            ? `shared, granted, and available keys for ${familiarId}`
            : "Paste secrets, secure references, or .env entries; keep environment-owned values in place"}
        </span>
        <button
          type="button"
          className="vault-btn vault-btn--primary focus-ring [margin-left:auto]!"
          onClick={() => { setAdding(true); setEditing(null); }}
          disabled={adding}
        >
          <Icon name="ph:plus" width={12} />
          Add secrets
        </button>
        <button
          type="button"
          className="vault-btn focus-ring"
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
            familiarId={familiarId}
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
          headline={familiarId ? "No secrets available" : "No mappings yet"}
          subtitle={familiarId
            ? "Add a secret scoped to this familiar."
            : "Paste a value or .env block, link a secure reference, or recognize an environment-owned key."}
          actions={
            <Button
              size="xs"
              leadingIcon="ph:plus"
              onClick={() => { setAdding(true); setEditing(null); }}
              disabled={adding}
            >
              Add secrets
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
              placeholder="Search secrets…"
              aria-label="Search secrets"
              containerClassName="vault-filter"
            />
          ) : null}
          {visibleMappings.length === 0 ? (
            <div className="vault-footer-note">No secrets match “{query.trim()}”.</div>
          ) : (
        <div className="vault-list">
          {visibleMappings.map((m) => {
            const granted = m.scope === "shared" ||
              m.scope.includes(familiarId?.trim().toLowerCase() ?? "");
            return (
            <div
              key={m.key}
              className={`vault-row${m.status === "error" || m.status === "unresolved" ? " vault-row--warn" : ""}`}
              data-granted={familiarId ? granted : undefined}
            >
              <div className="vault-row-main">
                <code className="vault-row-key">{m.key}</code>
                <StatusBadge status={m.status} storage={m.storage} />
                {m.required && <span className="vault-required-pill">required</span>}
                {familiarId ? (
                  <span className="vault-required-pill">
                    {m.scope === "shared" ? "shared" : granted ? "granted" : "not granted"}
                  </span>
                ) : null}
              </div>
              {m.ref && (
                <div className="vault-row-ref">{m.ref}</div>
              )}
              {m.storage === "encrypted" && !m.ref && (
                <div className="vault-row-ref">Local encrypted secret</div>
              )}
              {m.storage === "environment" && !m.ref && (
                <div className="vault-row-ref">Environment-owned value</div>
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
                    className="vault-action-btn focus-ring"
                    title={copiedKey === m.key ? "Copied" : "Copy reference"}
                    aria-label={`Copy the secure reference for ${m.key}`}
                    onClick={() => void handleCopyRef(m.key, m.ref!)}
                  >
                    <Icon name={copiedKey === m.key ? "ph:check" : "ph:copy"} width={11} />
                  </button>
                )}
                {familiarId ? (
                  m.scope === "shared" ? null : (
                    <button
                      type="button"
                      className="vault-action-btn focus-ring"
                      title={granted ? "Revoke from familiar" : "Grant to familiar"}
                      aria-label={`${granted ? "Revoke" : "Grant"} ${m.key} ${granted ? "from" : "to"} ${familiarId}`}
                      disabled={grantBusyKey === m.key}
                      onClick={() => void updateFamiliarGrant(m, granted)}
                    >
                      <Icon
                        name={granted ? "ph:minus-circle" : "ph:key"}
                        width={11}
                      />
                    </button>
                  )
                ) : (
                  <>
                    <button
                      type="button"
                      className="vault-action-btn focus-ring"
                      title="Edit"
                      onClick={() => { setEditing(m); setAdding(false); }}
                    >
                      <Icon name="ph:pencil-simple" width={11} />
                    </button>
                    <button
                      type="button"
                      className="vault-action-btn vault-action-btn--danger focus-ring"
                      title="Remove mapping"
                      onClick={() => handleDelete(m.key)}
                    >
                      <Icon name="ph:trash" width={11} />
                    </button>
                  </>
                )}
              </div>
            </div>
            );
          })}
        </div>
          )}
        </>
      )}

      {/* Footer note */}
      <div className="vault-footer-note">
        Local values are encrypted with a machine-local Cave key. Secure references resolve
        through their provider CLI. Environment values stay where they already live.
      </div>
      {grantError ? (
        <div className="vault-row-error" role="alert">{grantError}</div>
      ) : null}

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
