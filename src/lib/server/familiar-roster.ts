import { readFile } from "node:fs/promises";
import path from "node:path";

import type { CaveConfig } from "@/lib/cave-config";
import { loadConfig } from "@/lib/cave-config";
import { covenHome } from "@/lib/coven-paths";
import { callDaemonTarget, daemonTargetForConfig, type DaemonTarget } from "@/lib/coven-daemon";
import { filterInstallSeedFamiliars } from "@/lib/familiar-roster-guard";
import { parseFamiliarsToml } from "@/lib/onboarding-familiars";
import { removedFamiliarIds } from "./familiar-tombstones";

export type VisibleFamiliarRosterEntry = {
  id: string;
  display_name: string;
  role: string;
  description?: string;
  pronouns?: string;
  status?: string;
  last_seen?: string;
  active_sessions?: number;
  memory_freshness?: string;
  emoji?: string;
  icon?: string;
};

export type VisibleFamiliarRosterResult =
  | {
    ok: true;
    config: CaveConfig;
    target: DaemonTarget;
    roster: VisibleFamiliarRosterEntry[];
  }
  | {
    ok: false;
    config: CaveConfig;
    target: DaemonTarget;
    status: number;
    error: string;
  };

export async function loadVisibleFamiliarRoster(): Promise<VisibleFamiliarRosterResult> {
  const covenDir = covenHome();
  const familiarsToml = path.join(covenDir, "familiars.toml");
  const config = await loadConfig();
  const target = daemonTargetForConfig(config);
  const [res, removedIds, declaredEntries] = await Promise.all([
    callDaemonTarget<VisibleFamiliarRosterEntry[]>(target, {
      path: "/api/v1/familiars",
    }),
    removedFamiliarIds().catch(() => new Set<string>()),
    readFile(familiarsToml, "utf8")
      .then(parseFamiliarsToml)
      .catch(() => []),
  ]);
  if (!res.ok) {
    return {
      ok: false,
      config,
      target,
      status: res.status,
      error: res.error ?? `daemon http ${res.status}`,
    };
  }

  const explicitIds = new Set(declaredEntries.map((entry) => entry.id.toLowerCase()));
  const daemonRoster =
    target.mode === "hub"
      ? (res.data ?? [])
      : filterInstallSeedFamiliars(res.data ?? [], explicitIds);
  const visibleRoster = daemonRoster.filter((familiar) => !removedIds.has(familiar.id));
  const rosterIds = new Set(visibleRoster.map((familiar) => familiar.id.toLowerCase()));
  const declaredOnly: VisibleFamiliarRosterEntry[] = declaredEntries
    .filter((entry) => !rosterIds.has(entry.id.toLowerCase()) && !removedIds.has(entry.id))
    .map((entry) => ({
      id: entry.id,
      display_name: entry.displayName ?? entry.id,
      role: entry.role ?? "Familiar",
      ...(entry.description ? { description: entry.description } : {}),
      ...(entry.emoji ? { emoji: entry.emoji } : {}),
    }));

  return {
    ok: true,
    config,
    target,
    roster: [...visibleRoster, ...declaredOnly],
  };
}
