"use client";

import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Icon } from "@/lib/icon";

type FieldStatus = {
  key: string;
  env: string;
  title: string;
  description: string | null;
  sensitive: boolean;
  validatable: boolean;
  satisfied: boolean;
  source: "env" | "vault" | "none";
  ref: string | null;
};

type Props = {
  pluginId: string;
  displayName: string;
  open: boolean;
  onClose: () => void;
  /** Called after a successful save so the parent can refetch the grid. */
  onChanged: () => void;
};

export function MarketplaceConfigure({ pluginId, displayName, open, onClose, onChanged }: Props) {
  const [fields, setFields] = useState<FieldStatus[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  type ValidationResult = { state: "idle" | "testing" | "valid" | "invalid"; message?: string };
  const [results, setResults] = useState<Record<string, ValidationResult>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoaded(false);
    try {
      const res = await fetch(`/api/marketplace/config?id=${encodeURIComponent(pluginId)}`, { cache: "no-store" });
      const json = (await res.json()) as { ok?: boolean; fields?: FieldStatus[]; error?: string };
      if (!json.ok) throw new Error(json.error ?? `config http ${res.status}`);
      setFields(json.fields ?? []);
      setError(null);
    } catch (err) {
      setFields([]);
      setError(err instanceof Error ? err.message : "config unavailable");
    } finally {
      setLoaded(true);
    }
  }, [pluginId]);

  useEffect(() => {
    if (open) {
      setDrafts({});
      void load();
    }
  }, [open, load]);

  const allSatisfied = fields.length > 0 && fields.every((f) => f.satisfied);

  const validate = useCallback(async (field: FieldStatus) => {
    if (!field.validatable) return;
    setResults((r) => ({ ...r, [field.key]: { state: "testing" } }));
    try {
      const res = await fetch("/api/marketplace/config/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: pluginId, key: field.key }),
      });
      const json = (await res.json()) as { ok?: boolean; valid?: boolean; login?: string | null; error?: string | null };
      if (!json.ok) throw new Error(json.error ?? "validation failed");
      setResults((r) => ({
        ...r,
        [field.key]: json.valid
          ? { state: "valid", message: json.login ? `Valid — @${json.login}` : "Valid" }
          : { state: "invalid", message: json.error ?? "Invalid" },
      }));
    } catch (err) {
      setResults((r) => ({ ...r, [field.key]: { state: "invalid", message: err instanceof Error ? err.message : "validation failed" } }));
    }
  }, [pluginId]);

  const save = useCallback(async (field: FieldStatus) => {
    const draft = (drafts[field.key] ?? "").trim();
    if (!draft) return;
    if (field.sensitive && !draft.startsWith("op://")) {
      setError(`${field.title}: enter a 1Password reference (op://Vault/Item/field)`);
      return;
    }
    setBusyKey(field.key);
    setError(null);
    try {
      const res = field.sensitive
        ? await fetch("/api/vault", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ key: field.env, ref: draft, required: true, description: field.title }),
          })
        : await fetch("/api/marketplace/config", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: pluginId, key: field.key, value: draft }),
          });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "save failed");
      setDrafts((d) => ({ ...d, [field.key]: "" }));
      await load();
      onChanged();
      if (field.validatable) void validate(field);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setBusyKey(null);
    }
  }, [drafts, pluginId, load, onChanged, validate]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabel={`Configure ${displayName}`}
      breadcrumb={["Marketplace", displayName, "Set up"]}
      footerActions={<Button variant="secondary" size="sm" onClick={onClose}>Done</Button>}
    >
      <div className="flex flex-col gap-4">
        <p className="text-[12px] text-[var(--text-muted)]">
          {displayName} needs the following before its tools can run. Secrets are stored as 1Password
          references — Cave never keeps the raw value.
        </p>
        {error ? (
          <p className="rounded-md border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-[12px] text-[var(--danger-text)]">
            {error}
          </p>
        ) : null}
        {!loaded ? (
          <p className="text-[12px] text-[var(--text-muted)]">Loading…</p>
        ) : (
          fields.map((f) => (
            <div key={f.key} className="flex flex-col gap-1.5 rounded-lg border border-[var(--border-hairline)] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-[var(--text-primary)]">{f.title}</span>
                <span className={`inline-flex items-center gap-1 text-[11px] ${f.satisfied ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}>
                  <Icon name={f.satisfied ? "ph:check-circle" : "ph:warning"} width={12} aria-hidden />
                  {f.satisfied ? `Set${f.source === "vault" ? " · 1Password" : ""}` : "Not set"}
                </span>
              </div>
              {f.description ? <p className="text-[11px] text-[var(--text-muted)]">{f.description}</p> : null}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={drafts[f.key] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [f.key]: e.target.value }))}
                  placeholder={f.sensitive ? "op://Vault/Item/field" : "Enter a value (e.g. a directory path)"}
                  aria-label={`${f.title} value`}
                  className="min-w-0 flex-1 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)]"
                  style={{ height: 32 }}
                />
                <Button
                  variant="primary"
                  size="sm"
                  loading={busyKey === f.key}
                  onClick={() => void save(f)}
                >
                  Save
                </Button>
                {f.validatable ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={results[f.key]?.state === "testing"}
                    onClick={() => void validate(f)}
                  >
                    Test
                  </Button>
                ) : null}
              </div>
              {results[f.key] && results[f.key].state !== "idle" && results[f.key].state !== "testing" ? (
                <p className={`inline-flex items-center gap-1 text-[11px] ${results[f.key].state === "valid" ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}>
                  <Icon name={results[f.key].state === "valid" ? "ph:check-circle" : "ph:warning"} width={11} aria-hidden />
                  {results[f.key].message}
                </p>
              ) : null}
              {f.sensitive ? (
                <p className="text-[10px] text-[var(--text-muted)]">
                  Requires the 1Password CLI (op). Manage refs in Settings → Vault.
                </p>
              ) : null}
            </div>
          ))
        )}
        {allSatisfied ? (
          <p className="inline-flex items-center gap-1 text-[12px] text-[var(--text-primary)]">
            <Icon name="ph:check-circle" width={14} aria-hidden /> Configured — all required values are set.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
