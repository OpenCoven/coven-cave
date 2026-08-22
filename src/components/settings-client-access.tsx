"use client";

import "@/styles/settings-client-access.css";

import { useCallback, useEffect, useRef, useState } from "react";
import { SettingsOverview } from "@/components/settings-overview";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { useAnnouncer } from "@/components/ui/live-region";
import { SettingsGroup } from "@/components/ui/settings-group";
import { SkeletonRows } from "@/components/ui/skeleton";
import { usePausablePoll } from "@/lib/use-pausable-poll";

export const CLIENT_ACCESS_POLL_MS = 10_000;
const CLIENT_ACCESS_REVOCATION_REASON = "Revoked in Cave settings";

export type ClientAccessRequestStatus =
  | "pending"
  | "approved"
  | "denied"
  | "expired";

export type ClientAccessPairingRequest = {
  id: string;
  appName: string;
  installationId: string;
  scopes: string[];
  status: ClientAccessRequestStatus;
  createdAt: number;
  expiresAt: number;
  decidedAt: number | null;
};

export type ClientAccessCredential = {
  id: string;
  appName: string;
  installationId: string;
  scopes: string[];
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
  revocationReason: string | null;
};

export type ClientAccessAction = {
  kind: "approve" | "deny" | "revoke";
  id: string;
};

type ControlledClientAccessProps = {
  pendingRequests: ClientAccessPairingRequest[];
  credentials: ClientAccessCredential[];
  loading?: boolean;
  error?: string | null;
  action?: ClientAccessAction | null;
  onApprove: (id: string) => void | Promise<void>;
  onDeny: (id: string) => void | Promise<void>;
  onRevoke: (id: string) => void | Promise<void>;
  onRetry?: () => void;
};

type ManagedClientAccessProps = {
  active?: boolean;
};

export type SettingsClientAccessProps =
  | ControlledClientAccessProps
  | ManagedClientAccessProps;

type PairingListResponse = {
  ok?: boolean;
  pairingRequests?: ClientAccessPairingRequest[];
};

type CredentialListResponse = {
  ok?: boolean;
  credentials?: ClientAccessCredential[];
};

function isControlled(
  props: SettingsClientAccessProps,
): props is ControlledClientAccessProps {
  return "pendingRequests" in props && "credentials" in props;
}

function formatTime(value: number): { dateTime: string; label: string } | null {
  const date = new Date(value);
  if (!Number.isFinite(value) || Number.isNaN(date.getTime())) return null;
  const dateTime = date.toISOString();
  return {
    dateTime,
    label: dateTime.replace("T", " ").replace(".000Z", " UTC"),
  };
}

function Timestamp({ value, empty = "Never" }: { value: number | null; empty?: string }) {
  const formatted = value === null ? null : formatTime(value);
  if (!formatted) return <>{empty}</>;
  return <time dateTime={formatted.dateTime}>{formatted.label}</time>;
}

function StatusChip({
  status,
}: {
  status: ClientAccessRequestStatus | "active" | "revoked";
}) {
  const labels: Record<typeof status, string> = {
    pending: "Pending",
    approved: "Approved",
    denied: "Denied",
    expired: "Expired",
    active: "Active",
    revoked: "Revoked",
  };
  return (
    <span className={`settings-client-access__status settings-client-access__status--${status}`}>
      <i aria-hidden="true" />
      {labels[status]}
    </span>
  );
}

function ScopeList({ scopes }: { scopes: string[] }) {
  return (
    <ul className="settings-client-access__scopes" aria-label="Granted scopes">
      {scopes.map((scope) => (
        <li key={scope}>{scope}</li>
      ))}
    </ul>
  );
}

function RequestCard({
  request,
  action,
  onApprove,
  onDeny,
}: {
  request: ClientAccessPairingRequest;
  action: ClientAccessAction | null;
  onApprove: (id: string) => void | Promise<void>;
  onDeny: (id: string) => void | Promise<void>;
}) {
  const busy = action !== null;
  return (
    <article className="settings-client-access__card">
      <header className="settings-client-access__card-header">
        <div className="settings-client-access__identity">
          <h3>{request.appName}</h3>
          <p>{request.installationId}</p>
        </div>
        <StatusChip status={request.status} />
      </header>
      <ScopeList scopes={request.scopes} />
      <dl className="settings-client-access__metadata">
        <div>
          <dt>Created</dt>
          <dd><Timestamp value={request.createdAt} empty="Unknown" /></dd>
        </div>
        <div>
          <dt>Expires</dt>
          <dd><Timestamp value={request.expiresAt} empty="Unknown" /></dd>
        </div>
        {request.decidedAt !== null ? (
          <div>
            <dt>Decided</dt>
            <dd><Timestamp value={request.decidedAt} empty="Unknown" /></dd>
          </div>
        ) : null}
      </dl>
      {request.status === "pending" ? (
        <div className="settings-client-access__actions">
          <Button
            size="sm"
            variant="primary"
            disabled={busy}
            loading={action?.kind === "approve" && action.id === request.id}
            aria-label={`Approve access for ${request.appName}`}
            onClick={() => onApprove(request.id)}
          >
            Approve
          </Button>
          <Button
            size="sm"
            variant="danger-ghost"
            disabled={busy}
            loading={action?.kind === "deny" && action.id === request.id}
            aria-label={`Deny access for ${request.appName}`}
            onClick={() => onDeny(request.id)}
          >
            Deny
          </Button>
        </div>
      ) : null}
    </article>
  );
}

function CredentialCard({
  credential,
  action,
  onRevoke,
}: {
  credential: ClientAccessCredential;
  action: ClientAccessAction | null;
  onRevoke: (id: string) => void | Promise<void>;
}) {
  const revoked = credential.revokedAt !== null;
  return (
    <article className="settings-client-access__card">
      <header className="settings-client-access__card-header">
        <div className="settings-client-access__identity">
          <h3>{credential.appName}</h3>
          <p>{credential.installationId}</p>
        </div>
        <StatusChip status={revoked ? "revoked" : "active"} />
      </header>
      <ScopeList scopes={credential.scopes} />
      <dl className="settings-client-access__metadata">
        <div>
          <dt>Created</dt>
          <dd><Timestamp value={credential.createdAt} empty="Unknown" /></dd>
        </div>
        <div>
          <dt>Last used</dt>
          <dd><Timestamp value={credential.lastUsedAt} /></dd>
        </div>
        {credential.revokedAt !== null ? (
          <div>
            <dt>Revoked</dt>
            <dd><Timestamp value={credential.revokedAt} empty="Unknown" /></dd>
          </div>
        ) : null}
        {credential.revocationReason ? (
          <div className="settings-client-access__reason">
            <dt>Reason</dt>
            <dd>{credential.revocationReason}</dd>
          </div>
        ) : null}
      </dl>
      {!revoked ? (
        <div className="settings-client-access__actions">
          <Button
            size="sm"
            variant="danger-ghost"
            disabled={action !== null}
            loading={action?.kind === "revoke" && action.id === credential.id}
            aria-label={`Revoke access for ${credential.appName}`}
            onClick={() => onRevoke(credential.id)}
          >
            Revoke
          </Button>
        </div>
      ) : null}
    </article>
  );
}

function SettingsClientAccessContent({
  pendingRequests,
  credentials,
  loading = false,
  error = null,
  action = null,
  onApprove,
  onDeny,
  onRevoke,
  onRetry,
}: ControlledClientAccessProps) {
  const showInitialLoading =
    loading && pendingRequests.length === 0 && credentials.length === 0;
  return (
    <div className="settings-client-access">
      <SettingsOverview section="client-access" />
      {error ? (
        <ErrorState
          compact
          headline="Couldn’t load client access"
          subtitle={error}
          actions={onRetry ? (
            <Button size="xs" onClick={onRetry} leadingIcon="ph:arrows-clockwise">
              Retry
            </Button>
          ) : undefined}
        />
      ) : null}
      {showInitialLoading ? (
        <div className="settings-client-access__loading" role="status" aria-busy="true">
          <p>Loading client access…</p>
          <SkeletonRows count={4} />
        </div>
      ) : (
        <>
          <SettingsGroup
            label="Pending requests"
            description="Review apps asking Cave for scoped client access."
            meta={`${pendingRequests.length}`}
            variant="ruled"
            panel={false}
          >
            {pendingRequests.length > 0 ? (
              <div className="settings-client-access__list">
                {pendingRequests.map((request) => (
                  <RequestCard
                    key={request.id}
                    request={request}
                    action={action}
                    onApprove={onApprove}
                    onDeny={onDeny}
                  />
                ))}
              </div>
            ) : (
              <p className="settings-client-access__empty">No pending requests.</p>
            )}
          </SettingsGroup>
          <SettingsGroup
            label="Issued credentials"
            description="Active and revoked client credentials. Secret values are never shown."
            meta={`${credentials.length}`}
            variant="ruled"
            panel={false}
          >
            {credentials.length > 0 ? (
              <div className="settings-client-access__list">
                {credentials.map((credential) => (
                  <CredentialCard
                    key={credential.id}
                    credential={credential}
                    action={action}
                    onRevoke={onRevoke}
                  />
                ))}
              </div>
            ) : (
              <p className="settings-client-access__empty">No client credentials issued.</p>
            )}
          </SettingsGroup>
        </>
      )}
    </div>
  );
}

function appendTerminalRequest(
  current: ClientAccessPairingRequest[],
  request: ClientAccessPairingRequest,
): ClientAccessPairingRequest[] {
  return [request, ...current.filter((entry) => entry.id !== request.id)];
}

function ManagedSettingsClientAccess({ active = true }: ManagedClientAccessProps) {
  const { announce } = useAnnouncer();
  const [pendingRequests, setPendingRequests] = useState<ClientAccessPairingRequest[]>([]);
  const [terminalRequests, setTerminalRequests] = useState<ClientAccessPairingRequest[]>([]);
  const [credentials, setCredentials] = useState<ClientAccessCredential[]>([]);
  const [loading, setLoading] = useState(active);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<ClientAccessAction | null>(null);
  const pendingRef = useRef<ClientAccessPairingRequest[]>([]);
  const loadAbortRef = useRef<AbortController | null>(null);
  const actionRef = useRef<ClientAccessAction | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadAbortRef.current?.abort();
    };
  }, []);

  const load = useCallback(async (showLoading = false) => {
    if (!active) return;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    if (showLoading) setLoading(true);
    try {
      const [pairingResponse, credentialResponse] = await Promise.all([
        fetch("/api/client/v1/admin/pairing-requests", {
          cache: "no-store",
          signal: controller.signal,
        }),
        fetch("/api/client/v1/admin/credentials", {
          cache: "no-store",
          signal: controller.signal,
        }),
      ]);
      const pairingPayload = await pairingResponse.json().catch(() => null) as PairingListResponse | null;
      const credentialPayload = await credentialResponse.json().catch(() => null) as CredentialListResponse | null;
      if (
        !pairingResponse.ok
        || !credentialResponse.ok
        || pairingPayload?.ok !== true
        || credentialPayload?.ok !== true
        || !Array.isArray(pairingPayload.pairingRequests)
        || !Array.isArray(credentialPayload.credentials)
      ) {
        throw new Error("client access request failed");
      }
      if (controller.signal.aborted || !mountedRef.current) return;

      const nextPending = pairingPayload.pairingRequests;
      const nextIds = new Set(nextPending.map((request) => request.id));
      const expired = pendingRef.current
        .filter(
          (request) =>
            request.status === "pending"
            && !nextIds.has(request.id)
            && request.expiresAt <= Date.now(),
        )
        .map((request) => ({ ...request, status: "expired" as const }));
      if (expired.length > 0) {
        setTerminalRequests((current) =>
          expired.reduce(appendTerminalRequest, current),
        );
      }
      pendingRef.current = nextPending;
      setPendingRequests(nextPending);
      setCredentials(credentialPayload.credentials);
      setError(null);
    } catch {
      if (controller.signal.aborted || !mountedRef.current) return;
      setError("Couldn’t load client access.");
    } finally {
      if (!controller.signal.aborted && mountedRef.current) setLoading(false);
    }
  }, [active]);

  useEffect(() => {
    if (!active) {
      loadAbortRef.current?.abort();
      setLoading(false);
      return;
    }
    void load(true);
    return () => loadAbortRef.current?.abort();
  }, [active, load]);

  usePausablePoll(() => load(false), CLIENT_ACCESS_POLL_MS, { enabled: active });

  const decide = useCallback(async (
    request: ClientAccessPairingRequest,
    decision: "approved" | "denied",
  ) => {
    const kind = decision === "approved" ? "approve" : "deny";
    if (actionRef.current) return;
    const nextAction: ClientAccessAction = { kind, id: request.id };
    actionRef.current = nextAction;
    setAction(nextAction);
    setError(null);
    try {
      const response = await fetch(
        `/api/client/v1/admin/pairing-requests/${encodeURIComponent(request.id)}/decision`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision }),
        },
      );
      const payload = await response.json().catch(() => null) as {
        ok?: boolean;
        pairingRequest?: ClientAccessPairingRequest;
      } | null;
      if (!response.ok || payload?.ok !== true || !payload.pairingRequest) {
        throw new Error("pairing decision failed");
      }
      if (!mountedRef.current) return;
      pendingRef.current = pendingRef.current.filter((entry) => entry.id !== request.id);
      setPendingRequests(pendingRef.current);
      setTerminalRequests((current) =>
        appendTerminalRequest(current, payload.pairingRequest as ClientAccessPairingRequest),
      );
      await load(false);
      if (!mountedRef.current) return;
      const verb = decision === "approved" ? "Approved" : "Denied";
      announce(`${verb} access for ${request.appName}.`, "polite");
    } catch {
      if (!mountedRef.current) return;
      const message = `Couldn’t ${kind} access for ${request.appName}.`;
      setError(message);
      announce(message, "assertive");
    } finally {
      actionRef.current = null;
      if (mountedRef.current) setAction(null);
    }
  }, [announce, load]);

  const revoke = useCallback(async (credential: ClientAccessCredential) => {
    if (actionRef.current) return;
    const nextAction: ClientAccessAction = { kind: "revoke", id: credential.id };
    actionRef.current = nextAction;
    setAction(nextAction);
    setError(null);
    try {
      const response = await fetch(
        `/api/client/v1/admin/credentials/${encodeURIComponent(credential.id)}`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: CLIENT_ACCESS_REVOCATION_REASON }),
        },
      );
      const payload = await response.json().catch(() => null) as {
        ok?: boolean;
        credential?: ClientAccessCredential;
      } | null;
      if (!response.ok || payload?.ok !== true || !payload.credential) {
        throw new Error("credential revocation failed");
      }
      if (!mountedRef.current) return;
      setCredentials((current) =>
        current.map((entry) =>
          entry.id === credential.id
            ? payload.credential as ClientAccessCredential
            : entry,
        ),
      );
      await load(false);
      if (!mountedRef.current) return;
      announce(`Revoked access for ${credential.appName}.`, "polite");
    } catch {
      if (!mountedRef.current) return;
      const message = `Couldn’t revoke access for ${credential.appName}.`;
      setError(message);
      announce(message, "assertive");
    } finally {
      actionRef.current = null;
      if (mountedRef.current) setAction(null);
    }
  }, [announce, load]);

  const requests = [...terminalRequests, ...pendingRequests];
  return (
    <SettingsClientAccessContent
      pendingRequests={requests}
      credentials={credentials}
      loading={loading}
      error={error}
      action={action}
      onApprove={(id) => {
        const request = pendingRef.current.find((entry) => entry.id === id);
        return request ? decide(request, "approved") : undefined;
      }}
      onDeny={(id) => {
        const request = pendingRef.current.find((entry) => entry.id === id);
        return request ? decide(request, "denied") : undefined;
      }}
      onRevoke={(id) => {
        const credential = credentials.find((entry) => entry.id === id);
        return credential ? revoke(credential) : undefined;
      }}
      onRetry={() => { void load(true); }}
    />
  );
}

export function SettingsClientAccess(props: SettingsClientAccessProps = {}) {
  if (isControlled(props)) {
    return <SettingsClientAccessContent {...props} />;
  }
  return <ManagedSettingsClientAccess active={props.active} />;
}
