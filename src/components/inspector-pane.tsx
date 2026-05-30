"use client";

import { useState } from "react";
import type { Familiar } from "@/lib/types";

type Tab = "memory" | "tools";

type Props = { familiar: Familiar | null };

export function InspectorPane({ familiar }: Props) {
  const [tab, setTab] = useState<Tab>("memory");

  return (
    <aside className="flex h-full flex-col border-l border-zinc-800 bg-zinc-900/40">
      <nav className="flex border-b border-zinc-800 text-xs">
        {(["memory", "tools"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 px-4 py-3 uppercase tracking-widest transition-colors ${
              tab === t
                ? "border-b-2 border-violet-500 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto p-4 text-sm">
        {!familiar ? (
          <p className="text-xs text-zinc-600">Select a familiar to inspect.</p>
        ) : tab === "memory" ? (
          <div className="space-y-3 text-xs text-zinc-300">
            <p className="text-zinc-500">Memory inspector — live wiring pending.</p>
            <dl className="grid grid-cols-[88px_1fr] gap-y-1">
              <dt className="text-zinc-500">Freshness</dt>
              <dd className="font-mono">{familiar.memory_freshness ?? "—"}</dd>
              <dt className="text-zinc-500">Last seen</dt>
              <dd className="font-mono truncate">{familiar.last_seen ?? "—"}</dd>
            </dl>
          </div>
        ) : (
          <div className="space-y-3 text-xs text-zinc-300">
            <p className="text-zinc-500">MCP / tool inspector — daemon endpoint pending.</p>
          </div>
        )}
      </div>
    </aside>
  );
}
