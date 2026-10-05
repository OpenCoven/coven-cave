"use client";

import { useEffect, useRef, useState } from "react";
import { BottomTerminal, type TerminalHealth, type TerminalWriterHandle } from "@/components/bottom-terminal";
import { Modal } from "@/components/ui/modal";
import type { HarnessAuthFailure } from "@/lib/harness-failure";

/** The button click owns a new PTY. Credentials stay in the harness's own
 * interactive flow; Cave never reads or stores them as chat diagnostics. */
export function HarnessAuthTerminal({
  failure,
  onClose,
}: {
  failure: HarnessAuthFailure;
  onClose: () => void;
}) {
  const [threadId] = useState(() => `cave.auth.${crypto.randomUUID()}`);
  const writerRef = useRef<TerminalWriterHandle>(null);
  const startedRef = useRef(false);
  const [health, setHealth] = useState<TerminalHealth>("starting");
  const command = failure.loginCommand;

  useEffect(() => {
    if (health !== "healthy" || !command || startedRef.current) return;
    // BottomTerminal publishes its writer in the same async continuation that
    // marks the PTY healthy. The next task runs after that continuation ends.
    const timer = window.setTimeout(() => {
      if (!writerRef.current || startedRef.current) return;
      startedRef.current = true;
      writerRef.current.write(`${command}\r`);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [health, command]);

  return (
    <Modal open onClose={onClose} breadcrumb={["Connect", failure.harnessLabel ?? "Runtime"]} wide
      footerActions={
        <button type="button" className="focus-ring rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-[var(--text-primary)]" onClick={onClose}>
          Close terminal
        </button>
      }
    >
      <p className="mb-3 text-[length:var(--text-sm)] text-[var(--text-secondary)]">
        Complete sign-in here. {failure.harness === "claude" || failure.harness === "copilot"
          ? "If the CLI does not prompt, enter /login. " : ""}
        Close this terminal and retry the message when connected.
      </p>
      <div className="h-80 overflow-hidden rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)]">
        <BottomTerminal disposeOnUnmount threadId={threadId} label={`${failure.harnessLabel ?? "Runtime"} sign-in`} writerRef={writerRef} onHealthChange={setHealth} />
      </div>
    </Modal>
  );
}
