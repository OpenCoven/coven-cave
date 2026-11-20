"use client";

import { useState } from "react";
import { BottomTerminal } from "@/components/bottom-terminal";
import { Modal } from "@/components/ui/modal";
import type { HarnessAuthFailure } from "@/lib/harness-failure";

/** The button click owns a new PTY. Credentials stay in the harness's own
 * interactive flow; Cave never reads or stores them as chat diagnostics. */
export function HarnessAuthTerminal({
  failure,
  onClose,
  intent = "connect",
}: {
  failure: HarnessAuthFailure;
  onClose: () => void;
  intent?: "connect" | "switch-account";
}) {
  const [threadId] = useState(() => `cave.auth.${crypto.randomUUID()}`);
  const [deviceLogin, setDeviceLogin] = useState(false);
  const command = deviceLogin ? "codex login --device-auth" : failure.loginCommand;

  return (
    <Modal open onClose={onClose} breadcrumb={[intent === "switch-account" ? "Switch account" : "Connect", failure.harnessLabel ?? "Runtime"]} wide
      footerActions={
        <button type="button" className="focus-ring rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-[var(--text-primary)]" onClick={onClose}>
          Close terminal
        </button>
      }
    >
      <p className="mb-3 text-[length:var(--text-sm)] text-[var(--text-secondary)]">
        {deviceLogin ? (
          <>Open the address shown below on the device with your passkey or security key. Enter the code there, then close this terminal when sign-in finishes.</>
        ) : intent === "switch-account" ? (
          <>Choose your other {failure.harnessLabel ?? "runtime"} account in the sign-in page. This changes the sign-in used by
            other local {failure.harnessLabel ?? "runtime"} CLI launches, not only this chat. Existing running sessions keep
            their current account. API keys or Vault credentials can override CLI sign-in.
            Check the account printed here after sign-in, then close the terminal and send your next message.</>
        ) : <>Complete sign-in here. {failure.harness === "claude" || failure.harness === "copilot"
          ? "If the CLI does not prompt, enter /login. " : ""}
        Close this terminal and retry the message when connected.</>}
      </p>
      {intent === "connect" && failure.harness === "codex" && !deviceLogin ? (
        <button type="button" className="focus-ring mb-3 rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-[var(--text-primary)]" onClick={() => setDeviceLogin(true)}>
          Sign in on another device
        </button>
      ) : null}
      <div className="h-80 overflow-hidden rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)]">
        <BottomTerminal key={deviceLogin ? "device" : "local"} useServerPty disposeOnUnmount threadId={deviceLogin ? `${threadId}.device` : threadId} label={`${failure.harnessLabel ?? "Runtime"} sign-in`}
          onReady={(writer) => { if (command) writer.write(`${command}\r`); }} />
      </div>
    </Modal>
  );
}
