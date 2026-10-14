"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { OnboardingOverlay } from "@/components/lazy-surfaces";
import {
  SETUP_OPEN_EVENT,
  registerSetupHost,
  requestOpenSetup,
  type SetupOpenOrigin,
} from "@/lib/setup-events";

/**
 * Fallback host for the "Set up Cave" dialog on routes without a Workspace
 * (#5982). `/settings` is a standalone Next route: nothing there listens for
 * `cave:onboarding-open`, so the Setup row and the progress banner would
 * otherwise dispatch into silence. The first fallback open mounts this host;
 * it then registers itself, so a second caller on the same route reuses it
 * through the ordinary event instead of stacking a second overlay.
 */
function LocalSetupOverlayHost({
  open,
  onOpen,
  onDismiss,
}: {
  open: boolean;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const unregister = registerSetupHost();
    const listener = () => onOpen();
    window.addEventListener(SETUP_OPEN_EVENT, listener);
    return () => {
      window.removeEventListener(SETUP_OPEN_EVENT, listener);
      unregister();
    };
  }, [onOpen]);
  return <OnboardingOverlay open={open} onDismiss={onDismiss} />;
}

/** `openSetup` prefers a registered host (the Workspace); `setupHost` renders
 *  the lazy local overlay only after a fallback open was needed. */
export function useSetupOpener(origin: SetupOpenOrigin): {
  openSetup: () => void;
  setupHost: ReactNode;
} {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const onOpen = useCallback(() => setOpen(true), []);
  const onDismiss = useCallback(() => setOpen(false), []);
  const openSetup = useCallback(() => {
    if (requestOpenSetup(origin)) return;
    setMounted(true);
    setOpen(true);
  }, [origin]);
  const setupHost = mounted ? (
    <LocalSetupOverlayHost open={open} onOpen={onOpen} onDismiss={onDismiss} />
  ) : null;
  return { openSetup, setupHost };
}
