"use client";

/**
 * Inline fix actions for a parsed harness/runtime failure (cave-noox).
 *
 * Every surface that shows a daemon harness error (chat error strip, group
 * chat error replies, board task-chat errors) renders this row instead of a
 * dead-end message: one "Use <Adapter>" button per switch target, and a
 * "Copy fix command" button when the error quotes `coven adapter …` commands.
 *
 * Style-neutral on purpose — hosts pass `buttonClassName` so the buttons
 * inherit the surrounding strip/bubble/banner chrome.
 */

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { copyText } from "@/lib/clipboard";
import {
  harnessFixCommand,
  harnessSwitchTargets,
  type HarnessFailure,
} from "@/lib/harness-failure";

const DEFAULT_BTN =
  "focus-ring inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)]/50 px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] disabled:opacity-40";

export function HarnessFixActions({
  failure,
  busy = false,
  onUseHarness,
  buttonClassName,
  className,
}: {
  failure: HarnessFailure;
  /** Disables the buttons while the host is already switching/retrying. */
  busy?: boolean;
  /** Switch the failing familiar to this adapter id (host PATCHes config + retries). */
  onUseHarness?: (harnessId: string) => void | Promise<void>;
  /** Host-supplied button chrome so the row matches the surrounding surface. */
  buttonClassName?: string;
  className?: string;
}) {
  const targets = onUseHarness ? harnessSwitchTargets(failure) : [];
  const command = harnessFixCommand(failure);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  if (targets.length === 0 && !command) return null;

  const btn = buttonClassName ?? DEFAULT_BTN;

  return (
    <span className={`flex flex-wrap items-center gap-1 ${className ?? ""}`}>
      {targets.map((target) => (
        <button
          key={target.id}
          type="button"
          className={btn}
          disabled={busy}
          onClick={() => void onUseHarness?.(target.id)}
          title={`Switch this familiar to ${target.label} and retry`}
        >
          <Icon name="ph:plugs" width={11} aria-hidden />
          Use {target.label}
        </button>
      ))}
      {command ? (
        <button
          type="button"
          className={btn}
          disabled={busy}
          onClick={() => {
            void copyText(command).then((ok) => {
              if (!ok) return;
              setCopied(true);
              if (copiedTimer.current) clearTimeout(copiedTimer.current);
              copiedTimer.current = setTimeout(() => setCopied(false), 1500);
            });
          }}
          title={command}
        >
          <Icon name={copied ? "ph:check-bold" : "ph:terminal-window"} width={11} aria-hidden />
          {copied ? "Copied" : "Copy fix command"}
        </button>
      ) : null}
    </span>
  );
}
