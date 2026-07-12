import { compareSemver } from "./app-update.ts";

export type OpenCovenToolVerificationSpec<TId extends string = string> = {
  id: TId;
  binary: string;
  packageName: string;
  minimumVersion: string;
};

export type OpenCovenToolProbe = {
  path: string | null;
  executablePath: string | null;
  executableVerified: boolean;
  version: string | null;
  packageName: string | null;
  packagePath: string | null;
  error?: "version-probe-failed" | "launcher-unreadable";
};

export type OpenCovenToolVerification<TId extends string = string> = {
  id: TId;
  path: string | null;
  executablePath: string | null;
  current: string | null;
  latest: string | null;
  expectedPackageName: string;
  discoveredPackageName: string | null;
  packagePath: string | null;
  packageVerified: boolean;
  executableVerified: boolean;
  compatible: boolean;
  latestSatisfied: boolean | null;
  ok: boolean;
  error?: string;
};

function verificationError<TId extends string>(
  tool: OpenCovenToolVerificationSpec<TId>,
  probe: OpenCovenToolProbe,
  latest: string | null,
): string | undefined {
  if (!probe.path) {
    return `${tool.binary} was not found on PATH after install. Restart Cave or move the npm global bin directory ahead of stale launchers, then retry.`;
  }
  const pathDetail = ` at ${probe.path}`;
  if (!probe.executablePath) {
    return `Cave found ${tool.binary}${pathDetail}, but its launcher target could not be read. Remove or repair that stale launcher, then retry.`;
  }
  if (probe.packageName !== tool.packageName) {
    const actual = probe.packageName ?? "an unrecognized package";
    return `Cave resolves ${tool.binary}${pathDetail} to ${actual}, not ${tool.packageName}. A stale PATH entry is shadowing the requested package.`;
  }
  if (!probe.executableVerified) {
    return `Cave found ${tool.binary}${pathDetail}, but it does not point to the ${tool.binary} entry point from ${tool.packageName}. Repair the launcher or move the intended npm bin directory ahead of it.`;
  }
  if (!probe.version) {
    return `Cave found ${tool.binary}${pathDetail}, but its version probe could not verify the expected executable. Repair the launcher or retry after restarting Cave.`;
  }
  if (compareSemver(probe.version, tool.minimumVersion) < 0) {
    return `Cave resolves ${tool.binary}${pathDetail} as ${probe.version}, below the required ${tool.minimumVersion}. A stale executable is still first on PATH.`;
  }
  if (!latest) {
    return `Cave verified ${tool.binary}${pathDetail} as ${probe.version}, but could not read npm's latest version. Check the network or registry and retry before treating the update as complete.`;
  }
  if (compareSemver(probe.version, latest) < 0) {
    return `Cave resolves ${tool.binary}${pathDetail} as ${probe.version}, but npm latest is ${latest}. A stale executable is still first on PATH.`;
  }
  return undefined;
}

export function evaluateOpenCovenToolVerification<TId extends string>(
  tool: OpenCovenToolVerificationSpec<TId>,
  probe: OpenCovenToolProbe,
  latest: string | null,
): OpenCovenToolVerification<TId> {
  const packageVerified =
    probe.packageName === tool.packageName &&
    Boolean(probe.packagePath) &&
    Boolean(probe.executablePath) &&
    probe.executableVerified;
  const compatible =
    packageVerified &&
    !!probe.version &&
    compareSemver(probe.version, tool.minimumVersion) >= 0;
  const latestSatisfied = latest
    ? !!probe.version && compareSemver(probe.version, latest) >= 0
    : null;
  const error = verificationError(tool, probe, latest);
  return {
    id: tool.id,
    path: probe.path,
    executablePath: probe.executablePath,
    current: probe.version,
    latest,
    expectedPackageName: tool.packageName,
    discoveredPackageName: probe.packageName,
    packagePath: probe.packagePath,
    packageVerified,
    executableVerified: probe.executableVerified,
    compatible,
    latestSatisfied,
    ok: !error,
    ...(error ? { error } : {}),
  };
}

/** A successful npm process is only one half of an OpenCoven tool update.
 * The executable discovered after it exits must also satisfy the verification
 * result before the caller is allowed to report success. */
export function isVerifiedOpenCovenInstallSuccess(
  exitCode: number | null,
  verification: OpenCovenToolVerification,
): boolean {
  return exitCode === 0 && verification.ok;
}
