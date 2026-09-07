"use client";

import "@/styles/settings-client-access.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SettingsOverview } from "@/components/settings-overview";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { useAnnouncer } from "@/components/ui/live-region";
import { SettingsGroup } from "@/components/ui/settings-group";
import { SkeletonRows } from "@/components/ui/skeleton";
import { usePausablePoll } from "@/lib/use-pausable-poll";

export const CLIENT_ACCESS_POLL_MS = 10_000;
// Client access reads stay on the local admin surface, but can still outlast
// one poll window when the app is busy. Give them two poll intervals so slow
// loads still coalesce; after that, treat the read as wedged and recover.
export const CLIENT_ACCESS_LOAD_TIMEOUT_MS = CLIENT_ACCESS_POLL_MS * 2;
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

// Operational state of the client v1 surface itself (cave-6rwq0), as answered
// by GET /api/client/v1/admin/status. The two degraded states — the discovery
// record not published (the CLIENT V1 DISABLED boot banner) and the
// unverified-ownership waiver in force (the SECURITY WAIVER line) — previously
// existed only on stderr; this is the same state, read from the admin surface
// this Settings screen already uses for pairing and credentials.
export type ClientV1DiscoveryStatus = {
  available: boolean;
  reason?: string;
};

export type ClientV1OwnershipWaiverStatus = {
  granted: boolean;
  reason?: string;
};

export type ClientV1Status = {
  discovery: ClientV1DiscoveryStatus;
  ownershipWaiver: ClientV1OwnershipWaiverStatus;
};

type ClientAccessErrorState = {
  source: "load" | "mutation";
  headline: string;
  subtitle?: string;
  terminal?: boolean;
};

type ControlledClientAccessProps = {
  pendingRequests: ClientAccessPairingRequest[];
  credentials: ClientAccessCredential[];
  status?: ClientV1Status | null;
  loading?: boolean;
  error?: string | null;
  errorHeadline?: string | null;
  hasConfirmedSnapshot?: boolean;
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

type ClientAccessErrorEnvelope = {
  error?: {
    code?: string;
    details?: {
      reason?: string;
    };
  };
};

type ClientAccessResponseFailure = {
  status: number;
  code: string | null;
  reason: string | null;
};

type ClientAccessLoadMode =
  | "authoritative"
  | "background"
  | "initial"
  | "manual";

type ActiveLoad = {
  controller: AbortController;
  id: number;
  mode: ClientAccessLoadMode;
  promise: Promise<void>;
};

type ClientAccessLoadOptions = {
  preserveMutationError?: boolean;
  showLoading?: boolean;
};

type ClientAccessIdentityRecord = {
  id: string;
  appName: string;
  installationId: string;
};

type ClientAccessIdentityKind = "request" | "credential";

const CLIENT_ACCESS_IDENTITY_KEY_SEPARATOR = "\u0000";
const CLIENT_ACCESS_STABLE_ID_SUFFIX_MIN = 4;
const CLIENT_ACCESS_STABLE_ID_TOKEN_MAX = 8;

function isControlled(
  props: SettingsClientAccessProps,
): props is ControlledClientAccessProps {
  return "pendingRequests" in props && "credentials" in props;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function ScopeList({ scopes, label }: { scopes: string[]; label: string }) {
  return (
    <ul className="settings-client-access__scopes" aria-label={label}>
      {scopes.map((scope) => (
        <li key={scope}>{scope}</li>
      ))}
    </ul>
  );
}

function parsePairingRequests(payload: unknown): ClientAccessPairingRequest[] | null {
  if (!isRecord(payload) || typeof payload.apiVersion !== "string") return null;
  if (!isRecord(payload.data) || !Array.isArray(payload.data.pairingRequests)) {
    return null;
  }
  return payload.data.pairingRequests as ClientAccessPairingRequest[];
}

function parseCredentials(payload: unknown): ClientAccessCredential[] | null {
  if (!isRecord(payload) || typeof payload.apiVersion !== "string") return null;
  if (!isRecord(payload.data) || !Array.isArray(payload.data.credentials)) {
    return null;
  }
  return payload.data.credentials as ClientAccessCredential[];
}

function parseStatus(payload: unknown): ClientV1Status | null {
  if (!isRecord(payload) || typeof payload.apiVersion !== "string") return null;
  if (!isRecord(payload.data) || !isRecord(payload.data.status)) return null;
  const status = payload.data.status;
  if (!isRecord(status.discovery) || typeof status.discovery.available !== "boolean") {
    return null;
  }
  if (
    !isRecord(status.ownershipWaiver)
    || typeof status.ownershipWaiver.granted !== "boolean"
  ) {
    return null;
  }
  const discovery: ClientV1DiscoveryStatus = {
    available: status.discovery.available,
    ...(typeof status.discovery.reason === "string"
      ? { reason: status.discovery.reason }
      : {}),
  };
  const ownershipWaiver: ClientV1OwnershipWaiverStatus = {
    granted: status.ownershipWaiver.granted,
    ...(typeof status.ownershipWaiver.reason === "string"
      ? { reason: status.ownershipWaiver.reason }
      : {}),
  };
  return { discovery, ownershipWaiver };
}

// Best-effort by design: the degraded states are important when they exist,
// but the status endpoint must never take the whole client access page down
// with it. Any failure — network, refused auth, a body that is not the
// expected envelope — reads as "no status known" and leaves the rest of the
// load untouched.
async function fetchClientV1Status(signal: AbortSignal): Promise<ClientV1Status | null> {
  try {
    const response = await fetch("/api/client/v1/admin/status", {
      cache: "no-store",
      signal,
    });
    return parseStatus(await parseJson(response));
  } catch {
    return null;
  }
}

function parsePairingRequest(payload: unknown): ClientAccessPairingRequest | null {
  if (!isRecord(payload) || typeof payload.apiVersion !== "string") return null;
  if (!isRecord(payload.data) || !isRecord(payload.data.pairingRequest)) {
    return null;
  }
  return payload.data.pairingRequest as ClientAccessPairingRequest;
}

function parseCredential(payload: unknown): ClientAccessCredential | null {
  if (!isRecord(payload) || typeof payload.apiVersion !== "string") return null;
  if (!isRecord(payload.data) || !isRecord(payload.data.credential)) {
    return null;
  }
  return payload.data.credential as ClientAccessCredential;
}

async function parseJson(response: Response): Promise<unknown | null> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function parseResponseFailure(
  response: Response,
  payload: unknown,
): ClientAccessResponseFailure {
  if (!isRecord(payload)) {
    return { status: response.status, code: null, reason: null };
  }
  const envelope = payload as ClientAccessErrorEnvelope;
  return {
    status: response.status,
    code: typeof envelope.error?.code === "string" ? envelope.error.code : null,
    reason: typeof envelope.error?.details?.reason === "string"
      ? envelope.error.details.reason
      : null,
  };
}

function duplicateKeys<T>(
  records: T[],
  keyFor: (record: T) => string,
): Set<string> {
  const counts = new Map<string, number>();
  for (const record of records) {
    const key = keyFor(record);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set(
    Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([key]) => key),
  );
}

function describeAppIdentity(
  appName: string,
  installationId: string,
  includeInstallationId: boolean,
): string {
  return includeInstallationId
    ? `${appName}, installation ${installationId}`
    : appName;
}

function recordIdentityKey(record: ClientAccessIdentityRecord): string {
  return `${record.appName}${CLIENT_ACCESS_IDENTITY_KEY_SEPARATOR}${record.installationId}`;
}

function recordDescriptorKey(record: ClientAccessIdentityRecord): string {
  return `${recordIdentityKey(record)}${CLIENT_ACCESS_IDENTITY_KEY_SEPARATOR}${record.id}`;
}

function isUniqueSuffix(
  value: string,
  recordId: string,
  ids: string[],
): boolean {
  return ids.every((candidateId) => candidateId === recordId || !candidateId.endsWith(value));
}

function describeStableRecordDistinguisher(
  kind: ClientAccessIdentityKind,
  recordId: string,
  ids: string[],
): string {
  const tailToken = recordId.match(/([A-Za-z0-9]+)$/u)?.[1] ?? null;
  if (
    tailToken
    && tailToken.length >= CLIENT_ACCESS_STABLE_ID_SUFFIX_MIN
    && tailToken.length <= CLIENT_ACCESS_STABLE_ID_TOKEN_MAX
    && isUniqueSuffix(tailToken, recordId, ids)
  ) {
    return `${kind} ID ending ${tailToken}`;
  }
  for (
    let length = Math.min(recordId.length, CLIENT_ACCESS_STABLE_ID_SUFFIX_MIN);
    length <= recordId.length;
    length += 1
  ) {
    const suffix = recordId.slice(-length);
    if (isUniqueSuffix(suffix, recordId, ids)) {
      return `${kind} ID ending ${suffix}`;
    }
  }
  return `${kind} ID ${recordId}`;
}

function createActionIdentityResolver(
  records: ClientAccessIdentityRecord[],
  kind: ClientAccessIdentityKind,
): (record: ClientAccessIdentityRecord) => string {
  const duplicateAppNames = duplicateKeys(records, (record) => record.appName);
  const duplicateAppIdentities = duplicateKeys(records, recordIdentityKey);
  const recordDistinguishers = new Map<string, string>();
  if (duplicateAppIdentities.size > 0) {
    const recordsByIdentity = new Map<string, ClientAccessIdentityRecord[]>();
    for (const record of records) {
      const key = recordIdentityKey(record);
      if (!duplicateAppIdentities.has(key)) continue;
      const group = recordsByIdentity.get(key);
      if (group) {
        group.push(record);
      } else {
        recordsByIdentity.set(key, [record]);
      }
    }
    for (const group of recordsByIdentity.values()) {
      const ids = group.map((record) => record.id);
      for (const record of group) {
        recordDistinguishers.set(
          recordDescriptorKey(record),
          describeStableRecordDistinguisher(kind, record.id, ids),
        );
      }
    }
  }
  return (record) => {
    if (!duplicateAppNames.has(record.appName)) {
      return record.appName;
    }
    const identity = describeAppIdentity(record.appName, record.installationId, true);
    const distinguisher = recordDistinguishers.get(recordDescriptorKey(record));
    return distinguisher ? `${identity}, ${distinguisher}` : identity;
  };
}

function createLoadErrorState(
  hasLocalMutationState: boolean,
  hasSnapshot: boolean,
  timedOut = false,
): ClientAccessErrorState {
  if (!hasSnapshot) {
    return {
      source: "load",
      headline: timedOut
        ? "Client access took too long to load"
        : "Couldn’t load client access",
      subtitle: "Retry to fetch the latest client access state.",
    };
  }
  return {
    source: "load",
    headline: timedOut
      ? "Client access took too long to refresh"
      : "Couldn’t refresh client access",
    subtitle: hasLocalMutationState
      ? "Some client access details may still be stale. Retry to fetch the latest client access state."
      : "Showing the last confirmed snapshot. Retry to fetch the latest client access state.",
  };
}

function createMutationErrorState(
  headline: string,
  terminal = false,
): ClientAccessErrorState {
  return {
    source: "mutation",
    headline,
    terminal,
    ...(terminal ? { subtitle: "The request is no longer pending." } : {}),
  };
}

function errorAnnouncement(errorState: ClientAccessErrorState): string {
  return errorState.subtitle
    ? `${errorState.headline} ${errorState.subtitle}`
    : errorState.headline;
}

function isTerminalDecisionStatus(status: number): boolean {
  return status === 404 || status === 409;
}

function removeRecordById<T extends { id: string }>(
  records: T[],
  id: string,
): T[] {
  return records.filter((record) => record.id !== id);
}

function filterSuppressedPendingRequests(
  requests: ClientAccessPairingRequest[],
  suppressedIds: Set<string>,
): ClientAccessPairingRequest[] {
  if (suppressedIds.size === 0) return requests;
  return requests.filter((request) => !suppressedIds.has(request.id));
}

function RequestCard({
  request,
  action,
  actionIdentity,
  onApprove,
  onDeny,
}: {
  request: ClientAccessPairingRequest;
  action: ClientAccessAction | null;
  actionIdentity: string;
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
      <ScopeList scopes={request.scopes} label="Requested scopes" />
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
            aria-label={`Approve access for ${actionIdentity}`}
            onClick={() => onApprove(request.id)}
          >
            Approve
          </Button>
          <Button
            size="sm"
            variant="danger-ghost"
            disabled={busy}
            loading={action?.kind === "deny" && action.id === request.id}
            aria-label={`Deny access for ${actionIdentity}`}
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
  actionIdentity,
  onRevoke,
}: {
  credential: ClientAccessCredential;
  action: ClientAccessAction | null;
  actionIdentity: string;
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
      <ScopeList scopes={credential.scopes} label="Granted scopes" />
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
            aria-label={`Revoke access for ${actionIdentity}`}
            onClick={() => onRevoke(credential.id)}
          >
            Revoke
          </Button>
        </div>
      ) : null}
    </article>
  );
}

function ClientV1StatusSection({ status }: { status: ClientV1Status }) {
  const discoveryUnavailable = status.discovery.available === false;
  const waiverGranted = status.ownershipWaiver.granted === true;
  if (!discoveryUnavailable && !waiverGranted) return null;
  return (
    <SettingsGroup
      label="Client v1 status"
      description="Operational state of the client v1 surface."
      variant="ruled"
      panel={false}
    >
      {discoveryUnavailable ? (
        <div
          className="settings-client-access__alert"
          role="alert"
          aria-label="Client v1 is disabled"
        >
          <h3>Client v1 is disabled</h3>
          <p>
            The client v1 discovery record was not published, so paired clients
            cannot find this server and every client v1 request stays refused.
            Everything else on this server is running normally. Repair the path
            and restart to restore client v1 pairing.
          </p>
          {status.discovery.reason ? (
            <p className="settings-client-access__alert-detail">
              {status.discovery.reason}
            </p>
          ) : null}
        </div>
      ) : null}
      {waiverGranted ? (
        <div
          className="settings-client-access__alert"
          role="alert"
          aria-label="Security waiver in force"
        >
          <h3>Security waiver in force</h3>
          <p>
            Client v1 paths are being used with unverified ownership. The
            operator accepted this on this host with: “
            {status.ownershipWaiver.reason ?? "no reason recorded"}
            ”. Any principal that can write those paths can mint credentials
            or point a paired client at another server.
          </p>
          <p className="settings-client-access__alert-detail">
            Restart Cave without COVEN_CAVE_UNVERIFIED_PATH_OWNERSHIP set to
            restore the check.
          </p>
        </div>
      ) : null}
    </SettingsGroup>
  );
}

function SettingsClientAccessContent({
  pendingRequests,
  credentials,
  status = null,
  loading = false,
  error = null,
  errorHeadline = null,
  hasConfirmedSnapshot,
  action = null,
  onApprove,
  onDeny,
  onRevoke,
  onRetry,
}: ControlledClientAccessProps) {
  const resolvedErrorHeadline = errorHeadline ?? "Couldn’t load client access";
  const confirmedSnapshot = hasConfirmedSnapshot
    ?? (
      pendingRequests.length > 0
      || credentials.length > 0
      || (!loading && error === null && errorHeadline === null)
    );
  const showInitialLoading = loading && !confirmedSnapshot;
  const describePendingActionIdentity = useMemo(
    () => createActionIdentityResolver(pendingRequests, "request"),
    [pendingRequests],
  );
  const describeCredentialActionIdentity = useMemo(
    () => createActionIdentityResolver(credentials, "credential"),
    [credentials],
  );
  return (
    <div className="settings-client-access">
      <SettingsOverview section="client-access" />
      {error !== null || errorHeadline !== null ? (
        <ErrorState
          compact
          headline={resolvedErrorHeadline}
          subtitle={error ?? undefined}
          actions={onRetry ? (
            <Button size="xs" onClick={onRetry} leadingIcon="ph:arrows-clockwise">
              Retry
            </Button>
          ) : undefined}
        />
      ) : null}
      {status ? <ClientV1StatusSection status={status} /> : null}
      {showInitialLoading ? (
        <div className="settings-client-access__loading" role="status" aria-busy="true">
          <p>Loading client access…</p>
          <SkeletonRows count={4} />
        </div>
      ) : confirmedSnapshot ? (
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
                    actionIdentity={describePendingActionIdentity(request)}
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
                    actionIdentity={describeCredentialActionIdentity(credential)}
                    onRevoke={onRevoke}
                  />
                ))}
              </div>
            ) : (
              <p className="settings-client-access__empty">No client credentials issued.</p>
            )}
          </SettingsGroup>
        </>
      ) : null}
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
  const [status, setStatus] = useState<ClientV1Status | null>(null);
  const [hasConfirmedSnapshot, setHasConfirmedSnapshot] = useState(false);
  const [loading, setLoading] = useState(active);
  const [errorState, setErrorState] = useState<ClientAccessErrorState | null>(null);
  const [action, setAction] = useState<ClientAccessAction | null>(null);
  const pendingRef = useRef<ClientAccessPairingRequest[]>([]);
  const terminalRequestsRef = useRef<ClientAccessPairingRequest[]>([]);
  const credentialsRef = useRef<ClientAccessCredential[]>([]);
  const loadRef = useRef<ActiveLoad | null>(null);
  const hasConfirmedSnapshotRef = useRef(false);
  const loadIdRef = useRef(0);
  const hasLocalMutationStateRef = useRef(false);
  const suppressedTerminalRequestIdsRef = useRef<Set<string>>(new Set());
  const actionRef = useRef<ClientAccessAction | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadRef.current?.controller.abort();
      loadRef.current = null;
    };
  }, []);

  const load = useCallback(async (
    mode: ClientAccessLoadMode,
    options: ClientAccessLoadOptions = {},
  ) => {
    if (!active) return;
    const currentLoad = loadRef.current;
    if (currentLoad) {
      if (mode === "background") return currentLoad.promise;
      currentLoad.controller.abort();
    }
    const controller = new AbortController();
    let timedOut = false;
    const loadId = loadIdRef.current + 1;
    loadIdRef.current = loadId;
    if (options.showLoading) setLoading(true);
    if (mode !== "background") {
      setErrorState((currentError) =>
        currentError?.source === "load" ? null : currentError);
    }
    const promise = (async () => {
      const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, CLIENT_ACCESS_LOAD_TIMEOUT_MS);
      try {
        const [pairingResponse, credentialResponse, nextStatus] = await Promise.all([
          fetch("/api/client/v1/admin/pairing-requests", {
            cache: "no-store",
            signal: controller.signal,
          }),
          fetch("/api/client/v1/admin/credentials", {
            cache: "no-store",
            signal: controller.signal,
          }),
          fetchClientV1Status(controller.signal),
        ]);
        const [pairingPayload, credentialPayload] = await Promise.all([
          parseJson(pairingResponse),
          parseJson(credentialResponse),
        ]);
        const parsedPending = parsePairingRequests(pairingPayload);
        const nextCredentials = parseCredentials(credentialPayload);
        if (
          !pairingResponse.ok
          || !credentialResponse.ok
          || parsedPending === null
          || nextCredentials === null
        ) {
          throw new Error("client access request failed");
        }
        const nextPending = filterSuppressedPendingRequests(
          parsedPending,
          suppressedTerminalRequestIdsRef.current,
        );
        if (
          controller.signal.aborted
          || !mountedRef.current
          || loadRef.current?.id !== loadId
        ) {
          return;
        }

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
          setTerminalRequests((current) => {
            const next = expired.reduce(appendTerminalRequest, current);
            terminalRequestsRef.current = next;
            return next;
          });
        }
        pendingRef.current = nextPending;
        credentialsRef.current = nextCredentials;
        setPendingRequests(nextPending);
        setCredentials(nextCredentials);
        setStatus(nextStatus);
        hasConfirmedSnapshotRef.current = true;
        setHasConfirmedSnapshot(true);
        hasLocalMutationStateRef.current = false;
        setErrorState((currentError) =>
          options.preserveMutationError
            && currentError?.source === "mutation"
            && currentError.terminal
            ? currentError
            : null);
      } catch {
        if (
          (!timedOut && controller.signal.aborted)
          || !mountedRef.current
          || loadRef.current?.id !== loadId
        ) {
          return;
        }
        setErrorState((currentError) =>
          options.preserveMutationError
            && currentError?.source === "mutation"
            && currentError.terminal
            ? currentError
            : createLoadErrorState(
                hasLocalMutationStateRef.current,
                hasConfirmedSnapshotRef.current,
                timedOut,
              ),
        );
      } finally {
        clearTimeout(timeoutId);
        if (loadRef.current?.id === loadId) loadRef.current = null;
        if (
          (timedOut || !controller.signal.aborted)
          && mountedRef.current
          && loadIdRef.current === loadId
        ) {
          setLoading(false);
        }
      }
    })();
    loadRef.current = {
      controller,
      id: loadId,
      mode,
      promise,
    };
    return promise;
  }, [active]);

  const settleTerminalRequest = useCallback((requestId: string) => {
    suppressedTerminalRequestIdsRef.current.add(requestId);
    pendingRef.current = removeRecordById(pendingRef.current, requestId);
    setPendingRequests(pendingRef.current);
    setTerminalRequests((current) => {
      const next = removeRecordById(current, requestId);
      terminalRequestsRef.current = next;
      return next;
    });
    hasLocalMutationStateRef.current = true;
  }, []);

  useEffect(() => {
    if (!active) {
      loadRef.current?.controller.abort();
      loadRef.current = null;
      setLoading(false);
      return;
    }
    void load("initial", { showLoading: true });
    return () => {
      loadRef.current?.controller.abort();
      loadRef.current = null;
    };
  }, [active, load]);

  usePausablePoll(() => load("background"), CLIENT_ACCESS_POLL_MS, {
    enabled: active,
  });

  const decide = useCallback(async (
    request: ClientAccessPairingRequest,
    decision: "approved" | "denied",
  ) => {
    const kind = decision === "approved" ? "approve" : "deny";
    if (actionRef.current) return;
    const nextAction: ClientAccessAction = { kind, id: request.id };
    const actionIdentity = createActionIdentityResolver(
      [...terminalRequestsRef.current, ...pendingRef.current],
      "request",
    )(request);
    actionRef.current = nextAction;
    setAction(nextAction);
    setErrorState(null);
    try {
      const response = await fetch(
        `/api/client/v1/admin/pairing-requests/${encodeURIComponent(request.id)}/decision`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision }),
        },
      );
      const payload = await parseJson(response);
      const pairingRequest = response.ok ? parsePairingRequest(payload) : null;
      if (response.ok && pairingRequest) {
        if (!mountedRef.current) return;
        pendingRef.current = pendingRef.current.filter((entry) => entry.id !== request.id);
        setPendingRequests(pendingRef.current);
        setTerminalRequests((current) => {
          const next = appendTerminalRequest(current, pairingRequest);
          terminalRequestsRef.current = next;
          return next;
        });
        hasLocalMutationStateRef.current = true;
        await load("authoritative");
        if (!mountedRef.current) return;
        const verb = decision === "approved" ? "Approved" : "Denied";
        announce(`${verb} access for ${actionIdentity}.`, "polite");
        return;
      }
      if (!mountedRef.current) return;
      const failure = parseResponseFailure(response, payload);
      const terminal = isTerminalDecisionStatus(failure.status);
      const error = createMutationErrorState(
        `Couldn’t ${kind} access for ${actionIdentity}.`,
        terminal,
      );
      setErrorState(error);
      announce(errorAnnouncement(error), "assertive");
      if (terminal) {
        settleTerminalRequest(request.id);
        await load("authoritative", { preserveMutationError: true });
      }
    } catch {
      if (!mountedRef.current) return;
      const error = createMutationErrorState(
        `Couldn’t ${kind} access for ${actionIdentity}.`,
      );
      setErrorState(error);
      announce(error.headline, "assertive");
    } finally {
      actionRef.current = null;
      if (mountedRef.current) setAction(null);
    }
  }, [announce, load, settleTerminalRequest]);

  const revoke = useCallback(async (credential: ClientAccessCredential) => {
    if (actionRef.current) return;
    const nextAction: ClientAccessAction = { kind: "revoke", id: credential.id };
    const actionIdentity = createActionIdentityResolver(
      credentialsRef.current,
      "credential",
    )(credential);
    actionRef.current = nextAction;
    setAction(nextAction);
    setErrorState(null);
    try {
      const response = await fetch(
        `/api/client/v1/admin/credentials/${encodeURIComponent(credential.id)}`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: CLIENT_ACCESS_REVOCATION_REASON }),
        },
      );
      const payload = await parseJson(response);
      const nextCredential = response.ok ? parseCredential(payload) : null;
      if (!response.ok || !nextCredential) {
        throw new Error("credential revocation failed");
      }
      if (!mountedRef.current) return;
      credentialsRef.current = credentialsRef.current.map((entry) =>
        entry.id === credential.id
          ? nextCredential
          : entry,
      );
      setCredentials(credentialsRef.current);
      hasLocalMutationStateRef.current = true;
      await load("authoritative");
      if (!mountedRef.current) return;
      announce(`Revoked access for ${actionIdentity}.`, "polite");
    } catch {
      if (!mountedRef.current) return;
      const error = createMutationErrorState(
        `Couldn’t revoke access for ${actionIdentity}.`,
      );
      setErrorState(error);
      announce(error.headline, "assertive");
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
      status={status}
      loading={loading}
      error={errorState?.subtitle ?? null}
      errorHeadline={errorState?.headline}
      hasConfirmedSnapshot={hasConfirmedSnapshot}
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
        const credential = credentialsRef.current.find((entry) => entry.id === id);
        return credential ? revoke(credential) : undefined;
      }}
      onRetry={() => { void load("manual", { showLoading: true }); }}
    />
  );
}

export function SettingsClientAccess(props: SettingsClientAccessProps = {}) {
  if (isControlled(props)) {
    return <SettingsClientAccessContent {...props} />;
  }
  return <ManagedSettingsClientAccess active={props.active} />;
}
