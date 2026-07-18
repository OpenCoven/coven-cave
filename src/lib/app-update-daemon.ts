import { compareSemver, parseSemver } from "./app-update.ts";

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
};

type Dependencies = {
  fetch?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
};

const UPDATE_ROUTE = "/api/onboarding/update";
const INSTALL_ROUTE = "/api/onboarding/install";

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

/**
 * Before Cave replaces and relaunches itself, bring the separately installed
 * Coven CLI up to date. The existing install route owns the safety-sensitive
 * daemon lifecycle: graceful stop, npm update, executable verification, and
 * restart only when the daemon was running before the update.
 */
export async function updateDaemonForCaveUpdate(
  caveVersion: string,
  dependencies: Dependencies = {},
): Promise<"current" | "updated"> {
  const request = dependencies.fetch ?? fetch;
  const wait = dependencies.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const pollIntervalMs = dependencies.pollIntervalMs ?? 1_000;
  const maxPollAttempts = dependencies.maxPollAttempts ?? 300;

  const checkResponse = await request(UPDATE_ROUTE, {
    method: "POST",
    cache: "no-store",
  });
  const checkBody = await responseBody(checkResponse);
  if (!checkResponse.ok || checkBody.ok === false) {
    throw new Error(safeFailure(checkBody, "Cave could not check the Coven daemon version."));
  }

  const tools = Array.isArray(checkBody.tools) ? (checkBody.tools as ToolStatus[]) : [];
  const cli = tools.find((tool) => tool.id === "coven-cli");
  if (!cli) throw new Error("Cave could not find the Coven CLI update status.");
  if (
    cli.installed &&
    cli.compatible !== false &&
    typeof cli.current === "string" &&
    parseSemver(cli.current) &&
    compareSemver(cli.current, caveVersion) >= 0
  ) {
    return "current";
  }

  const startResponse = await request(INSTALL_ROUTE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ target: "coven-cli" }),
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
      if (job.ok) return "updated";
      throw new Error(safeFailure(job as Record<string, unknown>, "The Coven daemon update failed."));
    }
    if (attempt + 1 < maxPollAttempts) await wait(pollIntervalMs);
  }

  throw new Error("The Coven daemon update did not finish before the Cave update timed out.");
}
