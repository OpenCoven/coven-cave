import { NextResponse } from "next/server";
import { callDaemon } from "@/lib/coven-daemon";
import { bindingFor, loadConfig } from "@/lib/cave-config";
import { buildRetroRunsSnapshot, normalizeRetroRunState } from "@/lib/retro-runs";
import { redactSecretsDeep, redactSecretText } from "@/lib/secret-redaction";

export const dynamic = "force-dynamic";

type DaemonFamiliar = {
  id: string;
  display_name?: string;
  role?: string;
};

export async function GET() {
  const [familiarsRes, config] = await Promise.all([
    callDaemon<DaemonFamiliar[]>({ path: "/api/v1/familiars" }),
    loadConfig(),
  ]);

  if (!familiarsRes.ok || !familiarsRes.data) {
    return NextResponse.json({
      ok: false,
      error: redactSecretText(familiarsRes.error ?? `daemon http ${familiarsRes.status}`),
      snapshot: buildRetroRunsSnapshot([]),
    });
  }

  const familiarInputs = familiarsRes.data.map((familiar) => {
    const safe = redactSecretsDeep(familiar);
    const binding = bindingFor(config, familiar.id);
    return {
      id: familiar.id,
      displayName: binding.display_name ?? safe.display_name ?? familiar.id,
      role: binding.role ?? safe.role,
    };
  });

  const states = await Promise.all(
    familiarInputs.map(async (familiar) => {
      const stateRes = await callDaemon<unknown>({
        path: `/api/v1/skills/eval-loop/${encodeURIComponent(familiar.id)}`,
      });
      if (!stateRes.ok || !stateRes.data) {
        return normalizeRetroRunState({
          familiar,
          state: {
            familiar_id: familiar.id,
            last_run: null,
            iterations: [],
            track_counts: { synthesis: 0, prompt: 0, memory: 0 },
            total_accepted: 0,
            total_reverted: 0,
            running: false,
            unavailable: redactSecretText(stateRes.error ?? `daemon http ${stateRes.status}`),
          },
        });
      }
      return normalizeRetroRunState({ familiar, state: redactSecretsDeep(stateRes.data) });
    }),
  );

  return NextResponse.json({ ok: true, snapshot: buildRetroRunsSnapshot(states) });
}
