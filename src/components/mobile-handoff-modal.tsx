"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

type HandoffReady = {
  ok: true;
  backendUrl: string;
  serveUrl: string;
  url: string;
  expiresAt: number;
  expiresAtIso: string;
  qrSvg: string;
};

type HandoffError = {
  ok: false;
  error?: string;
  stderr?: string;
};

type HandoffResponse = HandoffReady | HandoffError;

type Props = {
  open: boolean;
  onClose: () => void;
};

function expiryLabel(expiresAtIso: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(expiresAtIso));
  } catch {
    return expiresAtIso;
  }
}

export function MobileHandoffModal({ open, onClose }: Props) {
  const [handoff, setHandoff] = useState<HandoffReady | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const start = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch("/api/mobile-handoff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      const json = (await res.json()) as HandoffResponse;
      if (!json.ok) {
        setHandoff(null);
        setError(json.stderr || json.error || "Mobile handoff failed.");
        return;
      }
      setHandoff(json);
    } catch (err) {
      setHandoff(null);
      setError(err instanceof Error ? err.message : "Mobile handoff failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void start();
  }, [open, start]);

  const copyUrl = useCallback(async () => {
    if (!handoff?.url) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(handoff.url);
      setCopied(true);
    } catch (err) {
      setCopied(false);
      setError(err instanceof Error ? err.message : "Failed to copy URL.");
    }
  }, [handoff?.url]);

  const resetServe = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/mobile-handoff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reset" }),
      });
      const json = (await res.json()) as HandoffResponse;
      if (!json.ok) setError(json.stderr || json.error || "Tailscale Serve reset failed.");
      setHandoff(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tailscale Serve reset failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <Modal
      open={open}
      onClose={onClose}
      breadcrumb={["CovenCave", "Open on phone"]}
      footerActions={
        <>
          <Button variant="ghost" onClick={resetServe} disabled={loading}>
            Reset Serve
          </Button>
          <Button variant="secondary" onClick={() => void start()} loading={loading}>
            Refresh link
          </Button>
          <Button variant="primary" onClick={() => void copyUrl()} disabled={!handoff?.url || loading}>
            {copied ? "Copied" : "Copy URL"}
          </Button>
        </>
      }
      ariaLabel="Open CovenCave on phone"
    >
      <div className="mobile-handoff">
        <div className="mobile-handoff-qr" aria-label="CovenCave mobile QR code">
          {handoff?.qrSvg ? (
            <div
              className="mobile-handoff-qr__svg"
              dangerouslySetInnerHTML={{ __html: handoff.qrSvg }}
            />
          ) : (
            <div className="mobile-handoff-qr__placeholder" aria-busy={loading || undefined}>
              {loading ? "Starting..." : "No QR"}
            </div>
          )}
        </div>

        <div className="mobile-handoff__body">
          <p className="mobile-handoff__title">Scan from a device signed into this tailnet.</p>
          {handoff ? (
            <>
              <p className="mobile-handoff__meta">
                Expires at {expiryLabel(handoff.expiresAtIso)}
              </p>
              <p className="mobile-handoff__url">{handoff.serveUrl}</p>
              <p className="mobile-handoff__hint">
                The first open stores the invite in an HTTP-only cookie, then removes it from the visible URL.
              </p>
            </>
          ) : error ? (
            <p className="mobile-handoff__error">{error}</p>
          ) : (
            <p className="mobile-handoff__meta">
              Cave will publish the local sidecar through Tailscale Serve and create a short-lived invite.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
