export type MemoryFeedRequestDomain = "files" | "canonical";

export type BackgroundMemoryFeedRequest = {
  kind: "background";
  domain: MemoryFeedRequestDomain;
  requestId: number;
  forceEpoch: number;
  startedDuringForce: boolean;
};

export type ForcedMemoryFeedRequest = {
  kind: "force";
  forceEpoch: number;
};

export type MemoryFeedRequest =
  | BackgroundMemoryFeedRequest
  | ForcedMemoryFeedRequest;

/**
 * Coordinates the Familiars parent feed's two independent background domains
 * with one explicit-refresh owner. Background polls remain independent from
 * each other, while a force epoch owns every file/canonical publication until
 * it settles or a newer explicit refresh begins.
 */
export function createMemoryFeedRequestGate() {
  let mounted = false;
  let forceEpoch = 0;
  let activeForceEpoch: number | null = null;
  const backgroundRequestIds: Record<MemoryFeedRequestDomain, number> = {
    files: 0,
    canonical: 0,
  };

  return {
    mount(): void {
      mounted = true;
    },

    unmount(): void {
      mounted = false;
      forceEpoch += 1;
      activeForceEpoch = null;
    },

    beginBackground(
      domain: MemoryFeedRequestDomain,
    ): BackgroundMemoryFeedRequest {
      backgroundRequestIds[domain] += 1;
      return {
        kind: "background",
        domain,
        requestId: backgroundRequestIds[domain],
        forceEpoch,
        startedDuringForce: activeForceEpoch !== null,
      };
    },

    beginForce(): ForcedMemoryFeedRequest {
      forceEpoch += 1;
      activeForceEpoch = forceEpoch;
      return { kind: "force", forceEpoch };
    },

    finishForce(request: ForcedMemoryFeedRequest): void {
      if (activeForceEpoch === request.forceEpoch) {
        activeForceEpoch = null;
      }
    },

    isCurrent(request: MemoryFeedRequest): boolean {
      if (!mounted || request.forceEpoch !== forceEpoch) return false;
      if (request.kind === "force") return true;
      return (
        !request.startedDuringForce &&
        request.requestId === backgroundRequestIds[request.domain]
      );
    },
  };
}
