import { bindingFor, loadConfig, type CaveConfig } from "@/lib/cave-config";
import { callDaemon, type DaemonResponse } from "@/lib/coven-daemon";
import { unwrapDaemonEvalState } from "@/lib/eval-loop-daemon";
import {
  buildRetroRunsSnapshot,
  normalizeRetroRunState,
  type RetroRunsSnapshot,
} from "@/lib/retro-runs";
import { redactSecretsDeep, redactSecretText } from "@/lib/secret-redaction";

type DaemonFamiliar = {
  id: string;
  display_name?: string;
  role?: string;
};

export type RetroRunsSnapshotIssueCode =
  | "retro_roster_unavailable"
  | "retro_state_unavailable";

export type RetroRunsSnapshotResult =
  | { ok: true; snapshot: RetroRunsSnapshot }
  | {
      ok: false;
      code: RetroRunsSnapshotIssueCode;
      error: string;
      snapshot: RetroRunsSnapshot;
    };

export type RetroRunsSnapshotDependencies = {
  loadConfig: () => Promise<CaveConfig>;
  callDaemon: <T>(request: { path: string }) => Promise<DaemonResponse<T>>;
};

const DEFAULT_DEPENDENCIES: RetroRunsSnapshotDependencies = {
  loadConfig,
  callDaemon,
};

export async function loadRetroRunsSnapshot({
  familiarId = null,
  dependencies = DEFAULT_DEPENDENCIES,
}: {
  familiarId?: string | null;
  dependencies?: RetroRunsSnapshotDependencies;
} = {}): Promise<RetroRunsSnapshotResult> {
  const [familiarsRes, config] = await Promise.all([
    dependencies.callDaemon<DaemonFamiliar[]>({ path: "/api/v1/familiars" }),
    dependencies.loadConfig(),
  ]);

  if (!familiarsRes.ok || !familiarsRes.data) {
    return {
      ok: false,
      code: "retro_roster_unavailable",
      error: redactSecretText(
        familiarsRes.error ?? `daemon http ${familiarsRes.status}`,
      ),
      snapshot: buildRetroRunsSnapshot([]),
    };
  }

  let stateFailed = false;
  const states = await Promise.all(
    familiarsRes.data
      .filter((familiar) => !familiarId || familiar.id === familiarId)
      .map(async (familiar) => {
        const safe = redactSecretsDeep(familiar);
        const binding = bindingFor(config, familiar.id);
        const input = {
          id: familiar.id,
          displayName: binding.display_name ?? safe.display_name ?? familiar.id,
          role: binding.role ?? safe.role,
        };
        const stateRes = await dependencies.callDaemon<unknown>({
          path: `/api/v1/skills/eval-loop/${encodeURIComponent(familiar.id)}`,
        });
        if (!stateRes.ok || !stateRes.data) {
          stateFailed = true;
          return normalizeRetroRunState({
            familiar: input,
            state: {
              familiar_id: familiar.id,
              last_run: null,
              iterations: [],
              track_counts: { synthesis: 0, prompt: 0, memory: 0 },
              total_accepted: 0,
              total_reverted: 0,
              running: false,
              unavailable: redactSecretText(
                stateRes.error ?? `daemon http ${stateRes.status}`,
              ),
            },
          });
        }
        return normalizeRetroRunState({
          familiar: input,
          state: redactSecretsDeep(unwrapDaemonEvalState(stateRes.data)),
        });
      }),
  );

  const snapshot = buildRetroRunsSnapshot(states);
  return stateFailed
    ? {
        ok: false,
        code: "retro_state_unavailable",
        error: "One or more retro states are unavailable.",
        snapshot,
      }
    : { ok: true, snapshot };
}
