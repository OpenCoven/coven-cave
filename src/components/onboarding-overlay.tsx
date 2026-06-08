"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import type { IconName } from "@/lib/icon";
import { useFocusTrap } from "@/lib/use-focus-trap";

type PruneState =
  | { idle: true }
  | { counting: true }
  | { count: number }
  | { pruning: true }
  | { pruned: number }
  | { error: string };
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

const PLATFORM_COPY: Record<
  PlatformId,
  {
    label: string;
    installCommand: string;
    caveInstall: string[];
    cliInstall: string[];
    warning?: string;
  }
> = {
  windows: {
    label: "Windows",
    installCommand: "where coven",
    warning:
      "For now, turn off Smart App Control before downloading or opening the Windows build.",
    caveInstall: [
      "Download the MSI from the official GitHub Release.",
      "Before downloading/opening, go to Settings > Privacy & security > Windows Security > App & browser control > Smart App Control, then turn Smart App Control off for now.",
      "Install CovenCave, then open it from Start.",
    ],
    cliInstall: [
      "Install the coven CLI from OpenCoven/coven or use the bundled CLI when available.",
      "Make sure coven.exe is on PATH if you installed it separately.",
      "Click Re-check after Windows can run coven from a new terminal.",
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
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const raw =
    `${nav.userAgentData?.platform ?? navigator.platform ?? navigator.userAgent}`.toLowerCase();
  if (raw.includes("win")) return "windows";
  if (raw.includes("linux")) return "linux";
  if (raw.includes("mac")) return "mac";
  return "unknown";
}

function stepCount(status: OnboardingStatus | null): number {
  return Object.values(status?.steps ?? {}).filter((s) => s.ok).length;
}

const BENTO_CARD =
  "rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/35 p-4";
const BENTO_CARD_SOFT =
  "rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/25 p-4";

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
  const [selectedHarnessId, setSelectedHarnessId] = useState<string | null>(
    null,
  );
  const [confirmCreateNewFamiliar, setConfirmCreateNewFamiliar] =
    useState(false);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [prune, setPrune] = useState<PruneState>({ idle: true });
  const [statusFailures, setStatusFailures] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useFocusTrap(open, dialogRef, { onEscape: onDismiss });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/onboarding/status", { cache: "no-store" });
      if (!res.ok) {
        setStatusFailures((n) => n + 1);
        return;
      }
      const json = (await res.json()) as OnboardingStatus & { ok: boolean };
      setStatus(json);
      setStatusFailures(0);
    } catch {
      // Track consecutive failures so the UI can move past "checking..." once
      // we're sure the poll isn't just slow. One blip stays silent.
      setStatusFailures((n) => n + 1);
    }
  }, []);

  useEffect(() => setPlatform(detectPlatform()), []);

  const loadOpenClawAgents = useCallback(async () => {
    setAgentsLoading(true);
    setAgentsError(null);
    try {
      const res = await fetch("/api/openclaw-agents", { cache: "no-store" });
      const json = (await res.json()) as {
        ok?: boolean;
        agents?: OpenClawAgent[];
        error?: string;
      };
      if (!res.ok || json.ok === false)
        throw new Error(json.error ?? "failed to load OpenClaw agents");
      const agents = json.agents ?? [];
      setOpenclawAgents(agents);
      setSelectedAgentId((current) =>
        current && agents.some((agent) => agent.id === current)
          ? current
          : null,
      );
    } catch (err) {
      setAgentsError(
        err instanceof Error ? err.message : "failed to load OpenClaw agents",
      );
    } finally {
      setAgentsLoading(false);
    }
  }, []);

  const loadHarnesses = useCallback(async () => {
    try {
      const res = await fetch("/api/harnesses", { cache: "no-store" });
      const json = (await res.json()) as {
        ok?: boolean;
        harnesses?: HarnessReport[];
      };
      if (!res.ok || json.ok === false) return;
      const next = json.harnesses ?? [];
      setHarnesses(next);
      setSelectedHarnessId((current) => {
        if (
          current &&
          next.some(
            (adapter) =>
              adapter.id === current && adapter.installed && adapter.chatSupported,
          )
        )
          return current;
        return null;
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
  const chatHarnesses = harnesses.filter((adapter) => adapter.chatSupported);

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard may be blocked */
    }
  };

  const copyDiagnostics = async () => {
    await copyText(
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          platform,
          setupComplete: status?.complete ?? false,
          steps: status?.steps ?? null,
          // Number of consecutive /api/onboarding/status failures at capture
          // time. Non-zero here narrows "setup stuck" to "Cave can't reach
          // the local status endpoint" (vs the daemon being healthy but the
          // user hitting an unmet step).
          statusFailures,
          setupError,
          agentsError,
          harnesses: harnesses.map((adapter) => ({
            id: adapter.id,
            label: adapter.label,
            installed: adapter.installed,
            path: adapter.path,
            version: adapter.version,
            chatSupported: adapter.chatSupported,
            installHint: adapter.installHint,
            source: adapter.source,
            manifestPath: adapter.manifestPath,
          })),
          openclawAgents: openclawAgents.map((agent) => ({
            id: agent.id,
            displayName: agent.displayName,
            workspacePath: agent.workspacePath,
          })),
        },
        null,
        2,
      ),
    );
  };

  const scaffoldOnly = async () => {
    setPicking("scaffold");
    setSetupError(null);
    try {
      const res = await fetch("/api/onboarding/setup", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false)
        throw new Error(json.error ?? "setup failed");
      await refresh();
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : "setup failed");
    } finally {
      setPicking(null);
    }
  };

  const createFamiliar = async () => {
    const selectedAgent =
      openclawAgents.find((agent) => agent.id === selectedAgentId) ?? null;
    if (!selectedAgent) {
      setSetupError(
        "Pick an existing OpenClaw agent first. Use Available harnesses only when you want to create a new Coven familiar.",
      );
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
      if (!res.ok || json.ok === false)
        throw new Error(json.error ?? "setup failed");
      await refresh();
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : "setup failed");
    } finally {
      setPicking(null);
    }
  };

  const createLocalFamiliar = async () => {
    const selectedHarness =
      chatHarnesses.find(
        (adapter) => adapter.id === selectedHarnessId && adapter.installed,
      ) ?? null;
    if (!selectedHarness) {
      setSetupError(
        "Pick an installed harness first, or choose an existing OpenClaw agent.",
      );
      return;
    }
    if (!confirmCreateNewFamiliar) {
      setSetupError(
        "Confirm that you want to create a new Coven familiar before continuing.",
      );
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
            description:
              familiarDescription.trim() ||
              `Local ${selectedHarness.label} adapter on this machine.`,
            glyph: familiarGlyph,
            harness: selectedHarness.id,
            model: `${selectedHarness.id}-local`,
          },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false)
        throw new Error(json.error ?? "setup failed");
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
      if (!res.ok || json.ok === false)
        throw new Error(json.error ?? "daemon start failed");
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
        title: "Find runtime source",
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
    ] satisfies Array<{
      key: string;
      title: string;
      ok: boolean;
      detail: string;
      icon: IconName;
    }>;
  }, [status]);

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Onboarding"
      tabIndex={-1}
      className="fixed inset-0 z-50 overflow-y-auto bg-[var(--bg-base)]/96 backdrop-blur-sm"
    >
      <div className="mx-auto flex min-h-full w-full max-w-[min(1680px,100vw)] flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-[var(--border-hairline)] pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wider text-[var(--accent-presence)]">
              <span>Welcome</span>
              <span className="rounded-full border border-[var(--border-hairline)] px-2 py-0.5 normal-case tracking-normal text-[var(--text-secondary)]">
                {platformCopy.label}
              </span>
              {process.env.NEXT_PUBLIC_DEMO === "true" ? (
                <span className="rounded-full border border-[color-mix(in_oklch,var(--color-warning)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_10%,transparent)] px-2 py-0.5 normal-case tracking-normal text-[var(--color-warning)]">
                  Demo mode
                </span>
              ) : null}
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-[var(--text-primary)] sm:text-3xl">
              Set up CovenCave on this machine.
            </h1>
            <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[var(--text-secondary)]">
              Cave checks Codex, Claude Code, Hermes, and OpenClaw as equal ways
              to create your first functional familiar. It creates only your
              Coven files and shows exactly what still needs setup on this
              machine.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => void refresh()}
              className="focus-ring inline-flex items-center gap-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-2 text-[12px] text-[var(--text-primary)] hover:border-[var(--border-strong)]"
            >
              <Icon name="ph:arrows-clockwise-bold" />
              Re-check
            </button>
            <button
              onClick={() => void copyDiagnostics()}
              className="focus-ring inline-flex items-center gap-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-2 text-[12px] text-[var(--text-primary)] hover:border-[var(--border-strong)]"
            >
              <Icon name="ph:clipboard-text" />
              Copy diagnostics
            </button>
            <div className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-2 text-[12px] text-[var(--text-secondary)]">
              {stepCount(status)}/6 ready
            </div>
          </div>
        </header>

        {platformCopy.warning ? (
          <section className="mt-5 rounded-lg border border-[color-mix(in_oklch,var(--color-warning)_50%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_12%,transparent)] p-4 text-[13px] text-[var(--color-warning)]">
            <div className="flex items-start gap-3">
              <Icon
                name="ph:warning-fill"
                width={18}
                className="mt-0.5 shrink-0 text-[var(--color-warning)]"
              />
              <div>
                <div className="font-semibold">Windows download notice</div>
                <p className="mt-1 leading-6">{platformCopy.warning}</p>
              </div>
            </div>
          </section>
        ) : null}

        {statusFailures >= 3 ? (
          <section
            role="alert"
            className="mt-5 flex items-start justify-between gap-3 rounded-lg border border-[color-mix(in_oklch,var(--color-warning)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_10%,transparent)] p-4 text-[13px] text-[var(--color-warning)]"
          >
            <div>
              <div className="font-semibold">Setup status is unreachable.</div>
              <p className="mt-1 leading-6 text-[var(--text-secondary)]">
                Cave couldn&rsquo;t reach <code className="font-mono">/api/onboarding/status</code> in {statusFailures} attempts. The coven CLI may not be installed, or the local sidecar may be blocked. The cards below will stay on &ldquo;checking…&rdquo; until this clears.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              className="focus-ring shrink-0 rounded-md border border-[color-mix(in_oklch,var(--color-warning)_40%,transparent)] px-2 py-1 font-mono text-[11px] text-[var(--color-warning)] hover:bg-[color-mix(in_oklch,var(--color-warning)_15%,transparent)]"
            >
              Retry now
            </button>
          </section>
        ) : null}

        {setupError ? (
          <section className="mt-5 rounded-lg border border-[color-mix(in_oklch,var(--color-danger)_40%,transparent)] bg-[color-mix(in_oklch,var(--color-danger)_10%,transparent)] p-4 text-[13px] text-[var(--color-danger)]">
            {setupError}
          </section>
        ) : null}

        <main className="grid flex-1 auto-rows-[minmax(0,auto)] gap-4 py-5 lg:grid-cols-12">
          <section className={`${BENTO_CARD} lg:col-span-12`}>
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">
                  Setup progress
                </h2>
                <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">
                  Bring whichever runtime you already use. Cave keeps checking
                  and turns the first healthy source into a working familiar.
                </p>
              </div>
              <span className="font-mono text-[11px] text-[var(--text-muted)]">
                {stepCount(status)}/6 ready
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              {steps.map((s, i) => (
                <div
                  key={s.key}
                  className={`rounded-lg border p-3 ${
                    s.ok
                      ? "border-[color-mix(in_oklch,var(--color-success)_50%,transparent)] bg-[color-mix(in_oklch,var(--color-success)_20%,transparent)]"
                      : "border-[var(--border-hairline)] bg-[var(--bg-raised)]/30"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`grid h-7 w-7 place-items-center rounded-full border ${
                        s.ok
                          ? "border-[color-mix(in_oklch,var(--color-success)_60%,transparent)] bg-[color-mix(in_oklch,var(--color-success)_15%,transparent)] text-[var(--color-success)]"
                          : "border-[var(--border-strong)] text-[var(--text-secondary)]"
                      }`}
                    >
                      {s.ok ? (
                        <Icon name="ph:check-bold" />
                      ) : (
                        <Icon name={s.icon} />
                      )}
                    </span>
                    <span className="font-mono text-[11px] text-[var(--text-muted)]">
                      {i + 1}
                    </span>
                  </div>
                  <div className="mt-3 text-[12px] font-medium text-[var(--text-primary)]">
                    {s.title}
                  </div>
                  <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-[var(--text-muted)]">
                    {s.detail}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className={`${BENTO_CARD} lg:col-span-6 xl:col-span-4`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">
                  Install path
                </h2>
                <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">
                  Follow the path for {platformCopy.label}, then re-check once
                  the CLI is available.
                </p>
              </div>
              <button
                onClick={() => void copyText(platformCopy.installCommand)}
                className="focus-ring rounded border border-[var(--border-hairline)] px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
              >
                Copy
              </button>
            </div>
            <div className="mt-3 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 font-mono text-[12px] text-[var(--text-primary)]">
              {platformCopy.installCommand}
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
              <InstructionList
                title="Install CovenCave"
                items={platformCopy.caveInstall}
              />
              <InstructionList
                title="Install coven CLI"
                items={platformCopy.cliInstall}
              />
            </div>
          </section>

          <section className={`${BENTO_CARD} lg:col-span-6 xl:col-span-4`}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">
                  Available harnesses
                </h2>
                <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">
                  Choose Codex, Claude Code, Hermes, or another installed Coven
                  adapter only when you want to create a new familiar bound to
                  that runtime.
                </p>
              </div>
              <button
                onClick={() => void loadHarnesses()}
                className="focus-ring rounded border border-[var(--border-hairline)] px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
              >
                Refresh
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
              {chatHarnesses.map((adapter) => {
                const active = selectedHarnessId === adapter.id;
                return (
                  <button
                    key={adapter.id}
                    onClick={() => {
                      if (!adapter.installed) return;
                      setSelectedHarnessId(adapter.id);
                      setSelectedAgentId(null);
                      setConfirmCreateNewFamiliar(false);
                      setFamiliarName(adapter.label);
                      setFamiliarRole("Code Familiar");
                      setFamiliarDescription(
                        `Local ${adapter.label} adapter on this machine.`,
                      );
                    }}
                    disabled={!adapter.installed}
                    className={`rounded-lg border p-3 text-left ${
                      active
                        ? "border-[color-mix(in_oklch,var(--accent-presence)_55%,transparent)] bg-[color-mix(in_oklch,var(--accent-presence)_12%,transparent)] text-[var(--text-primary)]"
                        : adapter.installed
                          ? "border-[var(--border-hairline)] bg-[var(--bg-base)]/45 text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
                          : "border-[var(--border-hairline)] bg-[var(--bg-base)]/35 text-[var(--text-muted)] opacity-70"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-medium">
                        {adapter.label}
                      </span>
                      {active ? (
                        <Icon
                          name="ph:check-bold"
                          className="text-[var(--accent-presence)]"
                        />
                      ) : null}
                    </div>
                    <div className="mt-1 truncate font-mono text-[11px]">
                      {adapter.binary}
                    </div>
                    <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-[var(--text-muted)]">
                      {adapter.installed
                        ? (adapter.path ?? "installed")
                        : adapter.installHint}
                    </div>
                  </button>
                );
              })}
            </div>
            <label className="mt-3 flex items-start gap-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)]/45 p-3 text-[12px] leading-5 text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={confirmCreateNewFamiliar}
                onChange={(e) =>
                  setConfirmCreateNewFamiliar(e.currentTarget.checked)
                }
                disabled={!selectedHarnessId || picking !== null}
                className="mt-1 h-4 w-4 accent-[var(--accent-presence)] disabled:opacity-50"
              />
              <span>
                I understand this creates a new Coven familiar instead of
                connecting an existing OpenClaw agent.
              </span>
            </label>
            <button
              onClick={createLocalFamiliar}
              disabled={
                picking !== null ||
                !selectedHarnessId ||
                !confirmCreateNewFamiliar ||
                (familiarGlyph.trim() !== "" && !familiarGlyph.trim().startsWith("ph:"))
              }
              className="focus-ring mt-3 inline-flex items-center gap-2 rounded-md bg-[var(--accent-presence)] px-4 py-2 text-[13px] font-medium text-white hover:bg-[color-mix(in_oklch,var(--accent-presence)_85%,#000)] disabled:opacity-50"
            >
              <Icon name="ph:terminal-window" />
              {picking === "local"
                ? "Creating..."
                : "Create new Coven familiar"}
            </button>
          </section>

          <section className={`${BENTO_CARD} lg:col-span-6 xl:col-span-4`}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">
                  Existing OpenClaw agents
                </h2>
                <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">
                  Choose an agent that already exists under ~/.openclaw. This
                  connects the agent as a familiar without creating a new
                  OpenClaw agent.
                </p>
              </div>
              <button
                onClick={() => void loadOpenClawAgents()}
                disabled={agentsLoading}
                className="focus-ring rounded border border-[var(--border-hairline)] px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
              >
                {agentsLoading ? "Loading..." : "Refresh"}
              </button>
            </div>
            {agentsError ? (
              <div className="rounded border border-[color-mix(in_oklch,var(--color-danger)_30%,transparent)] bg-[color-mix(in_oklch,var(--color-danger)_10%,transparent)] px-3 py-2 text-[12px] text-[var(--color-danger)]">
                {agentsError}
              </div>
            ) : openclawAgents.length === 0 ? (
              <div className="rounded border border-dashed border-[var(--border-hairline)] px-3 py-5 text-center text-[12px] text-[var(--text-muted)]">
                No OpenClaw agents found under ~/.openclaw/agents yet.
              </div>
            ) : (
              <div className="grid max-h-[19rem] gap-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-1">
                {openclawAgents.map((agent) => {
                  const active = selectedAgentId === agent.id;
                  return (
                    <button
                      key={agent.id}
                      onClick={() => {
                        setSelectedAgentId(agent.id);
                        setSelectedHarnessId(null);
                        setConfirmCreateNewFamiliar(false);
                        setFamiliarName(agent.displayName);
                        setFamiliarRole(agent.role);
                        setFamiliarDescription(
                          `Connected to OpenClaw agent "${agent.id}".`,
                        );
                      }}
                      className={`rounded-lg border p-3 text-left ${
                        active
                          ? "border-[color-mix(in_oklch,var(--accent-presence)_55%,transparent)] bg-[color-mix(in_oklch,var(--accent-presence)_12%,transparent)] text-[var(--text-primary)]"
                          : "border-[var(--border-hairline)] bg-[var(--bg-base)]/45 text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] font-medium">
                          {agent.displayName}
                        </span>
                        {active ? (
                          <Icon
                            name="ph:check-bold"
                            className="text-[var(--accent-presence)]"
                          />
                        ) : null}
                      </div>
                      <div className="mt-1 truncate font-mono text-[11px]">
                        {agent.id}
                      </div>
                      <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-[var(--text-muted)]">
                        {agent.role}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className={`${BENTO_CARD} lg:col-span-8 xl:col-span-8`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">
                  Familiar details
                </h2>
                <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">
                  Name the familiar and describe the job after choosing either
                  an existing OpenClaw agent or a new local harness familiar.
                  Cave will only create a new familiar after the explicit
                  confirmation above.
                </p>
              </div>
              <button
                onClick={scaffoldOnly}
                disabled={picking !== null}
                className="focus-ring rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 text-[12px] text-[var(--text-primary)] hover:border-[var(--border-strong)] disabled:opacity-50"
              >
                {picking === "scaffold" ? "Creating..." : "Create folder only"}
              </button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <label className="block">
                <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                  Name
                </span>
                <input
                  value={familiarName}
                  onChange={(e) => setFamiliarName(e.target.value)}
                  placeholder="Example: Riley"
                  className="focus-ring mt-1 w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 text-[13px] text-[var(--text-primary)] focus:border-[var(--border-strong)]"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                  Role
                </span>
                <input
                  value={familiarRole}
                  onChange={(e) => setFamiliarRole(e.target.value)}
                  placeholder="Research, Code, Ops..."
                  className="focus-ring mt-1 w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 text-[13px] text-[var(--text-primary)] focus:border-[var(--border-strong)]"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                  Glyph
                </span>
                <input
                  value={familiarGlyph}
                  onChange={(e) => setFamiliarGlyph(e.target.value)}
                  placeholder="ph:sparkle-fill"
                  aria-invalid={familiarGlyph.trim() !== "" && !familiarGlyph.trim().startsWith("ph:")}
                  className={`focus-ring mt-1 w-full rounded-md border bg-[var(--bg-base)] px-3 py-2 font-mono text-[13px] text-[var(--text-primary)] ${
                    familiarGlyph.trim() !== "" && !familiarGlyph.trim().startsWith("ph:")
                      ? "border-[var(--color-danger)] focus:border-[var(--color-danger)]"
                      : "border-[var(--border-hairline)] focus:border-[var(--border-strong)]"
                  }`}
                />
                {familiarGlyph.trim() !== "" && !familiarGlyph.trim().startsWith("ph:") ? (
                  <span className="mt-1 block text-[11px] text-[var(--color-danger)]">
                    Must start with <code className="font-mono">ph:</code> — see <a href="https://phosphoricons.com" target="_blank" rel="noreferrer" className="underline">phosphoricons.com</a>.
                  </span>
                ) : null}
              </label>
              <label className="block">
                <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                  Description
                </span>
                <input
                  value={familiarDescription}
                  onChange={(e) => setFamiliarDescription(e.target.value)}
                  placeholder="What should this familiar help with?"
                  className="focus-ring mt-1 w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 text-[13px] text-[var(--text-primary)] focus:border-[var(--border-strong)]"
                />
              </label>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <button
                onClick={createFamiliar}
                disabled={
                  picking !== null ||
                  !selectedAgentId ||
                  familiarName.trim().length === 0 ||
                  (familiarGlyph.trim() !== "" && !familiarGlyph.trim().startsWith("ph:"))
                }
                className="focus-ring inline-flex items-center gap-2 rounded-md bg-[var(--accent-presence)] px-4 py-2 text-[13px] font-medium text-white hover:bg-[color-mix(in_oklch,var(--accent-presence)_85%,#000)] disabled:opacity-50"
              >
                <Icon name="ph:sparkle" />
                {picking === "familiar"
                  ? "Connecting..."
                  : "Connect selected existing agent"}
              </button>
              <button
                onClick={startDaemon}
                disabled={startingDaemon || !status?.steps.covenCli.ok}
                className="focus-ring inline-flex items-center gap-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-4 py-2 text-[13px] text-[var(--text-primary)] hover:border-[var(--border-strong)] disabled:opacity-50"
                title={
                  !status?.steps.covenCli.ok
                    ? "Install coven CLI first"
                    : "coven daemon start"
                }
              >
                <Icon name="ph:rocket-launch-bold" />
                {startingDaemon ? "Starting..." : "Start daemon"}
              </button>
            </div>
          </section>

          <section className={`${BENTO_CARD_SOFT} lg:col-span-4 xl:col-span-2`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">
                  Tester demo mode
                </h2>
                <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">
                  Demo data is opt-in for testers and never appears in normal
                  installs.
                </p>
              </div>
              <Icon
                name="ph:toggle-right-bold"
                className="text-[var(--text-muted)]"
              />
            </div>
            <div className="mt-3 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 font-mono text-[12px] text-[var(--text-primary)]">
              NEXT_PUBLIC_DEMO=true pnpm dev
            </div>
          </section>

          <MaintenancePanel
            prune={prune}
            setPrune={setPrune}
            className="lg:col-span-4 xl:col-span-2"
          />
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
              className="focus-ring rounded-md bg-[color-mix(in_oklch,var(--color-success)_90%,transparent)] px-4 py-2 text-[13px] font-medium text-white hover:bg-[color-mix(in_oklch,var(--color-success)_85%,#000)]"
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
      <h3 className="text-[12px] font-semibold text-[var(--text-primary)]">
        {title}
      </h3>
      <ol className="mt-2 space-y-2">
        {items.map((item, index) => (
          <li
            key={item}
            className="flex gap-2 text-[12px] leading-5 text-[var(--text-secondary)]"
          >
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
  className = "",
}: {
  prune: PruneState;
  setPrune: (next: PruneState) => void;
  className?: string;
}) {
  return (
    <div className={`${BENTO_CARD_SOFT} ${className}`}>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
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
            <span className="text-[var(--color-danger)]">{prune.error}</span>
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
                  const json = (await res.json()) as {
                    ok: boolean;
                    wouldPrune?: number;
                    error?: string;
                  };
                  setPrune(
                    json.ok
                      ? { count: json.wouldPrune ?? 0 }
                      : { error: json.error ?? "dry-run failed" },
                  );
                } catch (err) {
                  setPrune({
                    error: err instanceof Error ? err.message : "fetch failed",
                  });
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
                className="focus-ring rounded border border-[var(--border-strong)] bg-[var(--bg-raised)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"
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
                      const json = (await res.json()) as {
                        ok: boolean;
                        pruned?: number;
                        error?: string;
                      };
                      setPrune(
                        json.ok
                          ? { pruned: json.pruned ?? 0 }
                          : { error: json.error ?? "prune failed" },
                      );
                    } catch (err) {
                      setPrune({
                        error:
                          err instanceof Error ? err.message : "fetch failed",
                      });
                    }
                  }}
                  className="focus-ring rounded bg-[color-mix(in_oklch,var(--color-danger)_80%,transparent)] px-2.5 py-1 text-[11px] text-white hover:bg-[color-mix(in_oklch,var(--color-danger)_85%,#000)]"
                >
                  Delete {prune.count}
                </button>
              ) : (
                <span className="text-[11px] text-[var(--text-muted)]">
                  Nothing to prune.
                </span>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
