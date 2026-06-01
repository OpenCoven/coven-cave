"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";

type Step = { ok: boolean; detail?: string; hint?: string };

type OnboardingStatus = {
  complete: boolean;
  steps: {
    covenCli: Step;
    covenHome: Step;
    daemon: Step;
    familiars: Step;
    binding: Step;
  };
};

type Template = {
  id: string;
  label: string;
  blurb: string;
  harness: "claude" | "codex";
  model: string;
  accent: string;
};

const TEMPLATES: Template[] = [
  {
    id: "claude",
    label: "Claude Sonnet 4.6",
    blurb: "Recommended. Strong reasoning, fast streaming. Needs an Anthropic API key.",
    harness: "claude",
    model: "anthropic/claude-sonnet-4-6",
    accent: "from-purple-500/20 to-fuchsia-500/10 border-purple-700/40",
  },
  {
    id: "codex",
    label: "Codex GPT-5",
    blurb: "OpenAI Codex CLI. Solid coding partner. Needs an OpenAI key in the Codex config.",
    harness: "codex",
    model: "openai/gpt-5",
    accent: "from-emerald-500/20 to-teal-500/10 border-emerald-700/40",
  },
];

type Props = {
  open: boolean;
  onDismiss: () => void;
};

export function OnboardingOverlay({ open, onDismiss }: Props) {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [startingDaemon, setStartingDaemon] = useState(false);
  const [pickedTemplate, setPickedTemplate] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/onboarding/status", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as OnboardingStatus & { ok: boolean };
      setStatus(json);
    } catch {
      /* ignore — next poll will retry */
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
    pollRef.current = setInterval(refresh, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [open, refresh]);

  // Auto-dismiss when fully complete (brief celebratory beat).
  useEffect(() => {
    if (!open || !status?.complete) return;
    const t = setTimeout(onDismiss, 1200);
    return () => clearTimeout(t);
  }, [open, status?.complete, onDismiss]);

  const runSetup = async (tmpl: Template) => {
    setPicking(tmpl.id);
    setPickedTemplate(tmpl.id);
    try {
      await fetch("/api/onboarding/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ harness: tmpl.harness, model: tmpl.model }),
      });
      await refresh();
    } finally {
      setPicking(null);
    }
  };

  const scaffoldOnly = async () => {
    setPicking("scaffold");
    try {
      await fetch("/api/onboarding/setup", { method: "POST" });
      await refresh();
    } finally {
      setPicking(null);
    }
  };

  const startDaemon = async () => {
    setStartingDaemon(true);
    try {
      await fetch("/api/daemon/start", { method: "POST" });
      await refresh();
    } finally {
      setStartingDaemon(false);
    }
  };

  const installCmd = "brew install opencoven/tap/coven";
  const copyInstall = async () => {
    try {
      await navigator.clipboard.writeText(installCmd);
    } catch {
      /* clipboard blocked — user can still copy manually */
    }
  };

  const steps = useMemo(() => {
    const s = status?.steps;
    return [
      {
        key: "covenCli",
        title: "Install the coven CLI",
        ok: !!s?.covenCli.ok,
        detail: s?.covenCli.detail ?? s?.covenCli.hint ?? "checking…",
        action: s?.covenCli.ok ? null : (
          <div className="mt-2 space-y-2">
            <div className="flex items-center gap-2 rounded-md border border-[--border-hairline] bg-[--bg-base] px-3 py-2 font-mono text-[12px] text-[--text-primary]">
              <span className="text-[--text-muted]">$</span>
              <code className="flex-1">{installCmd}</code>
              <button
                onClick={copyInstall}
                className="rounded border border-[--border-hairline] px-2 py-0.5 text-[11px] text-[--text-secondary] hover:bg-[--bg-raised]"
              >
                copy
              </button>
            </div>
            <p className="text-[11px] text-[--text-muted]">
              Or see{" "}
              <span className="font-mono text-[--text-secondary]">github.com/OpenCoven/coven</span>{" "}
              for other install paths. Re-checks every 2s.
            </p>
          </div>
        ),
      },
      {
        key: "covenHome",
        title: "Create your ~/.coven home",
        ok: !!s?.covenHome.ok,
        detail: s?.covenHome.detail ?? s?.covenHome.hint ?? "checking…",
        action: s?.covenHome.ok ? null : (
          <button
            onClick={scaffoldOnly}
            disabled={picking === "scaffold"}
            className="mt-2 rounded-md border border-[--border-hairline] bg-[--bg-raised] px-3 py-1.5 text-[12px] text-[--text-primary] hover:bg-[--bg-raised] disabled:opacity-50"
          >
            {picking === "scaffold" ? "creating…" : "Create ~/.coven"}
          </button>
        ),
      },
      {
        key: "binding",
        title: "Pick your first familiar",
        ok: !!s?.binding.ok && !!pickedTemplate,
        detail: s?.binding.detail ?? s?.binding.hint ?? "checking…",
        action: (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {TEMPLATES.map((tmpl) => {
              const active = pickedTemplate === tmpl.id;
              return (
                <button
                  key={tmpl.id}
                  onClick={() => void runSetup(tmpl)}
                  disabled={picking !== null}
                  className={`rounded-lg border bg-gradient-to-br p-3 text-left transition disabled:opacity-50 ${
                    active
                      ? `${tmpl.accent} ring-1 ring-white/20`
                      : "border-[--border-hairline] from-[--bg-raised]/40 to-[--bg-raised]/10 hover:border-[--border-strong]"
                  }`}
                >
                  <div className="text-[13px] font-medium text-[--text-primary]">{tmpl.label}</div>
                  <div className="mt-0.5 text-[11px] text-[--text-secondary]">{tmpl.blurb}</div>
                  {active ? (
                    <div className="mt-1.5 flex items-center gap-1 font-mono text-[10px] text-emerald-300">
                      <Icon name="ph:check-bold" />
                      <span>saved</span>
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        ),
      },
      {
        key: "daemon",
        title: "Start the coven daemon",
        ok: !!s?.daemon.ok,
        detail: s?.daemon.detail ?? s?.daemon.hint ?? "checking…",
        action: s?.daemon.ok ? null : (
          <button
            onClick={startDaemon}
            disabled={startingDaemon || !s?.covenCli.ok}
            className="mt-2 rounded-md border border-[--border-hairline] bg-[--bg-raised] px-3 py-1.5 text-[12px] text-[--text-primary] hover:bg-[--bg-raised] disabled:opacity-50"
            title={!s?.covenCli.ok ? "Install coven CLI first" : "Run `coven daemon start`"}
          >
            {startingDaemon ? "starting…" : "Start daemon"}
          </button>
        ),
      },
      {
        key: "familiars",
        title: "Load familiars",
        ok: !!s?.familiars.ok,
        detail: s?.familiars.detail ?? s?.familiars.hint ?? "checking…",
        action: null,
      },
    ];
  }, [status, picking, pickedTemplate, startingDaemon]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[--bg-base]/95 backdrop-blur-sm">
      <div className="w-[540px] max-w-[94vw] max-h-[92vh] overflow-y-auto rounded-2xl border border-[--border-hairline] bg-[--bg-base] p-7 shadow-2xl">
        <div className="mb-5">
          <div className="text-[11px] uppercase tracking-wider text-purple-300/80">Welcome</div>
          <h1 className="mt-1 text-xl font-semibold text-[--text-primary]">Let's wake your Coven.</h1>
          <p className="mt-1 text-[13px] text-[--text-secondary]">
            Five quick checks. Cave handles what it can; you handle the rest. Status refreshes automatically.
          </p>
        </div>

        <ol className="space-y-4">
          {steps.map((s, i) => (
            <li
              key={s.key}
              className={`rounded-xl border p-4 transition-colors ${
                s.ok ? "border-emerald-700/40 bg-emerald-950/15" : "border-[--border-hairline] bg-[--bg-raised]/30"
              }`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[12px] font-medium ${
                    s.ok
                      ? "border-emerald-600 bg-emerald-600/20 text-emerald-300"
                      : "border-[--border-strong] bg-[--bg-raised] text-[--text-secondary]"
                  }`}
                >
                  {s.ok ? <Icon name="ph:check-bold" /> : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-[--text-primary]">{s.title}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-[--text-muted] truncate">{s.detail}</div>
                  {s.action}
                </div>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-6 flex items-center justify-between">
          <button
            onClick={() => {
              try {
                localStorage.setItem("cave:onboarding:dismissed", "1");
              } catch {
                /* private mode */
              }
              onDismiss();
            }}
            className="text-[11px] text-[--text-muted] hover:text-[--text-secondary]"
          >
            Skip for now
          </button>
          {status?.complete ? (
            <button
              onClick={onDismiss}
              className="rounded-md bg-emerald-500/90 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-emerald-400"
            >
              Open Cave →
            </button>
          ) : (
            <span className="text-[11px] text-[--text-muted]">
              {Object.values(status?.steps ?? {}).filter((s) => s.ok).length}/5 ready
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
