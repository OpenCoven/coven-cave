"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { useAnnouncer } from "@/components/ui/live-region";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import type { DeviceAccessSnapshot } from "@/lib/server/device-access/contract";
import "@/styles/device-access.css";

type Snapshot = DeviceAccessSnapshot & {
  network: { host: string; tailnet: string } | null;
  networkError: string | null;
};

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

function time(value: number | null): string {
  return value === null ? "Never" : new Date(value).toLocaleString();
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

  return (
    <section className="device-access" aria-labelledby="device-access-title">
      <h3 id="device-access-title">Device access</h3>
      <p>
        Allow requests from selected Tailscale networks, then allow or deny each device here.
        Approved devices reconnect without another invite until you revoke them.
      </p>
      {error ? <ErrorState compact headline="Device access unavailable" subtitle={error} /> : null}
      {data ? <>
        <p>
          {data.enabled ? "Desktop-managed access is on." : "Existing invite pairing is still in use."}
          {" "}This grants remote Cave access, not desktop administration or terminal access.
        </p>
        {data.network ? <p>Desktop: <code>{data.network.host}</code> · Tailnet: <code>{data.network.tailnet}</code></p> : null}
        {data.networkError ? <p role="status">{data.networkError}</p> : null}
        {data.enabled ? <p>Use the current pairing code above to request access. Keep mobile mode on so the desktop remains reachable.</p> : null}
        <div className="device-access__actions">
          <Button size="xs" variant="secondary" disabled={busy} onClick={() => {
            setTailnets(data.allowedTailnets.join("\n") || data.network?.tailnet || "");
            setEditing(true);
          }}>{data.enabled ? "Edit allowed tailnets" : "Set up device approval"}</Button>
          <Button size="xs" variant="ghost" disabled={busy} onClick={() => { void refresh(); }}>Refresh</Button>
        </div>
        {editing ? <form className="device-access__form" onSubmit={(event) => {
          event.preventDefault();
          void mutate("/tailnets", { tailnets: tailnets.split(/\s+/).filter(Boolean) }, "PUT");
        }}>
          <label htmlFor="allowed-device-tailnets">Allowed tailnets</label>
          <textarea id="allowed-device-tailnets" className="focus-ring" rows={3} value={tailnets}
            onChange={(event) => setTailnets(event.target.value)} placeholder="example.ts.net" />
          <p>Enter exact tailnet DNS suffixes, one per line. No wildcards. Removing a tailnet revokes its devices; adding it again does not restore their access.</p>
          {!data.enabled ? <label className="device-access__consent">
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="focus-ring" />
            Replace existing remote invite access. Every remote device must request approval again.
          </label> : null}
          <div className="device-access__actions">
            <Button size="xs" type="submit" disabled={busy || (!data.enabled && !consent)}>Save tailnets</Button>
            <Button size="xs" variant="ghost" type="button" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </form> : null}
        <h4>Requests and devices</h4>
        <p>Before allowing a request, compare its request code with the code shown on that device. Device names are labels, not proof of identity.</p>
        {data.devices.length === 0 ? <p>No devices have requested access.</p> : (
          <ul className="device-access__list">{data.devices.map((device) => <li key={device.id}>
            <div><strong>{device.label}</strong> · {device.status}</div>
            <div>{device.peer.loginName} · {device.peer.deviceName}</div>
            <div>Tailnet <code>{device.peer.tailnet}</code> · Device <code>{device.peer.nodeId}</code></div>
            <div>Request code <code>{device.id.slice(-8)}</code></div>
            <small>Requested {time(device.createdAt)} · Decided {time(device.decidedAt)} · Last access {time(device.lastSeenAt)}</small>
            <div className="device-access__actions">
              {device.status === "pending" ? <>
                <Button size="xs" disabled={busy} onClick={() => void mutate("/decision", { id: device.id, decision: "allowed" })}>Allow</Button>
                <Button size="xs" variant="secondary" disabled={busy} onClick={() => void mutate("/decision", { id: device.id, decision: "denied" })}>Deny</Button>
              </> : null}
              {device.status === "allowed" ? <Button size="xs" variant="danger" disabled={busy}
                onClick={() => void mutate("/decision", { id: device.id, decision: "revoked" })}>Revoke access</Button> : null}
            </div>
          </li>)}</ul>
        )}
        <details>
          <summary className="focus-ring">Access history</summary>
          <p>Recent events are shown below. Credentials are never included. Request IDs connect admission and completion records.</p>
          <ul className="device-access__list">{data.events.map((event) => <li key={event.id}>
            <div>{time(event.at)} · {event.event} · {event.actor}</div>
            {event.deviceId ? <code>{event.deviceId}</code> : null}
            {event.path ? <div>{event.method} {event.path} · {event.status === 0 ? "Admitted" : event.status}</div> : null}
            {event.requestId ? <div>Trace <code>{event.requestId}</code></div> : null}
          </li>)}</ul>
        </details>
      </> : !error ? <p role="status">Loading device access…</p> : null}
    </section>
  );
}
