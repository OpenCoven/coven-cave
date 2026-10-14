"use client";

import { useEffect, useState } from "react";
import { useSetupOpener } from "@/components/onboarding-local-setup-host";
import { Button } from "@/components/ui/button";
import {
  fetchOnboardingBootstrapStatus,
  summarizeOnboardingBootstrap,
  useOnboardingBootstrapStatus,
} from "@/lib/onboarding-bootstrap-status";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import { SettingsRow } from "./settings-layout";

const POLL_MS = 2_000;

/**
 * Settings › General › Setup (#5982): the re-entry point for "Set up Cave"
 * after the first-run dialog was dismissed. One GET on mount; polls only
 * while a run is in progress and the dialog is not already showing it. The
 * dialog owns Retry and diagnostics; this row only reopens it. It never
 * touches the first-run dismissal cookie.
 */
export function SetupStatusRow() {
  const { state, dialogOpen } = useOnboardingBootstrapStatus();
  const [load, setLoad] = useState<"checking" | "ready" | "failed">("checking");
  const { openSetup, setupHost } = useSetupOpener("settings");

  useEffect(() => {
    let cancelled = false;
    void fetchOnboardingBootstrapStatus().then((next) => {
      if (!cancelled) setLoad(next ? "ready" : "failed");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  usePausablePoll(async () => {
    await fetchOnboardingBootstrapStatus();
  }, POLL_MS, {
    enabled: state?.status === "running" && !dialogOpen,
    serialize: true,
  });

  const summary = summarizeOnboardingBootstrap(state);
  const checking = load === "checking" && !state;
  const unavailable = load === "failed" && !state;
  const tone = checking ? "muted" : unavailable ? "warning" : summary.tone;
  const label = checking
    ? "Checking setup…"
    : unavailable
      ? "Couldn’t load setup status"
      : summary.label;
  const detail = unavailable
    ? "Cave couldn’t reach its setup status. Open setup to check again."
    : summary.detail;

  return (
    <SettingsRow
      label="Cave setup"
      description="Local components, Cave defaults, and the local service."
      variant="sheet"
    >
      <div className="settings-setup">
        <div className="settings-setup__summary">
          <span className={`settings-setup-status settings-setup-status--${tone}`} role="status">
            <span className="settings-setup-status__dot" aria-hidden="true" />
            {label}
          </span>
          <p className="settings-setup__detail">{detail}</p>
        </div>
        <Button variant="secondary" size="xs" onClick={openSetup}>
          {summary.actionLabel}
        </Button>
      </div>
      {setupHost}
    </SettingsRow>
  );
}
