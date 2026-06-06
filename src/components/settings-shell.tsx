"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/lib/icon";

// ─── Types ────────────────────────────────────────────────────────────────────

type DaemonStatus = {
  running: boolean;
  covenVersion?: string;
  apiVersion?: string;
  workspacePath?: string;
  daemon?: { pid: number; startedAt: string; socket: string };
};

type Section = "general" | "daemon" | "familiars" | "appearance" | "about";

const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: "general",    label: "General",    icon: "ph:sliders-horizontal" },
  { id: "daemon",     label: "Daemon",     icon: "ph:terminal-window" },
  { id: "familiars",  label: "Familiars",  icon: "ph:users-three" },
  { id: "appearance", label: "Appearance", icon: "ph:paint-brush" },
  { id: "about",      label: "About",      icon: "ph:info" },
];

// ─── Shell ────────────────────────────────────────────────────────────────────

export function SettingsShell() {
  const router = useRouter();
  const [section, setSection] = useState<Section>("general");

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-[var(--bg-base)] text-[var(--text-primary)]">
      {/* Header */}
      <header className="flex shrink-0 items-center gap-3 border-b border-[var(--border-hairline)] px-4 py-2.5">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
        >
          <Icon name="ph:arrow-left" width={13} />
          Back
        </button>
        <span className="text-[13px] font-semibold text-[var(--text-primary)]">Settings</span>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <nav className="w-[200px] shrink-0 border-r border-[var(--border-hairline)] py-3">
          <p className="mb-1 px-4 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
            Settings
          </p>
          <div className="space-y-px px-2">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                className={`flex w-full items-center gap-2 rounded-[5px] px-2.5 py-[6px] text-left text-[12px] transition-colors ${
                  section === s.id
                    ? "bg-[var(--accent-presence)] text-white"
                    : "text-[var(--text-primary)] hover:bg-[var(--bg-raised)]"
                }`}
              >
                <Icon
                  name={s.icon as Parameters<typeof Icon>[0]["name"]}
                  width={13}
                  className={section === s.id ? "text-white/70" : "text-[var(--text-muted)]"}
                />
                {s.label}
              </button>
            ))}
          </div>
        </nav>

        {/* Content */}
        <main className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
          {section === "general" && <GeneralSection />}
          {section === "daemon"   && <DaemonSection />}
          {section === "familiars" && <FamiliarsSection />}
          {section === "appearance" && <AppearanceSection />}
          {section === "about"    && <AboutSection />}
        </main>
      </div>
    </div>
  );
}

// ─── Section: General ─────────────────────────────────────────────────────────

function GeneralSection() {
  return (
    <SettingsPage title="General" description="App-wide preferences.">
      <SettingsGroup label="Workspace">
        <SettingsRow label="Workspace path" description="Where Coven stores familiar workspaces.">
          <WorkspacePathField />
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup label="Startup">
        <SettingsRow label="Launch at login" description="Start CovenCave when you log in." comingSoon />
        <SettingsRow label="Open to" description="Which view to show on launch." comingSoon />
      </SettingsGroup>
    </SettingsPage>
  );
}

function WorkspacePathField() {
  const [path, setPath] = useState("");
  useEffect(() => {
    fetch("/api/daemon/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { workspacePath?: string }) => { if (j.workspacePath) setPath(j.workspacePath); })
      .catch(() => {});
  }, []);
  return (
    <input
      value={path}
      readOnly
      className="w-full max-w-sm rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-1.5 font-mono text-[11px] text-[var(--text-secondary)] outline-none"
    />
  );
}

// ─── Section: Daemon ──────────────────────────────────────────────────────────

function DaemonSection() {
  const [status, setStatus] = useState<DaemonStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const refresh = () => {
    setLoading(true);
    fetch("/api/daemon/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: DaemonStatus) => { setStatus(j); setLoading(false); })
      .catch(() => { setStatus({ running: false }); setLoading(false); });
  };

  useEffect(refresh, []);

  const startDaemon = async () => {
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch("/api/daemon/start", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || json?.stderr || "daemon did not start");
      }
      refresh();
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "daemon did not start");
    } finally {
      setStarting(false);
    }
  };

  return (
    <SettingsPage title="Daemon" description="The coven daemon manages familiar sessions and the workspace.">
      <SettingsGroup label="Status">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-card)] px-4 py-3">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${
            loading ? "animate-pulse bg-[var(--text-muted)]"
            : status?.running ? "bg-emerald-400"
            : "bg-red-400"
          }`} />
          <span className="text-[13px] font-medium">
            {loading ? "Checking…" : status?.running ? "Running" : "Offline"}
          </span>
          {status?.running && status.daemon && (
            <span className="ml-auto font-mono text-[11px] text-[var(--text-muted)]">
              pid {status.daemon.pid}
            </span>
          )}
          {!loading && !status?.running && (
            <button
              type="button"
              onClick={startDaemon}
              disabled={starting}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-[var(--accent-presence)] px-3 py-1.5 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-60"
              title="coven daemon start"
            >
              <Icon name="ph:rocket-launch-bold" width={12} />
              {starting ? "Starting..." : "Start daemon"}
            </button>
          )}
          <button
            type="button"
            onClick={refresh}
            className={`${status?.running ? "ml-auto" : ""} flex items-center gap-1 rounded px-2 py-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]`}
          >
            <Icon name="ph:arrow-clockwise" width={11} />
            Refresh
          </button>
          {startError && <p className="basis-full text-[11px] text-rose-300">{startError}</p>}
        </div>
      </SettingsGroup>

      {status?.running && (
        <SettingsGroup label="Info">
          <SettingsKV label="Coven version" value={status.covenVersion ?? "—"} />
          <SettingsKV label="API version"   value={status.apiVersion   ?? "—"} />
          <SettingsKV label="Socket"        value={status.daemon?.socket ?? "—"} mono />
          <SettingsKV label="Started"       value={status.daemon?.startedAt ? new Date(status.daemon.startedAt).toLocaleString() : "—"} />
          <SettingsKV label="Workspace"     value={status.workspacePath ?? "—"} mono />
        </SettingsGroup>
      )}
    </SettingsPage>
  );
}

// ─── Section: Familiars ───────────────────────────────────────────────────────

function FamiliarsSection() {
  return (
    <SettingsPage title="Familiars" description="Configure which familiars are visible and their defaults.">
      <SettingsGroup label="Familiars">
        <p className="text-[12px] text-[var(--text-muted)]">
          Familiar configuration lives in the daemon workspace. Edit familiar TOML files directly for now — a UI is coming.
        </p>
      </SettingsGroup>
    </SettingsPage>
  );
}

// ─── Section: Appearance ─────────────────────────────────────────────────────

function AppearanceSection() {
  return (
    <SettingsPage title="Appearance" description="Colors, density, and font preferences.">
      <SettingsGroup label="Theme">
        <SettingsRow label="Color scheme" description="Light, dark, or system." comingSoon />
        <SettingsRow label="Accent color"  description="Primary highlight color." comingSoon />
      </SettingsGroup>
      <SettingsGroup label="Density">
        <SettingsRow label="Sidebar density" description="Compact or relaxed sidebar rows." comingSoon />
      </SettingsGroup>
    </SettingsPage>
  );
}

// ─── Section: About ───────────────────────────────────────────────────────────

function AboutSection() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/daemon/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: DaemonStatus) => { if (j.covenVersion) setVersion(j.covenVersion); })
      .catch(() => {});
  }, []);

  return (
    <SettingsPage title="About" description="Version and build information.">
      <SettingsGroup label="CovenCave">
        <SettingsKV label="App version" value="0.0.41" />
        <SettingsKV label="Daemon version" value={version ?? "—"} />
        <SettingsKV label="Built with" value="Next.js · React · Tauri · Tailwind" />
      </SettingsGroup>
      <SettingsGroup label="Links">
        <div className="flex flex-wrap gap-2">
          {[
            { label: "GitHub", href: "https://github.com/OpenCoven/coven-cave" },
            { label: "Docs",   href: "https://docs.openclaw.ai" },
          ].map((l) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
            >
              <Icon name="ph:arrow-square-out" width={12} />
              {l.label}
            </a>
          ))}
        </div>
      </SettingsGroup>
    </SettingsPage>
  );
}

// ─── Primitives ───────────────────────────────────────────────────────────────

function SettingsPage({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-[18px] font-semibold text-[var(--text-primary)]">{title}</h1>
        {description && <p className="mt-1 text-[12px] text-[var(--text-muted)]">{description}</p>}
      </div>
      {children}
    </div>
  );
}

function SettingsGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">{label}</p>
      <div className="divide-y divide-[var(--border-hairline)] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-card)] overflow-hidden">
        {children}
      </div>
    </div>
  );
}

function SettingsRow({ label, description, comingSoon, children }: { label: string; description?: string; comingSoon?: boolean; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <p className="text-[13px] text-[var(--text-primary)]">{label}</p>
        {description && <p className="text-[11px] text-[var(--text-muted)]">{description}</p>}
      </div>
      {comingSoon ? (
        <span className="shrink-0 rounded-full bg-[var(--bg-raised)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">Soon</span>
      ) : children}
    </div>
  );
}

function SettingsKV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="text-[12px] text-[var(--text-secondary)]">{label}</span>
      <span className={`text-right text-[12px] text-[var(--text-muted)] ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
