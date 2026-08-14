"use client";

import "@/styles/settings-client-access.css";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { useAnnouncer } from "@/components/ui/live-region";
import { settingsGroupId } from "@/components/ui/settings-group";
import { SkeletonRows } from "@/components/ui/skeleton";
import { relativeTime } from "@/lib/relative-time";
import { usePausablePoll } from "@/lib/use-pausable-poll";

/**
 * Settings · Client Access — Cave's own local approval surface for the
 * standalone OpenCoven Chat client facade (`/api/client/v1`). Talks only to
 * the four admin routes (`/api/client/v1/admin/*`), which stay behind the
 * existing sidecar-token + same-origin/CSRF gate exactly like every other
 * first-party Cave settings surface — this component fetches them the same
 * plain way `access-groups-section.tsx` does, with no client bearer token of
 * its own.
 *
 * Pending requests and paired credentials are both polled every two seconds
 * while the tab is visible (`usePausablePoll`), with an immediate refresh on
 * regaining focus, so an approval that gets exchanged for a credential out
 * of band (in the OpenCoven Chat client) appears here without a remount.
 * Each endpoint carries its own generation counter plus an
 * aborted-in-flight-request guard so a stale, already-in-flight response —
 * from either endpoint — can never overwrite state a newer fetch (or the
 * operator's own local decision) already set; see `resolvedPendingIds` and
 * `resolvedCredentialIds` below for each endpoint's specific piece of that
 * guard.
 */

const PENDING_POLL_INTERVAL_MS = 2_000;

type PendingPairingRequest = {
  id: string;
  appName: string;
  installationId: string;
  scopes: string[];
  status: "pending";
  createdAt: number;
  expiresAt: number;
};

type PairedCredential = {
  id: string;
  appName: string;
  installationId: string;
  scopes: string[];
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
};

function installationSuffix(installationId: string): string {
  return installationId.slice(-6);
}

function formatScopes(scopes: string[]): string {
  return scopes.join(", ");
}

function formatExpiresIn(expiresAt: number, now: number): string {
  const ms = expiresAt - now;
  if (ms <= 0) return "Expiring now";
  const minutes = Math.ceil(ms / 60_000);
  return minutes <= 1 ? "Expires in under a minute" : `Expires in ${minutes} min`;
}

async function readJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function SectionHeading({ children }: { children: string }) {
  return <p className="settings-client-access-heading">{children}</p>;
}

function mutationHeaders(): HeadersInit {
  return {
    "content-type": "application/json",
    "idempotency-key": crypto.randomUUID(),
  };
}

export function SettingsClientAccess() {
  const { announce } = useAnnouncer();

  const [pending, setPending] = useState<PendingPairingRequest[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [pendingBusy, setPendingBusy] = useState<Set<string>>(new Set());

  const [credentials, setCredentials] = useState<PairedCredential[]>([]);
  const [credentialsLoading, setCredentialsLoading] = useState(true);
  const [credentialsError, setCredentialsError] = useState<string | null>(null);
  const [credentialsBusy, setCredentialsBusy] = useState<Set<string>>(new Set());

  // Ids the operator just locally approved/denied. Filtered out of every
  // poll response until the SERVER itself confirms the id is really gone —
  // an in-flight request sent just before a local decision can otherwise
  // land afterward and resurrect a row the operator already acted on.
  const resolvedPendingIds = useRef<Set<string>>(new Set());
  // Bumped on every fetch attempt; a response is applied only if it is still
  // the most recent one requested, so an out-of-order network response from
  // an earlier poll can never overwrite state a newer poll already set.
  const pendingFetchGeneration = useRef(0);
  const pendingAbortRef = useRef<AbortController | null>(null);
  // Same generation + in-flight-abort guard as pending requests above,
  // applied to the credentials list — the poll below fetches both together,
  // so a credential response can be just as stale/out-of-order/racing an
  // unmount as a pending-requests response.
  const credentialsFetchGeneration = useRef(0);
  const credentialsAbortRef = useRef<AbortController | null>(null);
  // Mirrors `resolvedPendingIds` for revocation: ids the operator just
  // locally revoked (a successful DELETE). Filtered out of every poll
  // response until the SERVER itself confirms the id is really gone — a
  // credential GET sent just before the revoke, but whose response only
  // lands afterward (it's already in flight, so aborting it doesn't stop
  // its response from resolving), can otherwise apply after the local
  // removal and resurrect a row the operator already revoked.
  const resolvedCredentialIds = useRef<Set<string>>(new Set());

  const loadPending = useCallback(async () => {
    const generation = ++pendingFetchGeneration.current;
    pendingAbortRef.current?.abort();
    const controller = new AbortController();
    pendingAbortRef.current = controller;
    try {
      const response = await fetch("/api/client/v1/admin/pairing-requests", {
        cache: "no-store",
        signal: controller.signal,
      });
      const json = (await readJsonSafely(response)) as { ok?: boolean; requests?: PendingPairingRequest[] } | null;
      if (generation !== pendingFetchGeneration.current) return;
      if (!response.ok || json?.ok !== true || !Array.isArray(json.requests)) {
        setPendingError("Couldn’t load pending pairing requests.");
        return;
      }
      const serverList = json.requests;
      // Self-cleaning: once the server confirms an id is gone, stop
      // filtering it — a future, unrelated re-request of the same id (a
      // brand-new pairing attempt reusing... no, ids are never reused, but
      // this keeps the set from growing forever) is then treated normally.
      for (const id of [...resolvedPendingIds.current]) {
        if (!serverList.some((request) => request.id === id)) resolvedPendingIds.current.delete(id);
      }
      setPending(serverList.filter((request) => !resolvedPendingIds.current.has(request.id)));
      setPendingError(null);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (generation !== pendingFetchGeneration.current) return;
      setPendingError("Couldn’t load pending pairing requests.");
    } finally {
      if (generation === pendingFetchGeneration.current) setPendingLoading(false);
    }
  }, []);

  const loadCredentials = useCallback(async () => {
    const generation = ++credentialsFetchGeneration.current;
    credentialsAbortRef.current?.abort();
    const controller = new AbortController();
    credentialsAbortRef.current = controller;
    try {
      const response = await fetch("/api/client/v1/admin/credentials", {
        cache: "no-store",
        signal: controller.signal,
      });
      const json = (await readJsonSafely(response)) as { ok?: boolean; credentials?: PairedCredential[] } | null;
      if (generation !== credentialsFetchGeneration.current) return;
      if (!response.ok || json?.ok !== true || !Array.isArray(json.credentials)) {
        setCredentialsError("Couldn’t load paired clients.");
        return;
      }
      const serverList = json.credentials;
      // Self-cleaning, mirroring `loadPending` above: once the server
      // confirms a revoked id is really gone, stop filtering it — otherwise
      // this set would grow unbounded across a long-lived session.
      for (const id of [...resolvedCredentialIds.current]) {
        if (!serverList.some((credential) => credential.id === id)) resolvedCredentialIds.current.delete(id);
      }
      setCredentials(
        serverList.filter(
          (credential) => credential.revokedAt === null && !resolvedCredentialIds.current.has(credential.id),
        ),
      );
      setCredentialsError(null);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (generation !== credentialsFetchGeneration.current) return;
      setCredentialsError("Couldn’t load paired clients.");
    } finally {
      if (generation === credentialsFetchGeneration.current) setCredentialsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPending();
    void loadCredentials();
    return () => {
      pendingAbortRef.current?.abort();
      credentialsAbortRef.current?.abort();
    };
  }, [loadPending, loadCredentials]);

  // Polled together (recurring interval + immediate focus/visibility
  // refresh) so an approved-and-later-exchanged credential appears without a
  // remount: the exchange happens out-of-band in the OpenCoven Chat client,
  // so Cave only ever learns about it by re-fetching. `usePausablePoll`'s
  // initial-mount-load-is-the-caller's-job contract is why this single call
  // doesn't duplicate the mount-time loads dispatched by the effect above.
  usePausablePoll(() => {
    void loadPending();
    void loadCredentials();
  }, PENDING_POLL_INTERVAL_MS);

  const decide = useCallback(
    async (request: PendingPairingRequest, decision: "approve" | "deny") => {
      setPendingBusy((prev) => new Set(prev).add(request.id));
      try {
        const response = await fetch(`/api/client/v1/admin/pairing-requests/${request.id}/decision`, {
          method: "POST",
          headers: mutationHeaders(),
          body: JSON.stringify({ decision }),
        });
        if (!response.ok) throw new Error(String(response.status));
        resolvedPendingIds.current.add(request.id);
        setPending((prev) => prev.filter((candidate) => candidate.id !== request.id));
        announce(decision === "approve" ? `Approved ${request.appName}.` : `Denied ${request.appName}.`);
      } catch {
        announce(
          decision === "approve" ? `Couldn’t approve ${request.appName}.` : `Couldn’t deny ${request.appName}.`,
          "assertive",
        );
      } finally {
        setPendingBusy((prev) => {
          const next = new Set(prev);
          next.delete(request.id);
          return next;
        });
      }
    },
    [announce],
  );

  const revoke = useCallback(
    async (credential: PairedCredential) => {
      setCredentialsBusy((prev) => new Set(prev).add(credential.id));
      try {
        const response = await fetch(`/api/client/v1/admin/credentials/${credential.id}`, {
          method: "DELETE",
          headers: { "idempotency-key": crypto.randomUUID() },
        });
        if (!response.ok) throw new Error(String(response.status));
        // A failed DELETE must never hide the credential (nothing here runs
        // in that case — the row stays visible and gets busy=false again in
        // `finally` below), so all of this only happens on confirmed
        // success:
        //   1. Record the id as locally revoked so any credential response
        //      still in flight (sent before this revoke, resolving after
        //      it) gets filtered rather than resurrecting the row.
        //   2. Abort the current credential GET and advance the generation
        //      counter, so that same stale in-flight response is dropped
        //      outright rather than merely re-filtered.
        //   3. Remove the row locally, immediately — waiting for the next
        //      poll would flash a revoked credential back into view.
        resolvedCredentialIds.current.add(credential.id);
        credentialsFetchGeneration.current += 1;
        credentialsAbortRef.current?.abort();
        setCredentials((prev) => prev.filter((candidate) => candidate.id !== credential.id));
        announce(`Revoked access for ${credential.appName}.`);
      } catch {
        announce(`Couldn’t revoke access for ${credential.appName}.`, "assertive");
      } finally {
        setCredentialsBusy((prev) => {
          const next = new Set(prev);
          next.delete(credential.id);
          return next;
        });
      }
    },
    [announce],
  );

  const now = Date.now();

  return (
    <section className="settings-client-access" aria-labelledby="settings-client-access-title">
      <header className="settings-client-access-hero">
        <p className="settings-client-access-hero__kicker">Settings · Client Access</p>
        <h1 id="settings-client-access-title">Client Access</h1>
        <p className="settings-client-access-hero__subtitle">
          Approve pairing requests from the standalone OpenCoven Chat app, and manage which installations can reach
          this Cave.
        </p>
      </header>

      <div id={settingsGroupId("Pending requests")} data-settings-group tabIndex={-1} className="settings-client-access-group scroll-mt-4 focus-ring">
        <SectionHeading>Pending requests</SectionHeading>
        {pendingLoading ? (
          <section role="status" aria-busy="true">
            <span className="sr-only">Loading pending pairing requests…</span>
            <SkeletonRows count={2} />
          </section>
        ) : pendingError ? (
          <ErrorState
            headline="Couldn’t load pending requests"
            subtitle={pendingError}
            actions={
              <Button size="sm" onClick={() => void loadPending()}>
                Retry
              </Button>
            }
          />
        ) : pending.length === 0 ? (
          <EmptyState
            icon="ph:plug"
            headline="No pending pairing requests"
            subtitle="New OpenCoven Chat installations will appear here for approval."
          />
        ) : (
          <ul className="settings-client-access-list">
            {pending.map((request) => (
              <li key={request.id} className="settings-client-access-row">
                <div className="settings-client-access-row__identity">
                  <strong>{request.appName}</strong>
                  <span className="settings-client-access-row__meta">
                    Installation …{installationSuffix(request.installationId)}
                  </span>
                  <span className="settings-client-access-row__meta">{formatScopes(request.scopes)}</span>
                  <span className="settings-client-access-row__meta">
                    Requested {relativeTime(new Date(request.createdAt).toISOString(), now)}
                  </span>
                  <span className="settings-client-access-row__meta">{formatExpiresIn(request.expiresAt, now)}</span>
                </div>
                <div className="settings-client-access-row__actions">
                  <Button
                    variant="primary"
                    size="sm"
                    loading={pendingBusy.has(request.id)}
                    disabled={pendingBusy.has(request.id)}
                    onClick={() => void decide(request, "approve")}
                    className="focus-ring"
                    aria-label={`Approve pairing request from ${request.appName}`}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="danger-ghost"
                    size="sm"
                    loading={pendingBusy.has(request.id)}
                    disabled={pendingBusy.has(request.id)}
                    onClick={() => void decide(request, "deny")}
                    className="focus-ring"
                    aria-label={`Deny pairing request from ${request.appName}`}
                  >
                    Deny
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div id={settingsGroupId("Paired clients")} data-settings-group tabIndex={-1} className="settings-client-access-group scroll-mt-4 focus-ring">
        <SectionHeading>Paired clients</SectionHeading>
        {credentialsLoading ? (
          <section role="status" aria-busy="true">
            <span className="sr-only">Loading paired clients…</span>
            <SkeletonRows count={2} />
          </section>
        ) : credentialsError ? (
          <ErrorState
            headline="Couldn’t load paired clients"
            subtitle={credentialsError}
            actions={
              <Button size="sm" onClick={() => void loadCredentials()}>
                Retry
              </Button>
            }
          />
        ) : credentials.length === 0 ? (
          <EmptyState
            icon="ph:link-simple"
            headline="No paired clients yet"
            subtitle="Approved installations will appear here, and can be revoked at any time."
          />
        ) : (
          <ul className="settings-client-access-list">
            {credentials.map((credential) => (
              <li key={credential.id} className="settings-client-access-row">
                <div className="settings-client-access-row__identity">
                  <strong>{credential.appName}</strong>
                  <span className="settings-client-access-row__meta">
                    Installation …{installationSuffix(credential.installationId)}
                  </span>
                  <span className="settings-client-access-row__meta">{formatScopes(credential.scopes)}</span>
                  <span className="settings-client-access-row__meta">
                    Paired {relativeTime(new Date(credential.createdAt).toISOString(), now)}
                  </span>
                  <span className="settings-client-access-row__meta">
                    {credential.lastUsedAt
                      ? `Last used ${relativeTime(new Date(credential.lastUsedAt).toISOString(), now)}`
                      : "Never used"}
                  </span>
                </div>
                <div className="settings-client-access-row__actions">
                  <Button
                    variant="danger-ghost"
                    size="sm"
                    loading={credentialsBusy.has(credential.id)}
                    disabled={credentialsBusy.has(credential.id)}
                    onClick={() => void revoke(credential)}
                    className="focus-ring"
                    aria-label={`Revoke access for ${credential.appName}`}
                  >
                    Revoke
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
