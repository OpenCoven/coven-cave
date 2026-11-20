"use client";

import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { Modal } from "@/components/ui/modal";

/** Keep the server's safe error envelope through the action boundary. */
export class XPublishError extends Error {
  constructor(message: string, readonly code?: string, readonly retryAt?: string) {
    super(message);
  }
}

type Recovery = { title: string; hint: string; settings?: boolean };

export function xPublishRecovery(error: Error): Recovery {
  switch (error instanceof XPublishError ? error.code : undefined) {
    case "not-connected":
      return { title: "Connect X to publish", hint: "Your wording is still here. Connect an account, then review it again before publishing.", settings: true };
    case "unauthorized":
    case "oauth-expired":
      return { title: "Reconnect X to continue", hint: "X access has expired or changed. Reconnect, then review the account and wording again.", settings: true };
    case "missing-scope":
      return { title: "Allow publishing on X", hint: "Reconnect X to approve publishing access, then review the account and wording again.", settings: true };
    case "capability-disabled":
      return { title: "Allow publishing on X", hint: "Open X settings and allow publishing for this familiar, then review your wording again.", settings: true };
    case "not-configured":
      return { title: "X needs to be set up", hint: "Your wording is still here. Open X settings to check what this installation needs.", settings: true };
    case "oauth-in-progress":
    case "oauth-port-in-use":
      return { title: "Finish connecting X", hint: "Check the connection in X settings, then return to review your wording.", settings: true };
    case "rate-limited":
      return { title: "X is limiting requests", hint: "Your wording is still here. Wait for the limit to reset, then review again. Nothing retries automatically." };
    case "billing-unavailable":
      return { title: "X needs a billing update", hint: "Check the app's credits or billing in the X developer console, then return to review your wording." };
    case "upstream-unavailable":
      return { title: "X is temporarily unavailable", hint: "Your wording is still here. Check your account on X before trying again. Nothing retries automatically." };
    case "ambiguous-write":
    case "invalid-response":
    case "connection-lost":
      return { title: "Check whether your post appeared", hint: "The outcome could not be confirmed. Check your account on X and settle any uncertain attempt below before posting again." };
    default:
      return { title: "This action couldn't be completed", hint: error.message || "Your wording is still here. Check post history, then review again." };
  }
}

export function XPublishRecovery({ error, connectionSettings, busy }: {
  error: Error;
  connectionSettings?: ReactNode;
  busy: boolean;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const recovery = xPublishRecovery(error);
  const retryAt = error instanceof XPublishError && error.code === "rate-limited"
    && error.retryAt && Number.isFinite(Date.parse(error.retryAt)) ? error.retryAt : null;
  return (
    <>
      <ErrorState
        compact
        live={false}
        icon={recovery.settings ? "ph:plugs" : "ph:info"}
        headline={recovery.title}
        subtitle={(
          <>
            {recovery.hint}
            {retryAt && <> Try after <time dateTime={retryAt}>{new Date(retryAt).toLocaleString()}</time>.</>}
          </>
        )}
        actions={recovery.settings && connectionSettings ? (
          <Button
            ref={settingsTrigger}
            size="sm"
            disabled={busy}
            onClick={() => {
              // Safari does not focus clicked buttons. Give Modal a stable
              // return target before it captures the active element.
              settingsTrigger.current?.focus();
              setSettingsOpen(true);
            }}
          >
            Open X settings
          </Button>
        ) : undefined}
      />
      {settingsOpen && (
        <Modal
          open
          breadcrumb={["X connection settings"]}
          onClose={() => setSettingsOpen(false)}
          footerActions={<Button onClick={() => setSettingsOpen(false)}>Back to draft</Button>}
        >
          {connectionSettings}
        </Modal>
      )}
    </>
  );
}
