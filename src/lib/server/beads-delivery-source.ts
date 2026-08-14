import {
  buildBeadsDeliveryOverview,
  type BeadDeliveryRow,
  type BeadsDeliveryOverview,
} from "../beads-delivery.ts";
import { runBdCommand, type BdResult } from "./beads-cli.ts";
import {
  resolveSafeBeadsWorkspace,
  type BeadsWorkspaceResolution,
} from "./beads-workspace.ts";

const OVERVIEW_CACHE_TTL_MS = 15_000;

type CacheEntry = {
  overview: BeadsDeliveryOverview;
  validUntil: number;
};

type BeadsDeliveryOverviewTestHooks = {
  now: () => number;
  runBdCommand: (repoRoot: string, beadsDir: string, args: string[]) => Promise<BdResult>;
  resolveWorkspace: (repoRoot: string) => BeadsWorkspaceResolution;
};

const overviewCache = new Map<string, CacheEntry>();
const overviewEpochs = new Map<string, number>();
const testHooks: Partial<BeadsDeliveryOverviewTestHooks> = {};

function parseRows(stdout: string): BeadDeliveryRow[] {
  const parsed = JSON.parse(stdout) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Beads overview output must be an array");
  return parsed as BeadDeliveryRow[];
}

function now(): number {
  return testHooks.now?.() ?? Date.now();
}

function resolveWorkspace(repoRoot: string): BeadsWorkspaceResolution {
  return testHooks.resolveWorkspace?.(repoRoot) ?? resolveSafeBeadsWorkspace(repoRoot);
}

function executeBdCommand(repoRoot: string, beadsDir: string, args: string[]): Promise<BdResult> {
  return testHooks.runBdCommand?.(repoRoot, beadsDir, args) ?? runBdCommand(repoRoot, beadsDir, args);
}

function readEpoch(repoRoot: string): number {
  return overviewEpochs.get(repoRoot) ?? 0;
}

async function readRows(repoRoot: string, beadsDir: string, args: string[]): Promise<BeadDeliveryRow[]> {
  const result = await executeBdCommand(repoRoot, beadsDir, args);
  if (!result.ok) throw new Error("Beads overview command failed");
  return parseRows(result.stdout);
}

export async function readBeadsDeliveryOverview(repoRoot: string): Promise<BeadsDeliveryOverview> {
  const nowMs = now();
  const cached = overviewCache.get(repoRoot);
  if (cached && cached.validUntil > nowMs) return cached.overview;

  const capturedEpoch = readEpoch(repoRoot);
  const workspace = resolveWorkspace(repoRoot);
  if (!workspace.ok) throw new Error(workspace.error);

  const [allRows, readyRows] = await Promise.all([
    readRows(repoRoot, workspace.beadsDir, ["list", "--all", "--json"]),
    readRows(repoRoot, workspace.beadsDir, ["ready", "--json"]),
  ]);
  const overview = buildBeadsDeliveryOverview(allRows, readyRows, nowMs);
  if (readEpoch(repoRoot) === capturedEpoch) {
    overviewCache.set(repoRoot, { overview, validUntil: nowMs + OVERVIEW_CACHE_TTL_MS });
  }
  return overview;
}

export function invalidateBeadsDeliveryOverview(repoRoot: string): void {
  overviewEpochs.set(repoRoot, readEpoch(repoRoot) + 1);
  overviewCache.delete(repoRoot);
}

export function __setBeadsDeliveryOverviewTestHooksForTests(
  hooks: Partial<BeadsDeliveryOverviewTestHooks>,
): void {
  Object.assign(testHooks, hooks);
}

export function __getBeadsDeliveryOverviewEpochForTests(repoRoot: string): number {
  return readEpoch(repoRoot);
}

export function __clearBeadsDeliveryOverviewCacheForTests(): void {
  overviewCache.clear();
  overviewEpochs.clear();
  delete testHooks.now;
  delete testHooks.runBdCommand;
  delete testHooks.resolveWorkspace;
}
