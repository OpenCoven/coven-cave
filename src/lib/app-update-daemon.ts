type ToolStatus = {
  id?: string;
  installed?: boolean;
  outdated?: boolean;
  compatible?: boolean;
  current?: string | null;
};

type InstallJob = {
  status?: "idle" | "running" | "done";
  ok?: boolean;
  error?: string;
  hint?: string;
  tail?: string;
  verification?: {
    current?: string | null;
  };
};

type Dependencies = {
  fetch?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  confirmInstall?: boolean;
  onUpdateStart?: () => void;
};

const UPDATE_ROUTE = "/api/onboarding/update";
const INSTALL_ROUTE = "/api/onboarding/install";
const activeDaemonUpdates = new Set<Promise<unknown>>();

/** Keep desktop auto-start from racing an in-flight CLI replacement. */
export async function waitForDaemonUpdateIdle(): Promise<void> {
  while (activeDaemonUpdates.size > 0) {
    await Promise.allSettled([...activeDaemonUpdates]);
  }
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

function safeFailure(body: Record<string, unknown>, fallback: string): string {
  for (const key of ["hint", "error"]) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

type Semver = {
  core: [number, number, number];
  prerelease: string[];
};

function releaseSemver(version: string): Semver | null {
  const match = /^\s*v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?\s*$/.exec(version);
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split(".") ?? [],
  };
}

/** Compare full release versions, including SemVer prerelease precedence. */
export function compareCaveDaemonVersions(left: string, right: string): number | null {
  const a = releaseSemver(left);
  const b = releaseSemver(right);
  if (!a || !b) return null;
  for (let index = 0; index < a.core.length; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1;
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const av = a.prerelease[index];
    const bv = b.prerelease[index];
    if (av === undefined || bv === undefined) return av === undefined ? -1 : 1;
    if (av === bv) continue;
    const aNumeric = /^\d+$/.test(av);
    const bNumeric = /^\d+$/.test(bv);
    if (aNumeric && bNumeric) return Number(av) < Number(bv) ? -1 : 1;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return av < bv ? -1 : 1;
  }
  return 0;
}

/**
 * Before Cave replaces and relaunches itself, bring the separately installed
 * Coven CLI up to date. The existing install route owns the safety-sensitive
 * daemon lifecycle: graceful stop, npm update, executable verification, and
 * restart only when the daemon was running before the update.
 */
async function runDaemonUpdateForCaveUpdate(
  caveVersion: string,
  dependencies: Dependencies = {},
): Promise<"current" | "updated" | "confirmation-required"> {
  const request = dependencies.fetch ?? fetch;
  const wait = dependencies.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const pollIntervalMs = dependencies.pollIntervalMs ?? 1_000;
  const maxPollAttempts = dependencies.maxPollAttempts ?? 300;
  if (!releaseSemver(caveVersion)) {
    throw new Error("Cave could not verify the release version before updating the daemon.");
  }

  const checkResponse = await request(UPDATE_ROUTE, {
    method: "POST",
    cache: "no-store",
  });
  const checkBody = await responseBody(checkResponse);
  if (!checkResponse.ok || checkBody.ok === false) {
    throw new Error(safeFailure(checkBody, "Cave could not check the Coven daemon version."));
  }
  if (checkBody.freshness !== "fresh") {
    throw new Error("Cave could not verify a fresh Coven CLI version before continuing.");
  }

  const tools = Array.isArray(checkBody.tools) ? (checkBody.tools as ToolStatus[]) : [];
  const cli = tools.find((tool) => tool.id === "coven-cli");
  if (!cli) throw new Error("Cave could not find the Coven CLI update status.");
  const currentComparison =
    typeof cli.current === "string"
      ? compareCaveDaemonVersions(cli.current, caveVersion)
      : null;
  if (
    cli.installed &&
    cli.compatible !== false &&
    currentComparison !== null &&
    currentComparison >= 0
  ) {
    return "current";
  }

  if (!dependencies.confirmInstall) {
    return "confirmation-required";
  }

  dependencies.onUpdateStart?.();
  const startResponse = await request(INSTALL_ROUTE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ target: "coven-cli", confirmInstall: true }),
    cache: "no-store",
  });
  const startBody = await responseBody(startResponse);
  if (!startResponse.ok) {
    throw new Error(safeFailure(startBody, "Cave could not start the Coven daemon update."));
  }

  for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
    const jobResponse = await request(`${INSTALL_ROUTE}?target=coven-cli`, { cache: "no-store" });
    const job = (await responseBody(jobResponse)) as InstallJob;
    if (!jobResponse.ok) {
      throw new Error(safeFailure(job as Record<string, unknown>, "Cave lost the Coven daemon update status."));
    }
    if (job.status === "done") {
      if (job.ok) {
        const installedVersion = job.verification?.current;
        const comparison = typeof installedVersion === "string"
          ? compareCaveDaemonVersions(installedVersion, caveVersion)
          : null;
        if (comparison !== null && comparison >= 0) return "updated";
        throw new Error(
          `Cave updated the Coven CLI, but could not verify version ${caveVersion} or newer on PATH.`,
        );
      }
      throw new Error(safeFailure(job as Record<string, unknown>, "The Coven daemon update failed."));
    }
    if (attempt + 1 < maxPollAttempts) await wait(pollIntervalMs);
  }

  throw new Error("The Coven daemon update did not finish before the Cave update timed out.");
}

export function updateDaemonForCaveUpdate(
  caveVersion: string,
  dependencies: Dependencies = {},
): Promise<"current" | "updated" | "confirmation-required"> {
  const operation = runDaemonUpdateForCaveUpdate(caveVersion, dependencies);
  activeDaemonUpdates.add(operation);
  void operation.finally(() => activeDaemonUpdates.delete(operation)).catch(() => {});
  return operation;
}
