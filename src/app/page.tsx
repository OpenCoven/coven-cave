import { cookies } from "next/headers";
import { OnboardingStartupGate } from "@/components/onboarding-startup-gate";
import { WorkspaceApp } from "@/components/workspace-app";
import { shouldAutoOpenOnboardingBootstrap } from "@/lib/onboarding-gate";
import { onboardingBootstrapStatus } from "@/lib/server/onboarding-bootstrap";

export default async function Home() {
  const [bootstrap, cookieStore] = await Promise.all([
    onboardingBootstrapStatus(),
    cookies(),
  ]);
  const dismissed = cookieStore.get("cave_onboarding_dismissed")?.value === "1";

  if (
    shouldAutoOpenOnboardingBootstrap(bootstrap) &&
    (bootstrap.confirmed || !dismissed)
  ) {
    return <OnboardingStartupGate initialState={bootstrap} />;
  }

  return <WorkspaceApp />;
}
