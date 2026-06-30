import type { CaveConfig } from "@/lib/cave-config";
import { loadState } from "@/lib/cave-config";
import { deriveTravelClientStatus, type TravelClientStatus } from "@/lib/travel-client-state";

export async function travelLocalQueueStatus(config: CaveConfig): Promise<TravelClientStatus | null> {
  const state = await loadState();
  const status = deriveTravelClientStatus({
    multiHost: config.multiHost,
    travel: state.travel,
    hubReachable: state.travel.hubUnreachableSince ? false : null,
  });
  return status.authority === "travel-local" ? status : null;
}
