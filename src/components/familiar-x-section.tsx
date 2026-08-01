"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { XScope } from "@/lib/x-api";
import { useTauriPlatform } from "@/lib/tauri-platform";
import {
  cancelSystemBrowserOpen,
  openSystemBrowser,
  reserveSystemBrowserWindow,
  type SystemBrowserReservation,
} from "@/lib/open-system-browser";
import { useArmedConfirm } from "@/lib/use-armed-confirm";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { useAnnouncer } from "@/components/ui/live-region";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import "@/styles/familiar-x-section.css";

const X_SCOPES = new Set<XScope>([
  "tweet.read",
  "users.read",
  "offline.access",
  "tweet.write",
]);
const OAUTH_POLL_LIMIT_MS = 10 * 60 * 1000;
const OAUTH_POLL_INTERVAL_MS = 1000;
const FLOW_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAX_OAUTH_CANCELLATION_BODY_BYTES = 64;

type XCapability = "research" | "publish";
type XGrant = "xResearchEnabled" | "xPublishEnabled";
type XAccount = { id: string; username: string; name: string };
type XConnectionState = {
  configured: boolean;
  activeFlow: boolean;
  oauthFlowId?: string;
  oauthOutcome?: "pending" | "succeeded" | "failed";
};
type XConnection =
  | (XConnectionState & {
    connected: false;
  })
  | (XConnectionState & {
    connected: true;
    account: XAccount;
    scopes: XScope[];
  });
type OAuthAttempt = {
  capability: XCapability;
  grant: XGrant | null;
  familiarId: string;
  flowId: string;
  deadline: number;
};
type PendingOAuthStart = {
  controller: AbortController;
  reservation: SystemBrowserReservation;
  familiarId: string;
  flowId: string;
  generation: number;
};
type ActiveOAuthReservation = {
  reservation: SystemBrowserReservation;
  familiarId: string;
  flowId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizedAccount(value: unknown): XAccount | null {
  if (!isRecord(value)) return null;
  if (!Object.keys(value).every((key) => ["id", "username", "name"].includes(key))) {
    return null;
  }
  if (
    typeof value.id !== "string"
    || typeof value.username !== "string"
    || !/^[A-Za-z0-9_]{1,15}$/.test(value.username)
    || typeof value.name !== "string"
    || !value.name.trim()
  ) {
    return null;
  }
  return { id: value.id, username: value.username, name: value.name };
}

function sanitizedScopes(value: unknown): XScope[] | null {
  if (!Array.isArray(value)) return null;
  const scopes: XScope[] = [];
  const seen = new Set<XScope>();
  for (const scope of value) {
    if (typeof scope !== "string" || !X_SCOPES.has(scope as XScope)) return null;
    const typedScope = scope as XScope;
    if (!seen.has(typedScope)) {
      seen.add(typedScope);
      scopes.push(typedScope);
    }
  }
  return scopes;
}

export function sanitizeXConnection(value: unknown): XConnection | null {
  if (!isRecord(value)) return null;
  if (
    !Object.keys(value).every((key) =>
      [
        "configured",
        "connected",
        "activeFlow",
        "account",
        "scopes",
        "expiry",
        "oauthFlowId",
        "oauthOutcome",
      ].includes(key))
    || typeof value.configured !== "boolean"
    || typeof value.connected !== "boolean"
    || typeof value.activeFlow !== "boolean"
  ) {
    return null;
  }
  const hasFlowId = typeof value.oauthFlowId === "string"
    && FLOW_ID_PATTERN.test(value.oauthFlowId);
  const hasOutcome = value.oauthOutcome === "pending"
    || value.oauthOutcome === "succeeded"
    || value.oauthOutcome === "failed";
  if (
    (value.oauthFlowId !== undefined || value.oauthOutcome !== undefined)
    && (!hasFlowId || !hasOutcome)
  ) {
    return null;
  }
  const oauth: Pick<XConnectionState, "oauthFlowId" | "oauthOutcome"> =
    hasFlowId && hasOutcome
      ? {
        oauthFlowId: value.oauthFlowId as string,
        oauthOutcome: value.oauthOutcome as NonNullable<XConnectionState["oauthOutcome"]>,
      }
      : {};
  if (!value.connected) {
    return {
      configured: value.configured,
      connected: false,
      activeFlow: value.activeFlow,
      ...oauth,
    };
  }
  const account = sanitizedAccount(value.account);
  const scopes = sanitizedScopes(value.scopes);
  if (!account || !scopes) return null;
  return {
    configured: value.configured,
    connected: true,
    activeFlow: value.activeFlow,
    account,
    scopes,
    ...oauth,
  };
}

async function fetchConnection(signal?: AbortSignal): Promise<XConnection> {
  const response = await fetch("/api/x/connection", {
    cache: "no-store",
    signal,
  });
  const connection = sanitizeXConnection(await response.json().catch(() => null));
  if (!response.ok || !connection) {
    throw new Error("Couldn't load the X connection.");
  }
  return connection;
}

function createOAuthFlowId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function cancelXOAuthFlow(
  flowId: string,
  options: { keepalive?: boolean } = {},
): Promise<boolean> {
  if (!FLOW_ID_PATTERN.test(flowId)) return false;
  const body = JSON.stringify({ flowId });
  if (body.length > MAX_OAUTH_CANCELLATION_BODY_BYTES) return false;
  const request: RequestInit = {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body,
    ...(options.keepalive ? { keepalive: true } : {}),
  };
  try {
    const response = await fetch("/api/x/oauth/start", request);
    return response.ok;
  } catch {
    if (!options.keepalive) return false;
    try {
      const response = await fetch("/api/x/oauth/start", {
        method: request.method,
        headers: request.headers,
        body,
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

function requiredScope(capability: XCapability): XScope {
  return capability === "publish" ? "tweet.write" : "tweet.read";
}

function grantLabel(grant: XGrant): string {
  return grant === "xResearchEnabled" ? "X research" : "X publishing";
}

export function FamiliarXSection({ familiar }: { familiar: ResolvedFamiliar }) {
  const platform = useTauriPlatform();
  const { announce } = useAnnouncer();
  const disconnectConfirm = useArmedConfirm();
  const [connection, setConnection] = useState<XConnection | null>(null);
  const [researchEnabled, setResearchEnabled] = useState(
    familiar.xResearchEnabled === true,
  );
  const researchEnabledRef = useRef(researchEnabled);
  const [publishEnabled, setPublishEnabled] = useState(
    familiar.xPublishEnabled === true,
  );
  const publishEnabledRef = useRef(publishEnabled);
  const [loading, setLoading] = useState(true);
  const [savingGrant, setSavingGrant] = useState<XGrant | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [cancellingActiveFlow, setCancellingActiveFlow] = useState(false);
  const [startingOAuth, setStartingOAuth] = useState(false);
  const [oauthAttempt, setOauthAttempt] = useState<OAuthAttempt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const pendingOAuthRef = useRef<PendingOAuthStart | null>(null);
  const activeOAuthReservationRef = useRef<ActiveOAuthReservation | null>(null);
  const familiarIdRef = useRef(familiar.id);
  const familiarGenerationRef = useRef(0);
  if (familiarIdRef.current !== familiar.id) {
    familiarIdRef.current = familiar.id;
    familiarGenerationRef.current += 1;
  }

  const settleOAuthReservation = useCallback((
    flowId: string,
    close: boolean,
  ) => {
    const active = activeOAuthReservationRef.current;
    if (!active || active.flowId !== flowId) return false;
    activeOAuthReservationRef.current = null;
    if (close) cancelSystemBrowserOpen(active.reservation);
    return true;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const pending = pendingOAuthRef.current;
      pendingOAuthRef.current = null;
      if (pending) {
        pending.controller.abort();
        cancelSystemBrowserOpen(pending.reservation);
        void cancelXOAuthFlow(pending.flowId, { keepalive: true });
      }
      const active = activeOAuthReservationRef.current;
      if (active && settleOAuthReservation(active.flowId, true)) {
        void cancelXOAuthFlow(active.flowId, { keepalive: true });
      }
    };
  }, [settleOAuthReservation]);

  useEffect(() => {
    const pending = pendingOAuthRef.current;
    if (pending && pending.familiarId !== familiar.id) {
      pendingOAuthRef.current = null;
      pending.controller.abort();
      cancelSystemBrowserOpen(pending.reservation);
      void cancelXOAuthFlow(pending.flowId);
    }
    const active = activeOAuthReservationRef.current;
    if (
      active
      && active.familiarId !== familiar.id
      && settleOAuthReservation(active.flowId, true)
    ) {
      void cancelXOAuthFlow(active.flowId);
    }
    const nextResearch = familiar.xResearchEnabled === true;
    const nextPublish = familiar.xPublishEnabled === true;
    researchEnabledRef.current = nextResearch;
    publishEnabledRef.current = nextPublish;
    setResearchEnabled(nextResearch);
    setPublishEnabled(nextPublish);
    setSavingGrant(null);
    setCancellingActiveFlow(false);
    setStartingOAuth(false);
    setOauthAttempt(null);
    setError(null);
  }, [
    familiar.id,
    familiar.xPublishEnabled,
    familiar.xResearchEnabled,
    settleOAuthReservation,
  ]);

  const reloadConnection = useCallback(async (signal?: AbortSignal) => {
    const next = await fetchConnection(signal);
    setConnection(next);
    return next;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void reloadConnection(controller.signal)
      .then(() => setError(null))
      .catch((loadError) => {
        if (!controller.signal.aborted) setError((loadError as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reloadConnection]);

  const saveGrant = useCallback(async (grant: XGrant, enabled: boolean) => {
    const familiarId = familiar.id;
    const generation = familiarGenerationRef.current;
    const isCurrent = () =>
      mountedRef.current
      && familiarIdRef.current === familiarId
      && familiarGenerationRef.current === generation;
    const previous = grant === "xResearchEnabled"
      ? researchEnabledRef.current
      : publishEnabledRef.current;
    if (grant === "xResearchEnabled") {
      researchEnabledRef.current = enabled;
      setResearchEnabled(enabled);
    } else {
      publishEnabledRef.current = enabled;
      setPublishEnabled(enabled);
    }
    setSavingGrant(grant);
    setError(null);
    try {
      const response = await fetch("/api/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          familiars: {
            [familiar.id]: { [grant]: enabled ? true : null },
          },
        }),
      });
      const result = await response.json().catch(() => null) as unknown;
      if (!response.ok || !isRecord(result) || result.ok !== true) {
        throw new Error(`Couldn't save ${grantLabel(grant).toLowerCase()}.`);
      }
      if (!isCurrent()) return false;
      window.dispatchEvent(new Event("cave:familiars-refresh"));
      announce(
        enabled
          ? `${grantLabel(grant)} allowed for ${familiar.display_name}.`
          : `${grantLabel(grant)} disabled for ${familiar.display_name}.`,
      );
      return true;
    } catch (saveError) {
      if (!isCurrent()) return false;
      if (grant === "xResearchEnabled") {
        researchEnabledRef.current = previous;
        setResearchEnabled(previous);
      } else {
        publishEnabledRef.current = previous;
        setPublishEnabled(previous);
      }
      const message = (saveError as Error).message;
      setError(message);
      announce(message, "assertive");
      return false;
    } finally {
      if (isCurrent()) setSavingGrant(null);
    }
  }, [
    announce,
    familiar.display_name,
    familiar.id,
  ]);

  const startOAuth = useCallback(async (
    capability: XCapability,
    grant: XGrant | null,
  ) => {
    if (pendingOAuthRef.current) return;
    const reservation = reserveSystemBrowserWindow({
      platform,
      hostname: window.location.hostname,
    });
    if (!reservation.ok) {
      setError(reservation.error);
      announce(reservation.error, "assertive");
      return;
    }

    const flowId = createOAuthFlowId();
    const pending: PendingOAuthStart = {
      controller: new AbortController(),
      reservation,
      familiarId: familiar.id,
      flowId,
      generation: familiarGenerationRef.current,
    };
    pendingOAuthRef.current = pending;
    const ownsPending = () =>
      mountedRef.current
      && pending.familiarId === familiarIdRef.current
      && pending.generation === familiarGenerationRef.current
      && pendingOAuthRef.current === pending;
    const cancelPending = async () => {
      pending.controller.abort();
      cancelSystemBrowserOpen(reservation);
      await cancelXOAuthFlow(pending.flowId);
    };
    let handedOffToPolling = false;
    setStartingOAuth(true);
    setError(null);
    try {
      const response = await fetch("/api/x/oauth/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ capability, flowId }),
        signal: pending.controller.signal,
      });
      const result = await response.json().catch(() => null) as unknown;
      if (
        !response.ok
        || !isRecord(result)
        || result.ok !== true
        || typeof result.authorizationUrl !== "string"
        || result.flowId !== pending.flowId
      ) {
        cancelSystemBrowserOpen(reservation);
        throw new Error(
          isRecord(result) && typeof result.error === "string"
            ? result.error
            : "Couldn't start X authorization.",
        );
      }
      if (!ownsPending()) {
        await cancelPending();
        return;
      }
      const authorizationUrl = result.authorizationUrl;
      const opened = await openSystemBrowser(authorizationUrl, reservation);
      if (!ownsPending()) {
        await cancelPending();
        return;
      }
      if (!opened.ok) throw new Error(opened.error);
      activeOAuthReservationRef.current = {
        reservation,
        familiarId: pending.familiarId,
        flowId: pending.flowId,
      };
      pendingOAuthRef.current = null;
      handedOffToPolling = true;
      setOauthAttempt({
        capability,
        grant,
        familiarId: pending.familiarId,
        flowId: pending.flowId,
        deadline: Date.now() + OAUTH_POLL_LIMIT_MS,
      });
      announce("X authorization opened in the system browser.");
    } catch (startError) {
      await cancelPending();
      if (!ownsPending()) return;
      const message = (startError as Error).message;
      setError(message);
      announce(message, "assertive");
    } finally {
      if (!handedOffToPolling && pendingOAuthRef.current === pending) {
        pendingOAuthRef.current = null;
      }
      if (
        mountedRef.current
        && pending.familiarId === familiarIdRef.current
        && pending.generation === familiarGenerationRef.current
      ) setStartingOAuth(false);
    }
  }, [announce, familiar.id, platform]);

  useEffect(() => {
    if (!oauthAttempt) return;
    if (oauthAttempt.familiarId !== familiar.id) {
      setOauthAttempt(null);
      if (settleOAuthReservation(oauthAttempt.flowId, true)) {
        void cancelXOAuthFlow(oauthAttempt.flowId);
      }
      return;
    }
    const controller = new AbortController();
    let checking = false;
    let settled = false;

    const stopWithError = (message: string, cancelFlow = true) => {
      if (settled) return;
      settled = true;
      setOauthAttempt(null);
      setError(message);
      announce(message, "assertive");
      controller.abort();
      settleOAuthReservation(oauthAttempt.flowId, true);
      if (cancelFlow) void cancelXOAuthFlow(oauthAttempt.flowId);
    };

    const poll = async () => {
      if (checking || settled) return;
      if (Date.now() >= oauthAttempt.deadline) {
        stopWithError("X authorization timed out. Try again.");
        return;
      }
      checking = true;
      try {
        const next = await reloadConnection(controller.signal);
        if (settled) return;
        if (
          next.oauthFlowId === oauthAttempt.flowId
          && next.oauthOutcome === "succeeded"
        ) {
          if (
            next.connected
            && next.scopes.includes(requiredScope(oauthAttempt.capability))
          ) {
            if (oauthAttempt.grant) {
              const saved = await saveGrant(oauthAttempt.grant, true);
              if (
                settled
                || oauthAttempt.familiarId !== familiarIdRef.current
              ) return;
              if (!saved) {
                settled = true;
                settleOAuthReservation(oauthAttempt.flowId, true);
                setOauthAttempt(null);
                controller.abort();
                return;
              }
              if (settled) return;
            }
            settled = true;
            settleOAuthReservation(oauthAttempt.flowId, false);
            setOauthAttempt(null);
            setError(null);
            announce("X connection updated.");
            controller.abort();
          } else {
            stopWithError(
              "X authorization didn't grant the requested permission. Try again.",
              false,
            );
          }
        } else if (
          next.oauthFlowId === oauthAttempt.flowId
          && next.oauthOutcome === "failed"
        ) {
          stopWithError("X authorization failed. Try again.", false);
        } else if (!next.activeFlow) {
          stopWithError(
            "X authorization didn't grant the requested permission. Try again.",
            false,
          );
        }
      } catch {
        if (!controller.signal.aborted) {
          stopWithError("Couldn't verify X authorization. Try again.");
        }
      } finally {
        checking = false;
      }
    };

    void poll();
    const interval = window.setInterval(() => void poll(), OAUTH_POLL_INTERVAL_MS);
    const timeout = window.setTimeout(
      () => stopWithError("X authorization timed out. Try again."),
      Math.max(0, oauthAttempt.deadline - Date.now()),
    );
    return () => {
      if (
        !settled
        && settleOAuthReservation(oauthAttempt.flowId, true)
      ) {
        void cancelXOAuthFlow(oauthAttempt.flowId, { keepalive: true });
      }
      settled = true;
      controller.abort();
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [
    announce,
    familiar.id,
    oauthAttempt,
    reloadConnection,
    saveGrant,
    settleOAuthReservation,
  ]);

  async function toggleResearch() {
    if (researchEnabled) {
      await saveGrant("xResearchEnabled", false);
      return;
    }
    if (!connection?.connected || !connection.scopes.includes("tweet.read")) {
      await startOAuth("research", "xResearchEnabled");
      return;
    }
    await saveGrant("xResearchEnabled", true);
  }

  async function togglePublishing() {
    if (publishEnabled) {
      await saveGrant("xPublishEnabled", false);
      return;
    }
    if (!connection?.connected || !connection.scopes.includes("tweet.write")) {
      await startOAuth("publish", "xPublishEnabled");
      return;
    }
    await saveGrant("xPublishEnabled", true);
  }

  async function disconnect() {
    if (disconnecting) return;
    setDisconnecting(true);
    setError(null);
    try {
      const response = await fetch("/api/x/connection", { method: "DELETE" });
      if (!response.ok) throw new Error("Couldn't disconnect X.");
      setOauthAttempt(null);
      setConnection({ configured: true, connected: false, activeFlow: false });
      announce("X disconnected.");
    } catch (disconnectError) {
      const message = (disconnectError as Error).message;
      setError(message);
      announce(message, "assertive");
    } finally {
      setDisconnecting(false);
    }
  }

  async function cancelInheritedFlow() {
    if (
      cancellingActiveFlow
      || !connection
      || connection.connected
      || !connection.activeFlow
      || !connection.oauthFlowId
    ) return;
    const familiarId = familiar.id;
    const generation = familiarGenerationRef.current;
    const isCurrent = () =>
      mountedRef.current
      && familiarIdRef.current === familiarId
      && familiarGenerationRef.current === generation;
    setCancellingActiveFlow(true);
    setError(null);
    try {
      const cancelled = await cancelXOAuthFlow(connection.oauthFlowId);
      if (!cancelled) {
        throw new Error("Couldn't cancel the X connection attempt.");
      }
      await reloadConnection();
      if (!isCurrent()) return;
      announce("X connection attempt cancelled.");
    } catch (cancelError) {
      if (!isCurrent()) return;
      const message = (cancelError as Error).message;
      setError(message);
      announce(message, "assertive");
    } finally {
      if (isCurrent()) setCancellingActiveFlow(false);
    }
  }

  const busy = savingGrant !== null
    || startingOAuth
    || oauthAttempt !== null
    || cancellingActiveFlow;

  return (
    <section
      className="familiar-studio-brain__card familiar-x-section"
      data-x-section
    >
      <div className="familiar-x-section__heading">
        <h3 className="familiar-studio-brain__card-title">X</h3>
        {oauthAttempt ? (
          <span className="ui-pill" role="status">Waiting for authorization…</span>
        ) : null}
      </div>

      {loading ? (
        <SkeletonGroup className="familiar-x-section__loading">
          <Skeleton variant="text" width="42%" />
          <Skeleton variant="row" />
          <Skeleton variant="row" />
        </SkeletonGroup>
      ) : null}

      {!loading && connection && !connection.configured ? (
        <ErrorState
          compact
          headline="X isn't configured"
          subtitle="Install a Cave build with the OpenCoven X app configured, then try again."
        />
      ) : null}

      {!loading && connection?.configured && !connection.connected ? (
        <div className="familiar-x-section__empty">
          {connection.activeFlow ? (
            <>
              <p className="familiar-studio-brain__hint" role="status">
                An X connection attempt is still active. Cancel it before reconnecting.
              </p>
              {connection.oauthFlowId ? (
                <Button
                  size="sm"
                  variant="secondary"
                  className="focus-ring"
                  aria-label="Cancel connection attempt"
                  loading={cancellingActiveFlow}
                  onClick={() => void cancelInheritedFlow()}
                >
                  Cancel connection attempt
                </Button>
              ) : null}
            </>
          ) : (
            <>
              <p className="familiar-studio-brain__hint">
                Connect one X account before granting this familiar research or publishing access.
              </p>
              <Button
                size="sm"
                variant="secondary"
                className="focus-ring"
                loading={startingOAuth}
                disabled={platform === "unknown"}
                onClick={() => void startOAuth("research", null)}
              >
                Connect X
              </Button>
            </>
          )}
        </div>
      ) : null}

      {!loading && connection?.connected ? (
        <>
          <div className="familiar-x-section__account">
            <div>
              <span className="familiar-studio-brain__label">Connection</span>
              <p className="familiar-x-section__account-name">
                {connection.account.name} · @{connection.account.username}
              </p>
            </div>
            <div className="familiar-x-section__actions">
              <Button
                size="xs"
                variant="ghost"
                className="focus-ring"
                disabled={busy}
                onClick={() => void startOAuth(
                  connection.scopes.includes("tweet.write") ? "publish" : "research",
                  null,
                )}
              >
                Reconnect
              </Button>
              <Button
                size="xs"
                variant="danger-ghost"
                className="focus-ring"
                loading={disconnecting}
                disabled={busy}
                onClick={() => disconnectConfirm.trigger(() => void disconnect())}
              >
                {disconnectConfirm.armed ? "Really disconnect X?" : "Disconnect"}
              </Button>
            </div>
          </div>

          <div className="familiar-x-section__scopes" aria-label="Granted X scopes">
            {connection.scopes.map((scope) => (
              <span className="ui-pill" key={scope}>{scope}</span>
            ))}
          </div>

          <div className="familiar-x-section__grants">
            <div className="familiar-studio-brain__row">
              <span className="familiar-studio-brain__label">Allow X research</span>
              <div className="familiar-studio-brain__control">
                <button
                  type="button"
                  role="switch"
                  aria-checked={researchEnabled}
                  aria-label={`Allow X research for ${familiar.display_name}`}
                  disabled={busy}
                  onClick={() => void toggleResearch()}
                  className={`settings-switch focus-ring${researchEnabled ? " is-on" : ""}`}
                >
                  <span className="settings-switch__knob" aria-hidden />
                </button>
              </div>
            </div>

            <div className="familiar-studio-brain__row">
              <span className="familiar-studio-brain__label">Allow X publishing</span>
              <div className="familiar-studio-brain__control">
                <button
                  type="button"
                  role="switch"
                  aria-checked={publishEnabled}
                  aria-label={`Allow X publishing for ${familiar.display_name}`}
                  disabled={busy}
                  onClick={() => void togglePublishing()}
                  className={`settings-switch focus-ring${publishEnabled ? " is-on" : ""}`}
                >
                  <span className="settings-switch__knob" aria-hidden />
                </button>
              </div>
            </div>
          </div>

          <p className="familiar-studio-brain__hint">
            Grants authorize only Cave's X research and publishing APIs. Credentials
            never enter the familiar runtime.
          </p>
        </>
      ) : null}

      {error ? (
        <ErrorState
          compact
          headline="Couldn't update X"
          subtitle={error}
          actions={
            !loading ? (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  setError(null);
                  void reloadConnection().catch((reloadError) =>
                    setError((reloadError as Error).message));
                }}
              >
                Retry
              </Button>
            ) : undefined
          }
        />
      ) : null}
    </section>
  );
}
