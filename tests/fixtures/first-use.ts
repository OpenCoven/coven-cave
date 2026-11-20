import type { Page } from "@playwright/test";
import type { FirstUsePayload } from "../../src/components/first-use-provider";
import { parseFirstUseState, resolveFirstUseContext } from "../../src/lib/first-use";
import type { CaveProject } from "../../src/lib/cave-projects-types";

type CompletedFirstUseOptions = {
  project: Pick<CaveProject, "id" | "name" | "root"> & Partial<Pick<CaveProject, "createdAt" | "updatedAt">>;
  familiarIds: string[];
  actingFamiliarId: string;
  permissionMode?: "read" | "full";
  access?: "read" | "write";
  harness?: string;
  repairReason?: "project" | "familiar" | "access" | "runtime";
  seedWorkspaceScope?: boolean;
};

/** An already-introduced installation with real stable context, never a dismissal bypass. */
export function completedFirstUsePayload(options: CompletedFirstUseOptions): FirstUsePayload {
  const defaults = { projectId: options.project.id, familiarIds: options.familiarIds, actingFamiliarId: options.actingFamiliarId };
  const state = parseFirstUseState({
    version: 1, revision: 8, step: "complete", outcome: "plan", defaults,
    permissionMode: options.permissionMode ?? "read",
    practice: { approvalHeld: true, stopped: true, retried: true, verified: true },
    completedAt: "2026-01-01T00:00:00.000Z",
  });
  const project = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...options.project };
  const level = options.access ?? "write";
  return {
    state,
    resolution: resolveFirstUseContext({ defaults,
      projectIds: options.repairReason === "project" ? [] : [project.id],
      familiarIds: options.repairReason === "familiar" ? [] : options.familiarIds,
      eligibleFamiliarIds: options.repairReason === "access" ? [] : options.familiarIds,
      runtimeAvailable: options.repairReason !== "runtime",
    }),
    project: options.repairReason === "project" ? null : project,
    access: options.repairReason ? [] : options.familiarIds.map((familiarId) => ({ familiarId, level, direct: level, groups: [], supreme: false })),
  };
}

/** Register after a suite's catchall so its API fixtures retain their normal boundaries. */
export async function installCompletedFirstUse(page: Page, options: CompletedFirstUseOptions) {
  const payload = completedFirstUsePayload(options);
  await page.route("**/api/onboarding/journey", (route) => route.request().method() === "GET"
    ? route.fulfill({ json: { ok: true, ...payload } })
    : route.fulfill({ status: 403, json: { ok: false, error: "This fixture has already completed its introduction." } }));
  await page.route("**/api/onboarding/journey?runtimeFamiliarId=*", (route) => {
    if (route.request().method() !== "GET") return route.fulfill({ status: 403, json: { ok: false, error: "This fixture only reads runtime configuration." } });
    const params = new URL(route.request().url()).searchParams;
    const familiarId = params.get("runtimeFamiliarId");
    const ready = familiarId !== null && options.familiarIds.includes(familiarId) && params.get("projectId") === options.project.id && !options.repairReason;
    return route.fulfill({ json: { ok: true, runtime: { familiarId, harness: options.harness ?? "codex", transport: "local", state: ready ? "ready" : "unavailable" } } });
  });
  await page.route("**/api/project-grants**", (route) => route.request().method() === "GET"
    ? route.fulfill({ json: { ok: true, grants: payload.access.map((entry) => ({ familiarId: entry.familiarId, projectId: options.project.id, access: entry.level, source: "human", grantedAt: "2026-01-01T00:00:00.000Z" })), accessGroups: [], supremeFamiliarId: null } })
    : route.fulfill({ status: 403, json: { ok: false, error: "This fixture does not change project grants." } }));
  if (options.seedWorkspaceScope) await page.addInitScript(({ projectId, familiarIds }) => {
    localStorage.setItem("cave:workspace:project-scope:v1", JSON.stringify(projectId));
    localStorage.setItem("cave:workspace:familiar-scope-by-project:v1", JSON.stringify({ [projectId]: familiarIds }));
  }, { projectId: options.project.id, familiarIds: options.familiarIds });
  return { state: payload.state, payload };
}
