"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import type { IconName } from "@/lib/icon";

type PruneState = { idle: true } | { counting: true } | { count: number } | { pruning: true } | { pruned: number } | { error: string };
type Step = { ok: boolean; detail?: string; hint?: string };
type PlatformId = "windows" | "linux" | "mac" | "unknown";

type OnboardingStatus = {
  complete: boolean;
  steps: {
    covenCli: Step;
    covenHome: Step;
    adapters: Step;
    daemon: Step;
    familiars: Step;
    binding: Step;
  };
};

type HarnessReport = {
  id: string;
  label: string;
  binary: string;
  chatSupported: boolean;
  installed: boolean;
  path: string | null;
  version: string | null;
  installHint: string;
  source: string;
  manifestPath: string | null;
};

type OpenClawAgent = {
  id: string;
  displayName: string;
  role: string;
  workspacePath: string | null;
};

const PLATFORM_COPY: Record<PlatformId, {
  label: string;
  installCommand: string;
  caveInstall: string[];
  cliInstall: string[];
  warning?: string;
}> = {
  windows: {
    label: "Windows",
    installCommand: "where coven",
    warning: "For now, turn off Smart App Control before downloading or opening the Windows build.",
    caveInstall: [
      "Download the MSI from the official GitHub Release.",
      "Before downloading/opening, go to Settings > Privacy & security > Windows Security > App & browser control > Smart App Control, then turn Smart App Control off for now.",
      "Install CovenCave, then open it from Start.",
    ],
    cliInstall: [
      "Install the coven CLI from OpenCoven/coven.",
      "Make sure coven.exe is on PATH.",
      "Click Re-check here after a new terminal can run coven.",
    ],
  },
  linux: {
    label: "Linux",
    installCommand: "chmod +x CovenCave_*.AppImage && ./CovenCave_*.AppImage",
    caveInstall: [
      "Download the AppImage from the official GitHub Release.",
      "Run chmod +x CovenCave_*.AppImage.",
      "Launch the AppImage from your file manager or terminal.",
    ],
    cliInstall: [
      "Install the coven CLI from OpenCoven/coven.",
      "Make sure coven is executable and on PATH.",
      "If your desktop shell has an older PATH, restart Cave after installing the CLI.",
    ],
  },
  mac: {
    label: "macOS",
    installCommand: "brew install opencoven/tap/coven",
    caveInstall: [
      "Download the DMG from the official GitHub Release.",
      "Open the DMG and drag CovenCave to Applications.",
      "Open CovenCave from Applications.",
    ],
    cliInstall: [
      "Install the coven CLI with Homebrew.",
      "Make sure a terminal can run coven.",
      "Click Re-check here after install.",
    ],
  },
  unknown: {
    label: "Your platform",
    installCommand: "coven --version",
    caveInstall: [
      "Download the matching asset from the official GitHub Release.",
      "Install or launch the app for your OS.",
      "Open CovenCave and continue setup here.",
    ],
    cliInstall: [
      "Install the coven CLI from OpenCoven/coven.",
      "Make sure coven is on PATH.",
      "Click Re-check here after install.",
    ],
  },
};

type Props = {
  open: boolean;
  onDismiss: () => void;
};

function detectPlatform(): PlatformId {
  if (typeof navigator === "undefined") return "unknown";
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const raw = `${nav.userAgentData?.platform ?? navigator.platform ?? navigator.userAgent}`.toLowerCase();
  if (raw.includes("win")) return "windows";
  if (raw.includes("linux")) return "linux";
  if (raw.includes("mac")) return "mac";
  return "unknown";
}

function stepCount(status: OnboardingStatus | null): number {
  return Object.values(status?.steps ?? {}).filter((s) => s.ok).length;
}

export function OnboardingOverlay({ open, onDismiss }: Props) {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [platform, setPlatform] = useState<PlatformId>("unknown");
  const [picking, setPicking] = useState<string | null>(null);
  const [startingDaemon, setStartingDaemon] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [familiarName, setFamiliarName] = useState("");
  const [familiarRole, setFamiliarRole] = useState("Familiar");
  const [familiarDescription, setFamiliarDescription] = useState("");
  const [familiarGlyph, setFamiliarGlyph] = useState("ph:sparkle-fill");
  const [openclawAgents, setOpenclawAgents] = useState<OpenClawAgent[]>([]);
  const [harnesses, setHarnesses] = useState<HarnessReport[]>([]);
  const [selectedHarnessId, setSelectedHarnessId] = useState<string | null>(null);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [prune, setPrune] = useState<PruneState>({ idle: true });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/onboarding/status", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as OnboardingStatus & { ok: boolean };
      setStatus(json);
    } catch {
      /* ignore; the next poll will retry */
    }
  }, []);

  useEffect(() => setPlatform(detectPlatform()), []);

  const loadOpenClawAgents = useCallback(async () => {
    setAgentsLoading(true);
    setAgentsError(null);
    try {
      const res = await fetch("/api/openclaw-agents", { cache: "no-store" });
      const json = await res.json() as { ok?: boolean; agents?: OpenClawAgent[]; error?: string };
      if (!res.ok || json.ok === false) throw new Error(json.error ?? "failed to load OpenClaw agents");
      const agents = json.agents ?? [];
      setOpenclawAgents(agents);
      setSelectedAgentId((current) => {
        if (current || !agents[0]) return current;
        setFamiliarName(agents[0].displayName);
        setFamiliarRole(agents[0].role);
        setFamiliarDescription(`Connected to OpenClaw agent "${agents[0].id}".`);
        return agents[0].id;
      });
    } catch (err) {
      setAgentsError(err instanceof Error ? err.message : "failed to load OpenClaw agents");
    } finally {
      setAgentsLoading(false);
    }
  }, []);

  const loadHarnesses = useCallback(async () => {
    try {
      const res = await fetch("/api/harnesses", { cache: "no-store" });
      const json = await res.json() as { ok?: boolean; harnesses?: HarnessReport[] };
      if (!res.ok || json.ok === false) return;
      const next = json.harnesses ?? [];
      setHarnesses(next);
      setSelectedHarnessId((current) => {
        if (current && next.some((adapter) => adapter.id === current && adapter.installed)) return current;
        return next.find((adapter) => adapter.installed && adapter.chatSupported)?.id
          ?? next.find((adapter) => adapter.installed)?.id
          ?? current;
      });
    } catch {
      /* harness availability is advisory; status cards carry setup hints */
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
    void loadHarnesses();
    void loadOpenClawAgents();
    pollRef.current = setInterval(refresh, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [open, refresh, loadHarnesses, loadOpenClawAgents]);

  useEffect(() => {
    if (!open || !status?.complete) return;
    const t = setTimeout(onDismiss, 1200);
    return () => clearTimeout(t);
  }, [open, status?.complete, onDismiss]);

  const platformCopy = PLATFORM_COPY[platform];

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard may be blocked */
    }
  };

  const scaffoldOnly = async () => {
    setPicking("scaffold");
    setSetupError(null);
    try {
      const res = await fetch("/api/onboarding/setup", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) throw new Error(json.error ?? "setup failed");
      await refresh();
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : "setup failed");
    } finally {
      setPicking(null);
    }
  };

  const createFamiliar = async () => {
    const selectedAgent = openclawAgents.find((agent) => agent.id === selectedAgentId) ?? null;
    if (!selectedAgent) {
      setSetupError("Pick an OpenClaw agent to connect first.");
      return;
    }
    setPicking("familiar");
    setSetupError(null);
    try {
      const res = await fetch("/api/onboarding/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          familiar: {
            id: selectedAgent.id,
            displayName: familiarName,
            role: familiarRole,
            description: familiarDescription,
            glyph: familiarGlyph,
            openclawAgentId: selectedAgent.id,
          },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) throw new Error(json.error ?? "setup failed");
      await refresh();
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : "setup failed");
    } finally {
      setPicking(null);
    }
  };

  const createLocalFamiliar = async () => {
    const selectedHarness = harnesses.find((adapter) => adapter.id === selectedHarnessId && adapter.installed) ?? null;
    if (!selectedHarness) {
      setSetupError("Pick an installed local adapter first.");
      return;
    }
    setPicking("local");
    setSetupError(null);
    try {
      const res = await fetch("/api/onboarding/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          familiar: {
            id: `${selectedHarness.id}-local`,
            displayName: familiarName.trim() || selectedHarness.label,
            role: familiarRole.trim() || "Code Familiar",
            description: familiarDescription.trim() || `Local ${selectedHarness.label} adapter on this machine.`,
            glyph: familiarGlyph,
            harness: selectedHarness.id,
            model: `${selectedHarness.id}-local`,
          },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) throw new Error(json.error ?? "setup failed");
      await refresh();
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : "setup failed");
    } finally {
      setPicking(null);
    }
  };

  const startDaemon = async () => {
    setStartingDaemon(true);
    setSetupError(null);
    try {
      const res = await fetch("/api/daemon/start", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) throw new Error(json.error ?? "daemon start failed");
      await refresh();
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : "daemon start failed");
    } finally {
      setStartingDaemon(false);
    }
  };

  const steps = useMemo(() => {
    const s = status?.steps;
    return [
      {
        key: "covenCli",
        title: "Install coven CLI",
        ok: !!s?.covenCli.ok,
        detail: s?.covenCli.detail ?? s?.covenCli.hint ?? "checking...",
        icon: "ph:gear-six",
      },
      {
        key: "covenHome",
        title: "Create Coven home",
        ok: !!s?.covenHome.ok,
        detail: s?.covenHome.detail ?? s?.covenHome.hint ?? "checking...",
        icon: "ph:folder",
      },
      {
        key: "adapters",
        title: "Find local adapter",
        ok: !!s?.adapters.ok,
        detail: s?.adapters.detail ?? s?.adapters.hint ?? "checking...",
        icon: "ph:terminal-window",
      },
      {
        key: "binding",
        title: "Create familiar",
        ok: !!s?.binding.ok,
        detail: s?.binding.detail ?? s?.binding.hint ?? "checking...",
        icon: "ph:sparkle",
      },
      {
        key: "daemon",
        title: "Start daemon",
        ok: !!s?.daemon.ok,
        detail: s?.daemon.detail ?? s?.daemon.hint ?? "checking...",
        icon: "ph:plug",
      },
      {
        key: "familiars",
        title: "Load familiars",
        ok: !!s?.familiars.ok,
        detail: s?.familiars.detail ?? s?.familiars.hint ?? "checking...",
        icon: "ph:user",
      },
    ] satisfies Array<{ key: string; title: string; ok: boolean; detail: string; icon: IconName }>;
  }, [status]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[var(--bg-base)]/96 backdrop-blur-sm">
      <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-[var(--border-hairline)] pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wider text-purple-300/80">
              <span>Welcome</span>
              <span className="rounded-full border border-[var(--border-hairline)] px-2 py-0.5 normal-case tracking-normal text-[var(--text-secondary)]">
                {platformCopy.label}
              </span>
              {process.env.NEXT_PUBLIC_DEMO === "true" ? (
                <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 normal-case tracking-normal text-amber-200">
                  Demo mode
                </span>
              ) : null}
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-[var(--text-primary)] sm:text-3xl">
              Set up CovenCave on this machine.
            </h1>
            <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[var(--text-secondary)]">
              Cave checks your local runtime, creates only your Coven files, and helps you add a first familiar that belongs to you.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => void refresh()}
              className="inline-flex items-center gap-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-2 text-[12px] text-[var(--text-primary)] hover:border-[var(--border-strong)]"
            >
              <Icon name="ph:arrows-clockwise-bold" />
              Re-check
            </button>
            <div className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-2 text-[12px] text-[var(--text-secondary)]">
              {stepCount(status)}/6 ready
            </div>
          </div>
        </header>

        {platformCopy.warning ? (
          <section className="mt-5 rounded-lg border border-amber-500/50 bg-amber-500/12 p-4 text-[13px] text-amber-100">
            <div className="flex items-start gap-3">
              <Icon name="ph:warning-fill" width={18} className="mt-0.5 shrink-0 text-amber-200" />
              <div>
                <div className="font-semibold">Windows download notice</div>
                <p className="mt-1 leading-6">{platformCopy.warning}</p>
              </div>
            </div>
          </section>
        ) : null}

        {setupError ? (
          <section className="mt-5 rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-[13px] text-rose-200">
            {setupError}
          </section>
        ) : null}

        <main className="grid flex-1 gap-5 py-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <section className="space-y-4">
            <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/35 p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">Platform path</h2>
                <button
                  onClick={() => void copyText(platformCopy.installCommand)}
                  className="rounded border border-[var(--border-hairline)] px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
                >
                  Copy command
                </button>
              </div>
              <div className="mt-3 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 font-mono text-[12px] text-[var(--text-primary)]">
                {platformCopy.installCommand}
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                <InstructionList title="Install CovenCave" items={platformCopy.caveInstall} />
                <InstructionList title="Install coven CLI" items={platformCopy.cliInstall} />
              </div>
            </div>

            <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/25 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">Tester demo mode</h2>
                  <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">
                    Demo data is opt-in for testers and never appears in normal installs.
                  </p>
                </div>
                <Icon name="ph:toggle-right-bold" className="text-[var(--text-muted)]" />
              </div>
              <div className="mt-3 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 font-mono text-[12px] text-[var(--text-primary)]">
                NEXT_PUBLIC_DEMO=true pnpm dev
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {steps.map((s, i) => (
                <div
                  key={s.key}
                  className={`rounded-lg border p-3 ${
                    s.ok ? "border-emerald-700/50 bg-emerald-950/20" : "border-[var(--border-hairline)] bg-[var(--bg-raised)]/30"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`grid h-7 w-7 place-items-center rounded-full border ${
                        s.ok
                          ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-200"
                          : "border-[var(--border-strong)] text-[var(--text-secondary)]"
                      }`}
                    >
                      {s.ok ? <Icon name="ph:check-bold" /> : <Icon name={s.icon} />}
                    </span>
                    <span className="font-mono text-[11px] text-[var(--text-muted)]">{i + 1}</span>
                  </div>
                  <div className="mt-3 text-[12px] font-medium text-[var(--text-primary)]">{s.title}</div>
                  <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-[var(--text-muted)]">{s.detail}</div>
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/35 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">Create a local familiar</h2>
                  <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">
                    Use Codex, Claude Code, or any detected Coven adapter already installed on this machine.
                  </p>
                </div>
                <button
                  onClick={scaffoldOnly}
                  disabled={picking !== null}
                  className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 text-[12px] text-[var(--text-primary)] hover:border-[var(--border-strong)] disabled:opacity-50"
                >
                  {picking === "scaffold" ? "Creating..." : "Create folder only"}
                </button>
              </div>

              <div className="mt-4 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-base)]/45 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                    Local adapters
                  </div>
                  <button
                    onClick={() => void loadHarnesses()}
                    className="rounded border border-[var(--border-hairline)] px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
                  >
                    Refresh
                  </button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {harnesses.map((adapter) => {
                    const active = selectedHarnessId === adapter.id;
                    return (
                      <button
                        key={adapter.id}
                        onClick={() => {
                          if (!adapter.installed) return;
                          setSelectedHarnessId(adapter.id);
                          setFamiliarName(adapter.label);
                          setFamiliarRole("Code Familiar");
                          setFamiliarDescription(`Local ${adapter.label} adapter on this machine.`);
                        }}
                        disabled={!adapter.installed}
                        className={`rounded-lg border p-3 text-left ${
                          active
                            ? "border-purple-500/55 bg-purple-500/12 text-[var(--text-primary)]"
                            : adapter.installed
                              ? "border-[var(--border-hairline)] bg-[var(--bg-raised)]/35 text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
                              : "border-[var(--border-hairline)] bg-[var(--bg-base)]/40 text-[var(--text-muted)] opacity-70"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[13px] font-medium">{adapter.label}</span>
                          {active ? <Icon name="ph:check-bold" className="text-purple-200" /> : null}
                        </div>
                        <div className="mt-1 truncate font-mono text-[11px]">{adapter.binary}</div>
                        <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-[var(--text-muted)]">
                          {adapter.installed ? adapter.path ?? "installed" : adapter.installHint}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={createLocalFamiliar}
                  disabled={picking !== null || !selectedHarnessId}
                  className="mt-3 inline-flex items-center gap-2 rounded-md bg-purple-600 px-4 py-2 text-[13px] font-medium text-white hover:bg-purple-500 disabled:opacity-50"
                >
                  <Icon name="ph:terminal-window" />
                  {picking === "local" ? "Creating..." : "Use local adapter"}
                </button>
              </div>

              <div className="mt-5 border-t border-[var(--border-hairline)] pt-4">
                <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Or connect an OpenClaw agent</h3>
                <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">
                  Choose one of your local OpenClaw agents. Cave writes only the selected agent as a familiar in `~/.coven/familiars.toml`.
                </p>
              </div>

              <div className="mt-4 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-base)]/45 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                    Local OpenClaw agents
                  </div>
                  <button
                    onClick={() => void loadOpenClawAgents()}
                    disabled={agentsLoading}
                    className="rounded border border-[var(--border-hairline)] px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
                  >
                    {agentsLoading ? "Loading..." : "Refresh"}
                  </button>
                </div>
                {agentsError ? (
                  <div className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-200">
                    {agentsError}
                  </div>
                ) : openclawAgents.length === 0 ? (
                  <div className="rounded border border-dashed border-[var(--border-hairline)] px-3 py-5 text-center text-[12px] text-[var(--text-muted)]">
                    No OpenClaw agents found under ~/.openclaw/agents yet.
                  </div>
                ) : (
                  <div className="grid max-h-56 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                    {openclawAgents.map((agent) => {
                      const active = selectedAgentId === agent.id;
                      return (
                        <button
                          key={agent.id}
                          onClick={() => {
                            setSelectedAgentId(agent.id);
                            setFamiliarName(agent.displayName);
                            setFamiliarRole(agent.role);
                            setFamiliarDescription(`Connected to OpenClaw agent "${agent.id}".`);
                          }}
                          className={`rounded-lg border p-3 text-left ${
                            active
                              ? "border-purple-500/55 bg-purple-500/12 text-[var(--text-primary)]"
                              : "border-[var(--border-hairline)] bg-[var(--bg-raised)]/35 text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-[13px] font-medium">{agent.displayName}</span>
                            {active ? <Icon name="ph:check-bold" className="text-purple-200" /> : null}
                          </div>
                          <div className="mt-1 truncate font-mono text-[11px]">{agent.id}</div>
                          <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-[var(--text-muted)]">{agent.role}</div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Name</span>
                  <input
                    value={familiarName}
                    onChange={(e) => setFamiliarName(e.target.value)}
                    placeholder="Example: Riley"
                    className="mt-1 w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)]"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Role</span>
                  <input
                    value={familiarRole}
                    onChange={(e) => setFamiliarRole(e.target.value)}
                    placeholder="Research, Code, Ops..."
                    className="mt-1 w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)]"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Glyph</span>
                  <input
                    value={familiarGlyph}
                    onChange={(e) => setFamiliarGlyph(e.target.value)}
                    placeholder="ph:sparkle-fill"
                    className="mt-1 w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 font-mono text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)]"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Description</span>
                  <input
                    value={familiarDescription}
                    onChange={(e) => setFamiliarDescription(e.target.value)}
                    placeholder="What should this familiar help with?"
                    className="mt-1 w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)]"
                  />
                </label>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <button
                  onClick={createFamiliar}
                  disabled={picking !== null || !selectedAgentId || familiarName.trim().length === 0}
                  className="inline-flex items-center gap-2 rounded-md bg-purple-600 px-4 py-2 text-[13px] font-medium text-white hover:bg-purple-500 disabled:opacity-50"
                >
                  <Icon name="ph:sparkle" />
                  {picking === "familiar" ? "Connecting..." : "Connect as familiar"}
                </button>
                <button
                  onClick={startDaemon}
                  disabled={startingDaemon || !status?.steps.covenCli.ok}
                  className="inline-flex items-center gap-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-4 py-2 text-[13px] text-[var(--text-primary)] hover:border-[var(--border-strong)] disabled:opacity-50"
                  title={!status?.steps.covenCli.ok ? "Install coven CLI first" : "coven daemon start"}
                >
                  <Icon name="ph:rocket-launch-bold" />
                  {startingDaemon ? "Starting..." : "Start daemon"}
                </button>
              </div>
            </div>

            <MaintenancePanel prune={prune} setPrune={setPrune} />
          </section>
        </main>

        <footer className="flex items-center justify-between border-t border-[var(--border-hairline)] py-4">
          <button
            onClick={() => {
              try {
                localStorage.setItem("cave:onboarding:dismissed", "1");
              } catch {
                /* private mode */
              }
              onDismiss();
            }}
            className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          >
            Skip for now
          </button>
          {status?.complete ? (
            <button
              onClick={onDismiss}
              className="rounded-md bg-emerald-500/90 px-4 py-2 text-[13px] font-medium text-white hover:bg-emerald-400"
            >
              Open Cave
            </button>
          ) : (
            <span className="text-[11px] text-[var(--text-muted)]">
              Status refreshes automatically every 2 seconds.
            </span>
          )}
        </footer>
      </div>
    </div>
  );
}

function InstructionList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="text-[12px] font-semibold text-[var(--text-primary)]">{title}</h3>
      <ol className="mt-2 space-y-2">
        {items.map((item, index) => (
          <li key={item} className="flex gap-2 text-[12px] leading-5 text-[var(--text-secondary)]">
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-[var(--border-hairline)] text-[10px] text-[var(--text-muted)]">
              {index + 1}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function MaintenancePanel({
  prune,
  setPrune,
}: {
  prune: PruneState;
  setPrune: (next: PruneState) => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/25 p-4">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
        Maintenance
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-[var(--text-secondary)]">
          {"idle" in prune ? (
            "Prune stale sessions: completed, failed, or killed sessions older than 24 hours."
          ) : "counting" in prune ? (
            "Counting stale sessions..."
          ) : "count" in prune ? (
            `Found ${prune.count} stale session${prune.count === 1 ? "" : "s"}. Confirm to delete.`
          ) : "pruning" in prune ? (
            "Pruning..."
          ) : "pruned" in prune ? (
            `Done. ${prune.pruned} session${prune.pruned === 1 ? "" : "s"} removed.`
          ) : "error" in prune ? (
            <span className="text-rose-300">{prune.error}</span>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2">
          {"idle" in prune || "pruned" in prune || "error" in prune ? (
            <button
              onClick={async () => {
                setPrune({ counting: true });
                try {
                  const res = await fetch("/api/sessions/prune", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ dryRun: true }),
                  });
                  const json = await res.json() as { ok: boolean; wouldPrune?: number; error?: string };
                  setPrune(json.ok ? { count: json.wouldPrune ?? 0 } : { error: json.error ?? "dry-run failed" });
                } catch (err) {
                  setPrune({ error: err instanceof Error ? err.message : "fetch failed" });
                }
              }}
              className="rounded border border-[var(--border-strong)] bg-[var(--bg-raised)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
            >
              Check
            </button>
          ) : null}
          {"count" in prune ? (
            <>
              <button
                onClick={() => setPrune({ idle: true })}
                className="rounded border border-[var(--border-strong)] bg-[var(--bg-raised)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
              >
                Cancel
              </button>
              {prune.count > 0 ? (
                <button
                  onClick={async () => {
                    setPrune({ pruning: true });
                    try {
                      const res = await fetch("/api/sessions/prune", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ dryRun: false }),
                      });
                      const json = await res.json() as { ok: boolean; pruned?: number; error?: string };
                      setPrune(json.ok ? { pruned: json.pruned ?? 0 } : { error: json.error ?? "prune failed" });
                    } catch (err) {
                      setPrune({ error: err instanceof Error ? err.message : "fetch failed" });
                    }
                  }}
                  className="rounded bg-rose-600/80 px-2.5 py-1 text-[11px] text-white hover:bg-rose-500"
                >
                  Delete {prune.count}
                </button>
              ) : (
                <span className="text-[11px] text-[var(--text-muted)]">Nothing to prune.</span>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
