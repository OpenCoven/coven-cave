"use client";

import { useCallback, useEffect, useState } from "react";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { AsanaWorkspace, AsanaWorkspacesResponse } from "@/lib/asana-tasks";
import { StandardSelect } from "@/components/ui/select";
import { useArmedConfirm } from "@/lib/use-armed-confirm";
import {
  reportDaemonSyncFailure,
  reportDaemonSyncSuccess,
} from "@/lib/daemon-sync-status";

/**
 * Familiar Studio → Brain → Asana. Connection and per-agent assignment live in
 * one place: the PAT is app-wide (connect once, seamlessly, right here when it
 * isn't set yet), and the toggle + workspace scope decide whether and how THIS
 * familiar works with Asana tasks. Persists to the familiar's binding via
 * /api/config, mirroring the Brain tab's other per-agent settings.
 *
 * `asanaEnabled` is undefined-means-on (the seamless default once connected);
 * turning the agent off writes `false`, turning it back on deletes the key.
 */
export function FamiliarAsanaSection({ familiar }: { familiar: ResolvedFamiliar }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [login, setLogin] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<AsanaWorkspace[]>([]);

  // Per-agent drafts (optimistic; reverted on save failure).
  const [enabled, setEnabled] = useState(familiar.asanaEnabled !== false);
  const [workspaceGid, setWorkspaceGid] = useState(familiar.asanaWorkspaceGid ?? "");

  // Inline connect form (shown only when the app has no PAT yet).
  const [pat, setPat] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  // Two-step, matching the app's armed-confirm standard (cave-w96h).
  const disconnectConfirm = useArmedConfirm();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEnabled(familiar.asanaEnabled !== false);
    setWorkspaceGid(familiar.asanaWorkspaceGid ?? "");
  }, [familiar.id, familiar.asanaEnabled, familiar.asanaWorkspaceGid]);

  const loadWorkspaces = useCallback(async () => {
    try {
      const res = await fetch("/api/asana/workspaces", { cache: "no-store" });
      const json = (await res.json()) as AsanaWorkspacesResponse;
      setWorkspaces(json.workspaces ?? []);
    } catch {
      setWorkspaces([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/asana/pat", { cache: "no-store" });
        const json = (await res.json()) as { hasPat?: boolean; login?: string | null };
        if (cancelled) return;
        setConfigured(Boolean(json.hasPat));
        setLogin(json.login ?? null);
        if (json.hasPat) void loadWorkspaces();
      } catch {
        if (!cancelled) setConfigured(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loadWorkspaces]);

  async function saveBinding(patch: Record<string, unknown>, revert: () => void) {
    try {
      const res = await fetch("/api/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ familiars: { [familiar.id]: patch } }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(`Couldn't save: ${json.error ?? res.statusText}`);
        reportDaemonSyncFailure(`cave-config write: ${json.error ?? res.statusText}`);
        revert();
      } else {
        setError(null);
        reportDaemonSyncSuccess();
      }
    } catch (err) {
      setError(`Couldn't save: ${(err as Error).message}`);
      revert();
    }
  }

  async function connect() {
    const token = pat.trim();
    if (!token || connecting) return;
    setConnecting(true);
    setError(null);
    try {
      const res = await fetch("/api/asana/pat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pat: token }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Couldn't connect Asana");
      } else {
        setPat("");
        setConfigured(true);
        setLogin(json.login ?? null);
        void loadWorkspaces();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    if (disconnecting) return;
    setDisconnecting(true);
    setError(null);
    try {
      const res = await fetch("/api/asana/pat", { method: "DELETE" });
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.ok === false) {
        setError(json?.error ?? "Couldn't disconnect Asana");
      } else {
        setConfigured(false);
        setLogin(null);
        setWorkspaces([]);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDisconnecting(false);
    }
  }

  function toggleEnabled() {
    const next = !enabled;
    setEnabled(next);
    // undefined-means-on: turning ON deletes the key (null), OFF writes false.
    void saveBinding({ asanaEnabled: next ? null : false }, () => setEnabled(!next));
  }

  function pickWorkspace(gid: string) {
    const prev = workspaceGid;
    setWorkspaceGid(gid);
    void saveBinding({ asanaWorkspaceGid: gid || null }, () => setWorkspaceGid(prev));
  }

  return (
    <section className="familiar-studio-brain__card" data-asana-section>
      <h3 className="familiar-studio-brain__card-title">Asana</h3>

      {configured === false ? (
        // Seamless first connect — the PAT is app-wide, entered once, right here.
        <div className="familiar-asana__connect">
          <p className="familiar-studio-brain__hint">
            Connect Asana once to let your familiars work with your tasks. The token is
            stored encrypted and only ever sent to Asana.
          </p>
          <div className="familiar-asana__connect-row">
            <input
              type="password"
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void connect(); }}
              placeholder="Asana Personal Access Token"
              aria-label="Asana Personal Access Token"
              className="familiar-asana__input focus-ring"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => void connect()}
              disabled={!pat.trim() || connecting}
              className="familiar-asana__connect-btn focus-ring"
            >
              {connecting ? "Verifying…" : "Connect"}
            </button>
          </div>
          <a
            href="https://app.asana.com/0/my-apps"
            target="_blank"
            rel="noreferrer"
            className="familiar-asana__gen-link"
          >
            Generate a token →
          </a>
        </div>
      ) : (
        <>
          <div className="familiar-studio-brain__row">
            <span className="familiar-studio-brain__label">Work with Asana tasks</span>
            <div className="familiar-studio-brain__control">
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-label="Work with Asana tasks"
                onClick={toggleEnabled}
                className={`settings-switch focus-ring${enabled ? " is-on" : ""}`}
              >
                <span className="settings-switch__knob" aria-hidden />
              </button>
            </div>
          </div>

          {enabled && workspaces.length > 1 ? (
            <div className="familiar-studio-brain__row">
              <span className="familiar-studio-brain__label">Workspace</span>
              <div className="familiar-studio-brain__control">
                <StandardSelect
                  label="Asana workspace scope"
                  value={workspaceGid}
                  onChange={pickWorkspace}
                  options={[
                    { value: "", label: "All workspaces" },
                    ...workspaces.map((ws) => ({ value: ws.gid, label: ws.name })),
                  ]}
                />
              </div>
            </div>
          ) : null}

          <p className="familiar-studio-brain__hint">
            {enabled
              ? `${familiar.display_name} sees your assigned Asana tasks${
                  workspaceGid ? " in the selected workspace" : ""
                } on the board and in the Queue.`
              : `${familiar.display_name} is opted out of Asana. Other familiars keep their access.`}
            {login ? ` · Connected as ${login}.` : ""}
          </p>

          {/* App-wide disconnect: removes the stored PAT (revoked tokens had
              no in-app way out — only a hidden vault-key delete; cave-d6zq).
              The connect form reappears for a fresh token. */}
          <div className="familiar-studio-brain__row">
            <span className="familiar-studio-brain__label">Connection</span>
            <div className="familiar-studio-brain__control">
              <button
                type="button"
                onClick={() => disconnectConfirm.trigger(() => void disconnect())}
                disabled={disconnecting}
                className="focus-ring rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:text-[var(--color-danger)]"
              >
                {disconnecting ? "Disconnecting…" : disconnectConfirm.armed ? "Really disconnect?" : "Disconnect Asana"}
              </button>
            </div>
          </div>
        </>
      )}

      {error ? <p className="familiar-asana__error" role="alert">{error}</p> : null}
    </section>
  );
}
