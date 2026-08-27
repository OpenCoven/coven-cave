import {
  CLIENT_V1_HPKE_FRESHNESS,
  type ClientV1HpkeBinding,
} from "./authority-contract.ts";

export type ClientV1AuthorityReplayResult =
  | { ok: true }
  | { ok: false; reason: "stale" }
  | { ok: false; reason: "replay" }
  | {
    ok: false;
    reason: "capacity";
    retryAfterSeconds: number;
  };

export type ClientV1AuthorityReplayEnvelope = Pick<
  ClientV1HpkeBinding,
  "issuedAt" | "keyId" | "requestNonce"
>;

export interface ClientV1AuthorityReplayCache {
  reserve(
    envelope: ClientV1AuthorityReplayEnvelope,
    now: number,
  ): ClientV1AuthorityReplayResult;
  size(now: number): number;
}

export function createClientV1AuthorityReplayCache():
  ClientV1AuthorityReplayCache {
  const reservations = new Map<string, number>();

  const purge = (now: number): void => {
    for (const [key, expiresAt] of reservations) {
      if (expiresAt <= now) reservations.delete(key);
    }
  };

  return {
    reserve(
      envelope: ClientV1AuthorityReplayEnvelope,
      now: number,
    ): ClientV1AuthorityReplayResult {
      purge(now);
      if (
        !Number.isSafeInteger(envelope.issuedAt)
        || envelope.issuedAt < now - CLIENT_V1_HPKE_FRESHNESS.maximumAgeMs
        || envelope.issuedAt
          > now + CLIENT_V1_HPKE_FRESHNESS.maximumFutureSkewMs
      ) {
        return { ok: false, reason: "stale" };
      }

      const key = `${envelope.keyId}:${envelope.requestNonce}`;
      if (reservations.has(key)) return { ok: false, reason: "replay" };

      if (reservations.size >= CLIENT_V1_HPKE_FRESHNESS.replayCapacity) {
        let earliestExpiry = Number.POSITIVE_INFINITY;
        for (const expiresAt of reservations.values()) {
          earliestExpiry = Math.min(earliestExpiry, expiresAt);
        }
        return {
          ok: false,
          reason: "capacity",
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((earliestExpiry - now) / 1_000),
          ),
        };
      }

      reservations.set(
        key,
        now + CLIENT_V1_HPKE_FRESHNESS.replayTtlMs,
      );
      return { ok: true };
    },
    size(now: number): number {
      purge(now);
      return reservations.size;
    },
  };
}
