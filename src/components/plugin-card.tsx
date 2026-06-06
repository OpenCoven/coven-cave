"use client";

import { Icon } from "@/lib/icon";

export type HarnessReport = {
  id: string;
  label: string;
  binary: string;
  chatSupported: boolean;
  installed: boolean;
  path: string | null;
  version: string | null;
};

const HARNESS_TAGLINE: Record<string, string> = {
  codex: "Run Codex sessions from this Cave",
  claude: "Drive Claude Code from a familiar",
  openclaw: "Bring OpenClaw into the Coven",
  copilot: "Wire up GitHub Copilot CLI",
  opencode: "Run OpenCode locally",
  gemini: "Talk to Google Gemini CLI",
  hermes: "Light a Hermes runtime",
  openhands: "Open up OpenHands tasks",
  aider: "Pair with Aider in-repo",
};

export function PluginCard({
  harness,
  onLaunch,
}: {
  harness: HarnessReport;
  onLaunch: () => void;
}) {
  const initial = (harness.label.match(/[a-z0-9]/i)?.[0] ?? "?").toUpperCase();
  const tagline =
    HARNESS_TAGLINE[harness.id] ?? `Run ${harness.label} from a familiar`;

  return (
    <div
      className={`group flex min-w-0 flex-col gap-3 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-card)] px-4 py-4 transition-colors ${
        harness.installed
          ? "hover:border-[var(--border-strong)]"
          : "opacity-60"
      }`}
    >
      {/* Top row: icon + name + status */}
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-raised)] text-[15px] font-semibold text-[var(--text-primary)]">
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-[var(--text-primary)]">
            {harness.label}
          </p>
          <p className="truncate text-[12px] text-[var(--text-muted)]">
            {tagline}
          </p>
        </div>
        {harness.installed ? (
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--accent-presence)]"
            title="Installed"
          >
            <Icon name="ph:check-bold" width={12} />
          </span>
        ) : (
          <span className="shrink-0 rounded-full border border-[var(--border-hairline)] px-2 py-px text-[10px] text-[var(--text-muted)]">
            not found
          </span>
        )}
      </div>

      {/* Version + binary path */}
      {harness.installed && (harness.version || harness.path) && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[var(--text-muted)]">
          {harness.version && <span>{harness.version}</span>}
          {harness.path && (
            <span className="truncate font-mono opacity-60">
              {harness.path.replace(/^\/Users\/[^/]+/, "~")}
            </span>
          )}
        </div>
      )}

      {/* Actions */}
      {harness.installed ? (
        <div className="flex items-center gap-2 pt-1">
          {harness.chatSupported ? (
            <button
              onClick={onLaunch}
              className="flex items-center gap-1.5 rounded-md bg-[var(--accent-presence)] px-3 py-1.5 text-[11px] font-medium text-white transition-opacity hover:opacity-85"
            >
              <Icon name="ph:rocket-launch-bold" width={11} />
              Launch
            </button>
          ) : (
            <span className="text-[11px] text-[var(--text-muted)]">
              Chat not yet wired
            </span>
          )}
          <a
            href={`https://github.com/search?q=${encodeURIComponent(harness.label)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          >
            <Icon name="ph:arrow-square-out-bold" width={11} />
            Docs
          </a>
        </div>
      ) : (
        <p className="text-[11px] text-[var(--text-muted)]">
          Install <code className="font-mono">{harness.binary}</code> on your
          PATH to enable.
        </p>
      )}
    </div>
  );
}
