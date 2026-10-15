"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSetupOpener } from "@/components/onboarding-local-setup-host";
import { useAnnouncer, type AnnounceLevel } from "@/components/ui/live-region";
import {
  fetchOnboardingBootstrapStatus,
  useOnboardingBootstrapStatus,
} from "@/lib/onboarding-bootstrap-status";
import {
  SETUP_BACKGROUNDED_EVENT,
  clearSetupBackgrounded,
  consumeSetupBackgrounded,
  markSetupBackgrounded,
} from "@/lib/setup-events";
import { useShellBanners } from "@/lib/shell-banners";
import { usePausablePoll } from "@/lib/use-pausable-poll";

/**
 * Background setup progress in the shell banner strip (#5982).
 *
 * Armed by the retained "backgrounded" latch (set when a running "Set up
 * Cave" dialog is closed) and by the live event for an already-mounted shell.
 * One banner id is updated in place — running → failed/complete — the same
 * idiom as the update banner. The dialog remains the owner of Retry and
 * diagnostics: every CTA here reopens it.
 *
 *   idle     nothing armed, no polling
 *   polling  2 s status poll while the dialog is closed; banner mirrors state
 *   settled  terminal banner (failed or complete) stays until dismissed;
 *            polling stops and the latch is cleared
 */
export const SETUP_BANNER_ID = "onboarding-setup";
const POLL_MS = 2_000;

type Phase = "idle" | "polling" | "settled";

export function SetupProgressBannerTrigger() {
  const { pushBanner, dismissBanner } = useShellBanners();
  const { announce } = useAnnouncer();
  const { state, dialogOpen } = useOnboardingBootstrapStatus();
  const { openSetup, setupHost } = useSetupOpener("banner");
  const [phase, setPhase] = useState<Phase>("idle");
  const phaseRef = useRef<Phase>("idle");
  const announcedRef = useRef("");

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const activate = useCallback(() => {
    setPhase("polling");
    announcedRef.current = "";
    void fetchOnboardingBootstrapStatus();
  }, []);

  useEffect(() => {
    if (consumeSetupBackgrounded()) activate();
    const onBackgrounded = () => {
      consumeSetupBackgrounded();
      activate();
    };
    window.addEventListener(SETUP_BACKGROUNDED_EVENT, onBackgrounded);
    return () => {
      window.removeEventListener(SETUP_BACKGROUNDED_EVENT, onBackgrounded);
      // A route change swaps shells (Workspace ↔ /settings). Re-arm so the
      // next trigger resumes the same run instead of losing it.
      if (phaseRef.current === "polling") markSetupBackgrounded();
    };
  }, [activate]);

  useEffect(() => () => dismissBanner(SETUP_BANNER_ID), [dismissBanner]);

  usePausablePoll(async () => {
    await fetchOnboardingBootstrapStatus();
  }, POLL_MS, {
    enabled: phase === "polling" && !dialogOpen,
    serialize: true,
  });

  const announceOnce = useCallback((key: string, message: string, level: AnnounceLevel = "polite") => {
    if (announcedRef.current === key) return;
    announcedRef.current = key;
    announce(message, level);
  }, [announce]);

  useEffect(() => {
    if (phase === "idle") return;
    if (dialogOpen) {
      // The dialog shows the same progress; one surface at a time. A run
      // that completes in view never echoes as a banner afterwards.
      dismissBanner(SETUP_BANNER_ID);
      if (state?.complete) {
        clearSetupBackgrounded();
        setPhase("idle");
      }
      return;
    }
    if (!state) return;
    if (state.status === "running") {
      const active = state.activeStage
        ? state.stages.find((stage) => stage.id === state.activeStage) ?? null
        : null;
      const title = active ? `Setting up Cave — ${active.label}…` : "Setting up Cave…";
      pushBanner({
        id: SETUP_BANNER_ID,
        severity: "info",
        title,
        cta: { label: "View setup", onClick: openSetup },
      });
      announceOnce(`running:${state.activeStage ?? ""}`, title);
      if (phase !== "polling") setPhase("polling");
      return;
    }
    if (state.status === "failed") {
      const stageLabel = state.failure?.stageLabel
        ?? state.stages.find((stage) => stage.status === "failed")?.label
        ?? "setup";
      const title = `Setup stopped at ${stageLabel}.`;
      pushBanner({
        id: SETUP_BANNER_ID,
        severity: "warning",
        title,
        detail: state.failure?.message,
        cta: { label: "Retry setup", onClick: openSetup },
      });
      announceOnce(
        `failed:${state.failure?.stage ?? stageLabel}`,
        state.failure?.message ? `${title} ${state.failure.message}` : title,
        "assertive",
      );
      clearSetupBackgrounded();
      if (phase !== "settled") setPhase("settled");
      return;
    }
    if (state.complete) {
      pushBanner({ id: SETUP_BANNER_ID, severity: "info", title: "Cave is set up." });
      announceOnce("complete", "Cave is set up.");
      clearSetupBackgrounded();
      if (phase !== "settled") setPhase("settled");
      return;
    }
    // Idle (unconfirmed or interrupted): nothing is running to report.
    dismissBanner(SETUP_BANNER_ID);
    clearSetupBackgrounded();
    setPhase("idle");
  }, [announceOnce, dialogOpen, dismissBanner, openSetup, phase, pushBanner, state]);

  return setupHost;
}
