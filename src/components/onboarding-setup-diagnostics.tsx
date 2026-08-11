"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import { Modal } from "@/components/ui/modal";
import { copyText } from "@/lib/clipboard";
import {
  ONBOARDING_BOOTSTRAP_STAGES,
  type OnboardingComponentReadiness,
  type OnboardingSetupDiagnostics,
} from "@/lib/onboarding-bootstrap";

type Props = {
  diagnostics: OnboardingSetupDiagnostics;
  open: boolean;
  onClose: () => void;
};

type CopyStatus = "idle" | "copied" | "failed";

const READINESS_LABELS: Record<OnboardingComponentReadiness, string> = {
  ready: "Ready",
  missing: "Missing",
  incompatible: "Incompatible",
  unusable: "Unavailable",
  not_ready: "Not ready",
  not_checked: "Not checked",
  unknown: "Unknown",
};

function yesNoUnknown(value: boolean | null): string {
  return value === true ? "Yes" : value === false ? "No" : "Unknown";
}

function writeProbeLabel(
  value: OnboardingSetupDiagnostics["applicationData"]["writeProbe"],
): string {
  return value === "passed"
    ? "Passed at capture time"
    : value === "failed"
      ? "Failed at capture time"
      : "Not run";
}

function stageLabel(diagnostics: OnboardingSetupDiagnostics): string {
  return (
    ONBOARDING_BOOTSTRAP_STAGES.find(
      (stage) => stage.id === diagnostics.stage,
    )?.label ?? diagnostics.stage
  );
}

export function formatOnboardingSetupDiagnostics(
  diagnostics: OnboardingSetupDiagnostics,
): string {
  const lines = [
    "Cave first-run setup diagnostics",
    `Captured: ${diagnostics.capturedAt}`,
    `Stage: ${stageLabel(diagnostics)}`,
    `Failure code: ${diagnostics.code}`,
    `Summary: ${diagnostics.summary}`,
    `Next step: ${diagnostics.nextStep}`,
    "",
    `Cave version: ${diagnostics.environment.appVersion}`,
    `Platform: ${diagnostics.environment.platform}/${diagnostics.environment.architecture}`,
    `Application data: ${diagnostics.applicationData.displayLocation}`,
    `Application-data directory exists: ${yesNoUnknown(diagnostics.applicationData.exists)}`,
    `Write probe: ${writeProbeLabel(diagnostics.applicationData.writeProbe)}`,
    `Managed Node.js: ${READINESS_LABELS[diagnostics.components.managedNode]}`,
    `Coven CLI: ${READINESS_LABELS[diagnostics.components.covenCli]}`,
    `Local service: ${READINESS_LABELS[diagnostics.components.localService]}`,
  ];

  if (diagnostics.installer) {
    lines.push(
      "",
      `Installer target: ${diagnostics.installer.target}`,
      `Installer status: ${diagnostics.installer.status}`,
      `Installer elapsed ms: ${diagnostics.installer.elapsedMs ?? "Unavailable"}`,
      `Installer exit code: ${diagnostics.installer.exitCode ?? "Unavailable"}`,
    );
    if (diagnostics.installer.outputTail.length > 0) {
      lines.push("Installer output (sanitized, bounded):");
      lines.push(...diagnostics.installer.outputTail);
    }
  }

  lines.push(
    "",
    "Privacy: credentials, URL query values, and local filesystem paths are omitted.",
  );
  return lines.join("\n");
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 border-b border-[var(--border-hairline)] py-2 last:border-b-0 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-4">
      <dt className="text-[length:var(--text-xs)] font-medium text-[var(--text-muted)]">
        {label}
      </dt>
      <dd className="min-w-0 break-words text-[length:var(--text-xs)] text-[var(--text-primary)]">
        {value}
      </dd>
    </div>
  );
}

export function OnboardingSetupDiagnosticsModal({
  diagnostics,
  open,
  onClose,
}: Props) {
  const descriptionId = useId();
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const { announce } = useAnnouncer();

  const copyDiagnostics = async () => {
    const copied = await copyText(formatOnboardingSetupDiagnostics(diagnostics));
    setCopyStatus(copied ? "copied" : "failed");
    const feedback = copied
      ? "Diagnostics copied."
      : "Couldn’t copy diagnostics. Select the report and copy it manually.";
    announce(
      feedback,
      copied ? "polite" : "assertive",
    );
  };

  const installer = diagnostics.installer;

  return (
    <Modal
      open={open}
      onClose={onClose}
      breadcrumb={["First run", "Setup diagnostics"]}
      ariaDescribedBy={descriptionId}
      wide
      footerActions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="primary"
            leadingIcon="ph:clipboard-text"
            onClick={() => void copyDiagnostics()}
          >
            {copyStatus === "copied"
              ? "Copied"
              : copyStatus === "failed"
                ? "Copy failed"
                : "Copy diagnostics"}
          </Button>
        </>
      }
    >
      <div className="select-text space-y-4">
        <div>
          <p
            id={descriptionId}
            className="text-[length:var(--text-sm)] leading-5 text-[var(--text-secondary)]"
          >
            Safe details from the failed setup stage. Local paths, URL query
            values, and credentials are omitted before this report is stored or
            copied.
          </p>
          <div className="mt-3 rounded-[var(--radius-card)] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3">
            <p className="text-[length:var(--text-sm)] font-medium text-[var(--danger-text)]">
              {diagnostics.summary}
            </p>
            <p className="mt-1 text-[length:var(--text-xs)] leading-4 text-[var(--text-secondary)]">
              {diagnostics.nextStep}
            </p>
          </div>
        </div>

        <dl className="rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3">
          <Fact label="Failed stage" value={stageLabel(diagnostics)} />
          <Fact label="Failure code" value={diagnostics.code} />
          <Fact label="Captured" value={diagnostics.capturedAt} />
          <Fact label="Cave version" value={diagnostics.environment.appVersion} />
          <Fact
            label="Platform"
            value={`${diagnostics.environment.platform}/${diagnostics.environment.architecture}`}
          />
          <Fact
            label="Application data"
            value={diagnostics.applicationData.displayLocation}
          />
          <Fact
            label="Directory exists"
            value={yesNoUnknown(diagnostics.applicationData.exists)}
          />
          <Fact
            label="Write probe"
            value={writeProbeLabel(diagnostics.applicationData.writeProbe)}
          />
          <Fact
            label="Managed Node.js"
            value={READINESS_LABELS[diagnostics.components.managedNode]}
          />
          <Fact
            label="Coven CLI"
            value={READINESS_LABELS[diagnostics.components.covenCli]}
          />
          <Fact
            label="Local service"
            value={READINESS_LABELS[diagnostics.components.localService]}
          />
          {installer ? (
            <>
              <Fact label="Installer target" value={installer.target} />
              <Fact label="Installer status" value={installer.status} />
              <Fact
                label="Exit code"
                value={installer.exitCode === null ? "Unavailable" : String(installer.exitCode)}
              />
            </>
          ) : null}
        </dl>

        {installer?.outputTail.length ? (
          <details className="rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-[var(--bg-subtle)]">
            <summary className="focus-ring cursor-pointer rounded-[var(--radius-control)] px-3 py-2 text-[length:var(--text-xs)] font-medium text-[var(--text-primary)]">
              Sanitized installer output
            </summary>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words border-t border-[var(--border-hairline)] p-3 font-mono text-[length:var(--text-2xs)] leading-4 text-[var(--text-secondary)] select-text">
              {installer.outputTail.join("\n")}
            </pre>
          </details>
        ) : null}

        {copyStatus !== "idle" ? (
          <p
            className={`text-[length:var(--text-xs)] ${
              copyStatus === "failed"
                ? "text-[var(--danger-text)]"
                : "text-[var(--color-success)]"
            }`}
          >
            {copyStatus === "copied"
              ? "Diagnostics copied."
              : "Couldn’t copy diagnostics. Select the report and copy it manually."}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
