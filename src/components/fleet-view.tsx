"use client";

/**
 * Fleet — Cave control plane for an Omnigent server and its hosts.
 * Talks only to local /api/omnigent/* proxies (token never hits the browser).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useAnnouncer } from "@/components/ui/live-region";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import type { OmnigentAgent, OmnigentHost, OmnigentSessionListItem } from "@/lib/omnigent/types";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";

type StatusPayload = {
  ok?: boolean;
  configured?: boolean;
  baseUrl?: string;
  hasToken?: boolean;
  online?: boolean;
  error?: string;
  defaults?: {
    baseUrl?: string;
    defaultAgentId?: string;
    defaultHostId?: string;
    defaultWorkspace?: string;
  };
};

export type FleetViewProps = {
  familiars?: ResolvedFamiliar[];
  activeFamiliarId?: string | null;
};

export function FleetView({ familiars = [], activeFamiliarId }: FleetViewProps) {
  const { announce } = useAnnouncer();
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [hosts, setHosts] = useState<OmnigentHost[]>([]);
  const [agents, setAgents] = useState<OmnigentAgent[]>([]);
  const [sessions, setSessions] = useState<OmnigentSessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Settings form
  const [baseUrlDraft, setBaseUrlDraft] = useState("");
  const [workspaceDraft, setWorkspaceDraft] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);

  // New run form
  const [runOpen, setRunOpen] = useState(false);
  const [hostId, setHostId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [familiarId, setFamiliarId] = useState(activeFamiliarId ?? "");
  const [prompt, setPrompt] = useState("");
  const [title, setTitle] = useState("");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [lastWebUrl, setLastWebUrl] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setError(null);
    try {
      const stRes = await fetch("/api/omnigent/status");
      const st = (await stRes.json()) as StatusPayload;
      setStatus(st);
      if (st.defaults?.baseUrl) setBaseUrlDraft(st.defaults.baseUrl);
      if (st.defaults?.defaultWorkspace) {
        setWorkspaceDraft(st.defaults.defaultWorkspace);
        setWorkspace((w) => w || st.defaults?.defaultWorkspace || "");
      }

      if (!st.configured || !st.online || !st.hasToken) {
        setHosts([]);
        setAgents([]);
        setSessions([]);
        setLoading(false);
        return;
      }

      const [hRes, aRes, sRes] = await Promise.all([
        fetch("/api/omnigent/hosts"),
        fetch("/api/omnigent/agents"),
        fetch("/api/omnigent/sessions"),
      ]);
      const hJson = await hRes.json();
      const aJson = await aRes.json();
      const sJson = await sRes.json();

      if (!hJson.ok) throw new Error(hJson.error || "hosts failed");
      if (!aJson.ok) throw new Error(aJson.error || "agents failed");
      if (!sJson.ok) throw new Error(sJson.error || "sessions failed");

      const nextHosts = (hJson.hosts ?? []) as OmnigentHost[];
      const nextAgents = (aJson.agents ?? []) as OmnigentAgent[];
      setHosts(nextHosts);
      setAgents(nextAgents);
      setSessions((sJson.sessions ?? []) as OmnigentSessionListItem[]);

      // Prefill run form defaults once.
      setHostId((prev) => {
        if (prev) return prev;
        const preferred = st.defaults?.defaultHostId;
        const online =
          nextHosts.find((h) => h.host_id === preferred) ||
          nextHosts.find((h) => (h.status ?? "").toLowerCase() === "online") ||
          nextHosts[0];
        return online?.host_id ?? "";
      });
      setAgentId((prev) => {
        if (prev) return prev;
        const preferred = st.defaults?.defaultAgentId;
        const hit =
          nextAgents.find((a) => a.id === preferred) ||
          nextAgents.find((a) => a.name === "claude-native-ui") ||
          nextAgents[0];
        return hit?.id ?? "";
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fleet load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  usePausablePoll(loadAll, 12_000);

  useEffect(() => {
    if (activeFamiliarId) setFamiliarId(activeFamiliarId);
  }, [activeFamiliarId]);

  const onlineCount = useMemo(
    () => hosts.filter((h) => (h.status ?? "").toLowerCase() === "online").length,
    [hosts],
  );
  const runningCount = useMemo(
    () => sessions.filter((s) => s.status === "running").length,
    [sessions],
  );

  async function saveOmnigentConfig() {
    setSavingConfig(true);
    setError(null);
    try {
      const res = await fetch("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          omnigent: {
            baseUrl: baseUrlDraft.trim(),
            defaultWorkspace: workspaceDraft.trim(),
            defaultHostId: hostId || undefined,
            defaultAgentId: agentId || undefined,
          },
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "save failed");
      announce("Omnigent settings saved");
      setLoading(true);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSavingConfig(false);
    }
  }

  async function startRun() {
    setRunning(true);
    setRunError(null);
    setLastWebUrl(null);
    try {
      const res = await fetch("/api/omnigent/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: agentId || undefined,
          hostId: hostId || undefined,
          workspace: workspace.trim() || undefined,
          prompt: prompt.trim(),
          title: title.trim() || undefined,
          familiar: familiarId || undefined,
          hostType: "external",
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        throw new Error(json.detail || json.error || "create failed");
      }
      setLastWebUrl(typeof json.webUrl === "string" ? json.webUrl : null);
      announce("Session started on Omnigent host");
      setPrompt("");
      setRunOpen(false);
      await loadAll();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "run failed");
    } finally {
      setRunning(false);
    }
  }

  if (loading && !status) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3 p-6">
        <SkeletonRows count={8} />
      </div>
    );
  }

  return (
    <div className="fleet-view flex h-full min-h-0 flex-col overflow-auto p-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Fleet</h1>
          <p className="text-sm opacity-70">
            Control Omnigent hosts and sessions from Cave. Tokens stay on the server (
            <code className="text-xs">~/.omnigent/auth_tokens.json</code>).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill status={status} />
          <Button type="button" variant="secondary" onClick={() => void loadAll()}>
            <Icon name="ph:arrows-clockwise" width={14} /> Refresh
          </Button>
          <Button type="button" onClick={() => setRunOpen(true)} disabled={!status?.online}>
            <Icon name="ph:play" width={14} /> New run
          </Button>
        </div>
      </header>

      {error ? (
        <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm" role="alert">
          {error}
        </div>
      ) : null}

      {lastWebUrl ? (
        <div className="mb-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm">
          Session started.{" "}
          <a className="underline" href={lastWebUrl} target="_blank" rel="noreferrer">
            Open in Omnigent
          </a>
        </div>
      ) : null}

      {/* Connection settings */}
      <section className="mb-6 rounded-lg border border-[var(--border-subtle,rgba(255,255,255,0.08))] p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide opacity-70">Connection</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="opacity-70">Omnigent base URL</span>
            <input
              className="rounded border border-[var(--border-subtle,rgba(255,255,255,0.12))] bg-transparent px-2 py-1.5"
              value={baseUrlDraft}
              onChange={(e) => setBaseUrlDraft(e.target.value)}
              placeholder="https://omnigent.tail3c92ee.ts.net"
              spellCheck={false}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="opacity-70">Default workspace (absolute on host)</span>
            <input
              className="rounded border border-[var(--border-subtle,rgba(255,255,255,0.12))] bg-transparent px-2 py-1.5"
              value={workspaceDraft}
              onChange={(e) => setWorkspaceDraft(e.target.value)}
              placeholder="/Users/you/Developer/1_Projects/…"
              spellCheck={false}
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button type="button" onClick={() => void saveOmnigentConfig()} disabled={savingConfig}>
            {savingConfig ? "Saving…" : "Save connection"}
          </Button>
          <span className="text-xs opacity-60">
            Token: {status?.hasToken ? "found" : "missing"} · Online: {status?.online ? "yes" : "no"}
          </span>
        </div>
      </section>

      {/* Summary */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Hosts online" value={`${onlineCount}/${hosts.length}`} />
        <StatCard label="Sessions" value={String(sessions.length)} />
        <StatCard label="Running" value={String(runningCount)} />
        <StatCard label="Agents" value={String(agents.length)} />
      </div>

      {!status?.configured ? (
        <EmptyState
          icon="ph:cloud-bold"
          headline="Connect Omnigent"
          subtitle="Paste your Omnigent server URL above (e.g. Tailscale), run omnigent login on this machine, then Save."
        />
      ) : null}

      {/* Hosts */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide opacity-70">Hosts</h2>
        {hosts.length === 0 ? (
          <p className="text-sm opacity-60">No hosts. Start `omnigent host &lt;url&gt;` on each machine.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {hosts.map((h) => {
              const online = (h.status ?? "").toLowerCase() === "online";
              return (
                <button
                  key={h.host_id}
                  type="button"
                  className="rounded-lg border border-[var(--border-subtle,rgba(255,255,255,0.08))] p-3 text-left hover:bg-white/5"
                  onClick={() => {
                    setHostId(h.host_id);
                    setRunOpen(true);
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{h.name || h.host_id.slice(0, 12)}</span>
                    <span className={`text-xs ${online ? "text-emerald-400" : "opacity-50"}`}>
                      {online ? "online" : h.status || "offline"}
                    </span>
                  </div>
                  <div className="mt-1 truncate font-mono text-[11px] opacity-50">{h.host_id}</div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Sessions */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide opacity-70">Recent sessions</h2>
        {sessions.length === 0 ? (
          <p className="text-sm opacity-60">No sessions yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle,rgba(255,255,255,0.06))] rounded-lg border border-[var(--border-subtle,rgba(255,255,255,0.08))]">
            {sessions.slice(0, 20).map((s) => {
              const familiar = s.labels?.["coven.familiar"];
              const web =
                status?.baseUrl && s.id ? `${status.baseUrl.replace(/\/+$/, "")}/c/${s.id}` : null;
              return (
                <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {s.title || s.agent_name || s.id}
                      {familiar ? (
                        <span className="ml-2 text-xs opacity-60">· {familiar}</span>
                      ) : null}
                    </div>
                    <div className="truncate text-xs opacity-50">
                      {s.status}
                      {s.host_id ? ` · ${s.host_id.slice(0, 14)}…` : ""}
                    </div>
                  </div>
                  {web ? (
                    <a className="shrink-0 text-xs underline opacity-80" href={web} target="_blank" rel="noreferrer">
                      Open
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* New run modal */}
      {runOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="New Omnigent run"
          onClick={() => !running && setRunOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-[var(--border-subtle,rgba(255,255,255,0.12))] bg-[var(--bg-elevated,#141414)] p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-lg font-semibold">New run</h3>
            <div className="grid gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="opacity-70">Host</span>
                <select
                  className="rounded border border-[var(--border-subtle,rgba(255,255,255,0.12))] bg-transparent px-2 py-1.5"
                  value={hostId}
                  onChange={(e) => setHostId(e.target.value)}
                >
                  {hosts.map((h) => (
                    <option key={h.host_id} value={h.host_id}>
                      {(h.status ?? "").toLowerCase() === "online" ? "●" : "○"} {h.name || h.host_id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="opacity-70">Agent (catalog)</span>
                <select
                  className="rounded border border-[var(--border-subtle,rgba(255,255,255,0.12))] bg-transparent px-2 py-1.5"
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                >
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.harness ? ` (${a.harness})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="opacity-70">Familiar label (optional)</span>
                <select
                  className="rounded border border-[var(--border-subtle,rgba(255,255,255,0.12))] bg-transparent px-2 py-1.5"
                  value={familiarId}
                  onChange={(e) => setFamiliarId(e.target.value)}
                >
                  <option value="">— none —</option>
                  {familiars.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.display_name || f.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="opacity-70">Workspace (absolute on host)</span>
                <input
                  className="rounded border border-[var(--border-subtle,rgba(255,255,255,0.12))] bg-transparent px-2 py-1.5 font-mono text-xs"
                  value={workspace}
                  onChange={(e) => setWorkspace(e.target.value)}
                  spellCheck={false}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="opacity-70">Title</span>
                <input
                  className="rounded border border-[var(--border-subtle,rgba(255,255,255,0.12))] bg-transparent px-2 py-1.5"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="cave fleet run"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="opacity-70">Prompt</span>
                <textarea
                  className="min-h-[96px] rounded border border-[var(--border-subtle,rgba(255,255,255,0.12))] bg-transparent px-2 py-1.5"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="What should the agent do?"
                />
              </label>
              {runError ? (
                <div className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-xs" role="alert">
                  {runError}
                </div>
              ) : null}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" disabled={running} onClick={() => setRunOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={running || !prompt.trim() || !hostId || !agentId}
                onClick={() => void startRun()}
              >
                {running ? "Starting…" : "Start session"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StatusPill({ status }: { status: StatusPayload | null }) {
  if (!status?.configured) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1 text-xs opacity-70">
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" /> Not configured
      </span>
    );
  }
  if (!status.online) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 px-2.5 py-1 text-xs text-amber-200">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Offline
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 px-2.5 py-1 text-xs text-emerald-200">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Online
    </span>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle,rgba(255,255,255,0.08))] px-3 py-2">
      <div className="text-xs opacity-60">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
