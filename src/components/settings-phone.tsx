"use client";

import "@/styles/settings-phone.css";

import { useCallback, useEffect, useRef, useState } from "react";
import { PairingStepsList } from "@/components/pairing-steps-list";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { useAnnouncer } from "@/components/ui/live-region";
import { settingsGroupId } from "@/components/ui/settings-group";
import { copyText } from "@/lib/clipboard";
import {
  readDesktopReachability,
  writeDesktopReachability,
  type DesktopReachabilityConfig,
  type DesktopReachabilityStatus,
} from "@/lib/desktop-reachability";
import { Icon } from "@/lib/icon";
import type { PairingStep } from "@/lib/mobile-handoff";
import { readMobileModeEnabled, writeMobileModeEnabled } from "@/lib/mobile-mode-pref";
import { reconcileMobileModeRequest } from "@/lib/mobile-mode-reconcile";
import { openExternalUrl } from "@/lib/open-external";
import { relativeTime } from "@/lib/relative-time";
import { classifyTailscaleFailureKind } from "@/lib/tailscale-failure";
import { usePausablePoll } from "@/lib/use-pausable-poll";

type MobileHandoffCardState = {
  nativeHost: string | null;
  inviteUrl: string | null;
  appInviteUrl: string | null;
  qrSvg: string | null;
  lastSeenAt: number | null;
};

type ReachabilitySettingKey = keyof DesktopReachabilityConfig;
type MobileWriteFlagKey = "grantMutations" | "fileWrites" | "canvasWrites";
type ChipTone = "success" | "warning" | "muted";

const PAUSED_PAIRING_STEPS: PairingStep[] = [
  { id: "access", label: "Pairing service ready", state: "skipped", detail: "Mobile mode off" },
  { id: "backend", label: "Cave server reachable", state: "skipped", detail: "Mobile mode off" },
  { id: "tailscale", label: "Tailscale connected", state: "skipped", detail: "Mobile mode off" },
  { id: "route", label: "Tailnet route live", state: "skipped", detail: "Mobile mode off" },
  { id: "phone", label: "Phone seen", state: "skipped", detail: "Mobile mode off" },
];

const CHECKING_PAIRING_STEPS: PairingStep[] = [
  { id: "access", label: "Pairing service ready", state: "pending", detail: "Checking…" },
  { id: "backend", label: "Cave server reachable", state: "pending", detail: "Waiting" },
  { id: "tailscale", label: "Tailscale connected", state: "pending", detail: "Waiting" },
  { id: "route", label: "Tailnet route live", state: "pending", detail: "Waiting" },
  { id: "phone", label: "Phone seen", state: "pending", detail: "Waiting" },
];

const WRITE_ACCESS_ROWS: Array<{
  key: MobileWriteFlagKey;
  label: string;
  hint: string;
}> = [
  {
    key: "grantMutations",
    label: "Allow permission changes from phone",
    hint: "Grant or revoke familiar project access, and decide grant requests, from the Cave app. Off keeps those desktop-only.",
  },
  {
    key: "fileWrites",
    label: "Allow file edits from phone",
    hint: "Save files in the Code tab from your phone. Off keeps phone access read-only.",
  },
  {
    key: "canvasWrites",
    label: "Allow canvas edits from phone",
    hint: "Generate, refine, comment on, and delete canvas artifacts. Off keeps the phone’s Canvas tab view-only.",
  },
];

/** Plain-language framing for handoff failures. Raw diagnostics stay behind a
 * disclosure while the headline tells a person what to do next. */
export function classifyTailscaleFailure(raw: string): { headline: string; hint: string } {
  const kind = classifyTailscaleFailureKind(raw);
  if (kind === "pairing-secret") {
    return {
      headline: "Pairing secret unavailable",
      hint: "Cave provisions the pairing secret automatically — retry below. If this persists, restart Cave and check the app data folder’s permissions.",
    };
  }
  if (kind === "not-installed") {
    return {
      headline: "Tailscale isn’t installed",
      hint: "Install Tailscale from tailscale.com/download and sign in — pairing resumes here automatically.",
    };
  }
  if (kind === "signed-out") {
    return {
      headline: "Tailscale is signed out",
      hint: "Open Tailscale and sign in — pairing resumes here automatically.",
    };
  }
  if (kind === "not-running") {
    return {
      headline: "Tailscale isn’t running",
      hint: "Open Tailscale and sign in — pairing resumes here automatically.",
    };
  }
  if (kind === "serve-permission") {
    return {
      headline: "Tailscale Serve needs permission",
      hint: "On Linux, run `sudo tailscale set --operator=$USER` once, then retry phone pairing.",
    };
  }
  if (kind === "serve-failed") {
    return {
      headline: "Tailscale Serve couldn’t start",
      hint: "Retry below; if it keeps failing, quit and reopen Tailscale.",
    };
  }
  return {
    headline: "Phone pairing is unavailable",
    hint: "Retry below — the technical details may help if it persists.",
  };
}

function SettingsSwitch({
  checked,
  label,
  disabled,
  onChange,
}: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`settings-switch focus-ring${checked ? " is-on" : ""}`}
    >
      <span className="settings-switch__knob" aria-hidden />
    </button>
  );
}

function StatusChip({ tone, children }: { tone: ChipTone; children: string }) {
  return (
    <span className={`settings-phone-chip settings-phone-chip--${tone}`}>
      <i aria-hidden="true" />
      {children}
    </span>
  );
}

function SectionRule({
  children,
  aside,
  asideTone = "muted",
}: {
  children: string;
  aside?: string;
  asideTone?: ChipTone;
}) {
  return (
    <div className="settings-phone-rule">
      <h2>{children}</h2>
      <i aria-hidden="true" />
      {aside ? (
        <span className={`settings-phone-rule__aside settings-phone-rule__aside--${asideTone}`}>
          {aside}
        </span>
      ) : null}
    </div>
  );
}

function IosInstallCard() {
  const [install, setInstall] = useState<{ url: string; qrSvg: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/mobile-handoff", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "install-info" }),
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((json: { ok?: boolean; configured?: boolean; url?: string; qrSvg?: string }) => {
        if (controller.signal.aborted) return;
        if (json?.ok && json.configured && json.url && json.qrSvg) {
          setInstall({ url: json.url, qrSvg: json.qrSvg });
        }
      })
      .catch(() => {
        // Optional install metadata is absent in source builds.
      });
    return () => controller.abort();
  }, []);

  return (
    <section
      id={settingsGroupId("Get the app")}
      data-settings-group
      className="settings-phone-card settings-phone-install"
    >
      <p className="settings-phone-card__kicker">Get the app</p>
      <div className="settings-phone-install__body">
        <div className="settings-phone-install__copy">
          <h3>Build it with Xcode</h3>
          <p>
            Open <code>apps/ios/CovenCave</code> and run on your device, or install the TestFlight build.
          </p>
        </div>
        {install ? (
          <div
            className="settings-phone-install__qr"
            role="img"
            aria-label="Install code for your iPhone camera"
            dangerouslySetInnerHTML={{ __html: install.qrSvg }}
          />
        ) : null}
      </div>
      <div className="settings-phone-card__actions">
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            openExternalUrl(
              "https://github.com/OpenCoven/coven-cave/blob/main/docs/ios-native-rebuild.md",
            )
          }
          leadingIcon="ph:file-text"
        >
          Setup guide
        </Button>
        {install ? (
          <Button
            variant="ghost"
            size="sm"
            leadingIcon="ph:arrow-square-out"
            onClick={() => openExternalUrl(install.url)}
          >
            TestFlight
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function DesktopReachabilityCard() {
  const [status, setStatus] = useState<DesktopReachabilityStatus | null>(null);
  const [busyKey, setBusyKey] = useState<ReachabilitySettingKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const { announce } = useAnnouncer();

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void readDesktopReachability()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn’t load Mac reachability settings.");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const update = async (key: ReachabilitySettingKey, enabled: boolean) => {
    if (!status?.supported || busyKey) return;
    const config = { ...status.config, [key]: enabled };
    setBusyKey(key);
    setError(null);
    try {
      const next = await writeDesktopReachability(config);
      setStatus(next);
      const labels: Record<ReachabilitySettingKey, string> = {
        preventSleep: "Stay awake while paired",
        preventSleepOnAcOnly: "Only keep awake on power",
        daemonMode: "Background availability",
      };
      announce(`${labels[key]} ${enabled ? "enabled" : "disabled"}.`, "polite");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Couldn’t update Mac reachability.";
      setError(message);
      announce(message, "assertive");
    } finally {
      setBusyKey(null);
    }
  };

  const renderSwitch = (
    key: ReachabilitySettingKey,
    label: string,
    disabled = false,
  ) => (
    <SettingsSwitch
      checked={status?.config[key] === true}
      label={label}
      disabled={!status?.supported || busyKey !== null || disabled}
      onChange={() => void update(key, status?.config[key] !== true)}
    />
  );

  const primaryHint = status?.pairedPhoneSeen
    ? status.preventSleepActive
      ? "A paired phone is present, so macOS idle sleep is currently prevented."
      : "Prevent idle sleep whenever this Mac has a paired phone."
    : "Starts after a phone pairs. Off leaves the Mac’s normal sleep settings unchanged.";

  return (
    <section
      id={settingsGroupId("Keep this Mac reachable")}
      data-settings-group
      className="settings-phone-card settings-phone-reachability"
    >
      <p className="settings-phone-card__kicker">Keep this Mac reachable</p>
      {!status && error ? (
        <ErrorState
          compact
          headline="Couldn’t load Mac reachability settings"
          subtitle={error}
          actions={
            <Button size="xs" onClick={() => setReloadKey((key) => key + 1)}>
              Retry
            </Button>
          }
        />
      ) : !status ? (
        <p role="status" className="settings-phone-card__status">
          Loading Mac reachability…
        </p>
      ) : !status.supported ? (
        <p role="status" className="settings-phone-card__status">
          {status.detail ?? "These controls are available in the macOS desktop app."}
        </p>
      ) : (
        <>
          <div className="settings-phone-reachability__primary">
            <div>
              <h3>Stay awake while paired</h3>
              <p>{primaryHint}</p>
            </div>
            {renderSwitch("preventSleep", "Stay awake while paired")}
          </div>
          <details className="settings-phone-details">
            <summary className="focus-ring">
              Availability options
              <Icon name="ph:caret-down" width={12} aria-hidden />
            </summary>
            <div className="settings-phone-details__body">
              <div className="settings-phone-option-row">
                <div>
                  <strong>Only keep awake on power</strong>
                  <span>Recommended. Battery use follows normal sleep settings.</span>
                </div>
                {renderSwitch(
                  "preventSleepOnAcOnly",
                  "Only keep awake on power",
                  !status.config.preventSleep,
                )}
              </div>
              <div className="settings-phone-option-row">
                <div>
                  <strong>Background availability</strong>
                  <span>
                    {status.backgroundAvailabilitySupported === false
                      ? "Packaged macOS builds can keep the server available after the window closes."
                      : "A macOS LaunchAgent keeps the Cave server available after this window closes."}
                  </span>
                </div>
                {renderSwitch(
                  "daemonMode",
                  "Background availability",
                  status.backgroundAvailabilitySupported === false,
                )}
              </div>
              <p className="settings-phone-reachability__caveat">
                Tailscale can’t wake a sleeping Mac. Keep it awake or use an always-on hub when the phone must stay connected.
              </p>
              {status.config.daemonMode && status.launchAgentInstalled ? (
                <p className="settings-phone-reachability__active" role="status">
                  Background availability is installed and takes over when this window closes.
                </p>
              ) : null}
            </div>
          </details>
          {error ? (
            <p role="alert" className="settings-phone-inline-error">
              {error}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

function MobileWriteAccessCard() {
  const [flags, setFlags] = useState<Record<MobileWriteFlagKey, boolean> | null>(null);
  const [busyKey, setBusyKey] = useState<MobileWriteFlagKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { announce } = useAnnouncer();

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void fetch("/api/mobile-permissions", { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok || !body?.ok) {
          throw new Error(body?.error ?? "Couldn’t load phone write access.");
        }
        return body;
      })
      .then((body) => {
        if (cancelled) return;
        setFlags({
          grantMutations: body.grantMutations === true,
          fileWrites: body.fileWrites === true,
          canvasWrites: body.canvasWrites === true,
        });
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Couldn’t load phone write access.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async (key: MobileWriteFlagKey) => {
    if (!flags || busyKey) return;
    const next = !flags[key];
    setBusyKey(key);
    setError(null);
    try {
      const res = await fetch("/api/mobile-permissions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [key]: next }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        const message = body?.error ?? "Couldn’t update phone write access.";
        setError(message);
        announce(message, "assertive");
        return;
      }
      setFlags({
        grantMutations: body.grantMutations === true,
        fileWrites: body.fileWrites === true,
        canvasWrites: body.canvasWrites === true,
      });
      const labels: Record<MobileWriteFlagKey, string> = {
        grantMutations: "Permission changes from phone",
        fileWrites: "File edits from phone",
        canvasWrites: "Canvas edits from phone",
      };
      announce(`${labels[key]} ${next ? "enabled" : "disabled"}.`, "polite");
    } catch {
      const message = "Couldn’t reach the desktop API.";
      setError(message);
      announce(message, "assertive");
    } finally {
      setBusyKey(null);
    }
  };

  const allowedCount = flags
    ? WRITE_ACCESS_ROWS.filter((row) => flags[row.key]).length
    : 0;
  const summary = error
    ? "needs attention"
    : flags
      ? `${allowedCount} of ${WRITE_ACCESS_ROWS.length} allowed`
      : "loading permissions";
  const summaryTone: ChipTone = error
    ? "warning"
    : allowedCount > 0
      ? "success"
      : "muted";

  return (
    <section
      id={settingsGroupId("Phone write access")}
      data-settings-group
      className="settings-phone-permissions"
    >
      <SectionRule aside={summary} asideTone={summaryTone}>
        Phone write access
      </SectionRule>
      <div className="settings-phone-permissions-grid">
        {WRITE_ACCESS_ROWS.map((row) => {
          const checked = flags?.[row.key] === true;
          return (
            <div className="settings-phone-permission" key={row.key}>
              <div>
                <h3>{row.label}</h3>
                <p>{row.hint}</p>
              </div>
              <SettingsSwitch
                checked={checked}
                label={row.label}
                disabled={!flags || busyKey !== null}
                onChange={() => void toggle(row.key)}
              />
            </div>
          );
        })}
      </div>
      {error ? (
        <p role="alert" className="settings-phone-inline-error settings-phone-permissions__error">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export function PhoneSection({ onUseAsHub }: { onUseAsHub: (url: string) => void }) {
  const [mobileModeEnabled, setMobileModeEnabled] = useState(readMobileModeEnabled);
  const [handoff, setHandoff] = useState<MobileHandoffCardState | null>(null);
  const [steps, setSteps] = useState<PairingStep[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"link" | "app" | "host" | null>(null);
  const initialReconcileDoneRef = useRef(false);
  const copyResetRef = useRef<number | null>(null);
  const { announce } = useAnnouncer();

  const reconcileMobileMode = useCallback(
    async (enabled: boolean, options?: { busy?: boolean; force?: boolean }) => {
      if (options?.busy) setBusy(true);
      setError(null);
      if (!enabled) {
        setHandoff(null);
        setSteps(null);
      }
      try {
        const result = await reconcileMobileModeRequest(enabled, {
          force: options?.force,
        });
        setSteps(enabled && Array.isArray(result.steps) ? result.steps : null);
        if (!result.ok) {
          setHandoff(null);
          setError(result.stderr || result.error || "Mobile mode unavailable.");
          return false;
        }
        setHandoff(
          enabled
            ? {
                nativeHost: result.nativeHost ?? null,
                inviteUrl: result.inviteUrl ?? null,
                appInviteUrl: result.appInviteUrl ?? null,
                qrSvg: result.qrSvg ?? null,
                lastSeenAt: result.lastSeenAt ?? null,
              }
            : null,
        );
        return true;
      } catch (cause) {
        setHandoff(null);
        setError(cause instanceof Error ? cause.message : "Mobile mode unavailable.");
        return false;
      } finally {
        if (options?.busy) setBusy(false);
      }
    },
    [],
  );

  const onMobileModeChange = async (enabled: boolean) => {
    writeMobileModeEnabled(enabled);
    setMobileModeEnabled(enabled);
    const ok = await reconcileMobileMode(enabled, { busy: true, force: true });
    announce(
      enabled
        ? ok
          ? "Mobile mode on."
          : "Mobile mode on; pairing needs attention."
        : "Mobile mode off.",
      ok ? "polite" : "assertive",
    );
  };

  useEffect(() => {
    if (initialReconcileDoneRef.current) return;
    initialReconcileDoneRef.current = true;
    if (!mobileModeEnabled) return;
    void reconcileMobileMode(mobileModeEnabled);
  }, [mobileModeEnabled, reconcileMobileMode]);

  useEffect(
    () => () => {
      if (copyResetRef.current !== null) {
        window.clearTimeout(copyResetRef.current);
      }
    },
    [],
  );

  usePausablePoll(() => void reconcileMobileMode(true), 60_000, {
    enabled: mobileModeEnabled,
  });

  const copy = (kind: "link" | "app" | "host", value: string) => {
    void copyText(value).then((ok) => {
      if (!ok) {
        announce("Couldn’t copy the phone pairing value.", "assertive");
        return;
      }
      setCopied(kind);
      announce(
        kind === "host"
          ? "Desktop address copied."
          : kind === "app"
            ? "App pairing link copied."
            : "Pairing link copied.",
        "polite",
      );
      if (copyResetRef.current !== null) {
        window.clearTimeout(copyResetRef.current);
      }
      copyResetRef.current = window.setTimeout(() => {
        setCopied((current) => (current === kind ? null : current));
        copyResetRef.current = null;
      }, 1500);
    });
  };

  const friendly = error ? classifyTailscaleFailure(error) : null;
  const pairingReady = mobileModeEnabled && !friendly && Boolean(handoff?.qrSvg);
  const paired = mobileModeEnabled && Boolean(handoff?.lastSeenAt);
  const statusLine = busy
    ? "Updating…"
    : !mobileModeEnabled
      ? "Turn on to let a phone pair over the tailnet."
      : friendly
        ? friendly.headline
        : pairingReady
          ? "Ready — scan the code with your iPhone camera."
          : "Starting the tailnet route…";
  const pairState = !mobileModeEnabled
    ? "not accepting scans"
    : friendly
      ? "needs attention"
      : paired && handoff?.lastSeenAt
        ? `paired · last seen ${relativeTime(new Date(handoff.lastSeenAt).toISOString())}`
        : pairingReady
          ? "ready to scan"
          : "checking route";
  const pairTone: ChipTone = friendly
    ? "warning"
    : pairingReady
      ? "success"
      : "muted";
  const displaySteps =
    steps ?? (mobileModeEnabled ? CHECKING_PAIRING_STEPS : PAUSED_PAIRING_STEPS);

  return (
    <section className="settings-phone" aria-labelledby="settings-phone-title">
      <header className="settings-phone-hero">
        <span className="settings-phone-hero__mark" aria-hidden="true">
          <Icon name="ph:device-mobile" width={18} />
        </span>
        <div className="settings-phone-hero__identity">
          <p className="settings-phone-hero__kicker">Settings · Phone</p>
          <h1 id="settings-phone-title">Phone</h1>
          <p className="settings-phone-hero__description">
            Native iOS handoff over your Tailscale network — no password, no cloud relay.
          </p>
        </div>
        <div className="settings-phone-hero__chips">
          <StatusChip tone={mobileModeEnabled ? "success" : "muted"}>
            {mobileModeEnabled ? "mobile mode on" : "mobile mode off"}
          </StatusChip>
          <StatusChip tone={pairTone}>
            {friendly
              ? "pairing needs attention"
              : pairingReady
                ? "pairing ready"
                : mobileModeEnabled
                  ? "pairing starting"
                  : "pairing paused"}
          </StatusChip>
          <StatusChip tone={paired ? "success" : "muted"}>
            {paired ? "phone paired" : "waiting for phone"}
          </StatusChip>
        </div>
      </header>

      <div className="settings-phone-mode">
        <div className="settings-phone-mode__status">
          <h2>Mobile mode</h2>
          <p>
            <span
              className={`settings-phone-live-dot settings-phone-live-dot--${pairTone}`}
              aria-hidden="true"
            />
            {statusLine}
          </p>
        </div>
        <div className="settings-phone-mode__pairing">
          <span>{pairState}</span>
          <small>
            {mobileModeEnabled
              ? "The pairing path refreshes automatically."
              : "Pairing stays private until mobile mode is on."}
          </small>
        </div>
        <div className="settings-phone-mode__actions">
          {handoff?.inviteUrl ? (
            <Button
              size="xs"
              variant="secondary"
              leadingIcon={copied === "link" ? "ph:check" : "ph:copy"}
              onClick={() => copy("link", handoff.inviteUrl ?? "")}
            >
              {copied === "link" ? "Copied" : "Copy link"}
            </Button>
          ) : null}
          {handoff?.appInviteUrl ? (
            <Button
              size="xs"
              variant="ghost"
              leadingIcon={copied === "app" ? "ph:check" : "ph:copy"}
              onClick={() => copy("app", handoff.appInviteUrl ?? "")}
            >
              {copied === "app" ? "Copied" : "Copy app link"}
            </Button>
          ) : null}
          <SettingsSwitch
            checked={mobileModeEnabled}
            label="Mobile mode"
            disabled={busy}
            onChange={() => void onMobileModeChange(!mobileModeEnabled)}
          />
        </div>
      </div>

      <div className="settings-phone-control-grid">
        <section
          id={settingsGroupId("Pair")}
          data-settings-group
          className="settings-phone-pair"
        >
          <SectionRule aside={pairState} asideTone={pairTone}>
            Pair
          </SectionRule>
          <div className="settings-phone-pair-sheet">
            <div className="settings-phone-qr-column">
              <div
                className={`settings-phone-qr${pairingReady ? "" : " settings-phone-qr--inactive"}`}
              >
                {pairingReady && handoff?.qrSvg ? (
                  <div
                    className="settings-phone-qr__svg"
                    role="img"
                    aria-label="Pairing code for your iPhone camera"
                    dangerouslySetInnerHTML={{ __html: handoff.qrSvg }}
                  />
                ) : (
                  <div
                    className="settings-phone-qr__placeholder"
                    role="status"
                    aria-busy={mobileModeEnabled && !friendly ? true : undefined}
                  >
                    <Icon
                      name={friendly ? "ph:warning" : "ph:device-mobile"}
                      width={20}
                      aria-hidden
                    />
                    <span>
                      {!mobileModeEnabled
                        ? "Mobile mode is off"
                        : friendly
                          ? "Pairing needs attention"
                          : "Preparing pairing code…"}
                    </span>
                  </div>
                )}
              </div>
              <p>Scan with your iPhone camera — Cave opens already paired.</p>
              <Button
                size="xs"
                variant="secondary"
                leadingIcon="ph:arrows-clockwise"
                disabled={!mobileModeEnabled || busy}
                onClick={() =>
                  void reconcileMobileMode(true, { busy: true, force: true })
                }
              >
                New code
              </Button>
            </div>

            <div className="settings-phone-pair__details">
              <PairingStepsList
                steps={displaySteps}
                showAllDetails
                className="settings-phone-checklist"
              >
                {steps?.some((step) => step.state === "fail") ? (
                  <li className="settings-phone-checklist__retry">
                    <Button
                      size="xs"
                      variant="secondary"
                      leadingIcon="ph:arrows-clockwise"
                      onClick={() =>
                        void reconcileMobileMode(true, {
                          busy: true,
                          force: true,
                        })
                      }
                      disabled={busy}
                    >
                      Retry
                    </Button>
                  </li>
                ) : null}
              </PairingStepsList>

              {mobileModeEnabled && friendly && error && !steps ? (
                <div className="settings-phone-pair__warning" role="status">
                  <strong>{friendly.headline}</strong>
                  <p>{friendly.hint}</p>
                  <Button
                    size="xs"
                    variant="secondary"
                    leadingIcon="ph:arrows-clockwise"
                    onClick={() =>
                      void reconcileMobileMode(true, { busy: true, force: true })
                    }
                    disabled={busy}
                  >
                    Retry
                  </Button>
                </div>
              ) : null}

              <details className="settings-phone-details settings-phone-manual">
                <summary className="focus-ring">
                  Manual setup
                  <span>
                    {handoff?.nativeHost
                      ? "if the camera won’t cooperate"
                      : "available after the route starts"}
                  </span>
                  <Icon name="ph:caret-down" width={12} aria-hidden />
                </summary>
                <div className="settings-phone-details__body">
                  {handoff?.nativeHost ? (
                    <div className="settings-phone-manual__address">
                      <span>Desktop address</span>
                      <code>{handoff.nativeHost}</code>
                      <Button
                        size="xs"
                        variant="ghost"
                        leadingIcon={copied === "host" ? "ph:check" : "ph:copy"}
                        onClick={() => copy("host", handoff.nativeHost ?? "")}
                      >
                        {copied === "host" ? "Copied" : "Copy"}
                      </Button>
                    </div>
                  ) : (
                    <p className="settings-phone-details__empty">
                      Turn on mobile mode and wait for the tailnet route.
                    </p>
                  )}
                  <p>
                    Sign your iPhone and this Mac into the same Tailscale network, then enter the desktop address on the app’s connect screen.
                  </p>
                  {handoff?.nativeHost ? (
                    <Button
                      size="xs"
                      variant="secondary"
                      leadingIcon="ph:desktop"
                      onClick={() =>
                        onUseAsHub(`http://${handoff.nativeHost}:8787`)
                      }
                    >
                      Use this device as hub
                    </Button>
                  ) : null}
                </div>
              </details>

              {error ? (
                <details className="settings-phone-technical">
                  <summary className="focus-ring">Technical details</summary>
                  <code>{error}</code>
                </details>
              ) : null}
            </div>
          </div>
        </section>

        <div className="settings-phone-side-stack">
          <IosInstallCard />
          <DesktopReachabilityCard />
          <section
            id={settingsGroupId("Why there’s no password")}
            data-settings-group
            className="settings-phone-card settings-phone-security"
          >
            <span className="settings-phone-security__mark" aria-hidden="true">
              <Icon name="ph:lock-simple-bold" width={14} />
            </span>
            <div>
              <h3>Why there’s no password</h3>
              <p>
                Being on your tailnet <em>is</em> the credential — the mobile API never leaves it, so there’s no token to copy.
              </p>
            </div>
          </section>
        </div>
      </div>

      <MobileWriteAccessCard />
    </section>
  );
}
