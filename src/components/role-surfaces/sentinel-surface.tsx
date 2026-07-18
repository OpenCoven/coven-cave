"use client";

/**
 * Sentinel Surface — the Watchtower.
 *
 * Alerts, session watch, and perimeter state for a sentinel familiar. Left
 * rail: live watch status (daemon, running/failed sessions) and perimeter
 * reachability (real ssh-host probes via `/api/hosts`). Center: the alert
 * board — the Cave's real escalations (`/api/escalations`), scoped and
 * filtered. Right sidebar: the selected alert's provenance and its real
 * lifecycle controls (acknowledge / snooze / resolve / dismiss, PATCHed to
 * the same store the Inbox uses). Bottom drawer: the watch log — recent
 * session failures and recently closed alerts.
 *
 * Everything rendered here is real Cave state; panels with nothing to show
 * say so instead of pretending.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import type { RoleSurfaceContext } from "@/lib/role-surfaces";
import { useRoleSurfaceState } from "@/lib/role-surface-state";
import { SEVERITIES, SNOOZE_PRESETS, type Escalation } from "@/lib/escalations-types";
import { relativeTime } from "@/lib/relative-time";
import {
  filterAlerts,
  summarizeAlerts,
  watchSessions,
  type AlertScope,
  type AlertSeverityFilter,
} from "./sentinel-watch";
import { RailSection, SurfaceCanvas, SurfaceEmpty, SurfaceRail, SurfaceRoom } from "./surface-room";
import { SENTINEL_SURFACE_ID } from "./ids";

export type SentinelState = {
  scope: AlertScope;
  severity: AlertSeverityFilter;
  selectedId: string | null;
  drawerOpen: boolean;
  /** Latest sweep counts — read by the registration manifest's status chip. */
  lastSummary: { open: number; critical: number } | null;
};

export const SENTINEL_INITIAL_STATE: SentinelState = {
  scope: "open",
  severity: "all",
  selectedId: null,
  drawerOpen: false,
  lastSummary: null,
};

type HostWire = {
  id: string;
  kind: "local" | "ssh";
  label: string;
  cwd?: string;
  online: boolean | null;
};

const SCOPES: { id: AlertScope; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "snoozed", label: "Snoozed" },
  { id: "resolved", label: "Closed" },
  { id: "all", label: "All" },
];

const STATE_LABELS: Record<Escalation["state"], string> = {
  new: "new",
  acknowledged: "acknowledged",
  snoozed: "snoozed",
  resolved: "resolved",
  dismissed: "dismissed",
};

export function SentinelSurface({ context }: { context: RoleSurfaceContext }) {
  const familiarId = context.activeFamiliar.id;
  const [state, patch] = useRoleSurfaceState<SentinelState>(familiarId, SENTINEL_SURFACE_ID, SENTINEL_INITIAL_STATE);

  // ── Alerts: the Cave's real escalations ────────────────────────────────────
  const [alerts, setAlerts] = useState<Escalation[] | null>(null);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const loadAlerts = useCallback(async () => {
    setAlertsError(null);
    try {
      const res = await fetch("/api/escalations", { cache: "no-store" });
      const json = res.ok ? ((await res.json()) as { ok?: boolean; items?: Escalation[] }) : null;
      if (!json?.ok || !Array.isArray(json.items)) throw new Error("bad response");
      setAlerts(json.items);
      const summary = summarizeAlerts(json.items);
      patch({ lastSummary: { open: summary.open, critical: summary.critical } });
    } catch {
      setAlertsError("Couldn't load escalations.");
      setAlerts((prev) => prev ?? []);
    }
  }, [patch]);
  useEffect(() => {
    void loadAlerts();
  }, [loadAlerts]);

  // ── Perimeter: registered hosts with live reachability probes ─────────────
  const [hosts, setHosts] = useState<HostWire[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/hosts", { cache: "no-store" });
        const json = res.ok ? ((await res.json()) as { ok?: boolean; hosts?: HostWire[] }) : null;
        if (!cancelled) setHosts(json?.hosts ?? []);
      } catch {
        if (!cancelled) setHosts([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const summary = useMemo(() => summarizeAlerts(alerts ?? []), [alerts]);
  const filtered = useMemo(
    () => filterAlerts(alerts ?? [], state.scope, state.severity),
    [alerts, state.scope, state.severity],
  );
  const selected = useMemo(
    () => (alerts ?? []).find((a) => a.id === state.selectedId) ?? null,
    [alerts, state.selectedId],
  );
  const watch = useMemo(() => watchSessions(context.runtimeState.sessions), [context.runtimeState.sessions]);
  const recentlyClosed = useMemo(
    () =>
      (alerts ?? [])
        .filter((a) => a.state === "resolved" || a.state === "dismissed")
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 8),
    [alerts],
  );

  // ── Lifecycle actions: PATCH the same store the Inbox uses ────────────────
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const act = useCallback(
    async (id: string, body: Record<string, string>, actionKey: string) => {
      setBusyAction(actionKey);
      setActionError(null);
      try {
        const res = await fetch(`/api/escalations/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        await loadAlerts();
      } catch {
        setActionError("Action failed — the escalation store didn't accept the change.");
      } finally {
        setBusyAction(null);
      }
    },
    [loadAlerts],
  );

  const runAlertAction = useCallback(
    async (action: NonNullable<Escalation["actions"]>[number]) => {
      if (action.kind === "link") {
        context.openUrl(action.target);
        return;
      }
      setBusyAction(`rpc:${action.id}`);
      setActionError(null);
      try {
        const res = await fetch(action.target, { method: "POST" });
        if (!res.ok) throw new Error(`status ${res.status}`);
        await loadAlerts();
      } catch {
        setActionError(`"${action.label}" failed.`);
      } finally {
        setBusyAction(null);
      }
    },
    [context, loadAlerts],
  );

  const closed = selected != null && (selected.state === "resolved" || selected.state === "dismissed");

  return (
    <SurfaceRoom
      accentHue={40}
      drawerTitle="Watch log"
      drawerOpen={state.drawerOpen}
      onToggleDrawer={() => patch({ drawerOpen: !state.drawerOpen })}
      drawer={
        <div className="role-surface-drawer-grid">
          <RailSection title="Recent session failures" iconName="ph:warning">
            {watch.recentFailures.length === 0 ? (
              <SurfaceEmpty title="No failed sessions on watch." />
            ) : (
              <ul className="role-surface-list" aria-label="Recent session failures">
                {watch.recentFailures.map((session) => (
                  <li key={session.id}>
                    <button
                      type="button"
                      className="role-surface-row-btn focus-ring-inset"
                      onClick={() => context.openSession(session.id, familiarId)}
                    >
                      {session.title || session.id}
                      <span className="role-surface-tag">exit {session.exit_code}</span>
                      <span className="role-surface-tag">{relativeTime(session.updated_at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </RailSection>
          <RailSection title="Recently closed alerts" iconName="ph:clock">
            {recentlyClosed.length === 0 ? (
              <SurfaceEmpty title="Nothing closed yet." />
            ) : (
              <ul className="role-surface-list" aria-label="Recently closed alerts">
                {recentlyClosed.map((item) => (
                  <li key={item.id} className="role-surface-list-row">
                    <span>{item.title}</span>
                    <span className="role-surface-tag">{STATE_LABELS[item.state]}</span>
                  </li>
                ))}
              </ul>
            )}
          </RailSection>
        </div>
      }
    >
      <SurfaceRail side="left" label="Watch status">
        <RailSection title="Watch status" iconName="ph:heartbeat">
          <ul className="role-surface-list">
            <li className="role-surface-list-row">
              <span className="role-surface-status">
                <span
                  className={`role-surface-status-dot role-surface-status-dot--${context.runtimeState.daemonRunning ? "ok" : "warn"}`}
                  aria-hidden
                />
                Daemon {context.runtimeState.daemonRunning ? "running" : "offline"}
              </span>
            </li>
            <li className="role-surface-list-row">
              <span>Sessions running</span>
              <span className="role-surface-tag">{watch.running}</span>
            </li>
            <li className="role-surface-list-row">
              <span className={watch.failed > 0 ? "role-surface-metric-warn" : undefined}>Sessions failed</span>
              <span className="role-surface-tag">{watch.failed}</span>
            </li>
            <li className="role-surface-list-row">
              <span className={summary.decisionsRequired > 0 ? "role-surface-metric-warn" : undefined}>
                Decisions required
              </span>
              <span className="role-surface-tag">{summary.decisionsRequired}</span>
            </li>
          </ul>
        </RailSection>
        <RailSection title="Alert queues" iconName="ph:bell">
          <ul className="role-surface-list">
            {SCOPES.map((scope) => (
              <li key={scope.id}>
                <button
                  type="button"
                  className={`role-surface-row-btn focus-ring-inset${state.scope === scope.id ? " role-surface-row-btn--active" : ""}`}
                  onClick={() => patch({ scope: scope.id })}
                >
                  {scope.label}
                  <span className="role-surface-tag">
                    {scope.id === "open"
                      ? summary.open
                      : scope.id === "snoozed"
                        ? summary.snoozed
                        : scope.id === "resolved"
                          ? (alerts ?? []).filter((a) => a.state === "resolved" || a.state === "dismissed").length
                          : (alerts ?? []).length}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </RailSection>
        <RailSection title="Perimeter" iconName="ph:globe">
          {hosts == null ? (
            <SurfaceEmpty title="Probing perimeter…" hint="Checking each registered host over ssh." />
          ) : hosts.length === 0 ? (
            <SurfaceEmpty title="No hosts registered." hint="Register remote hosts from the chat host picker." />
          ) : (
            <ul className="role-surface-list" aria-label="Registered hosts">
              {hosts.map((host) => (
                <li key={host.id} className="role-surface-list-row">
                  <span className="role-surface-status">
                    <span
                      className={`role-surface-status-dot role-surface-status-dot--${host.online === false ? "warn" : host.online ? "ok" : "busy"}`}
                      aria-hidden
                    />
                    {host.label}
                  </span>
                  <span className="role-surface-tag">
                    {host.kind === "local" ? "this machine" : host.online == null ? "unprobed" : host.online ? "reachable" : "unreachable"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </RailSection>
      </SurfaceRail>

      <SurfaceCanvas label="Alert board">
        <div className="role-surface-canvas-stack">
          <div className="role-surface-btn-row" role="group" aria-label="Severity filter">
            {(["all", ...SEVERITIES] as const).map((severity) => (
              <button
                key={severity}
                type="button"
                className={`role-surface-chip focus-ring${state.severity === severity ? " role-surface-chip--accent" : ""}`}
                aria-pressed={state.severity === severity}
                onClick={() => patch({ severity })}
              >
                {severity === "all" ? "All severities" : severity}
              </button>
            ))}
            <button type="button" className="role-surface-chip focus-ring" onClick={() => void loadAlerts()}>
              <Icon name="ph:arrow-clockwise" width={12} height={12} aria-hidden /> Sweep again
            </button>
          </div>
          {alertsError ? (
            <div role="alert" className="role-surface-hint">
              {alertsError}{" "}
              <button type="button" className="role-surface-chip focus-ring" onClick={() => void loadAlerts()}>
                Try again
              </button>
            </div>
          ) : null}
          {alerts == null ? (
            <SurfaceEmpty title="Sweeping escalations…" />
          ) : filtered.length === 0 ? (
            <SurfaceEmpty
              iconName="ph:binoculars"
              title={state.scope === "open" ? "Perimeter clear." : "Nothing here."}
              hint={
                state.severity !== "all"
                  ? "Loosen the severity filter."
                  : "Escalations raised anywhere in the Cave appear on this board."
              }
            />
          ) : (
            <ul className="role-surface-grid" aria-label="Alerts">
              {filtered.slice(0, 60).map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`role-surface-card focus-ring${item.id === state.selectedId ? " role-surface-card--active" : ""}`}
                    aria-current={item.id === state.selectedId ? "true" : undefined}
                    onClick={() => patch({ selectedId: item.id })}
                  >
                    <span className="role-surface-card-tags">
                      <span className={item.severity === "critical" ? "role-surface-tag role-surface-metric-warn" : "role-surface-tag"}>
                        {item.severity}
                      </span>
                      <span className="role-surface-tag">{STATE_LABELS[item.state]}</span>
                      {item.decisionRequired && <span className="role-surface-tag">decision required</span>}
                    </span>
                    <span className="role-surface-memory-path">{item.title}</span>
                    <span className="role-surface-memory-excerpt">
                      {item.origin} · {relativeTime(item.createdAt)}
                      {item.aboutFamiliar ? ` · about ${item.aboutFamiliar}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SurfaceCanvas>

      <SurfaceRail side="right" label="Alert details">
        {!selected ? (
          <RailSection title="Details" iconName="ph:note">
            <SurfaceEmpty title="Select an alert to triage it." />
          </RailSection>
        ) : (
          <>
            <RailSection title="Selected alert" iconName="ph:note">
              <p className="role-surface-memory-path">{selected.title}</p>
              {selected.excerpt && <p className="role-surface-memory-excerpt">{selected.excerpt}</p>}
              <dl className="role-surface-facts">
                <dt>Severity</dt>
                <dd>
                  {selected.severity}
                  {selected.severityReason ? ` — ${selected.severityReason}` : ""}
                </dd>
                <dt>State</dt>
                <dd>
                  {STATE_LABELS[selected.state]}
                  {selected.state === "snoozed" && selected.snoozeUntil
                    ? ` until ${new Date(selected.snoozeUntil).toLocaleString()}`
                    : ""}
                </dd>
                <dt>Origin</dt>
                <dd>{selected.origin}</dd>
                <dt>Raised</dt>
                <dd>{new Date(selected.createdAt).toLocaleString()}</dd>
                {selected.fromFamiliar && (
                  <>
                    <dt>From</dt>
                    <dd>{selected.fromFamiliar}</dd>
                  </>
                )}
                {selected.aboutFamiliar && (
                  <>
                    <dt>About</dt>
                    <dd>{selected.aboutFamiliar}</dd>
                  </>
                )}
                <dt>Decision</dt>
                <dd>{selected.decisionRequired ? "Required from a human" : "Not required"}</dd>
              </dl>
            </RailSection>
            <RailSection title="Triage" iconName="ph:shield-warning">
              {actionError ? (
                <p role="alert" className="role-surface-hint">
                  {actionError}
                </p>
              ) : null}
              {closed ? (
                <SurfaceEmpty title="Alert is closed." hint="Closed alerts expire from the store after 30 days." />
              ) : (
                <>
                  <div className="role-surface-btn-row">
                    {selected.state === "new" && (
                      <button
                        type="button"
                        className="role-surface-chip focus-ring"
                        disabled={busyAction != null}
                        onClick={() => void act(selected.id, { state: "acknowledged" }, "acknowledge")}
                      >
                        Acknowledge
                      </button>
                    )}
                    <button
                      type="button"
                      className="role-surface-chip role-surface-chip--accent focus-ring"
                      disabled={busyAction != null}
                      onClick={() => void act(selected.id, { state: "resolved" }, "resolve")}
                    >
                      Resolve
                    </button>
                    <button
                      type="button"
                      className="role-surface-chip focus-ring"
                      disabled={busyAction != null}
                      onClick={() => void act(selected.id, { state: "dismissed" }, "dismiss")}
                    >
                      Dismiss
                    </button>
                  </div>
                  <p className="role-surface-field-label">Snooze</p>
                  <div className="role-surface-btn-row">
                    {SNOOZE_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        className="role-surface-chip focus-ring"
                        disabled={busyAction != null}
                        onClick={() => void act(selected.id, { state: "snoozed", snoozePreset: preset.id }, `snooze:${preset.id}`)}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </RailSection>
            {(selected.sourceSessionKey || selected.sourceUrl || (selected.actions ?? []).length > 0) && (
              <RailSection title="Source & actions" iconName="ph:arrow-bend-up-right">
                <div className="role-surface-btn-row">
                  {selected.sourceSessionKey && (
                    <button
                      type="button"
                      className="role-surface-chip focus-ring"
                      onClick={() => context.openSession(selected.sourceSessionKey as string, familiarId)}
                    >
                      Open session
                    </button>
                  )}
                  {selected.sourceUrl && (
                    <button
                      type="button"
                      className="role-surface-chip focus-ring"
                      onClick={() => context.openUrl(selected.sourceUrl as string)}
                    >
                      Open link
                    </button>
                  )}
                  {(selected.actions ?? []).map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      className="role-surface-chip focus-ring"
                      disabled={busyAction != null}
                      onClick={() => void runAlertAction(action)}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </RailSection>
            )}
          </>
        )}
      </SurfaceRail>
    </SurfaceRoom>
  );
}
