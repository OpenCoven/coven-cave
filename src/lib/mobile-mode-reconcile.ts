export type MobileModeResponse = {
  ok: boolean;
  status: number;
  nativeHost?: string | null;
  inviteUrl?: string | null;
  appInviteUrl?: string | null;
  qrSvg?: string | null;
  lastSeenAt?: number | null;
  error?: string;
  stderr?: string;
  unavailable?: boolean;
  retryBlocked: boolean;
  skipped?: boolean;
};

type MobileModeRequest = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Coalesces the Workspace and Settings reconcilers and opens a small circuit
 * breaker for deliberate 503 "prerequisite unavailable" responses. Automatic
 * focus/interval refreshes then reuse the recorded result without touching the
 * network. A user toggle or Retry passes force:true and probes immediately.
 * Unexpected responses and transport failures stay retryable.
 */
export function createMobileModeReconciler(request: MobileModeRequest) {
  let blocked: { enabled: boolean; result: MobileModeResponse } | null = null;
  let inFlight: { enabled: boolean; promise: Promise<MobileModeResponse> } | null = null;

  return async function reconcile(
    enabled: boolean,
    options?: { force?: boolean },
  ): Promise<MobileModeResponse> {
    if (!options?.force && blocked?.enabled === enabled) {
      return { ...blocked.result, skipped: true };
    }
    if (inFlight?.enabled === enabled) return inFlight.promise;

    const promise = (async (): Promise<MobileModeResponse> => {
      try {
        const response = await request("/api/mobile-handoff", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: enabled ? "app-start" : "app-stop" }),
        });
        const json = (await response.json().catch(() => ({}))) as Omit<
          MobileModeResponse,
          "ok" | "status" | "retryBlocked"
        > & { ok?: boolean };
        const retryBlocked = json.unavailable === true || response.status === 503;
        const result: MobileModeResponse = {
          ...json,
          ok: json.ok === true && response.ok,
          status: response.status,
          retryBlocked,
        };
        blocked = result.retryBlocked ? { enabled, result } : null;
        return result;
      } catch (error) {
        blocked = null;
        return {
          ok: false,
          status: 0,
          error: error instanceof Error ? error.message : "Mobile mode unavailable.",
          retryBlocked: false,
        };
      }
    })();

    inFlight = { enabled, promise };
    try {
      return await promise;
    } finally {
      if (inFlight?.promise === promise) inFlight = null;
    }
  };
}

const reconcileSharedMobileMode = createMobileModeReconciler((input, init) => fetch(input, init));

export async function reconcileMobileModeRequest(
  enabled: boolean,
  options?: { force?: boolean },
): Promise<MobileModeResponse> {
  return await reconcileSharedMobileMode(enabled, options);
}
