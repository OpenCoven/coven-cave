"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { PairingStepsList } from "@/components/pairing-steps-list";
import { TailscaleRecoveryActions } from "@/components/tailscale-recovery-actions";
import { copyText } from "@/lib/clipboard";
import {
  backgroundAvailabilityReadiness,
  enableDesktopBackgroundAvailability,
  readDesktopReachability,
  type DesktopReachabilityStatus,
} from "@/lib/desktop-reachability";
import type { PairingStep } from "@/lib/mobile-handoff";
import { openExternalUrl } from "@/lib/open-external";
import { usePausablePoll } from "@/lib/use-pausable-poll";

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
  /** The proven probe ladder (cave-jr4r.1) — present on success too, so the
   *  modal can show the live "Phone seen" rung instead of discarding it. */
  steps?: PairingStep[];
  lastSeenAt?: number | null;
};

type HandoffError = {
  ok: false;
  error?: string;
  stderr?: string;
  /** Which rung broke — the route reports the whole ladder on failures. */
  steps?: PairingStep[];
};

type HandoffResponse = HandoffReady | HandoffError;
type AvailabilityGate = "checking" | "needs-consent" | "ready";

type Props = {
  open: boolean;
  onClose: () => void;
  autoCopyRequest?: number;
  mobileModeEnabled?: boolean;
  nativeHost?: string | null;
  mobileModeError?: string | null;
  onMobileModeChange?: (enabled: boolean) => void;
  /** Continue-on-phone (cave-i74f): when set, the QR carries `#chat-<id>` so
   *  one scan opens THIS conversation on the phone, not just the app. */
  chatId?: string | null;
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
  chatId = null,
}: Props) {
  const [handoff, setHandoff] = useState<HandoffReady | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Failure ladder from the route — which rung broke, not just one string. */
  const [errorSteps, setErrorSteps] = useState<PairingStep[] | null>(null);
  /** Live paired signal: flips the "Phone seen" rung the moment a scan lands. */
  const [phoneSeenAt, setPhoneSeenAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [availabilityGate, setAvailabilityGate] = useState<AvailabilityGate>("checking");
  const [reachability, setReachability] = useState<DesktopReachabilityStatus | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [enablingAvailability, setEnablingAvailability] = useState(false);
  const [sessionOnly, setSessionOnly] = useState(false);
  const [copied, setCopied] = useState<"host" | "invite" | null>(null);
  const lastAutoCopyRequestRef = useRef(0);
  /** Aborts an in-flight start when the modal closes, remounts, or Refresh races. */
  const startAbortRef = useRef<AbortController | null>(null);
  /** Invalidates native availability work before a closing modal can unmount. */
  const availabilityGenerationRef = useRef(0);

  const closeModal = useCallback(() => {
    availabilityGenerationRef.current += 1;
    startAbortRef.current?.abort();
    startAbortRef.current = null;
    onClose();
  }, [onClose]);

  // Parent navigation can unmount the conditional modal without calling its
  // onClose prop. A layout cleanup invalidates the attempt during that commit,
  // before a resolved native promise can enqueue an app-start microtask.
  useLayoutEffect(
    () => () => {
      availabilityGenerationRef.current += 1;
      startAbortRef.current?.abort();
      startAbortRef.current = null;
    },
    [],
  );

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

  const start = useCallback(async (copyRequest = 0): Promise<HandoffResponse> => {
    startAbortRef.current?.abort();
    const controller = new AbortController();
    startAbortRef.current = controller;

    setLoading(true);
    setError(null);
    setErrorSteps(null);
    setCopied(null);
    setHandoff(null);
    try {
      const res = await fetch("/api/mobile-handoff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(chatId ? { action: "app-start", chatId } : { action: "app-start" }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        return { ok: false, error: "Pairing refresh cancelled." };
      }
      const json = (await res.json()) as HandoffResponse;
      if (controller.signal.aborted) {
        return { ok: false, error: "Pairing refresh cancelled." };
      }
      if (!json.ok) {
        setHandoff(null);
        setError(json.stderr || json.error || "Mobile handoff failed.");
        setErrorSteps(Array.isArray(json.steps) && json.steps.length > 0 ? json.steps : null);
        return json;
      }
      setHandoff(json);
      setPhoneSeenAt(json.lastSeenAt ?? null);
      if (copyRequest > 0 && copyRequest !== lastAutoCopyRequestRef.current) {
        await copyHandoffUrl(json);
        if (controller.signal.aborted) {
          return { ok: false, error: "Pairing refresh cancelled." };
        }
        lastAutoCopyRequestRef.current = copyRequest;
      }
      return json;
    } catch (err) {
      if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
        return { ok: false, error: "Pairing refresh cancelled." };
      }
      setHandoff(null);
      const message = err instanceof Error ? err.message : "Mobile handoff failed.";
      setError(message);
      return { ok: false, error: message };
    } finally {
      if (!controller.signal.aborted) setLoading(false);
      if (startAbortRef.current === controller) startAbortRef.current = null;
    }
  }, [chatId, copyHandoffUrl]);

  useEffect(() => {
    const generation = availabilityGenerationRef.current + 1;
    availabilityGenerationRef.current = generation;
    if (!open) {
      startAbortRef.current?.abort();
      startAbortRef.current = null;
      setLoading(false);
      return;
    }
    let cancelled = false;
    setAvailabilityGate("checking");
    setAvailabilityError(null);
    setReachability(null);
    setHandoff(null);
    void readDesktopReachability()
      .then((status) => {
        if (cancelled || availabilityGenerationRef.current !== generation) return;
        setReachability(status);
        const readiness = backgroundAvailabilityReadiness(status);
        if (readiness === "needs-consent") {
          // Do not mint/show a durable-looking pairing code until packaged
          // macOS has either installed its existing background helper or the
          // user explicitly chooses a session-only link.
          setAvailabilityGate("needs-consent");
          return;
        }
        setSessionOnly(readiness === "not-applicable");
        setAvailabilityGate("ready");
        void start(autoCopyRequest);
      })
      .catch((cause) => {
        if (cancelled || availabilityGenerationRef.current !== generation) return;
        setAvailabilityGate("needs-consent");
        setAvailabilityError(
          cause instanceof Error
            ? cause.message
            : "Couldn’t check background availability.",
        );
      });
    return () => {
      cancelled = true;
      if (availabilityGenerationRef.current === generation) {
        availabilityGenerationRef.current += 1;
      }
      startAbortRef.current?.abort();
      startAbortRef.current = null;
    };
  }, [autoCopyRequest, open, start]);

  const enableBackgroundAvailability = useCallback(async () => {
    if (!reachability || enablingAvailability) return;
    const generation = availabilityGenerationRef.current;
    setEnablingAvailability(true);
    setAvailabilityError(null);
    try {
      const next = await enableDesktopBackgroundAvailability(reachability);
      if (availabilityGenerationRef.current !== generation) return;
      setReachability(next);
      setSessionOnly(false);
      setAvailabilityGate("ready");
      await start(autoCopyRequest);
    } catch (cause) {
      if (availabilityGenerationRef.current !== generation) return;
      setAvailabilityError(
        cause instanceof Error
          ? cause.message
          : "Couldn’t enable background availability.",
      );
    } finally {
      if (availabilityGenerationRef.current === generation) {
        setEnablingAvailability(false);
      }
    }
  }, [autoCopyRequest, enablingAvailability, reachability, start]);

  const continueForThisSession = useCallback(() => {
    setSessionOnly(true);
    setAvailabilityGate("ready");
    setAvailabilityError(null);
    void start(autoCopyRequest);
  }, [autoCopyRequest, start]);

  const copyUrl = useCallback(async () => {
    if (handoff) await copyHandoffUrl(handoff);
  }, [copyHandoffUrl, handoff]);

  // While the modal shows a healthy ladder that's still waiting on the first
  // scan, poll the cheap paired-signal read (~5s, paused in hidden tabs) so
  // "Waiting for the first scan" flips to a green "Phone seen" the moment the
  // phone lands — the loop closes on the desktop, not just on the phone.
  const phoneRungPending = Boolean(handoff?.steps) && !phoneSeenAt;
  const pollPhoneSeen = useCallback(async () => {
    try {
      const res = await fetch("/api/mobile-handoff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "status" }),
      });
      const json = (await res.json()) as { ok: boolean; lastSeenAt?: number | null };
      if (json.ok && json.lastSeenAt) setPhoneSeenAt(json.lastSeenAt);
    } catch {
      // Best-effort signal — the next tick retries.
    }
  }, []);
  usePausablePoll(() => void pollPhoneSeen(), 5000, { enabled: open && phoneRungPending });

  /** The success ladder with the phone rung kept live by the poll. */
  const displaySteps = useMemo(() => {
    if (!handoff?.steps) return null;
    if (!phoneSeenAt) return handoff.steps;
    return handoff.steps.map((step) =>
      step.id === "phone" ? { ...step, state: "ok" as const, detail: undefined } : step,
    );
  }, [handoff, phoneSeenAt]);

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
    startAbortRef.current?.abort();
    const controller = new AbortController();
    startAbortRef.current = controller;

    setLoading(true);
    setError(null);
    setErrorSteps(null);
    try {
      const res = await fetch("/api/mobile-handoff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reset" }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const json = (await res.json()) as HandoffResponse;
      if (controller.signal.aborted) return;
      if (!json.ok) setError(json.stderr || json.error || "Couldn’t stop sharing.");
      setHandoff(null);
    } catch (err) {
      if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
        return;
      }
      setError(err instanceof Error ? err.message : "Couldn’t stop sharing.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
      if (startAbortRef.current === controller) startAbortRef.current = null;
    }
  }, []);

  return (
    <Modal
      open={open}
      onClose={closeModal}
      breadcrumb={["CovenCave", chatId ? "Continue this chat on phone" : "Open on phone"]}
      footerActions={
        <>
          <Button variant="ghost" onClick={resetServe} disabled={loading}>
            Stop sharing
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
          <Button
            variant="secondary"
            onClick={() => void start()}
            loading={loading}
            disabled={availabilityGate !== "ready"}
          >
            Refresh link
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
            <div
              className="mobile-handoff-qr__placeholder"
              aria-busy={loading || enablingAvailability || availabilityGate === "checking" || undefined}
            >
              {availabilityGate === "checking"
                ? "Checking availability…"
                : enablingAvailability
                  ? "Enabling…"
                  : loading
                    ? "Starting..."
                    : availabilityGate === "needs-consent"
                      ? "Choose availability"
                      : "No QR"}
            </div>
          )}
        </div>

        <div className="mobile-handoff__body">
          {availabilityGate === "needs-consent" ? (
            <>
              <p className="mobile-handoff__title">Keep Cave available after this window closes?</p>
              <p className="mobile-handoff__meta">
                Remote reconnect needs a per-user background helper on this Mac. It stays
                loopback-only, still requires Tailscale and your paired token, and does not
                prevent Mac sleep.
              </p>
              <div className="mobile-handoff__actions">
                <Button
                  onClick={() => void enableBackgroundAvailability()}
                  loading={enablingAvailability}
                  disabled={!reachability}
                >
                  Enable &amp; show pairing code
                </Button>
                <Button
                  variant="secondary"
                  onClick={continueForThisSession}
                  disabled={enablingAvailability}
                >
                  Pair for this session
                </Button>
              </div>
              <p className="mobile-handoff__hint">
                To remain reachable while idle, separately enable “Stay awake while paired”
                in Settings → Phone. The default keeps normal battery sleep behavior.
              </p>
              {availabilityError ? (
                <p className="mobile-handoff__error" role="alert">{availabilityError}</p>
              ) : null}
            </>
          ) : (
            <p className="mobile-handoff__title">
              {chatId
                ? "Scan to continue this conversation on your phone."
                : "Connect CovenCave on your phone."}
            </p>
          )}
          {availabilityGate !== "ready" ? null : handoff ? (
            <>
              {handoff.nativeHost ? (
                <>
                  <p className="mobile-handoff__meta">
                    {sessionOnly
                      ? "Enter this host in the native iOS app. This session ends when Cave closes."
                      : "Enter this host in the native iOS app. Background availability keeps the server running after this window closes."}
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
                Don’t type your Mac’s 127.0.0.1 or Wi‑Fi LAN address into the phone — it can’t reach
                your desktop that way.
              </p>
              {displaySteps ? <PairingStepsList steps={displaySteps} className="mobile-handoff__steps" /> : null}
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
            <>
              {errorSteps ? (
                // The route's proven ladder: WHICH rung broke and what to do,
                // instead of one opaque error string.
                <PairingStepsList steps={errorSteps} className="mobile-handoff__steps" />
              ) : null}
              <p className="mobile-handoff__error">{error}</p>
              <TailscaleRecoveryActions
                failure={error}
                steps={errorSteps}
                busy={loading}
                attempt={() => start()}
              />
            </>
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
