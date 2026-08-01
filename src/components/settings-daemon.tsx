"use client";

import "@/styles/settings-daemon.css";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { IconButton } from "@/components/ui/icon-button";
import { useAnnouncer } from "@/components/ui/live-region";
import { RelativeTime } from "@/components/ui/relative-time";
import { TextArea } from "@/components/ui/text-area";
import { TextInput } from "@/components/ui/text-input";
import { copyText } from "@/lib/clipboard";
import { Icon, type IconName } from "@/lib/icon";
import { classifyTailscaleFailureKind } from "@/lib/tailscale-failure";
import {
  useDaemonAutomation,
  writeDaemonAutomation,
  type DaemonAutomationKey,
} from "@/lib/daemon-automation-pref";
import { parseExecutorUrls } from "./settings-multihost";

type DaemonStatus = {
  running: boolean;
  reason?: string;
  checkedAt?: string;
  covenVersion?: string;
  apiVersion?: string;
  workspacePath?: string;
  daemon?: { pid: number; startedAt: string; socket: string };
  executors?: Array<{
    url: string;
    healthUrl: string;
    ok: boolean;
    state: "available" | "unreachable";
    detail: string;
  }>;
  target?: {
    mode: "local" | "hub" | "unconfigured-hub";
    label: string;
    socket?: string;
    url?: string;
    error?: string;
  };
  travel?: {
    mode: "home" | "hub" | "watching-hub" | "travel" | "handoff-pending";
    authority: "local" | "hub" | "travel-local";
    reason: string;
    manualOffline: boolean;
    staleCache: boolean;
    wakeLocalSubdaemon: boolean;
    localBindHost: "127.0.0.1";
    hubUnreachableSince: string | null;
    hubUnreachableForMs: number;
    pendingQueueCount: number;
    handoffPending: boolean;
  };
};

type MultiHostMode = "local" | "hub";

type TailscaleDevice = {
  name: string;
  dnsName: string | null;
  hostName: string | null;
  tailnetIp: string | null;
  os: string | null;
  online: boolean;
  lastSeen: string | null;
  isSelf: boolean;
};

type DaemonProbe = {
  reachable: boolean;
  status: number;
  latencyMs: number;
  reason?: string;
  url: string;
};

type SavedConnection = {
  mode: MultiHostMode;
  hubUrl: string;
  executorUrls: string[];
};

type StatusTone = "danger" | "neutral" | "success" | "warning";

const RUNTIME_TARGETS: Array<{
  id: MultiHostMode;
  label: string;
  blurb: string;
  icon: IconName;
}> = [
  {
    id: "local",
    label: "Local",
    blurb: "Runs everything on this machine. The default, and the fastest path.",
    icon: "ph:terminal-window",
  },
  {
    id: "hub",
    label: "Server hub",
    blurb: "Connects to a shared daemon on another machine over your tailnet.",
    icon: "ph:cloud-bold",
  },
];

function SectionRule({ id, label, meta }: { id: string; label: string; meta?: ReactNode }) {
  return (
    <div className="settings-daemon-rule">
      <h2 id={id}>{label}</h2>
      <span className="settings-daemon-rule-line" aria-hidden="true" />
      {meta ? <span className="settings-daemon-rule-meta">{meta}</span> : null}
    </div>
  );
}

/**
 * Unattended lifecycle switches (cave-bqywj). Every one is opt-in and starts
 * off: they restart processes and install binaries on this machine.
 *
 * There is no "auto-reconnect" switch on purpose — reconnection already
 * happens unconditionally (the status poll re-probes every 5s and drops the
 * offline banner the moment the daemon answers; the PTY bridge runs its own
 * backoff loop). A toggle would either do nothing or, defaulting to off,
 * remove recovery that works today.
 *
 * `.settings-switch` comes from dashboard.css, which settings-shell.tsx
 * imports; DaemonSection only ever renders inside that shell.
 */
function AutomationSection() {
  const automation = useDaemonAutomation();
  const rows: {
    key: DaemonAutomationKey;
    label: string;
    description: string;
  }[] = [
    {
      key: "autoRestart",
      label: "Restart the daemon",
      description:
        "Relaunch a local daemon that goes offline mid-session. Today it is only started once, at app launch.",
    },
    {
      key: "autoUpgradeCli",
      label: "Upgrade Coven",
      description:
        "Install Coven CLI updates unattended. This is also the daemon — they ship as one package — and it changes the version of the command you type at.",
    },
  ];

  return (
    <section
      className="settings-daemon-section"
      aria-labelledby="settings-daemon-automation-heading"
    >
      <SectionRule id="settings-daemon-automation-heading" label="AUTOMATION" />
      <div className="settings-daemon-automation">
        {rows.map((row) => {
          const enabled = automation[row.key];
          // The description is the consequence — a process restart or an
          // unattended install. A screen reader must reach it from the switch
          // itself, not only by having read the row on the way past.
          const describedBy = `settings-daemon-automation-${row.key}-description`;
          return (
            <div className="settings-daemon-automation-row" key={row.key}>
              <div className="settings-daemon-automation-copy">
                <span className="settings-daemon-automation-label">{row.label}</span>
                <span className="settings-daemon-automation-description" id={describedBy}>
                  {row.description}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-label={row.label}
                aria-describedby={describedBy}
                onClick={() => writeDaemonAutomation(row.key, !enabled)}
                className={`settings-switch focus-ring${enabled ? " is-on" : ""}`}
              >
                <span className="settings-switch__knob" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function isValidHubUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function describeTailscaleFailure(raw: string): { headline: string; hint: string } {
  const kind = classifyTailscaleFailureKind(raw);
  if (kind === "not-installed") {
    return {
      headline: "Tailscale isn’t installed",
      hint: "Install Tailscale and sign in, then refresh devices.",
    };
  }
  if (kind === "signed-out" || kind === "not-running") {
    return {
      headline: "Tailscale isn’t running",
      hint: "Open Tailscale and sign in, then refresh devices.",
    };
  }
  return {
    headline: "Tailnet devices unavailable",
    hint: "Retry device discovery, or enter the server hub URL directly.",
  };
}

export function DaemonSection({
  suggestedHubUrl,
  onSuggestionConsumed,
  omnigentSettings,
}: {
  suggestedHubUrl: string | null;
  onSuggestionConsumed: () => void;
  omnigentSettings?: ReactNode;
}) {
  const { announce } = useAnnouncer();
  const [status, setStatus] = useState<DaemonStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusLoadError, setStatusLoadError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const [mode, setMode] = useState<MultiHostMode>("local");
  const [hubUrl, setHubUrl] = useState("");
  const [executorText, setExecutorText] = useState("");
  const [savedConnection, setSavedConnection] = useState<SavedConnection | null>(null);
  const [savingConnection, setSavingConnection] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [executorsOpen, setExecutorsOpen] = useState(false);

  const [devices, setDevices] = useState<TailscaleDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [probe, setProbe] = useState<DaemonProbe | null>(null);
  const [probing, setProbing] = useState(false);

  const [savingTravel, setSavingTravel] = useState(false);
  const [travelError, setTravelError] = useState<string | null>(null);
  const [copiedInfo, setCopiedInfo] = useState<"socket" | "workspace" | null>(null);

  const refreshCtlRef = useRef<AbortController | null>(null);
  const devicesCtlRef = useRef<AbortController | null>(null);
  const suggestionAppliedRef = useRef(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async (announceResult = false) => {
    refreshCtlRef.current?.abort();
    const ctl = new AbortController();
    refreshCtlRef.current = ctl;
    setLoading(true);
    setStatusLoadError(null);
    try {
      const response = await fetch("/api/daemon/status", { cache: "no-store", signal: ctl.signal });
      const result = await response.json().catch(() => ({})) as DaemonStatus & { error?: string };
      if (!response.ok) throw new Error(result.error || `status failed (${response.status})`);
      if (ctl.signal.aborted) return;
      setStatus(result);
      if (announceResult) announce("Daemon status refreshed.");
    } catch (error) {
      if (ctl.signal.aborted) return;
      const message = error instanceof Error ? error.message : "daemon status unavailable";
      setStatusLoadError(message);
      if (announceResult) announce(`Couldn't refresh daemon status: ${message}`, "assertive");
    } finally {
      if (!ctl.signal.aborted) setLoading(false);
    }
  }, [announce]);

  useEffect(() => {
    void refresh();
    return () => refreshCtlRef.current?.abort();
  }, [refresh]);

  useEffect(() => {
    const ctl = new AbortController();
    fetch("/api/config", { cache: "no-store", signal: ctl.signal })
      .then((response) => response.json())
      .then((result: {
        ok?: boolean;
        config?: {
          multiHost?: {
            mode?: MultiHostMode;
            hubUrl?: string;
            executorUrls?: string[];
          };
        };
      }) => {
        if (ctl.signal.aborted || !result.ok) return;
        const multiHost = result.config?.multiHost;
        const next: SavedConnection = {
          mode: multiHost?.mode === "hub" ? "hub" : "local",
          hubUrl: multiHost?.hubUrl ?? "",
          executorUrls: multiHost?.executorUrls ?? [],
        };
        setSavedConnection(next);
        setExecutorText(next.executorUrls.join("\n"));
        setExecutorsOpen(next.executorUrls.length > 0);
        if (suggestionAppliedRef.current) return;
        setMode(next.mode);
        setHubUrl(next.hubUrl);
      })
      .catch(() => {
        if (!ctl.signal.aborted) setConnectionError("Couldn’t load the saved daemon connection.");
      });
    return () => ctl.abort();
  }, []);

  useEffect(() => {
    if (!suggestedHubUrl) return;
    suggestionAppliedRef.current = true;
    setMode("hub");
    setHubUrl(suggestedHubUrl);
    setProbe(null);
    onSuggestionConsumed();
  }, [onSuggestionConsumed, suggestedHubUrl]);

  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);

  const loadDevices = useCallback(() => {
    devicesCtlRef.current?.abort();
    const ctl = new AbortController();
    devicesCtlRef.current = ctl;
    setDevicesLoading(true);
    setDevicesError(null);
    fetch("/api/tailscale/devices", { cache: "no-store", signal: ctl.signal })
      .then((response) => response.json())
      .then((result: { ok?: boolean; devices?: TailscaleDevice[]; reason?: string }) => {
        if (ctl.signal.aborted) return;
        if (!result.ok) {
          setDevices([]);
          setDevicesError(result.reason || "Tailscale status unavailable");
        } else {
          setDevices(result.devices ?? []);
        }
        setDevicesLoading(false);
      })
      .catch((error) => {
        if (ctl.signal.aborted) return;
        setDevicesError(error instanceof Error ? error.message : "Tailscale status unavailable");
        setDevicesLoading(false);
      });
  }, []);

  useEffect(() => {
    if (mode !== "hub") {
      devicesCtlRef.current?.abort();
      return;
    }
    loadDevices();
    return () => devicesCtlRef.current?.abort();
  }, [loadDevices, mode]);

  const connectionDirty = savedConnection !== null && (
    mode !== savedConnection.mode ||
    hubUrl.trim() !== savedConnection.hubUrl.trim() ||
    JSON.stringify(parseExecutorUrls(executorText)) !== JSON.stringify(savedConnection.executorUrls)
  );

  const persistConnection = async (nextMode = mode) => {
    const normalizedHubUrl = hubUrl.trim();
    const normalizedExecutorUrls = parseExecutorUrls(executorText);
    setSavingConnection(true);
    setConnectionError(null);
    try {
      const res = await fetch("/api/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ multiHost: { mode: nextMode, hubUrl: normalizedHubUrl, executorUrls: normalizedExecutorUrls } }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || `save failed (${res.status})`);
      }
      setMode(nextMode);
      setHubUrl(normalizedHubUrl);
      setSavedConnection({
        mode: nextMode,
        hubUrl: normalizedHubUrl,
        executorUrls: normalizedExecutorUrls,
      });
      announce("Daemon connection saved.");
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "could not save daemon connection";
      setConnectionError(msg);
      announce(`Couldn't save daemon connection: ${msg}`, "assertive");
    } finally {
      setSavingConnection(false);
    }
  };

  const probeHub = async (candidate: string, saveWhenReachable: boolean) => {
    const url = candidate.trim();
    if (!url) {
      setConnectionError("Enter a Server hub URL.");
      return;
    }
    if (!isValidHubUrl(url)) {
      setConnectionError("Enter a full HTTP URL, such as http://server.tailnet:8787.");
      return;
    }
    setProbing(true);
    setConnectionError(null);
    try {
      const response = await fetch("/api/daemon/probe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const result = await response.json().catch(() => ({})) as Partial<DaemonProbe> & {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || result.ok === false || typeof result.reachable !== "boolean") {
        throw new Error(result.error || `probe failed (${response.status})`);
      }
      const nextProbe: DaemonProbe = {
        reachable: result.reachable,
        status: result.status ?? 0,
        latencyMs: result.latencyMs ?? 0,
        reason: result.reason,
        url,
      };
      setProbe(nextProbe);
      if (nextProbe.reachable && saveWhenReachable) await persistConnection("hub");
    } catch (error) {
      const message = error instanceof Error ? error.message : "could not probe Server hub";
      setConnectionError(message);
      announce(`Couldn't check the Server hub: ${message}`, "assertive");
    } finally {
      setProbing(false);
    }
  };

  const saveConnection = async (nextMode = mode) => {
    if (nextMode === "hub") {
      await probeHub(hubUrl, true);
      return;
    }
    await persistConnection(nextMode);
  };

  const chooseMode = (nextMode: MultiHostMode) => {
    setMode(nextMode);
    setConnectionError(null);
    setProbe(null);
  };

  const revertConnection = () => {
    if (!savedConnection) return;
    setMode(savedConnection.mode);
    setHubUrl(savedConnection.hubUrl);
    setExecutorText(savedConnection.executorUrls.join("\n"));
    setExecutorsOpen(savedConnection.executorUrls.length > 0);
    setConnectionError(null);
    setProbe(null);
    announce("Daemon connection changes reverted.");
  };

  const selectDevice = (device: TailscaleDevice) => {
    const host = device.tailnetIp || device.dnsName;
    if (!host) return;
    const url = `http://${host}:8787`;
    setMode("hub");
    setHubUrl(url);
    setProbe(null);
    void probeHub(url, false);
  };

  const startDaemon = async () => {
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch("/api/daemon/start", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || json?.stderr || "daemon did not start");
      }
      announce("Daemon started.");
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "daemon did not start";
      setStartError(message);
      announce(`Couldn't start the daemon: ${message}`, "assertive");
    } finally {
      setStarting(false);
    }
  };

  const restartDaemon = async () => {
    setRestarting(true);
    setStartError(null);
    try {
      const res = await fetch("/api/daemon/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restart: true }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || json?.stderr || "daemon did not restart");
      }
      announce("Daemon restarted.");
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "daemon did not restart";
      setStartError(message);
      announce(`Couldn't restart the daemon: ${message}`, "assertive");
    } finally {
      setRestarting(false);
    }
  };

  const setManualOffline = async (manualOffline: boolean) => {
    setSavingTravel(true);
    setTravelError(null);
    try {
      const res = await fetch("/api/travel/client", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ manualOffline }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || `travel mode save failed (${res.status})`);
      }
      announce(manualOffline ? "Daemon set to manual offline." : "Daemon back online.");
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "could not save travel mode";
      setTravelError(message);
      announce(`Couldn't update travel mode: ${message}`, "assertive");
    } finally {
      setSavingTravel(false);
    }
  };

  const copyInfoValue = async (key: "socket" | "workspace", label: string, value?: string) => {
    if (!value) return;
    const ok = await copyText(value);
    announce(ok ? `${label} copied.` : `Couldn't copy ${label.toLowerCase()}.`, ok ? "polite" : "assertive");
    if (!ok) return;
    setCopiedInfo(key);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopiedInfo(null), 1200);
  };

  const manualOffline = status?.travel?.manualOffline === true;
  const daemonOnline = status?.running === true && !manualOffline;
  const statusTone: StatusTone = loading
    ? "neutral"
    : restarting || starting || manualOffline
      ? "warning"
      : status?.running
        ? "success"
        : "danger";
  const stateLabel = loading
    ? "Checking…"
    : restarting
      ? "Restarting…"
      : starting
        ? "Starting…"
        : manualOffline
          ? "Offline (manual)"
          : status?.running
            ? "Running"
            : "Offline";
  const targetLabel = status?.target?.label || (mode === "hub" ? "server hub" : "local runtime");
  const queueCount = status?.travel?.pendingQueueCount ?? 0;
  const isAway = Boolean(status?.travel && status.travel.mode !== "home");
  const normalizedExecutorCount = parseExecutorUrls(executorText).length;
  const hubUrlValid = isValidHubUrl(hubUrl);
  const hubBadge = hubUrl.trim() ? (hubUrlValid ? "valid" : "check url") : "required";
  const hubBadgeTone = hubUrl.trim() ? (hubUrlValid ? "success" : "danger") : "neutral";

  const statusMetrics = useMemo(() => [
    {
      label: "AUTHORITY",
      value: status?.travel?.authority || (mode === "hub" ? "server hub" : "local daemon"),
      alert: false,
    },
    {
      label: "PENDING QUEUE",
      value: String(queueCount),
      alert: queueCount > 0,
    },
    {
      label: "LOCAL BIND",
      value: status?.travel?.localBindHost || "127.0.0.1",
      alert: false,
    },
    {
      label: "STALE CACHE",
      value: status?.travel?.staleCache ? "yes" : "no",
      alert: status?.travel?.staleCache === true,
    },
    {
      label: "WAKE LOCAL",
      value: status?.travel?.wakeLocalSubdaemon ? "requested" : "standby",
      alert: false,
    },
    {
      label: "HANDOFF",
      value: status?.travel?.handoffPending ? "pending sync" : "clear",
      alert: status?.travel?.handoffPending === true,
    },
  ], [mode, queueCount, status?.travel]);

  const infoRows: Array<{
    key: string;
    label: string;
    value: ReactNode;
    rawValue?: string;
    copyKey?: "socket" | "workspace";
  }> = [
    { key: "coven", label: "Coven version", value: status?.covenVersion ?? "—" },
    { key: "api", label: "API version", value: status?.apiVersion ?? "—" },
    {
      key: "socket",
      label: "Socket",
      value: status?.daemon?.socket ?? "—",
      rawValue: status?.daemon?.socket,
      copyKey: "socket",
    },
    {
      key: "workspace",
      label: "Workspace",
      value: status?.workspacePath ?? "—",
      rawValue: status?.workspacePath,
      copyKey: "workspace",
    },
    {
      key: "started",
      label: "Started",
      value: <RelativeTime iso={status?.daemon?.startedAt} fallback="—" />,
    },
  ];

  const tailscaleFailure = devicesError ? describeTailscaleFailure(devicesError) : null;

  return (
    <section className="settings-daemon" aria-labelledby="settings-daemon-title">
      <header className="settings-daemon-hero" data-tone={statusTone}>
        <span className="settings-daemon-hero-icon" aria-hidden="true">
          <Icon name="ph:terminal-window" width={20} />
        </span>
        <div className="settings-daemon-hero-copy">
          <p className="settings-daemon-kicker">Settings · Daemon</p>
          <h1 id="settings-daemon-title">Daemon</h1>
          <ul className="settings-daemon-chip-list" aria-label="Daemon summary">
            <li><span data-tone="accent" />{targetLabel}</li>
            <li><span />{status?.apiVersion || "coven.daemon.v1"}</li>
            <li><span data-tone={queueCount > 0 ? "warning" : "neutral"} />{queueCount} queued</li>
            <li>
              <span data-tone={daemonOnline ? "success" : "neutral"} />
              up <RelativeTime iso={status?.daemon?.startedAt} fallback="—" />
            </li>
          </ul>
        </div>
        <div className="settings-daemon-hero-actions">
          <Button
            variant="secondary"
            size="sm"
            leadingIcon="ph:arrows-clockwise"
            loading={loading}
            onClick={() => void refresh(true)}
          >
            Refresh
          </Button>
          {!loading && !status?.running && mode === "local" && (
            <Button
              variant="primary"
              size="sm"
              leadingIcon="ph:rocket-launch-bold"
              loading={starting}
              onClick={() => void startDaemon()}
            >
              Start daemon
            </Button>
          )}
          {status?.running && (
            <Button
              variant="secondary"
              size="sm"
              leadingIcon="ph:arrow-clockwise"
              loading={restarting}
              onClick={() => void restartDaemon()}
            >
              Restart daemon
            </Button>
          )}
        </div>
      </header>

      <section className="settings-daemon-section" aria-labelledby="settings-daemon-status-heading">
        <SectionRule
          id="settings-daemon-status-heading"
          label="STATUS"
          meta={status?.checkedAt ? <>checked <RelativeTime iso={status.checkedAt} fallback="just now" /></> : "not checked"}
        />
        <div className="settings-daemon-status-card" data-tone={statusTone}>
          <div className="settings-daemon-status-strip">
            <span className="settings-daemon-state-dot" aria-hidden="true" />
            <span className="settings-daemon-state-label">{stateLabel}</span>
            {daemonOnline && !restarting ? (
              <span className="settings-daemon-pulse" aria-hidden="true">
                <span /><span /><span /><span />
              </span>
            ) : null}
            <span className="settings-daemon-pid">
              {status?.daemon?.pid ? `pid ${status.daemon.pid}` : "no process"}
            </span>
            <div className="settings-daemon-status-spacer" />
            <div className="settings-daemon-travel" aria-label={`Travel mode: ${isAway ? "away" : "home"}`}>
              <span className="settings-daemon-travel-label">TRAVEL</span>
              <span className="settings-daemon-travel-segments" aria-hidden="true">
                <span data-active={!isAway}>HOME</span>
                <span data-active={isAway}>AWAY</span>
              </span>
            </div>
            {status?.travel ? (
              <Button
                variant={manualOffline ? "secondary" : "ghost"}
                size="xs"
                className="settings-daemon-offline-action"
                loading={savingTravel}
                onClick={() => void setManualOffline(!manualOffline)}
              >
                {manualOffline ? "Back online" : "Manual offline"}
              </Button>
            ) : null}
          </div>

          <div className="settings-daemon-status-grid">
            {statusMetrics.map((metric) => (
              <div key={metric.label} className="settings-daemon-metric" data-alert={metric.alert || undefined}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </div>
            ))}
          </div>

          {mode === "hub" && (status?.executors?.length ?? 0) > 0 ? (
            <div className="settings-daemon-executor-health">
              <div className="settings-daemon-subhead">
                <Icon name="ph:terminal-window" width={12} aria-hidden />
                Executor nodes
              </div>
              {status?.executors?.map((executor) => (
                <div key={executor.url} className="settings-daemon-executor-row" data-online={executor.ok}>
                  <span className="settings-daemon-executor-dot" aria-hidden="true" />
                  <code>{executor.url}</code>
                  <span>{executor.detail}</span>
                </div>
              ))}
            </div>
          ) : null}

          {status?.target?.mode === "hub" && !loading && !status.running ? (
            <p className="settings-daemon-inline-error" role="alert">
              Configured but unreachable · {status.target.url}{status.reason ? ` · ${status.reason}` : ""}
            </p>
          ) : null}
          {startError ? <p className="settings-daemon-inline-error" role="alert">{startError}</p> : null}
          {travelError ? <p className="settings-daemon-inline-error" role="alert">{travelError}</p> : null}
        </div>
        {statusLoadError ? (
          <ErrorState
            compact
            headline="Daemon status unavailable"
            subtitle={statusLoadError}
            actions={<Button size="xs" variant="secondary" onClick={() => void refresh(true)}>Retry</Button>}
          />
        ) : null}
      </section>

      <section className="settings-daemon-section" aria-labelledby="settings-daemon-connection-heading">
        <SectionRule
          id="settings-daemon-connection-heading"
          label="CONNECTION"
          meta={
            <span data-dirty={connectionDirty || undefined}>
              {savedConnection === null ? "loading…" : connectionDirty ? "unsaved changes" : "saved"}
            </span>
          }
        />
        <div className="settings-daemon-connection-card">
          <div className="settings-daemon-card-rule">
            RUNTIME TARGET
          </div>
          <div className="settings-daemon-target-grid">
            {RUNTIME_TARGETS.map((target) => (
              <button
                key={target.id}
                type="button"
                className="settings-daemon-target focus-ring"
                data-selected={mode === target.id || undefined}
                aria-pressed={mode === target.id}
                onClick={() => chooseMode(target.id)}
              >
                <span className="settings-daemon-target-title">
                  <span className="settings-daemon-target-icon" aria-hidden="true">
                    <Icon name={target.icon} width={14} />
                  </span>
                  <strong>{target.label}</strong>
                  {mode === target.id ? (
                    <span className="settings-daemon-target-check" aria-hidden="true">
                      <Icon name="ph:check" width={10} />
                    </span>
                  ) : null}
                </span>
                <span>{target.blurb}</span>
              </button>
            ))}
          </div>

          {mode === "hub" ? (
            <>
              <div className="settings-daemon-field-row">
                <div className="settings-daemon-field-copy">
                  <label htmlFor="settings-daemon-hub-url">Server hub URL</label>
                  <span id="settings-daemon-hub-hint">HTTP endpoint on your private network</span>
                </div>
                <div className="settings-daemon-field-control">
                  <TextInput
                    id="settings-daemon-hub-url"
                    value={hubUrl}
                    onChange={(event) => {
                      setHubUrl(event.target.value);
                      setProbe(null);
                      setConnectionError(null);
                    }}
                    aria-label="Server hub URL"
                    aria-describedby="settings-daemon-hub-hint"
                    placeholder="http://server.tailnet:8787"
                    spellCheck={false}
                  />
                  <span className="settings-daemon-field-badge" data-tone={hubBadgeTone}>{hubBadge}</span>
                </div>
                {probing || probe?.url === hubUrl.trim() ? (
                  <p className="settings-daemon-probe" data-tone={probe?.reachable ? "success" : probe ? "danger" : "neutral"} role="status">
                    {probing
                      ? "Checking reachability…"
                      : probe?.reachable
                        ? `Reachable · ${probe.latencyMs} ms`
                        : `Unreachable${probe?.reason ? ` · ${probe.reason}` : ""}`}
                  </p>
                ) : null}
              </div>

              <div className="settings-daemon-tailnet">
                <div className="settings-daemon-tailnet-heading">
                  <div>
                    <strong>Tailnet devices</strong>
                    <span>Choose a private-network machine or enter its address above.</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="xs"
                    leadingIcon="ph:arrows-clockwise"
                    loading={devicesLoading}
                    onClick={loadDevices}
                  >
                    Refresh devices
                  </Button>
                </div>
                {tailscaleFailure ? (
                  <div className="settings-daemon-tailnet-error" role="status">
                    <strong>{tailscaleFailure.headline}</strong>
                    <span>{tailscaleFailure.hint}</span>
                  </div>
                ) : null}
                {!tailscaleFailure && !devicesLoading && devices.length === 0 ? (
                  <p className="settings-daemon-empty">No tailnet devices found.</p>
                ) : null}
                {devices.length > 0 ? (
                  <div className="settings-daemon-device-list">
                    {devices.map((device) => {
                      const selectable = Boolean(device.tailnetIp || device.dnsName);
                      return (
                        <button
                          key={`${device.isSelf ? "self" : "peer"}:${device.dnsName || device.name}`}
                          type="button"
                          className="settings-daemon-device focus-ring"
                          onClick={() => selectDevice(device)}
                          disabled={!selectable}
                        >
                          <span className="settings-daemon-device-dot" data-online={device.online} aria-hidden="true" />
                          <span>
                            <strong>{device.name}{device.isSelf ? " · This device" : ""}</strong>
                            <code>
                              {device.tailnetIp || device.dnsName || "No hub address"}
                              {device.os ? ` · ${device.os}` : ""}
                            </code>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </>
          ) : null}

          <div className="settings-daemon-executor-disclosure">
            <button
              type="button"
              className="settings-daemon-disclosure-trigger focus-ring"
              aria-expanded={executorsOpen}
              aria-controls="settings-daemon-executor-fields"
              onClick={() => setExecutorsOpen((open) => !open)}
            >
              <span className="settings-daemon-disclosure-icon" aria-hidden="true">
                <Icon name={executorsOpen ? "ph:caret-up" : "ph:caret-down"} width={11} />
              </span>
              <strong>Executor addresses</strong>
              <code>{normalizedExecutorCount ? `${normalizedExecutorCount} ${normalizedExecutorCount === 1 ? "address" : "addresses"}` : "none"}</code>
              <span>optional · multi-machine setups</span>
            </button>
            {executorsOpen ? (
              <div id="settings-daemon-executor-fields">
                <TextArea
                  value={executorText}
                  onChange={(event) => setExecutorText(event.target.value)}
                  aria-label="Executor addresses, one per line"
                  placeholder={"executor-1.tailnet:8787\nexecutor-2.tailnet:8787"}
                  disabled={mode !== "hub"}
                  rows={3}
                  spellCheck={false}
                />
                {mode !== "hub" ? <p>Executor addresses apply only to Server hub connections.</p> : null}
              </div>
            ) : null}
          </div>

          <div className="settings-daemon-connection-actions">
            <div className="settings-daemon-connection-summary">
              {connectionError ? <span role="alert">{connectionError}</span> : (
                connectionDirty
                  ? "Saving restarts the daemon connection — sessions in flight are handed off first."
                  : mode === "hub"
                    ? "Routing through the server hub."
                    : "Running against the local daemon socket."
              )}
            </div>
            {mode === "hub" && probe?.url === hubUrl.trim() && !probe.reachable ? (
              <Button
                variant="ghost"
                size="sm"
                leadingIcon="ph:warning"
                loading={savingConnection}
                onClick={() => void persistConnection("hub")}
              >
                Save anyway
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              disabled={!connectionDirty || savingConnection}
              onClick={revertConnection}
            >
              Revert
            </Button>
            <Button
              variant="primary"
              size="sm"
              leadingIcon="ph:check"
              disabled={!connectionDirty || savingConnection || probing}
              loading={savingConnection || probing}
              onClick={() => void saveConnection()}
            >
              Save connection
            </Button>
          </div>
        </div>
      </section>

      {omnigentSettings}

      <AutomationSection />

      <section className="settings-daemon-section settings-daemon-info-section" aria-labelledby="settings-daemon-info-heading">
        <SectionRule id="settings-daemon-info-heading" label="INFO" />
        <div className="settings-daemon-info">
          {infoRows.map((row) => (
            <div className="settings-daemon-info-row" key={row.key}>
              <span>{row.label}</span>
              <code>{row.value}</code>
              {row.copyKey ? (
                <IconButton
                  size="xs"
                  icon={copiedInfo === row.copyKey ? "ph:check" : "ph:copy"}
                  aria-label={`Copy ${row.label.toLowerCase()}`}
                  disabled={!row.rawValue}
                  onClick={() => void copyInfoValue(row.copyKey!, row.label, row.rawValue)}
                />
              ) : null}
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}
