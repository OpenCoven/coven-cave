"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessCode,
  AccessLedger,
  AccessMeta,
  AccessRow,
  AccessStatus,
  AccessTime,
  type AccessTone,
} from "@/components/access-ledger";
import { Button } from "@/components/ui/button";
import { useOptionalConfirm } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { IconButton } from "@/components/ui/icon-button";
import { useAnnouncer } from "@/components/ui/live-region";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Icon } from "@/lib/icon";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import type { DeviceAccessSnapshot } from "@/lib/server/device-access/contract";
import "@/styles/device-access.css";

type Snapshot = DeviceAccessSnapshot & {
  network: { host: string; tailnet: string } | null;
  networkError: string | null;
};
type Device = Snapshot["devices"][number];
type AccessEvent = Snapshot["events"][number];
type Decision = "allowed" | "denied" | "revoked";

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`/api/device-access/admin${path}`, {
    ...init, cache: "no-store", signal: AbortSignal.timeout(10_000),
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const message = data && typeof data === "object" && "message" in data && typeof data.message === "string"
      ? data.message : "Device access could not be updated.";
    throw new Error(message);
  }
  return data;
}

function snapshot(value: unknown): Snapshot {
  if (!value || typeof value !== "object" || !("enabled" in value)
    || typeof value.enabled !== "boolean" || !("allowedTailnets" in value)
    || !Array.isArray(value.allowedTailnets) || !("devices" in value)
    || !Array.isArray(value.devices) || !("events" in value) || !Array.isArray(value.events)) {
    throw new Error("The desktop returned an invalid device list.");
  }
  return value as Snapshot;
}

function deviceTone(status: string): AccessTone {
  switch (status) {
    case "pending":
      return "pending";
    case "allowed":
      return "good";
    case "denied":
    case "revoked":
      return "bad";
    default:
      return "muted";
  }
}

/**
 * One device in the ledger. The request code leads: it is the one thing to
 * compare with the phone before deciding, so it sits right under the name.
 * The status word is the raw record status, so a test or a reader finds
 * "revoked" beside "My phone" in one headline.
 */
function DeviceRow({
  device,
  busy,
  onDecide,
}: {
  device: Device;
  busy: boolean;
  onDecide: (device: Device, decision: Decision) => void;
}) {
  const pending = device.status === "pending";
  const tone = deviceTone(device.status);
  return (
    <AccessRow
      tone={tone}
      live={pending}
      settled={!pending}
      title={device.label}
      status={<AccessStatus tone={tone}>{device.status}</AccessStatus>}
      lead={<AccessCode label="Request code" code={device.id.slice(-8)} />}
      identity={(
        <>
          {device.peer.loginName} · {device.peer.deviceName} · tailnet <code>{device.peer.tailnet}</code>
          {" "}· node <code>{device.peer.nodeId}</code>
        </>
      )}
      meta={(
        <AccessMeta
          items={[
            <>Requested <AccessTime value={device.createdAt} fallback="at an unknown time" /></>,
            device.decidedAt !== null
              ? <>Decided <AccessTime value={device.decidedAt} fallback="at an unknown time" /></>
              : null,
            <>Last access <AccessTime value={device.lastSeenAt} fallback="never" /></>,
          ]}
        />
      )}
      revealActions={!pending && device.status === "allowed"}
      actions={pending ? (
        <>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => onDecide(device, "allowed")}>
            Allow
          </Button>
          <Button size="sm" variant="danger-ghost" disabled={busy} onClick={() => onDecide(device, "denied")}>
            Deny
          </Button>
        </>
      ) : device.status === "allowed" ? (
        <Button
          size="sm"
          variant="danger-ghost"
          disabled={busy}
          onClick={() => onDecide(device, "revoked")}
        >
          Revoke access
        </Button>
      ) : undefined}
    />
  );
}

function HistoryEvent({ event }: { event: AccessEvent }) {
  return (
    <li className="access-history__event">
      <span className="access-history__when">
        <AccessTime value={event.at} fallback="unknown time" />
      </span>
      <span className="access-history__what">
        <strong>{event.event}</strong> · {event.actor}
        {event.deviceId ? <> · device <code>{event.deviceId}</code></> : null}
      </span>
      {event.path ? (
        <span className="access-history__detail">
          {event.method} {event.path} · {event.status === 0 ? "Admitted" : event.status}
        </span>
      ) : null}
      {event.requestId ? (
        <span className="access-history__detail">Trace <code>{event.requestId}</code></span>
      ) : null}
    </li>
  );
}

export function SettingsDeviceAccess({ onPolicyChange }: { onPolicyChange?: () => void }) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [tailnets, setTailnets] = useState("");
  const [editing, setEditing] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const generation = useRef(0);
  const { announce } = useAnnouncer();
  const confirm = useOptionalConfirm();
  const refresh = useCallback(async () => {
    if (busyRef.current) return;
    const current = ++generation.current;
    try {
      const next = snapshot(await request(""));
      if (current !== generation.current) return;
      setData(next);
      setError(null);
    } catch (cause) {
      if (current !== generation.current) return;
      setError(cause instanceof Error ? cause.message : "Device access is unavailable.");
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  usePausablePoll(() => { void refresh(); }, 5_000, { enabled: !busy });

  async function mutate(path: string, payload: unknown, method = "POST") {
    setBusy(true);
    busyRef.current = true;
    generation.current++;
    setError(null);
    try {
      await request(path, { method, body: JSON.stringify(payload) });
      setData(snapshot(await request("")));
      announce("Device access updated.");
      setEditing(false);
      setConsent(false);
      if (path === "/tailnets") onPolicyChange?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Device access could not be updated.");
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  }

  // Revoking closes live connections, so it names the device and the
  // consequence first. Allow and Deny are reversible by another request.
  async function decide(device: Device, decision: Decision) {
    if (decision === "revoked" && confirm) {
      const confirmed = await confirm({
        title: `Revoke access for ${device.label}?`,
        body: (
          <>
            Active connections from {device.peer.deviceName} close now. The device has to
            request access again, and you approve it again here.
          </>
        ),
        confirmLabel: "Revoke access",
        danger: true,
      });
      if (!confirmed) return;
    }
    await mutate("/decision", { id: device.id, decision });
  }

  const enabled = data?.enabled === true;
  return (
    <section className="device-access device-access--ledger" aria-labelledby="device-access-title">
      <header className="device-access__head">
        <div className="device-access__heading">
          <h3 id="device-access-title">Device access</h3>
          {data ? <AccessStatus tone={enabled ? "good" : "muted"}>{enabled ? "on" : "off"}</AccessStatus> : null}
        </div>
        <p className="device-access__lede">
          Allow requests from selected Tailscale networks, then allow or deny each device here.
          Approved devices reconnect without another invite until you revoke them.
        </p>
        {data ? (
          <p className="device-access__state">
            {enabled ? "Desktop-managed access is on." : "Existing invite pairing is still in use."}
            {" "}This grants remote Cave access, not desktop administration or terminal access.
          </p>
        ) : null}
        {enabled ? (
          <p className="device-access__hint">
            Use the current pairing code above to request access. Keep mobile mode on so the
            desktop remains reachable.
          </p>
        ) : null}
        {data?.networkError ? <p role="status" className="device-access__hint">{data.networkError}</p> : null}
        {data ? (
          <div className="device-access__actions">
            <Button size="sm" variant={enabled ? "secondary" : "primary"} disabled={busy} onClick={() => {
              setTailnets(data.allowedTailnets.join("\n") || data.network?.tailnet || "");
              setEditing(true);
            }}>{enabled ? "Edit allowed tailnets" : "Set up device approval"}</Button>
            <IconButton
              icon="ph:arrows-clockwise"
              size="sm"
              aria-label="Refresh device access"
              title="Refresh"
              disabled={busy}
              onClick={() => { void refresh(); }}
            />
          </div>
        ) : null}
      </header>
      {error ? <ErrorState compact headline="Device access unavailable" subtitle={error} /> : null}
      {data?.network ? (
        <dl className="access-facts">
          <div>
            <dt>Desktop</dt>
            <dd><code>{data.network.host}</code></dd>
          </div>
          <div>
            <dt>Tailnet</dt>
            <dd><code>{data.network.tailnet}</code></dd>
          </div>
        </dl>
      ) : null}
      {data && editing ? <form className="device-access__form" onSubmit={(event) => {
        event.preventDefault();
        void mutate("/tailnets", { tailnets: tailnets.split(/\s+/).filter(Boolean) }, "PUT");
      }}>
        <label htmlFor="allowed-device-tailnets">Allowed tailnets</label>
        <textarea id="allowed-device-tailnets" className="focus-ring" rows={3} value={tailnets}
          onChange={(event) => setTailnets(event.target.value)} placeholder="example.ts.net" />
        <p className="device-access__hint">Enter exact tailnet DNS suffixes, one per line. No wildcards. Removing a tailnet revokes its devices; adding it again does not restore their access.</p>
        {!data.enabled ? <label className="device-access__consent">
          <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="focus-ring" />
          Replace existing remote invite access. Every remote device must request approval again.
        </label> : null}
        <div className="device-access__actions">
          <Button size="sm" type="submit" disabled={busy || (!data.enabled && !consent)}>Save tailnets</Button>
          <Button size="sm" variant="ghost" type="button" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
        </div>
      </form> : null}
      {data ? (
        <>
          <div className="device-access__section">
            <div className="device-access__rule">
              <h4>Requests and devices</h4>
              <span className="device-access__count">{data.devices.length}</span>
              <span className="device-access__rule-line" aria-hidden="true" />
            </div>
            <p className="device-access__hint">
              Before allowing a request, compare its request code with the code shown on that
              device. Device names are labels, not proof of identity.
            </p>
            {data.devices.length === 0 ? (
              <EmptyState
                compact
                icon="ph:device-mobile"
                headline="No devices have requested access."
                subtitle="A device on an allowed tailnet requests access from its own Cave; the request appears here with a code to compare."
              />
            ) : (
              <AccessLedger>
                {data.devices.map((device) => (
                  <DeviceRow key={device.id} device={device} busy={busy} onDecide={(target, decision) => { void decide(target, decision); }} />
                ))}
              </AccessLedger>
            )}
          </div>
          <details className="access-history">
            <summary className="focus-ring access-history__summary">
              <Icon name="ph:caret-down" width={12} height={12} className="access-history__caret" aria-hidden />
              Access history
              <span className="device-access__count">{data.events.length}</span>
            </summary>
            <p className="device-access__hint">Recent events are shown below. Credentials are never included. Request IDs connect admission and completion records.</p>
            {data.events.length === 0 ? (
              <p className="device-access__empty">No events recorded yet.</p>
            ) : (
              <ol className="access-history__list">
                {data.events.map((event) => <HistoryEvent key={event.id} event={event} />)}
              </ol>
            )}
          </details>
        </>
      ) : !error ? (
        <div className="device-access__loading" role="status" aria-busy="true">
          <p>Loading device access…</p>
          <SkeletonRows count={3} />
        </div>
      ) : null}
    </section>
  );
}
