import {
  buildBeadsDeliveryOverview,
  type BeadDeliveryRow,
  type BeadsDeliveryOverview,
} from "@/lib/beads-delivery";
import { runBdCommand } from "@/lib/server/beads-cli";
import { resolveSafeBeadsWorkspace } from "@/lib/server/beads-workspace";

const OVERVIEW_CACHE_TTL_MS = 15_000;

type CacheEntry = {
  overview: BeadsDeliveryOverview;
  validUntil: number;
};

const overviewCache = new Map<string, CacheEntry>();

function parseRows(stdout: string): BeadDeliveryRow[] {
  const parsed = JSON.parse(stdout) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Beads overview output must be an array");
  return parsed as BeadDeliveryRow[];
}

async function readRows(repoRoot: string, beadsDir: string, args: string[]): Promise<BeadDeliveryRow[]> {
  const result = await runBdCommand(repoRoot, beadsDir, args);
  if (!result.ok) throw new Error("Beads overview command failed");
  return parseRows(result.stdout);
}

export async function readBeadsDeliveryOverview(repoRoot: string): Promise<BeadsDeliveryOverview> {
  const nowMs = Date.now();
  const cached = overviewCache.get(repoRoot);
  if (cached && cached.validUntil > nowMs) return cached.overview;

  const workspace = resolveSafeBeadsWorkspace(repoRoot);
  if (!workspace.ok) throw new Error(workspace.error);

  const [allRows, readyRows] = await Promise.all([
    readRows(repoRoot, workspace.beadsDir, ["list", "--all", "--json"]),
    readRows(repoRoot, workspace.beadsDir, ["ready", "--json"]),
  ]);
  const overview = buildBeadsDeliveryOverview(allRows, readyRows, nowMs);
  overviewCache.set(repoRoot, { overview, validUntil: nowMs + OVERVIEW_CACHE_TTL_MS });
  return overview;
}

export function __clearBeadsDeliveryOverviewCacheForTests(): void {
  overviewCache.clear();
}
