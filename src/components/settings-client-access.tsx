"use client";

import "@/styles/settings-client-access.css";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SettingsOverview } from "@/components/settings-overview";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { useAnnouncer } from "@/components/ui/live-region";
import { SettingsGroup } from "@/components/ui/settings-group";
import { SkeletonRows } from "@/components/ui/skeleton";
import { relativeTime, relativeTimeSigned } from "@/lib/relative-time";
import { usePausablePoll } from "@/lib/use-pausable-poll";

type PairingDecision = "approved" | "denied";
type BusyAction = PairingDecision | "revoke";

type PairingRequestRecord = {
  id: string;
  appName: string;
  installationId: string;
  scopes: string[];
  status: "pending" | PairingDecision;
  createdAt: number;
  expiresAt: number;
  decidedAt: number | null;
};

type CredentialRecord = {
  id: string;
  appName: string;
  installationId: string;
  scopes: string[];
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
  revocationReason: string | null;
};

type AlertState = {
  title: string;
  message: string;
};

class ClientAccessResponseError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ClientAccessResponseError";
    this.status = status;
  }
}

type LedgerLoadOutcome = "succeeded" | "failed" | "superseded" | "aborted";

type LedgerSummary = {
  pendingCount: number;
  activeCredentials: number;
  revokedCredentials: number;
  refreshedAt: number;
};

type ListState<T> = {
  status: "loading" | "ready" | "error";
  items: T[];
  alert: AlertState | null;
};

const REVOKE_REASON = "revoked from Settings";

function initialListState<T>(): ListState<T> {
  return {
    status: "loading",
    items: [],
    alert: null,
  };
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeTimestamp(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function normalizeNullableTimestamp(value: unknown): number | null {
  return value === null ? null : normalizeTimestamp(value);
}

function normalizeScopes(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const scopes: string[] = [];
  for (const entry of value) {
    const scope = normalizeString(entry);
    if (!scope) return null;
    scopes.push(scope);
  }
  return scopes;
}

function parsePairingRequest(value: unknown): PairingRequestRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = normalizeString(record.id);
  const appName = normalizeString(record.appName);
  const installationId = normalizeString(record.installationId);
  const scopes = normalizeScopes(record.scopes);
  const createdAt = normalizeTimestamp(record.createdAt);
  const expiresAt = normalizeTimestamp(record.expiresAt);
  const decidedAt = normalizeNullableTimestamp(record.decidedAt);
  if (
    !id
    || !appName
    || !installationId
    || !scopes
    || createdAt === null
    || expiresAt === null
    || (record.status !== "pending" && record.status !== "approved" && record.status !== "denied")
  ) {
    return null;
  }
  return {
    id,
    appName,
    installationId,
    scopes,
    status: record.status,
    createdAt,
    expiresAt,
    decidedAt,
  };
}

function parseCredential(value: unknown): CredentialRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = normalizeString(record.id);
  const appName = normalizeString(record.appName);
  const installationId = normalizeString(record.installationId);
  const scopes = normalizeScopes(record.scopes);
  const createdAt = normalizeTimestamp(record.createdAt);
  const lastUsedAt = normalizeNullableTimestamp(record.lastUsedAt);
  const revokedAt = normalizeNullableTimestamp(record.revokedAt);
  const revocationReason = record.revocationReason === null
    ? null
    : normalizeString(record.revocationReason);
  if (!id || !appName || !installationId || !scopes || createdAt === null) {
    return null;
  }
  if ((revokedAt === null) !== (revocationReason === null)) return null;
  return {
    id,
    appName,
    installationId,
    scopes,
    createdAt,
    lastUsedAt,
    revokedAt,
    revocationReason,
  };
}

function sortPairingRequests(items: PairingRequestRecord[]): PairingRequestRecord[] {
  return [...items].sort(
    (left, right) =>
      right.createdAt - left.createdAt
      || left.appName.localeCompare(right.appName),
  );
}

function sortCredentials(items: CredentialRecord[]): CredentialRecord[] {
  return [...items].sort((left, right) => {
    const lifecycle = Number(left.revokedAt !== null) - Number(right.revokedAt !== null);
    if (lifecycle !== 0) return lifecycle;
    const leftUpdatedAt = left.revokedAt ?? left.lastUsedAt ?? left.createdAt;
    const rightUpdatedAt = right.revokedAt ?? right.lastUsedAt ?? right.createdAt;
    return rightUpdatedAt - leftUpdatedAt || left.appName.localeCompare(right.appName);
  });
}

function parsePairingRequests(value: unknown): PairingRequestRecord[] {
  if (!Array.isArray(value)) throw new Error("Invalid pending approvals response.");
  return sortPairingRequests(
    value.map(parsePairingRequest).map((record) => {
      if (!record) throw new Error("Invalid pending approval record.");
      return record;
    }),
  );
}

function parseCredentials(value: unknown): CredentialRecord[] {
  if (!Array.isArray(value)) throw new Error("Invalid issued credentials response.");
  return sortCredentials(
    value.map(parseCredential).map((record) => {
      if (!record) throw new Error("Invalid credential record.");
      return record;
    }),
  );
}

async function readEnvelopeData(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => null) as
    | {
        data?: Record<string, unknown>;
        error?: { message?: unknown };
      }
    | null;

  if (!response.ok) {
    const message =
      payload?.error && typeof payload.error.message === "string"
        ? payload.error.message
        : `Request failed (${response.status})`;
    throw new ClientAccessResponseError(message, response.status);
  }

  if (!payload?.data || typeof payload.data !== "object" || Array.isArray(payload.data)) {
    throw new Error("Invalid client access response.");
  }
  return payload.data;
}

function isTerminalPairingDecisionError(error: unknown): error is ClientAccessResponseError {
  return error instanceof ClientAccessResponseError
    && (error.status === 404 || error.status === 409);
}

async function loadPairingRequests(signal: AbortSignal): Promise<PairingRequestRecord[]> {
  const response = await fetch("/api/client/v1/admin/pairing-requests", {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  const data = await readEnvelopeData(response);
  return parsePairingRequests(data.pairingRequests);
}

async function loadCredentials(signal: AbortSignal): Promise<CredentialRecord[]> {
  const response = await fetch("/api/client/v1/admin/credentials", {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  const data = await readEnvelopeData(response);
  return parseCredentials(data.credentials);
}

async function postPairingDecision(
  id: string,
  decision: PairingDecision,
  signal: AbortSignal,
): Promise<PairingRequestRecord> {
  const response = await fetch(`/api/client/v1/admin/pairing-requests/${id}/decision`, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision }),
    signal,
  });
  const data = await readEnvelopeData(response);
  const pairingRequest = parsePairingRequest(data.pairingRequest);
  if (!pairingRequest) throw new Error("Invalid pairing decision response.");
  return pairingRequest;
}

async function revokeCredential(
  id: string,
  signal: AbortSignal,
): Promise<CredentialRecord> {
  const response = await fetch(`/api/client/v1/admin/credentials/${id}`, {
    method: "DELETE",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason: REVOKE_REASON }),
    signal,
  });
  const data = await readEnvelopeData(response);
  const credential = parseCredential(data.credential);
  if (!credential) throw new Error("Invalid credential revocation response.");
  return credential;
}

function markRefreshing<T>(state: ListState<T>, alert: AlertState | null = null): ListState<T> {
  return state.status === "ready"
    ? { ...state, alert }
    : { ...state, status: "loading", alert };
}

function settleList<T>(
  current: ListState<T>,
  result: PromiseSettledResult<T[]>,
  titles: { load: string; refresh: string },
): ListState<T> {
  if (result.status === "fulfilled") {
    return {
      status: "ready",
      items: result.value,
      alert: null,
    };
  }

  const message =
    result.reason instanceof Error ? result.reason.message : "Request failed.";
  if (current.status === "ready") {
    return {
      ...current,
      alert: { title: titles.refresh, message },
    };
  }
  return {
    status: "error",
    items: [],
    alert: { title: titles.load, message },
  };
}

function timestampToIso(timestamp: number | null): string | null {
  if (timestamp === null) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function relativeLabel(timestamp: number | null): string | null {
  const iso = timestampToIso(timestamp);
  return iso ? relativeTime(iso) : null;
}

function expiryLabel(timestamp: number): string {
  const iso = timestampToIso(timestamp);
  if (!iso) return "Expiration unavailable";
  const signed = relativeTimeSigned(iso);
  if (!signed) return "Expiration unavailable";
  if (signed === "soon") return "Expires soon";
  if (signed.startsWith("in ")) return `Expires ${signed}`;
  return signed === "just now" ? "Expired just now" : `Expired ${signed}`;
}

function exactLabel(timestamp: number | null): string | undefined {
  if (timestamp === null) return undefined;
  try {
    return new Intl.DateTimeFormat([], {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(timestamp);
  } catch {
    return undefined;
  }
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatPendingCount(count: number): string {
  return `${count} pending`;
}

function pairingRequestActionLabel(action: "Approve" | "Deny", item: PairingRequestRecord): string {
  return `${action} ${item.appName} pairing request for installation ${item.installationId}`;
}

function revokeCredentialActionLabel(item: CredentialRecord): string {
  return `Revoke ${item.appName} credential for installation ${item.installationId}`;
}

function summarizeLedger(
  pairings: PairingRequestRecord[],
  credentials: CredentialRecord[],
  refreshedAt: number,
): LedgerSummary {
  const revokedCredentials = credentials.filter((record) => record.revokedAt !== null).length;
  return {
    pendingCount: pairings.length,
    activeCredentials: credentials.length - revokedCredentials,
    revokedCredentials,
    refreshedAt,
  };
}

function StatusChip({
  label,
  tone,
  compact = false,
}: {
  label: string;
  tone: "pending" | "active" | "revoked";
  compact?: boolean;
}) {
  const className = compact
    ? "settings-client-access__summary-chip"
    : "settings-client-access__status-chip";
  return (
    <span className={className} data-tone={tone}>
      <span className="settings-client-access__chip-dot" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

function ScopeList({
  scopes,
  ariaLabel,
}: {
  scopes: string[];
  ariaLabel: string;
}) {
  return (
    <div className="settings-client-access__scopes-block">
      <p className="settings-client-access__scopes-label">Scopes</p>
      <ul className="settings-client-access__scopes" role="list" aria-label={ariaLabel}>
        {scopes.map((scope) => (
          <li key={scope} className="settings-client-access__scope">
            {scope}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RefreshAlert({
  alert,
  retryLabel,
  onRetry,
}: {
  alert: AlertState;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className="settings-client-access__inline-state">
      <ErrorState
        compact
        live={false}
        headline={alert.title}
        subtitle={alert.message}
        actions={(
          <Button
            size="xs"
            variant="secondary"
            aria-label={retryLabel}
            onClick={onRetry}
          >
            Retry
          </Button>
        )}
      />
    </div>
  );
}

function EmptyStateWithRefreshAlert({
  alert,
  retryLabel,
  onRetry,
  children,
}: {
  alert: AlertState | null;
  retryLabel: string;
  onRetry: () => void;
  children: ReactNode;
}) {
  if (!alert) {
    return <div className="settings-client-access__state">{children}</div>;
  }
  return (
    <div className="settings-client-access__list">
      <RefreshAlert alert={alert} retryLabel={retryLabel} onRetry={onRetry} />
      <div className="settings-client-access__state">{children}</div>
    </div>
  );
}

function PairingRequestItem({
  item,
  busyAction,
  onApprove,
  onDeny,
}: {
  item: PairingRequestRecord;
  busyAction?: BusyAction;
  onApprove: () => void;
  onDeny: () => void;
}) {
  return (
    <article className="settings-client-access__item">
      <div className="settings-client-access__item-head">
        <div className="settings-client-access__item-copy">
          <div className="settings-client-access__item-name-row">
            <h3 className="settings-client-access__item-name">{item.appName}</h3>
            <StatusChip label="Pending approval" tone="pending" />
          </div>
          <p className="settings-client-access__item-kicker">
            Review the installation identity and requested scopes before issuing access.
          </p>
        </div>
        <div className="settings-client-access__actions">
          <Button
            variant="primary"
            size="xs"
            aria-label={pairingRequestActionLabel("Approve", item)}
            loading={busyAction === "approved"}
            disabled={Boolean(busyAction)}
            onClick={onApprove}
          >
            {busyAction === "approved" ? "Approving…" : "Approve"}
          </Button>
          <Button
            variant="danger-ghost"
            size="xs"
            aria-label={pairingRequestActionLabel("Deny", item)}
            loading={busyAction === "denied"}
            disabled={Boolean(busyAction)}
            onClick={onDeny}
          >
            {busyAction === "denied" ? "Denying…" : "Deny"}
          </Button>
        </div>
      </div>

      <dl className="settings-client-access__details">
        <div className="settings-client-access__detail">
          <dt>Installation</dt>
          <dd className="settings-client-access__mono">{item.installationId}</dd>
        </div>
        <div className="settings-client-access__detail">
          <dt>Requested</dt>
          <dd title={exactLabel(item.createdAt)}>{relativeLabel(item.createdAt) ?? "Unavailable"}</dd>
        </div>
        <div className="settings-client-access__detail">
          <dt>Expiry</dt>
          <dd title={exactLabel(item.expiresAt)}>{expiryLabel(item.expiresAt)}</dd>
        </div>
      </dl>

      <ScopeList scopes={item.scopes} ariaLabel="Requested scopes" />
    </article>
  );
}

function CredentialItem({
  item,
  busyAction,
  onRevoke,
}: {
  item: CredentialRecord;
  busyAction?: BusyAction;
  onRevoke: () => void;
}) {
  const revoked = item.revokedAt !== null;
  const lastUsedLabel = item.lastUsedAt === null
    ? "Not used yet"
    : relativeLabel(item.lastUsedAt) ?? "Unavailable";
  const revokedLabel = item.revokedAt === null
    ? null
    : relativeLabel(item.revokedAt) ?? "Unavailable";

  return (
    <article className="settings-client-access__item">
      <div className="settings-client-access__item-head">
        <div className="settings-client-access__item-copy">
          <div className="settings-client-access__item-name-row">
            <h3 className="settings-client-access__item-name">{item.appName}</h3>
            <StatusChip label={revoked ? "Revoked" : "Active"} tone={revoked ? "revoked" : "active"} />
          </div>
          <p className="settings-client-access__item-kicker">
            Active credentials keep working until you revoke them.
          </p>
        </div>
        {!revoked ? (
          <div className="settings-client-access__actions">
            <Button
              variant="danger-ghost"
              size="xs"
              aria-label={revokeCredentialActionLabel(item)}
              loading={busyAction === "revoke"}
              disabled={Boolean(busyAction)}
              onClick={onRevoke}
            >
              {busyAction === "revoke" ? "Revoking…" : "Revoke"}
            </Button>
          </div>
        ) : null}
      </div>

      <dl className="settings-client-access__details">
        <div className="settings-client-access__detail">
          <dt>Installation</dt>
          <dd className="settings-client-access__mono">{item.installationId}</dd>
        </div>
        <div className="settings-client-access__detail">
          <dt>Created</dt>
          <dd title={exactLabel(item.createdAt)}>{relativeLabel(item.createdAt) ?? "Unavailable"}</dd>
        </div>
        <div className="settings-client-access__detail">
          <dt>Last used</dt>
          <dd title={exactLabel(item.lastUsedAt)}>{lastUsedLabel}</dd>
        </div>
        {revokedLabel ? (
          <div className="settings-client-access__detail">
            <dt>Revoked</dt>
            <dd title={exactLabel(item.revokedAt)}>
              {revokedLabel}
              {item.revocationReason ? ` · ${item.revocationReason}` : ""}
            </dd>
          </div>
        ) : null}
      </dl>

      <ScopeList scopes={item.scopes} ariaLabel="Issued credential scopes" />
    </article>
  );
}

export function ClientAccessSection() {
  const { announce } = useAnnouncer();
  const [pairings, setPairings] = useState<ListState<PairingRequestRecord>>(initialListState);
  const [credentials, setCredentials] = useState<ListState<CredentialRecord>>(initialListState);
  const [refreshing, setRefreshing] = useState(true);
  const [confirmedSummary, setConfirmedSummary] = useState<LedgerSummary | null>(null);
  const [busyActions, setBusyActions] = useState<Record<string, BusyAction>>({});
  const loadControllerRef = useRef<AbortController | null>(null);
  const loadInFlightRef = useRef(false);
  const loadRequestIdRef = useRef(0);
  const latestLoadPromiseRef = useRef<Promise<LedgerLoadOutcome> | null>(null);
  const mountedRef = useRef(false);
  const busyActionsRef = useRef(new Map<string, BusyAction>());
  const mutationControllersRef = useRef(new Map<string, AbortController>());

  const finishAction = useCallback((key: string) => {
    busyActionsRef.current.delete(key);
    mutationControllersRef.current.delete(key);
    if (!mountedRef.current) return;
    setBusyActions((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const beginAction = useCallback((key: string, action: BusyAction): AbortController | null => {
    if (busyActionsRef.current.has(key)) return null;
    busyActionsRef.current.set(key, action);
    setBusyActions((current) => ({ ...current, [key]: action }));
    const controller = new AbortController();
    mutationControllersRef.current.set(key, controller);
    return controller;
  }, []);

  const awaitAuthoritativeRefresh = useCallback(async (
    refreshPromise: Promise<LedgerLoadOutcome>,
  ): Promise<LedgerLoadOutcome> => {
    let pendingRefresh = refreshPromise;
    while (true) {
      const outcome = await pendingRefresh;
      if (outcome !== "superseded") return outcome;
      const latestRefresh = latestLoadPromiseRef.current;
      if (!latestRefresh || latestRefresh === pendingRefresh) return "aborted";
      pendingRefresh = latestRefresh;
    }
  }, []);

  const loadLedger = useCallback((
    options: {
      announceResult?: boolean;
      pairingsAlert?: AlertState | null;
      credentialsAlert?: AlertState | null;
    } = {},
  ): Promise<LedgerLoadOutcome> => {
    const loadPromise = (async (): Promise<LedgerLoadOutcome> => {
      const requestId = loadRequestIdRef.current + 1;
      loadRequestIdRef.current = requestId;
      loadInFlightRef.current = true;
      loadControllerRef.current?.abort();
      const controller = new AbortController();
      loadControllerRef.current = controller;

      setRefreshing(true);
      setPairings((current) => markRefreshing(current, options.pairingsAlert ?? null));
      setCredentials((current) => markRefreshing(current, options.credentialsAlert ?? null));

      try {
        const [pairingsResult, credentialsResult] = await Promise.allSettled([
          loadPairingRequests(controller.signal),
          loadCredentials(controller.signal),
        ]);

        if (!mountedRef.current) return "aborted";
        if (requestId !== loadRequestIdRef.current) return "superseded";
        if (controller.signal.aborted) return "aborted";

        setPairings((current) =>
          settleList(current, pairingsResult, {
            load: "Couldn't load pending approvals.",
            refresh: "Couldn't refresh pending approvals.",
          }),
        );
        setCredentials((current) =>
          settleList(current, credentialsResult, {
            load: "Couldn't load issued credentials.",
            refresh: "Couldn't refresh issued credentials.",
          }),
        );

        const succeeded =
          pairingsResult.status === "fulfilled"
          && credentialsResult.status === "fulfilled";
        if (succeeded) {
          const refreshedAt = Date.now();
          setConfirmedSummary(
            summarizeLedger(pairingsResult.value, credentialsResult.value, refreshedAt),
          );
        }

        if (options.announceResult) {
          announce(
            succeeded
              ? "Client access refreshed."
              : "Couldn't refresh client access. Check the sections below.",
            succeeded ? "polite" : "assertive",
          );
        }
        return succeeded ? "succeeded" : "failed";
      } finally {
        if (requestId === loadRequestIdRef.current) {
          loadInFlightRef.current = false;
          if (loadControllerRef.current === controller) {
            loadControllerRef.current = null;
          }
          if (mountedRef.current) {
            setRefreshing(false);
          }
        }
      }
    })();

    latestLoadPromiseRef.current = loadPromise;
    return loadPromise;
  }, [announce]);

  const retryLedger = useCallback(() => {
    void loadLedger({ announceResult: true });
  }, [loadLedger]);

  useEffect(() => {
    mountedRef.current = true;
    void loadLedger();
    return () => {
      mountedRef.current = false;
      loadControllerRef.current?.abort();
      loadInFlightRef.current = false;
      latestLoadPromiseRef.current = null;
      for (const controller of mutationControllersRef.current.values()) {
        controller.abort();
      }
      mutationControllersRef.current.clear();
      busyActionsRef.current.clear();
    };
  }, [loadLedger]);

  const refreshLedgerInBackground = useCallback(() => {
    if (busyActionsRef.current.size > 0 || loadInFlightRef.current) return;
    void loadLedger();
  }, [loadLedger]);

  usePausablePoll(refreshLedgerInBackground, 30_000, {
    pauseWhileInputActive: true,
  });

  const confirmedSnapshotLabel = confirmedSummary
    ? relativeLabel(confirmedSummary.refreshedAt) ?? "earlier"
    : null;

  const ledgerStamp = useMemo(() => {
    if (!confirmedSummary) {
      if (pairings.alert || credentials.alert) {
        return "No confirmed client access snapshot yet. Check the sections below.";
      }
      return "Waiting for the first confirmed client access snapshot.";
    }
    if (refreshing) {
      return `Refreshing the access ledger. Last confirmed ${confirmedSnapshotLabel ?? "earlier"}.`;
    }
    if (pairings.alert || credentials.alert) {
      return `Showing the last confirmed snapshot from ${confirmedSnapshotLabel ?? "earlier"}. Check the sections below.`;
    }
    return `Updated ${confirmedSnapshotLabel ?? "just now"}.`;
  }, [confirmedSnapshotLabel, confirmedSummary, credentials.alert, pairings.alert, refreshing]);

  const handlePairingDecision = useCallback(async (
    item: PairingRequestRecord,
    decision: PairingDecision,
  ) => {
    const key = `pairing:${item.id}`;
    const controller = beginAction(key, decision);
    if (!controller) return;
    setPairings((current) => ({ ...current, alert: null }));
    try {
      const decided = await postPairingDecision(item.id, decision, controller.signal);
      if (controller.signal.aborted || !mountedRef.current) return;
      setPairings((current) => ({
        status: "ready",
        items: current.items.filter((entry) => entry.id !== decided.id),
        alert: null,
      }));
      const refreshOutcome = await awaitAuthoritativeRefresh(loadLedger());
      if (controller.signal.aborted || !mountedRef.current || refreshOutcome === "aborted") return;
      const refreshed = refreshOutcome === "succeeded";
      const verb = decision === "approved" ? "Approved" : "Denied";
      announce(
        refreshed
          ? `${verb} ${item.appName} pairing request.`
          : `${verb} ${item.appName} pairing request. Couldn't refresh the access ledger.`,
        refreshed ? "polite" : "assertive",
      );
    } catch (error) {
      if (controller.signal.aborted || !mountedRef.current) return;
      const verb = decision === "approved" ? "approve" : "deny";
      const message = error instanceof Error ? error.message : "Request failed.";
      const alert = {
        title: `Couldn't ${verb} pairing request.`,
        message,
      };
      setPairings((current) => ({
        ...current,
        status: current.status === "ready" ? "ready" : "error",
        alert,
      }));
      announce(`Couldn't ${verb} ${item.appName} pairing request: ${message}`, "assertive");
      if (isTerminalPairingDecisionError(error)) {
        const refreshOutcome = await awaitAuthoritativeRefresh(loadLedger({ pairingsAlert: alert }));
        if (controller.signal.aborted || !mountedRef.current || refreshOutcome === "aborted") return;
        setPairings((current) => ({
          ...current,
          status: current.status === "ready" ? "ready" : "error",
          alert,
        }));
      }
    } finally {
      finishAction(key);
    }
  }, [announce, awaitAuthoritativeRefresh, beginAction, finishAction, loadLedger]);

  const handleRevokeCredential = useCallback(async (item: CredentialRecord) => {
    const key = `credential:${item.id}`;
    const controller = beginAction(key, "revoke");
    if (!controller) return;
    setCredentials((current) => ({ ...current, alert: null }));
    try {
      const revoked = await revokeCredential(item.id, controller.signal);
      if (controller.signal.aborted || !mountedRef.current) return;
      setCredentials((current) => ({
        status: "ready",
        items: sortCredentials(
          current.items.map((entry) => (entry.id === revoked.id ? revoked : entry)),
        ),
        alert: null,
      }));
      const refreshOutcome = await awaitAuthoritativeRefresh(loadLedger());
      if (controller.signal.aborted || !mountedRef.current || refreshOutcome === "aborted") return;
      const refreshed = refreshOutcome === "succeeded";
      announce(
        refreshed
          ? `Revoked ${item.appName} credential.`
          : `Revoked ${item.appName} credential. Couldn't refresh the access ledger.`,
        refreshed ? "polite" : "assertive",
      );
    } catch (error) {
      if (controller.signal.aborted || !mountedRef.current) return;
      const message = error instanceof Error ? error.message : "Request failed.";
      setCredentials((current) => ({
        ...current,
        status: current.status === "ready" ? "ready" : "error",
        alert: {
          title: "Couldn't revoke credential.",
          message,
        },
      }));
      announce(`Couldn't revoke ${item.appName} credential: ${message}`, "assertive");
    } finally {
      finishAction(key);
    }
  }, [announce, awaitAuthoritativeRefresh, beginAction, finishAction, loadLedger]);

  return (
    <div className="settings-client-access">
      <section className="max-w-none space-y-6" aria-labelledby="settings-client-access-title">
        <h2 id="settings-client-access-title" className="sr-only">Client access</h2>
        <SettingsOverview section="client-access" />

        <div className="settings-client-access__panel">
          <section className="settings-client-access__toolbar" aria-label="Client access operator summary">
            <div className="settings-client-access__toolbar-copy">
              <p className="settings-client-access__eyebrow">Operator ledger</p>
              <p className="settings-client-access__summary">
                Metadata only — pairing secrets and bearer tokens never render in
                Settings.
                {confirmedSummary ? null : " Counts appear after the first confirmed snapshot."}
              </p>
              {confirmedSummary ? (
                <ul className="settings-client-access__totals" aria-label="Client access counts">
                  <li>
                    <StatusChip
                      compact
                      label={formatPendingCount(confirmedSummary.pendingCount)}
                      tone="pending"
                    />
                  </li>
                  <li>
                    <StatusChip
                      compact
                      label={formatCount(confirmedSummary.activeCredentials, "active credential")}
                      tone="active"
                    />
                  </li>
                  <li>
                    <StatusChip
                      compact
                      label={formatCount(confirmedSummary.revokedCredentials, "revoked credential")}
                      tone="revoked"
                    />
                  </li>
                </ul>
              ) : null}
            </div>
            <div className="settings-client-access__toolbar-actions">
              <p className="settings-client-access__stamp">{ledgerStamp}</p>
              <Button
                variant="secondary"
                size="xs"
                leadingIcon="ph:arrows-clockwise"
                aria-label="Refresh client access"
                loading={refreshing}
                disabled={refreshing || busyActionsRef.current.size > 0}
                onClick={retryLedger}
              >
                {refreshing ? "Refreshing…" : "Refresh"}
              </Button>
            </div>
          </section>

          <SettingsGroup
            label="Pending approvals"
            description="Approve or deny new clients after checking their installation identity and requested scopes."
            variant="ruled"
            meta={pairings.status === "loading" ? "Loading…" : formatPendingCount(pairings.items.length)}
            panel
          >
            {pairings.status === "loading" ? (
              <div className="settings-client-access__state">
                <SkeletonRows count={2} />
              </div>
            ) : pairings.status === "error" ? (
              <div className="settings-client-access__state">
                <ErrorState
                  live={false}
                  headline={pairings.alert?.title ?? "Couldn't load pending approvals."}
                  subtitle={pairings.alert?.message}
                  actions={(
                    <Button
                      size="xs"
                      variant="secondary"
                      aria-label="Retry pending approvals"
                      onClick={retryLedger}
                    >
                      Retry
                    </Button>
                  )}
                />
              </div>
            ) : pairings.items.length === 0 ? (
              <EmptyStateWithRefreshAlert
                alert={pairings.alert}
                retryLabel="Retry pending approvals"
                onRetry={retryLedger}
              >
                <EmptyState
                  live={false}
                  icon="ph:key"
                  headline="No pairing requests waiting"
                  subtitle="New client pairings appear here until you approve or deny them."
                />
              </EmptyStateWithRefreshAlert>
            ) : (
              <div className="settings-client-access__list">
                {pairings.alert ? (
                  <RefreshAlert
                    alert={pairings.alert}
                    retryLabel="Retry pending approvals"
                    onRetry={retryLedger}
                  />
                ) : null}
                {pairings.items.map((item) => (
                  <PairingRequestItem
                    key={item.id}
                    item={item}
                    busyAction={busyActions[`pairing:${item.id}`]}
                    onApprove={() => {
                      void handlePairingDecision(item, "approved");
                    }}
                    onDeny={() => {
                      void handlePairingDecision(item, "denied");
                    }}
                  />
                ))}
              </div>
            )}
          </SettingsGroup>

          <SettingsGroup
            label="Issued credentials"
            description="Active credentials remain valid until you revoke them. Revoked records stay listed for audit."
            variant="ruled"
            meta={credentials.status === "loading" ? "Loading…" : formatCount(credentials.items.length, "record")}
            panel
          >
            {credentials.status === "loading" ? (
              <div className="settings-client-access__state">
                <SkeletonRows count={3} />
              </div>
            ) : credentials.status === "error" ? (
              <div className="settings-client-access__state">
                <ErrorState
                  live={false}
                  headline={credentials.alert?.title ?? "Couldn't load issued credentials."}
                  subtitle={credentials.alert?.message}
                  actions={(
                    <Button
                      size="xs"
                      variant="secondary"
                      aria-label="Retry issued credentials"
                      onClick={retryLedger}
                    >
                      Retry
                    </Button>
                  )}
                />
              </div>
            ) : credentials.items.length === 0 ? (
              <EmptyStateWithRefreshAlert
                alert={credentials.alert}
                retryLabel="Retry issued credentials"
                onRetry={retryLedger}
              >
                <EmptyState
                  live={false}
                  icon="ph:plug"
                  headline="No client credentials issued"
                  subtitle="Approved clients will appear here after they exchange a pairing approval."
                />
              </EmptyStateWithRefreshAlert>
            ) : (
              <div className="settings-client-access__list">
                {credentials.alert ? (
                  <RefreshAlert
                    alert={credentials.alert}
                    retryLabel="Retry issued credentials"
                    onRetry={retryLedger}
                  />
                ) : null}
                {credentials.items.map((item) => (
                  <CredentialItem
                    key={item.id}
                    item={item}
                    busyAction={busyActions[`credential:${item.id}`]}
                    onRevoke={() => {
                      void handleRevokeCredential(item);
                    }}
                  />
                ))}
              </div>
            )}
          </SettingsGroup>
        </div>
      </section>
    </div>
  );
}
