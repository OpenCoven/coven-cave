"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { OnboardingOverlay } from "@/components/onboarding-bootstrap-overlay";
import type { OnboardingBootstrapState } from "@/lib/onboarding-bootstrap";

const WorkspaceApp = dynamic(
  () => import("@/components/workspace-app").then((module) => module.WorkspaceApp),
  { ssr: false, loading: () => null },
);

const ONBOARDING_DISMISSED_KEY = "cave:onboarding:dismissed";

function wasDismissed(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDING_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The server has already established that setup is unfinished. Render its
 * hydrated dialog as the first surface and defer the Workspace bundle until a
 * user explicitly leaves setup. The localStorage check bridges dismissals made
 * before the server-readable cookie was introduced.
 */
export function OnboardingStartupGate({
  initialState,
}: {
  initialState: OnboardingBootstrapState;
}) {
  const [showWorkspace, setShowWorkspace] = useState(false);

  useEffect(() => {
    if (!initialState.confirmed && wasDismissed()) {
      setShowWorkspace(true);
    }
  }, [initialState.confirmed]);

  if (showWorkspace) return <WorkspaceApp />;

  return (
    <OnboardingOverlay
      autoFinishWhenComplete
      initialState={initialState}
      open
      onDismiss={() => setShowWorkspace(true)}
    />
  );
}
