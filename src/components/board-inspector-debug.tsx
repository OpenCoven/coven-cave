"use client";

import { useState } from "react";
import type { Card } from "@/lib/cave-board-types";
import { Icon } from "@/lib/icon";
import { useCopy } from "@/lib/use-copy";

const DEFAULT_TIMEOUT_MS = 2 * 60 * 60 * 1000;

function DebugKVRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="[display:flex]! [align-items:baseline]! [justify-content:space-between]! [gap:10px]! [padding:2px_0]! [font-size:var(--text-xs)]!">
      <span className="[flex-shrink:0]! [color:var(--text-muted)]!">{k}</span>
      <span
        className="[min-width:0]! [overflow:hidden]! [text-overflow:ellipsis]! [white-space:nowrap]! [font-family:ui-monospace,_monospace]! [font-size:var(--text-xs)]! [color:var(--text-secondary)]!"
        title={v}
      >
        {v}
      </span>
    </div>
  );
}

function CopyJsonButton({ getText }: { getText: () => string }) {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      className="board-toolbar-btn [font-size:var(--text-2xs)]! [padding:2px_var(--space-2)]!"
      onClick={() => copy(getText())}
    >
      <Icon name={copied ? "ph:check-bold" : "ph:copy"} width={10} />
      {copied ? "Copied" : "Copy JSON"}
    </button>
  );
}

/** Collapsed raw-card diagnostics, isolated from the edit form's controlled state. */
export function BoardInspectorDebug({ card }: { card: Card }) {
  const [open, setOpen] = useState(false);
  const timeoutMs = card.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const rows: Array<[string, string]> = [
    ["card id", card.id],
    ["session", card.sessionId ?? "—"],
    ["project", card.projectId ?? "—"],
    ["cwd", card.cwd ?? "—"],
    ["template", card.template ?? "—"],
    [
      "lifecycle",
      card.lifecycleAt ? `${card.lifecycle} · since ${card.lifecycleAt}` : card.lifecycle,
    ],
    ["retries", `${card.retryCount}/${card.maxRetries}`],
    ["timeout", timeoutMs % 60_000 === 0 ? `${timeoutMs / 60_000}m` : `${timeoutMs}ms`],
    ["needs human", card.needsHuman ? "yes" : "no"],
  ];

  return (
    <div className="board-drawer-field">
      <div className="board-drawer-field-label [display:flex]! [align-items:center]! [justify-content:space-between]!">
        <span className="[display:inline-flex]! [align-items:center]! [gap:5px]!">
          <Icon name="ph:bug-bold" width={11} />
          Debug
        </span>
        <button
          type="button"
          className="board-toolbar-btn [font-size:var(--text-2xs)]! [padding:2px_var(--space-2)]!"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          title={open ? "Hide debug details" : "Show debug details"}
        >
          <Icon name={open ? "ph:caret-up" : "ph:caret-down"} width={11} />
          {open ? "Hide" : "Show"}
        </button>
      </div>
      {open ? (
        <div className="[display:flex]! [flex-direction:column]! [gap:var(--space-2)]!">
          <div className="[padding:var(--space-2)_10px]! [border-radius:10px]! [border:1px_solid_var(--border-hairline)]! [background:var(--bg-base)]!">
            {rows.map(([k, v]) => (
              <DebugKVRow key={k} k={k} v={v} />
            ))}
          </div>
          <div className="[display:flex]! [align-items:center]! [justify-content:space-between]!">
            <span className="[font-size:var(--text-2xs)]! [color:var(--text-muted)]!">Raw card</span>
            <CopyJsonButton getText={() => JSON.stringify(card, null, 2)} />
          </div>
          <pre className="[max-height:260px]! [overflow:auto]! [white-space:pre-wrap]! [word-break:break-word]! [margin:0]! [padding:var(--space-2)]! [border-radius:var(--radius-control)]! [border:1px_solid_var(--border-hairline)]! [background:var(--bg-base)]! [font-family:ui-monospace,_monospace]! [font-size:var(--text-2xs)]! [line-height:1.5]! [color:var(--text-secondary)]!">
            {JSON.stringify(card, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
