import {
  readOnboardingInstall,
  startOnboardingInstall,
  type OnboardingInstallTarget,
} from "@/app/api/onboarding/install/install-service";
import { openCovenToolReadinessStatuses } from "@/lib/opencoven-tools-status";
import { probeManagedNodeToolchain } from "@/lib/server/managed-node-toolchain";
import {
  onboardingBootstrapPlatformPolicy,
  type OnboardingBootstrapStageResult,
} from "@/lib/onboarding-bootstrap";

const INSTALL_POLL_MS = 500;
const INSTALL_WAIT_MS = 6 * 60_000;

export type OnboardingCoreToolsInspection = {
  runtimeReady: boolean;
  coreToolsReady: boolean;
};

export async function inspectOnboardingCoreTools(): Promise<OnboardingCoreToolsInspection> {
  const [runtime, tools] = await Promise.all([
    probeManagedNodeToolchain(),
    openCovenToolReadinessStatuses(),
  ]);
  const core = tools.find((tool) => tool.id === "coven-cli");
  return {
    runtimeReady: runtime.status === "ready",
    coreToolsReady:
      core?.installed === true &&
      core.compatible === true &&
      core.packageVerified === true &&
      core.executableVerified === true,
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runReviewedInstall(
  target: Extract<OnboardingInstallTarget, "managed-node" | "coven-cli">,
): Promise<boolean> {
  const deadline = Date.now() + INSTALL_WAIT_MS;
  while (Date.now() < deadline) {
    const started = await startOnboardingInstall(target);
    if (started.status === 409) {
      await wait(INSTALL_POLL_MS);
      continue;
    }
    if (started.status !== 200 && started.status !== 202) return false;

    while (Date.now() < deadline) {
      const view = readOnboardingInstall(target);
      if (view.status === "done") return view.ok === true;
      if (view.status === "idle") break;
      await wait(INSTALL_POLL_MS);
    }
  }
  return false;
}

export async function ensureOnboardingCoreTools(
  onProgress: (detail: string) => Promise<void>,
): Promise<OnboardingBootstrapStageResult> {
  const policy = onboardingBootstrapPlatformPolicy(process.platform);
  if (!policy.supported) {
    return {
      ok: false,
      message:
        "Setup stopped at Prepare local components. Use a supported desktop build, then retry setup.",
    };
  }

  const before = await inspectOnboardingCoreTools();
  if (before.runtimeReady && before.coreToolsReady) {
    return {
      ok: true,
      skipped: true,
      detail: "Existing local components were verified.",
    };
  }

  if (!before.runtimeReady) {
    await onProgress("Setting up Cave’s private Node.js and npm runtime…");
    if (!(await runReviewedInstall("managed-node"))) {
      return {
        ok: false,
        message:
          "Setup stopped at Prepare local components. Cave couldn’t prepare its private Node.js and npm runtime. No Cave defaults were created. Retry setup; if it happens again, restart Cave and try once more.",
      };
    }
  }

  const afterRuntime = await inspectOnboardingCoreTools();
  if (!afterRuntime.coreToolsReady) {
    await onProgress("Installing and verifying the Coven CLI…");
    if (!(await runReviewedInstall("coven-cli"))) {
      return {
        ok: false,
        message:
          "Setup stopped at Prepare local components. Close other Cave setup windows, then retry setup.",
      };
    }
  }

  await onProgress("Verifying the local runtime and Coven CLI…");
  const verified = await inspectOnboardingCoreTools();
  if (!verified.runtimeReady || !verified.coreToolsReady) {
    return {
      ok: false,
      message:
        "Setup stopped at Prepare local components. Restart Cave, then retry setup.",
    };
  }

  return {
    ok: true,
    skipped: false,
    detail: "Cave’s local components are ready.",
  };
}
