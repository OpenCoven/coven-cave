"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import { openSystemBrowserUrl } from "@/lib/open-external";
import type { PairingStep } from "@/lib/surfaces/mobile-handoff";
import {
  launchTailscaleDesktopApp,
  pairingRecoveryFailureKind,
  retryPairingAfterTailscaleLaunch,
  TAILSCALE_DOWNLOAD_URL,
  type PairingRecoveryAttempt,
} from "@/lib/tailscale-recovery";
import { useIsTauriDesktop } from "@/lib/tauri-platform";

export function TailscaleRecoveryActions({
  failure,
  steps,
  busy = false,
  attempt,
  className,
}: {
  failure?: string | null;
  steps?: PairingStep[] | null;
  busy?: boolean;
  attempt: () => Promise<PairingRecoveryAttempt>;
  className?: string;
}) {
  const isDesktop = useIsTauriDesktop();
  const [recovering, setRecovering] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const { announce } = useAnnouncer();
  const failureKind = pairingRecoveryFailureKind({
    ok: false,
    error: failure ?? undefined,
    steps: steps ?? undefined,
  });
  const canOpenTailscale =
    isDesktop && (failureKind === "not-running" || failureKind === "signed-out");
  const canInstallTailscale = failureKind === "not-installed" || launchError !== null;
  const disabled = busy || recovering;

  const retry = async () => {
    setLaunchError(null);
    setRecovering(true);
    try {
      const result = await attempt();
      announce(
        result.ok ? "Pairing code ready." : "Phone pairing still needs attention.",
        result.ok ? "polite" : "assertive",
      );
    } finally {
      setRecovering(false);
    }
  };

  const openTailscale = async () => {
    setLaunchError(null);
    setRecovering(true);
    try {
      const launched = await launchTailscaleDesktopApp();
      if (!launched.ok) {
        setLaunchError(launched.error);
        announce(launched.error, "assertive");
        return;
      }

      announce("Tailscale opened. Waiting for it to connect.", "polite");
      const result = await retryPairingAfterTailscaleLaunch({ attempt });
      announce(
        result.ok
          ? "Tailscale connected. Pairing code ready."
          : "Tailscale still needs attention. Finish signing in, then retry.",
        result.ok ? "polite" : "assertive",
      );
    } finally {
      setRecovering(false);
    }
  };

  const installTailscale = async () => {
    const opened = await openSystemBrowserUrl(TAILSCALE_DOWNLOAD_URL);
    announce(
      opened ? "Tailscale download opened." : "Couldn’t open the Tailscale download.",
      opened ? "polite" : "assertive",
    );
  };

  return (
    <div className={`flex flex-wrap items-center justify-end gap-2 ${className ?? ""}`}>
      {canInstallTailscale ? (
        <Button
          size="xs"
          variant="secondary"
          leadingIcon="ph:download-simple"
          disabled={disabled}
          onClick={() => void installTailscale()}
        >
          Install Tailscale
        </Button>
      ) : null}
      {canOpenTailscale ? (
        <Button
          size="xs"
          variant="secondary"
          leadingIcon="ph:arrow-square-out"
          disabled={disabled}
          onClick={() => void openTailscale()}
        >
          {recovering ? "Waiting for Tailscale…" : "Open Tailscale"}
        </Button>
      ) : null}
      <Button
        size="xs"
        variant="secondary"
        leadingIcon="ph:arrows-clockwise"
        disabled={disabled}
        onClick={() => void retry()}
      >
        Retry
      </Button>
      {launchError ? (
        <p
          role="alert"
          className="basis-full text-right text-[length:var(--text-xs)] text-[var(--color-warning)]"
        >
          {launchError}
        </p>
      ) : null}
    </div>
  );
}
