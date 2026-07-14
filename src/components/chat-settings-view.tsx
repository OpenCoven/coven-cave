"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { SettingsGroup } from "@/components/ui/settings-group";
import {
  normalizeChatAutoArchivePolicy,
  type ChatAutoArchivePolicy,
} from "@/lib/chat-auto-archive";

/**
 * Consolidated chat settings — the chat page's Settings tab. One place for the
 * behavior knobs that apply to every chat on this device, starting with the
 * auto-archive policy (previously config-file only): the master sweep switch,
 * event-driven archiving (task completion, thread reflections), and the idle
 * windows. Reads/writes the `chatAutoArchive` key through `/api/config`, whose
 * PATCH merges partial policies over the stored one.
 */

type SaveState = "idle" | "saving" | "error";

function PolicyRow({
  label,
  description,
  dimmed,
  children,
}: {
  label: string;
  description?: string;
  dimmed?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`flex items-center justify-between gap-4 px-4 py-3 ${dimmed ? "opacity-50" : ""}`}>
      <div className="min-w-0">
        <p className="text-[13px] text-[var(--text-primary)]">{label}</p>
        {description && <p className="text-[11px] text-[var(--text-muted)]">{description}</p>}
      </div>
      {children}
    </div>
  );
}

function PolicySwitch({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`settings-switch focus-ring${checked ? " is-on" : ""}`}
    >
      <span className="settings-switch__knob" aria-hidden />
    </button>
  );
}

/** Days input that commits on blur/Enter so each keystroke doesn't PATCH. */
function PolicyDays({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  disabled?: boolean;
  onCommit: (days: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const parsed = Number.parseInt(draft, 10);
    const days = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 365) : value;
    setDraft(String(days));
    if (days !== value) onCommit(days);
  };
  return (
    <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-[var(--text-secondary)]">
      <input
        type="number"
        min={0}
        max={365}
        value={draft}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="w-16 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2 py-1 text-right text-[12px] text-[var(--text-primary)] focus-ring"
      />
      days
    </label>
  );
}

export function ChatSettingsView() {
  const [policy, setPolicy] = useState<ChatAutoArchivePolicy | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const policyRef = useRef<ChatAutoArchivePolicy | null>(null);
  policyRef.current = policy;

  useEffect(() => {
    const ctl = new AbortController();
    fetch("/api/config", { cache: "no-store", signal: ctl.signal })
      .then((r) => r.json())
      .then((json: { ok?: boolean; config?: { chatAutoArchive?: Partial<ChatAutoArchivePolicy> }; error?: string }) => {
        if (ctl.signal.aborted) return;
        if (!json.ok) throw new Error(json.error ?? "failed to load config");
        setPolicy(normalizeChatAutoArchivePolicy(json.config?.chatAutoArchive));
      })
      .catch((err) => {
        if (ctl.signal.aborted) return;
        setLoadError(err instanceof Error ? err.message : "failed to load config");
      });
    return () => ctl.abort();
  }, []);

  // Optimistic patch: apply locally, persist the changed fields, revert on failure.
  const update = useCallback((patch: Partial<ChatAutoArchivePolicy>) => {
    const previous = policyRef.current;
    if (!previous) return;
    setPolicy({ ...previous, ...patch });
    setSaveState("saving");
    fetch("/api/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatAutoArchive: patch }),
    })
      .then((r) => r.json())
      .then((json: { ok?: boolean; error?: string }) => {
        if (!json.ok) throw new Error(json.error ?? "failed to save");
        setSaveState("idle");
      })
      .catch(() => {
        setPolicy(previous);
        setSaveState("error");
      });
  }, []);

  const sweepOff = policy ? !policy.enabled : false;

  return (
    <div className="chat-settings-view min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-8">
        <header>
          <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">Chat settings</h2>
          <p className="mt-1 text-[12px] text-[var(--text-muted)]">
            Applies to every chat on this device. Per-familiar behavior (like auto
            self-report) lives with each familiar under Familiars → Brain.
          </p>
        </header>

        {loadError ? (
          <p role="alert" className="text-[12px] text-[var(--accent-danger,#e5484d)]">
            {loadError}
          </p>
        ) : !policy ? (
          <p className="text-[12px] text-[var(--text-muted)]">Loading…</p>
        ) : (
          <>
            <SettingsGroup
              label="Auto-archive"
              description="Move finished chats out of the list automatically. Chats marked keep are never auto-archived."
            >
              <PolicyRow
                label="Auto-archive"
                description="Master switch for event- and time-based archiving."
              >
                <PolicySwitch
                  label="Auto-archive"
                  checked={policy.enabled}
                  onChange={(enabled) => update({ enabled })}
                />
              </PolicyRow>
              <PolicyRow
                label="After task completion"
                description="Archive a chat when its linked task completes, instead of only nudging."
                dimmed={sweepOff}
              >
                <PolicySwitch
                  label="Archive after task completion"
                  checked={policy.archiveOnTaskCompletion}
                  disabled={sweepOff}
                  onChange={(archiveOnTaskCompletion) => update({ archiveOnTaskCompletion })}
                />
              </PolicyRow>
              <PolicyRow
                label="After thread reflection"
                description="Archive a thread as soon as its reflection lands — a reflection marks it wrapped up."
                dimmed={sweepOff}
              >
                <PolicySwitch
                  label="Archive after thread reflection"
                  checked={policy.archiveOnReflection}
                  disabled={sweepOff}
                  onChange={(archiveOnReflection) => update({ archiveOnReflection })}
                />
              </PolicyRow>
              <PolicyRow
                label="After PR merge"
                description="Archive a chat once the pull request its work produced merges."
                dimmed={sweepOff}
              >
                <PolicySwitch
                  label="Archive after PR merge"
                  checked={policy.archiveOnPrMerge}
                  disabled={sweepOff}
                  onChange={(archiveOnPrMerge) => update({ archiveOnPrMerge })}
                />
              </PolicyRow>
              <PolicyRow
                label="External chats idle for"
                description="Chats created outside the chat surface (cron, flows, generated runs). 0 turns this window off."
                dimmed={sweepOff}
              >
                <PolicyDays
                  label="Archive external chats after days idle"
                  value={policy.externalAfterDays}
                  disabled={sweepOff}
                  onCommit={(externalAfterDays) => update({ externalAfterDays })}
                />
              </PolicyRow>
              <PolicyRow
                label="Any chat idle for"
                description="Every chat, regardless of origin. 0 turns this window off."
                dimmed={sweepOff}
              >
                <PolicyDays
                  label="Archive any chat after days idle"
                  value={policy.idleAfterDays}
                  disabled={sweepOff}
                  onCommit={(idleAfterDays) => update({ idleAfterDays })}
                />
              </PolicyRow>
            </SettingsGroup>
            <p aria-live="polite" className="text-[11px] text-[var(--text-muted)]">
              {saveState === "error"
                ? "Saving failed — change reverted. Try again."
                : saveState === "saving"
                  ? "Saving…"
                  : "Changes save automatically."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
