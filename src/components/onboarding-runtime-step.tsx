"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import { usePausablePoll } from "@/lib/use-pausable-poll";

const RUNTIMES = [
  { id: "codex", label: "Codex" },
  { id: "claude", label: "Claude Code" },
  { id: "copilot", label: "GitHub Copilot CLI" },
] as const;

type RuntimeId = (typeof RUNTIMES)[number]["id"];
type InstallView = {
  status: "idle" | "running" | "done" | "started" | "busy" | "unavailable";
  ok?: boolean;
  error?: string;
  hint?: string;
  npmBusy?: boolean;
  npmBusyLabel?: string | null;
};
type HarnessView = {
  id: string;
  label: string;
  chatSupported: boolean;
  installed: boolean;
};

export function OnboardingRuntimeStep({
  open,
  onReadyChange,
}: {
  open: boolean;
  onReadyChange: (ready: boolean) => void;
}) {
  const [harnesses, setHarnesses] = useState<HarnessView[]>([]);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTarget, setActiveTarget] = useState<RuntimeId | null>(null);
  const [startingTarget, setStartingTarget] = useState<RuntimeId | null>(null);
  const [npmBusyLabel, setNpmBusyLabel] = useState<string | null>(null);
  const [installedHere, setInstalledHere] = useState(false);
  const { announce } = useAnnouncer();

  const ready = installedHere || harnesses.some((harness) => harness.chatSupported && harness.installed);
  useEffect(() => onReadyChange(ready), [onReadyChange, ready]);

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      const [harnessResponse, laneResponse] = await Promise.all([
        fetch("/api/harnesses", { cache: "no-store" }),
        fetch("/api/onboarding/install", { cache: "no-store" }),
      ]);
      if (!harnessResponse.ok || !laneResponse.ok) throw new Error("Couldn’t check runtimes. Retry.");
      const harnessPayload = (await harnessResponse.json()) as { harnesses?: HarnessView[] };
      const lane = (await laneResponse.json()) as InstallView;
      if (!Array.isArray(harnessPayload.harnesses)) throw new Error("Couldn’t check runtimes. Retry.");
      setHarnesses(harnessPayload.harnesses);
      setNpmBusyLabel(lane.npmBusy ? lane.npmBusyLabel ?? "Another install" : null);
    } catch {
      setError("Couldn’t check runtimes. Retry.");
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
    // A reopened dialog must reattach to a server-owned install job.
    let cancelled = false;
    void Promise.all(RUNTIMES.map(async ({ id }) => {
      try {
        const response = await fetch(`/api/onboarding/install?target=${id}`, { cache: "no-store" });
        const view = (await response.json()) as InstallView;
        return response.ok && view.status === "running" ? id : null;
      } catch {
        return null;
      }
    })).then((targets) => {
      const running = targets.find((target) => target !== null);
      if (!cancelled && running) setActiveTarget((current) => current ?? running);
    });
    return () => { cancelled = true; };
  }, [open, refresh]);

  usePausablePoll(async () => {
    if (!activeTarget) return;
    try {
      const response = await fetch(`/api/onboarding/install?target=${activeTarget}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Couldn’t check the install. Retry.");
      const view = (await response.json()) as InstallView;
      if (view.status === "running") return;
      setActiveTarget(null);
      if (view.status === "done" && view.ok) {
        setInstalledHere(true);
        setError(null);
        announce("Chat runtime installed.");
      } else if (view.status === "done") {
        setError(view.error ?? "Runtime install failed. Retry.");
        announce("Runtime install failed. Retry.", "assertive");
      } else {
        setError("Install status was lost. Check runtimes and retry if needed.");
      }
      await refresh();
    } catch {
      setError("Couldn’t check the install. Retry.");
    }
  }, 2_000, { enabled: open && activeTarget !== null });

  const install = async (target: RuntimeId) => {
    setError(null);
    setStartingTarget(target);
    try {
      const response = await fetch("/api/onboarding/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target, confirmInstall: true }),
      });
      const view = (await response.json()) as InstallView;
      if (!response.ok) {
        setError(view.hint ?? view.error ?? "Runtime install could not start. Retry.");
        await refresh();
      } else {
        setActiveTarget(target);
        announce(`Installing ${RUNTIMES.find((runtime) => runtime.id === target)?.label ?? "runtime"}.`);
      }
    } catch {
      setError("Couldn’t start the runtime install. Retry.");
    } finally {
      setStartingTarget(null);
    }
  };

  return (
    <section aria-label="Chat runtime" className="grid gap-3 rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-[var(--bg-subtle)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[length:var(--text-sm)] font-medium text-[var(--text-primary)]">Choose a chat runtime</h2>
          <p className="mt-1 text-[length:var(--text-xs)] text-[var(--text-secondary)]">A familiar needs one runtime. Sign in when you first use it.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => { setError(null); void refresh(); }} disabled={checking || startingTarget !== null || activeTarget !== null}>Refresh</Button>
      </div>
      {ready ? (
        <p role="status" className="text-[length:var(--text-xs)] text-[var(--color-success)]">Chat runtime ready. You can open Cave.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {RUNTIMES.map(({ id, label }) => (
            <Button key={id} variant="secondary" size="sm" onClick={() => void install(id)} disabled={checking || startingTarget !== null || activeTarget !== null || npmBusyLabel !== null}>
              {startingTarget === id || activeTarget === id ? `Installing ${label}…` : `Install ${label}`}
            </Button>
          ))}
        </div>
      )}
      {npmBusyLabel && !activeTarget ? <p role="status" className="text-[length:var(--text-xs)] text-[var(--text-muted)]">{npmBusyLabel} is installing. Refresh when it finishes.</p> : null}
      {error ? <p role="alert" className="text-[length:var(--text-xs)] text-[var(--danger-text)]">{error}</p> : null}
    </section>
  );
}
