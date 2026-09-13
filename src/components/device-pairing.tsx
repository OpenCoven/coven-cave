"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { useAnnouncer } from "@/components/ui/live-region";
import type { DeviceRecord } from "@/lib/server/device-access/contract";
import "@/styles/device-access.css";

function deviceFrom(value: unknown): DeviceRecord {
  if (!value || typeof value !== "object" || !("device" in value)
    || !value.device || typeof value.device !== "object"
    || !("id" in value.device) || typeof value.device.id !== "string"
    || !("status" in value.device) || typeof value.device.status !== "string") {
    throw new Error("The desktop returned an invalid pairing response.");
  }
  return value.device as DeviceRecord;
}

export function DevicePairing() {
  const [device, setDevice] = useState<DeviceRecord | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { announce } = useAnnouncer();
  const requestId = device?.id;

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const response = await fetch("/api/device-access/status", {
          cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        });
        if (!response.ok) {
          if (response.status === 403 && !requestId) return;
          throw new Error("Device access is unavailable or has been revoked.");
        }
        const current = deviceFrom(await response.json());
        setError(null);
        setDevice(current);
        if (current.status === "allowed") {
          announce("Device access allowed.");
          window.location.replace("/");
          return;
        }
        if (current.status === "pending") timer = setTimeout(() => { void poll(); }, 2_000);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not read pairing status.");
      }
    }
    void poll();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
    // Restart polling only when a new request is created, not for every poll.
  }, [requestId, announce]);

  async function requestAccess() {
    setBusy(true);
    setError(null);
    try {
      let installationId = localStorage.getItem("cave:device-installation");
      if (!installationId) {
        installationId = crypto.randomUUID();
        localStorage.setItem("cave:device-installation", installationId);
      }
      const response = await fetch("/api/device-access/requests", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ installationId, label: label.trim() || "Cave browser" }),
        signal: AbortSignal.timeout(10_000),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message = payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
          ? payload.message : "The desktop refused this request.";
        throw new Error(message);
      }
      setDevice(deviceFrom(payload));
      announce("Access requested. Allow this device on the desktop.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not request device access.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="device-access device-access--connect">
    <h1>Connect to Cave</h1>
    <p>Request access, then allow this device in the desktop app under Settings → Phone → Device access.</p>
    <label htmlFor="device-label">Device label</label>
    <input id="device-label" className="focus-ring" value={label} maxLength={200}
      onChange={(event) => setLabel(event.target.value)} placeholder="My device" />
    {device ? <div role="status">
      <p>Status: <strong>{device.status}</strong></p>
      <p>Compare this code on the desktop: <code>{device.id.slice(-8)}</code></p>
      {device.status === "pending" ? <p>Waiting for Allow or Deny on the desktop. This request expires after five minutes.</p> : null}
      {device.status === "denied" || device.status === "revoked" || device.status === "expired"
        ? <p>This request cannot grant access. A new request needs a new desktop approval.</p> : null}
    </div> : null}
    {error ? <ErrorState compact headline="Connection unavailable" subtitle={error} /> : null}
    {error ? <Button onClick={() => window.location.reload()}>Retry connection</Button> : null}
    <Button disabled={busy || device?.status === "pending"} onClick={() => void requestAccess()}>
      {busy ? "Requesting access…" : "Request access"}
    </Button>
    <p>Your approval is remembered on this device. Network outages do not revoke it; the desktop must still be awake and reachable.</p>
  </main>;
}
