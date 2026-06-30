"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { copyText } from "@/lib/clipboard";
import { openExternalUrl } from "@/lib/open-external";

type HandoffReady = {
  ok: true;
  backendUrl: string;
  serveUrl: string;
  nativeUrl?: string;
  nativeHost?: string;
  inviteUrl?: string;
  url?: string;
  expiresAt?: number;
  expiresAtIso?: string;
  qrSvg: string;
  warning?: string;
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
  autoCopyRequest?: number;
  mobileModeEnabled?: boolean;
  nativeHost?: string | null;
  mobileModeError?: string | null;
  onMobileModeChange?: (enabled: boolean) => void;
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

export function MobileHandoffModal({
  open,
  onClose,
  autoCopyRequest = 0,
  mobileModeEnabled = true,
  nativeHost = null,
  mobileModeError = null,
  onMobileModeChange,
}: Props) {
  const [handoff, setHandoff] = useState<HandoffReady | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<"host" | "invite" | null>(null);
  const lastAutoCopyRequestRef = useRef(0);

  const copyHandoffUrl = useCallback(async (nextHandoff: HandoffReady) => {
    const url = nextHandoff.inviteUrl || nextHandoff.url || nextHandoff.nativeUrl;
    if (!url) return;
    try {
      if (!(await copyText(url))) throw new Error("Clipboard unavailable");
      setCopied("invite");
    } catch (err) {
      setCopied(null);
      setError(err instanceof Error ? err.message : "Failed to copy URL.");
    }
  }, []);

  const start = useCallback(async (copyRequest = 0) => {
    setLoading(true);
    setError(null);
    setCopied(null);
    setHandoff(null);
    try {
      const res = await fetch("/api/mobile-handoff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "app-start" }),
      });
      const json = (await res.json()) as HandoffResponse;
      if (!json.ok) {
        setHandoff(null);
        setError(json.stderr || json.error || "Mobile handoff failed.");
        return;
      }
      setHandoff(json);
      if (copyRequest > 0 && copyRequest !== lastAutoCopyRequestRef.current) {
        lastAutoCopyRequestRef.current = copyRequest;
        await copyHandoffUrl(json);
      }
    } catch (err) {
      setHandoff(null);
      setError(err instanceof Error ? err.message : "Mobile handoff failed.");
    } finally {
      setLoading(false);
    }
  }, [copyHandoffUrl]);

  useEffect(() => {
    if (open) void start(autoCopyRequest);
  }, [autoCopyRequest, open, start]);

  const copyUrl = useCallback(async () => {
    if (handoff) await copyHandoffUrl(handoff);
  }, [copyHandoffUrl, handoff]);

  const copyHost = useCallback(async () => {
    if (!handoff?.nativeHost) return;
    try {
      if (!(await copyText(handoff.nativeHost))) throw new Error("Clipboard unavailable");
      setCopied("host");
    } catch (err) {
      setCopied(null);
      setError(err instanceof Error ? err.message : "Failed to copy host.");
    }
  }, [handoff]);

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
          {onMobileModeChange ? (
            <Button
              variant="secondary"
              onClick={() => onMobileModeChange(!mobileModeEnabled)}
              disabled={loading}
            >
              {mobileModeEnabled ? "Turn off mobile mode" : "Turn on mobile mode"}
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => void start()} loading={loading}>
            Refresh route
          </Button>
          <Button variant="secondary" onClick={() => void copyHost()} disabled={!handoff?.nativeHost || loading}>
            {copied === "host" ? "Host copied" : "Copy host"}
          </Button>
          <Button variant="secondary" onClick={() => void copyUrl()} disabled={!(handoff?.inviteUrl || handoff?.url || handoff?.nativeUrl) || loading}>
            {copied === "invite" ? "Invite copied" : "Copy invite"}
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
          <p className="mobile-handoff__title">Connect CovenCave on your phone.</p>
          {handoff ? (
            <>
              {handoff.nativeHost ? (
                <>
                  <p className="mobile-handoff__meta">
                    Enter this host in the native iOS app. Mobile mode stays alive until you turn it off in Settings.
                  </p>
                  <button
                    type="button"
                    className="mobile-handoff__url mobile-handoff__copy"
                    onClick={() => void copyHost()}
                  >
                    {handoff.nativeHost}
                  </button>
                </>
              ) : null}
              {handoff.expiresAtIso ? (
                <p className="mobile-handoff__meta">
                  Expires at {expiryLabel(handoff.expiresAtIso)}
                </p>
              ) : null}
              {handoff.inviteUrl || handoff.url ? (
                <a
                  className="mobile-handoff__url mobile-handoff__link"
                  href={handoff.inviteUrl || handoff.url}
                  onClick={(event) => {
                    event.preventDefault();
                    openExternalUrl(handoff.inviteUrl || handoff.url || "");
                  }}
                >
                  {handoff.inviteUrl || handoff.url}
                </a>
              ) : null}
              <p className="mobile-handoff__hint">
                The QR opens the Tailscale-served desktop page; the host is what the native app needs.
              </p>
              {handoff.warning ? (
                <p className="mobile-handoff__warning">{handoff.warning}</p>
              ) : null}
            </>
          ) : nativeHost ? (
            <>
              <p className="mobile-handoff__meta">
                Mobile mode is on. Enter this host in the native iOS app.
              </p>
              <button
                type="button"
                className="mobile-handoff__url mobile-handoff__copy"
                onClick={() => void copyText(nativeHost)}
              >
                {nativeHost}
              </button>
              {mobileModeError ? (
                <p className="mobile-handoff__warning">{mobileModeError}</p>
              ) : null}
            </>
          ) : error ? (
            <p className="mobile-handoff__error">{error}</p>
          ) : (
            <p className="mobile-handoff__meta">
              Cave will publish this desktop through Tailscale Serve and show the native app host.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
