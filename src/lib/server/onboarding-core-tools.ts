import {
  readOnboardingInstall,
  startOnboardingInstall,
  type OnboardingInstallView,
  type OnboardingInstallTarget,
} from "@/app/api/onboarding/install/install-service";
import { openCovenToolReadinessStatuses } from "@/lib/opencoven-tools-status";
import {
  onboardingBootstrapPlatformPolicy,
  type OnboardingBootstrapStageResult,
  type OnboardingComponentReadiness,
  type OnboardingSetupFailureCode,
} from "@/lib/onboarding-bootstrap";
import {
  managedNodePaths,
  probeManagedNodeToolchain,
  probeManagedToolchainWriteAccess,
} from "@/lib/server/managed-node-toolchain";
import {
  createOnboardingSetupDiagnostics,
  diagnosticInstaller,
  onboardingFailureCopy,
} from "@/lib/server/onboarding-diagnostics";

const INSTALL_POLL_MS = 500;
const INSTALL_WAIT_MS = 6 * 60_000;

const FAILURE_CODES = new Set<OnboardingSetupFailureCode>([
  "application_data_not_writable",
  "filesystem_failed",
  "download_failed",
  "integrity_check_failed",
  "archive_failed",
  "install_busy",
  "install_timeout",
  "verification_failed",
  "unsupported_platform",
  "installer_start_failed",
  "local_service_failed",
  "unknown_failure",
]);

export type OnboardingCoreToolsInspection = {
  runtimeReady: boolean;
  coreToolsReady: boolean;
  components: {
    managedNode: OnboardingComponentReadiness;
    covenCli: OnboardingComponentReadiness;
  };
};

function managedNodeReadiness(
  status: "ready" | "missing" | "incompatible" | "unusable",
): OnboardingComponentReadiness {
  return status === "ready"
    ? "ready"
    : status === "missing"
      ? "missing"
      : status === "incompatible"
        ? "incompatible"
        : "unusable";
}

export async function inspectOnboardingCoreTools(): Promise<OnboardingCoreToolsInspection> {
  const [runtime, tools] = await Promise.all([
    probeManagedNodeToolchain(),
    openCovenToolReadinessStatuses(),
  ]);
  const core = tools.find((tool) => tool.id === "coven-cli");
  const coreToolsReady =
    core?.installed === true &&
    core.compatible === true &&
    core.packageVerified === true &&
    core.executableVerified === true;
  const covenCli: OnboardingComponentReadiness = coreToolsReady
    ? "ready"
    : !core?.installed
      ? "missing"
      : !core.compatible
        ? "incompatible"
        : "unusable";
  return {
    runtimeReady: runtime.status === "ready",
    coreToolsReady,
    components: {
      managedNode: managedNodeReadiness(runtime.status),
      covenCli,
    },
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ApplicationDataProbe = {
  exists: boolean | null;
  writeProbe: "passed" | "failed" | "not_run";
};

export type OnboardingCoreToolsDependencies = {
  platform: NodeJS.Platform;
  inspect: () => Promise<OnboardingCoreToolsInspection>;
  startInstall: typeof startOnboardingInstall;
  readInstall: typeof readOnboardingInstall;
  probeManagedNodeWrite: () => Promise<ApplicationDataProbe>;
  now: () => number;
  wait: (ms: number) => Promise<void>;
};

const defaultDependencies: OnboardingCoreToolsDependencies = {
  platform: process.platform,
  inspect: inspectOnboardingCoreTools,
  startInstall: startOnboardingInstall,
  readInstall: readOnboardingInstall,
  probeManagedNodeWrite: async () => {
    const paths = managedNodePaths();
    return paths
      ? probeManagedToolchainWriteAccess(paths)
      : { exists: null, writeProbe: "not_run" };
  },
  now: Date.now,
  wait,
};

type ReviewedInstallTarget = Extract<
  OnboardingInstallTarget,
  "managed-node" | "coven-cli"
>;

export type ReviewedInstallResult =
  | {
      ok: true;
      target: ReviewedInstallTarget;
      view: OnboardingInstallView;
    }
  | {
      ok: false;
      target: ReviewedInstallTarget;
      code: OnboardingSetupFailureCode;
      view: OnboardingInstallView | null;
    };

function safeFailureCode(value: unknown): OnboardingSetupFailureCode | null {
  return typeof value === "string" &&
    FAILURE_CODES.has(value as OnboardingSetupFailureCode)
    ? (value as OnboardingSetupFailureCode)
    : null;
}

function applicationDataFromView(
  view: OnboardingInstallView | null,
): ApplicationDataProbe | null {
  const applicationData = view?.applicationData;
  if (!applicationData) return null;
  const writeProbe = applicationData.writeProbe;
  if (writeProbe !== "passed" && writeProbe !== "failed") return null;
  return {
    exists:
      typeof applicationData.exists === "boolean"
        ? applicationData.exists
        : null,
    writeProbe,
  };
}

/**
 * Observe the reviewed install lane without parsing its user-facing prose.
 * The service owns classification because it knows which fixed installer ran;
 * this loop only preserves that stable result across busy and polling states.
 */
export async function runReviewedInstall(
  target: ReviewedInstallTarget,
  dependencies: OnboardingCoreToolsDependencies = defaultDependencies,
): Promise<ReviewedInstallResult> {
  const deadline = dependencies.now() + INSTALL_WAIT_MS;
  let lastView: OnboardingInstallView | null = null;
  let sawBusy = false;
  let sawRunning = false;

  while (dependencies.now() < deadline) {
    const started = await dependencies.startInstall(target);
    lastView = started.body;
    if (started.status === 409) {
      sawBusy = true;
      await dependencies.wait(INSTALL_POLL_MS);
      continue;
    }
    if (started.status !== 200 && started.status !== 202) {
      return {
        ok: false,
        target,
        code:
          safeFailureCode(lastView?.failureCode) ?? "installer_start_failed",
        view: lastView,
      };
    }

    while (dependencies.now() < deadline) {
      const view = dependencies.readInstall(target);
      lastView = view;
      if (view.status === "done") {
        return view.ok === true
          ? { ok: true, target, view }
          : {
              ok: false,
              target,
              code: safeFailureCode(view.failureCode) ?? "unknown_failure",
              view,
            };
      }
      if (view.status === "idle") break;
      sawRunning = true;
      await dependencies.wait(INSTALL_POLL_MS);
    }
  }

  return {
    ok: false,
    target,
    code: sawRunning ? "install_timeout" : sawBusy ? "install_busy" : "install_timeout",
    view: lastView,
  };
}

function stageFailure(input: {
  code: OnboardingSetupFailureCode;
  inspection: OnboardingCoreToolsInspection;
  applicationData?: ApplicationDataProbe;
  installer?: ReturnType<typeof diagnosticInstaller>;
}): OnboardingBootstrapStageResult {
  const copy = onboardingFailureCopy(input.code);
  const diagnostics = createOnboardingSetupDiagnostics({
    stage: "core-tools",
    code: input.code,
    applicationData: input.applicationData,
    components: {
      managedNode: input.inspection.components.managedNode,
      covenCli: input.inspection.components.covenCli,
      localService:
        input.code === "local_service_failed" ? "not_ready" : "not_checked",
    },
    installer: input.installer,
  });
  return {
    ok: false,
    code: input.code,
    nextStep: copy.nextStep,
    diagnostics,
    message: `Setup stopped at Prepare local components. ${copy.summary} ${copy.nextStep}`,
  };
}

function busyStatus(result: ReviewedInstallResult): "busy" | undefined {
  return !result.ok && result.code === "install_busy" ? "busy" : undefined;
}

export async function ensureOnboardingCoreTools(
  onProgress: (detail: string) => Promise<void>,
  dependencies: OnboardingCoreToolsDependencies = defaultDependencies,
): Promise<OnboardingBootstrapStageResult> {
  const policy = onboardingBootstrapPlatformPolicy(dependencies.platform);
  if (!policy.supported) {
    const inspection: OnboardingCoreToolsInspection = {
      runtimeReady: false,
      coreToolsReady: false,
      components: { managedNode: "not_checked", covenCli: "not_checked" },
    };
    return stageFailure({ code: "unsupported_platform", inspection });
  }

  let inspection = await dependencies.inspect();
  if (inspection.runtimeReady && inspection.coreToolsReady) {
    return {
      ok: true,
      skipped: true,
      detail: "Existing local components were verified.",
    };
  }

  let lastInstaller: ReturnType<typeof diagnosticInstaller> | undefined;

  if (!inspection.runtimeReady) {
    await onProgress("Setting up Cave’s private Node.js and npm runtime…");
    const result = await runReviewedInstall("managed-node", dependencies);
    lastInstaller = diagnosticInstaller(
      result.target,
      result.view,
      busyStatus(result),
    );
    if (!result.ok) {
      let applicationData = applicationDataFromView(result.view);
      if (
        !applicationData &&
        (result.code === "application_data_not_writable" ||
          result.code === "filesystem_failed")
      ) {
        applicationData = await dependencies.probeManagedNodeWrite();
      }
      applicationData ??= { exists: null, writeProbe: "not_run" };
      const code =
        result.code === "application_data_not_writable" &&
        applicationData.writeProbe !== "failed"
          ? "filesystem_failed"
          : result.code === "filesystem_failed" &&
              applicationData.writeProbe === "failed"
            ? "application_data_not_writable"
            : result.code;
      inspection = await dependencies.inspect();
      return stageFailure({
        code,
        inspection,
        applicationData,
        installer: lastInstaller,
      });
    }
  }

  inspection = await dependencies.inspect();
  if (!inspection.coreToolsReady) {
    await onProgress("Installing and verifying the Coven CLI…");
    const result = await runReviewedInstall("coven-cli", dependencies);
    lastInstaller = diagnosticInstaller(
      result.target,
      result.view,
      busyStatus(result),
    );
    if (!result.ok) {
      inspection = await dependencies.inspect();
      return stageFailure({
        code: result.code,
        inspection,
        installer: lastInstaller,
      });
    }
  }

  await onProgress("Verifying the local runtime and Coven CLI…");
  inspection = await dependencies.inspect();
  if (!inspection.runtimeReady || !inspection.coreToolsReady) {
    return stageFailure({
      code: "verification_failed",
      inspection,
      installer: lastInstaller,
    });
  }

  return {
    ok: true,
    skipped: false,
    detail: "Cave’s local components are ready.",
  };
}
