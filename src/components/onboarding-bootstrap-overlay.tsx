"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OnboardingSetupDiagnosticsModal } from "@/components/onboarding-setup-diagnostics";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import { Icon } from "@/lib/icon";
import {
  ONBOARDING_BOOTSTRAP_BOUNDARIES,
  createOnboardingBootstrapState,
  type OnboardingBootstrapState,
  type OnboardingBootstrapStageStatus,
} from "@/lib/onboarding-bootstrap";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { usePausablePoll } from "@/lib/use-pausable-poll";

type Props = {
  open: boolean;
  onDismiss: () => void;
  autoFinishWhenComplete?: boolean;
  initialState?: OnboardingBootstrapState;
};

type BootstrapResponse = OnboardingBootstrapState & {
  ok: true;
  boundaries: typeof ONBOARDING_BOOTSTRAP_BOUNDARIES;
};

const STATUS_TIMEOUT_MS = 5_000;
const POLL_MS = 1_000;

function stageIcon(status: OnboardingBootstrapStageStatus) {
  if (status === "complete" || status === "skipped") {
    return "ph:check-circle-fill" as const;
  }
  if (status === "failed") return "ph:warning-fill" as const;
  if (status === "running") return "ph:circle-notch-bold" as const;
  return "ph:sparkle-bold" as const;
}

function stageTone(status: OnboardingBootstrapStageStatus): string {
  if (status === "complete" || status === "skipped") {
    return "border-[color-mix(in_oklch,var(--color-success)_40%,var(--border-hairline))] text-[var(--color-success)]";
  }
  if (status === "failed") {
    return "border-[var(--danger-border)] text-[var(--danger-text)]";
  }
  if (status === "running") {
    return "border-[color-mix(in_oklch,var(--accent-presence)_45%,var(--border-hairline))] text-[var(--accent-presence)]";
  }
  return "border-[var(--border-hairline)] text-[var(--text-muted)]";
}

export function OnboardingOverlay({
  open,
  onDismiss,
  autoFinishWhenComplete = false,
  initialState,
}: Props) {
  const [state, setState] = useState<OnboardingBootstrapState>(
    () => initialState ?? createOnboardingBootstrapState(),
  );
  const [loading, setLoading] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const diagnosticsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const restoreDiagnosticsFocusRef = useRef(false);
  const autoFinishFiredRef = useRef(false);
  const requestQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const { announce } = useAnnouncer();

  const persistDismissal = useCallback(() => {
    try {
      localStorage.setItem("cave:onboarding:dismissed", "1");
    } catch {
      /* private mode */
    }
    try {
      document.cookie = "cave_onboarding_dismissed=1; Path=/; Max-Age=31536000; SameSite=Lax";
    } catch {
      /* embedded browser storage disabled */
    }
  }, []);

  const dismiss = useCallback(() => {
    if (!state.confirmed) persistDismissal();
    onDismiss();
  }, [onDismiss, persistDismissal, state.confirmed]);

  const finish = useCallback(() => {
    persistDismissal();
    onDismiss();
  }, [onDismiss, persistDismissal]);

  useFocusTrap(open && !diagnosticsOpen, dialogRef, { onEscape: dismiss });

  useEffect(() => {
    if (diagnosticsOpen || !restoreDiagnosticsFocusRef.current) return;
    restoreDiagnosticsFocusRef.current = false;
    const frame = requestAnimationFrame(() => {
      diagnosticsTriggerRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [diagnosticsOpen]);

  const closeDiagnostics = useCallback(() => {
    restoreDiagnosticsFocusRef.current = true;
    setDiagnosticsOpen(false);
  }, []);

  const performRequest = useCallback(
    async (method: "GET" | "POST", body?: object) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);
      setLoading(true);
      try {
        const response = await fetch("/api/onboarding/bootstrap", {
          method,
          cache: "no-store",
          signal: controller.signal,
          headers: body ? { "content-type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        const json = (await response.json().catch(() => null)) as
          | BootstrapResponse
          | { error?: string }
          | null;
        if (!response.ok || !json || !("ok" in json) || json.ok !== true) {
          throw new Error(json && "error" in json && json.error
            ? json.error
            : "setup request failed");
        }
        setState(json);
        setRequestError(null);
        return json;
      } catch (error) {
        setRequestError(
          error instanceof Error && error.name === "AbortError"
            ? "Couldn’t reach setup in time."
            : "Couldn’t load setup.",
        );
        return null;
      } finally {
        clearTimeout(timeout);
        setLoading(false);
      }
    },
    [],
  );

  const request = useCallback(
    (method: "GET" | "POST", body?: object) => {
      const queued = requestQueueRef.current.then(() =>
        performRequest(method, body),
      );
      requestQueueRef.current = queued.then(
        () => undefined,
        () => undefined,
      );
      return queued;
    },
    [performRequest],
  );

  useEffect(() => {
    if (!open || initialState) return;
    void request("GET");
  }, [initialState, open, request]);

  useEffect(() => {
    if (!open || !state.failure?.diagnostics) setDiagnosticsOpen(false);
  }, [open, state.failure?.diagnostics]);

  useEffect(() => {
    if (!open || !state.confirmed || state.complete || state.status !== "idle") {
      return;
    }
    void request("POST", { resume: true });
  }, [open, request, state.complete, state.confirmed, state.status]);

  usePausablePoll(async () => {
    await request("GET");
  }, POLL_MS, {
    enabled: open && state.status === "running",
  });

  const previousAnnouncementRef = useRef("");
  useEffect(() => {
    if (!open) {
      previousAnnouncementRef.current = "";
      return;
    }
    const active = state.activeStage
      ? state.stages.find((stage) => stage.id === state.activeStage)
      : null;
    const announcementKey = [
      state.status,
      state.activeStage ?? "",
      active?.detail ?? "",
    ].join(":");
    if (previousAnnouncementRef.current === announcementKey) return;
    previousAnnouncementRef.current = announcementKey;
    if (state.status === "running" && state.activeStage) {
      if (active) announce(`${active.label}. ${active.detail}`);
    } else if (state.status === "failed" && state.failure) {
      announce(state.failure.message, "assertive");
    } else if (state.complete) {
      announce("Cave setup complete.");
    }
  }, [announce, open, state]);

  useEffect(() => {
    if (!open || !autoFinishWhenComplete || !state.complete) {
      autoFinishFiredRef.current = false;
      return;
    }
    if (autoFinishFiredRef.current) return;
    autoFinishFiredRef.current = true;
    const timer = setTimeout(finish, 700);
    return () => clearTimeout(timer);
  }, [autoFinishWhenComplete, finish, open, state.complete]);

  if (!open) return null;

  const running = state.status === "running";
  const started = state.confirmed || running || state.status === "failed";

  return (
    <>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal={diagnosticsOpen ? undefined : true}
        inert={diagnosticsOpen || undefined}
        aria-label="Set up Cave"
        tabIndex={-1}
        className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[color-mix(in_oklch,var(--bg-base)_94%,transparent)] p-4 backdrop-blur-sm"
      >
      <section className="w-full max-w-2xl rounded-[var(--radius-panel)] border border-[var(--border-hairline)] bg-[var(--bg-raised)] shadow-[var(--shadow-elevated)]">
        <header className="flex items-start justify-between gap-4 border-b border-[var(--border-hairline)] p-5">
          <div>
            <p className="font-mono text-[length:var(--text-2xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[var(--text-muted)]">
              First run
            </p>
            <h1 className="mt-1 font-display text-[length:var(--text-xl)] font-semibold text-[var(--text-primary)]">
              Set up Cave
            </h1>
            <p className="mt-2 max-w-xl text-[length:var(--text-sm)] leading-5 text-[var(--text-secondary)]">
              One confirmation prepares Cave’s local components, creates your
              defaults, and starts the local service. Existing setup is kept.
            </p>
          </div>
          <button
            type="button"
            aria-label={running ? "Run setup in background" : "Close setup"}
            onClick={dismiss}
            className="focus-ring grid size-8 shrink-0 place-items-center rounded-[var(--radius-control)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <Icon name="ph:x-bold" aria-hidden />
          </button>
        </header>

        <div className="space-y-4 p-5">
          <ol aria-label="Setup progress" className="grid gap-2">
            {state.stages.map((stage) => (
              <li
                key={stage.id}
                aria-current={state.activeStage === stage.id ? "step" : undefined}
                className={`flex items-start gap-3 rounded-[var(--radius-card)] border bg-[var(--bg-base)] p-3 ${stageTone(stage.status)}`}
              >
                <Icon
                  name={stageIcon(stage.status)}
                  className={`mt-0.5 shrink-0 ${stage.status === "running" ? "motion-safe:animate-spin" : ""}`}
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="text-[length:var(--text-sm)] font-medium text-[var(--text-primary)]">
                    {stage.label}
                  </p>
                  <p className="mt-0.5 text-[length:var(--text-xs)] leading-4 text-[var(--text-secondary)]">
                    {stage.detail}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          {state.failure ? (
            <div
              role="alert"
              className="rounded-[var(--radius-card)] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3"
            >
              <p className="text-[length:var(--text-sm)] font-medium text-[var(--danger-text)]">
                {state.failure.stageLabel} is blocked
              </p>
              <p className="mt-1 text-[length:var(--text-xs)] leading-4 text-[var(--text-secondary)]">
                {state.failure.message}
              </p>
              {state.failure.stage === "core-tools" ? (
                <p className="mt-2 text-[length:var(--text-xs)] leading-4 text-[var(--text-secondary)]">
                  This step prepares Cave’s private Node.js/npm runtime and the Coven CLI. It does not create Cave defaults or start a familiar runtime.
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  loading={loading}
                  onClick={() => void request("POST", { resume: true })}
                >
                  {state.failure.recoveryLabel}
                </Button>
                {state.failure.diagnostics ? (
                  <Button
                    ref={diagnosticsTriggerRef}
                    variant="secondary"
                    size="sm"
                    onClick={() => setDiagnosticsOpen(true)}
                  >
                    View diagnostics
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          {requestError ? (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3"
            >
              <p className="text-[length:var(--text-xs)] text-[var(--danger-text)]">
                {requestError} Retry setup.
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void request("GET")}
              >
                Retry
              </Button>
            </div>
          ) : null}

          <div className="grid gap-2 rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-[var(--bg-subtle)] p-3 text-[length:var(--text-xs)] leading-4 text-[var(--text-secondary)]">
            <p className="flex items-start gap-2">
              <Icon name="ph:key-bold" className="mt-0.5 shrink-0" aria-hidden />
              {ONBOARDING_BOOTSTRAP_BOUNDARIES.credentials}
            </p>
            <p className="flex items-start gap-2">
              <Icon name="ph:check-circle-fill" className="mt-0.5 shrink-0" aria-hidden />
              {ONBOARDING_BOOTSTRAP_BOUNDARIES.elevation}
            </p>
            <p className="flex items-start gap-2">
              <Icon name="ph:git-branch-bold" className="mt-0.5 shrink-0" aria-hidden />
              {ONBOARDING_BOOTSTRAP_BOUNDARIES.git}
            </p>
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-hairline)] p-5">
          <p role="status" className="text-[length:var(--text-xs)] text-[var(--text-muted)]">
            {state.complete
              ? "Cave is ready."
              : running
                ? "Setup continues if you close this window."
                : started
                  ? "Setup is ready to resume."
                  : "No provider credentials or administrator access are requested."}
          </p>
          <div className="flex items-center gap-2">
            {!started && !state.complete ? (
              <>
                <Button variant="ghost" onClick={dismiss}>
                  Not now
                </Button>
                <Button
                  variant="primary"
                  loading={loading}
                  onClick={() => void request("POST", { confirm: true })}
                >
                  Set up Cave
                </Button>
              </>
            ) : state.complete ? (
              <Button variant="primary" onClick={finish}>
                Open Cave
              </Button>
            ) : running ? (
              <Button variant="secondary" onClick={onDismiss}>
                Run in background
              </Button>
            ) : null}
          </div>
        </footer>
      </section>
      </div>
      {state.failure?.diagnostics && diagnosticsOpen ? (
        <OnboardingSetupDiagnosticsModal
          diagnostics={state.failure.diagnostics}
          open
          onClose={closeDiagnostics}
        />
      ) : null}
    </>
  );
}
