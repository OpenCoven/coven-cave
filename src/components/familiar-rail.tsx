"use client";

import type { Familiar } from "@/lib/types";

type Props = {
  familiars: Familiar[];
  activeId: string | null;
  onSelect: (id: string) => void;
  error?: string | null;
};

export function FamiliarRail({ familiars, activeId, onSelect, error }: Props) {
  const current = familiars.find((f) => f.id === activeId) ?? null;

  return (
    <aside className="flex h-full flex-col border-r border-zinc-800 bg-zinc-900/40">
      <header className="border-b border-zinc-800 px-4 py-3">
        <div className="text-xs uppercase tracking-widest text-zinc-500">Coven</div>
        <div className="text-sm font-semibold text-zinc-100">Familiars</div>
      </header>

      <ul className="flex-1 overflow-y-auto py-2">
        {familiars.length === 0 && !error ? (
          <li className="px-4 py-3 text-xs text-zinc-500">No familiars loaded yet…</li>
        ) : null}

        {error ? (
          <li className="mx-3 my-2 rounded-md border border-amber-700/40 bg-amber-900/20 px-3 py-2 text-xs text-amber-200">
            Familiars unavailable: {error}
          </li>
        ) : null}

        {familiars.map((f) => {
          const isActive = activeId === f.id;
          const online = f.status === "online";
          return (
            <li key={f.id}>
              <button
                onClick={() => onSelect(f.id)}
                className={`flex w-full items-center gap-3 px-4 py-2 text-left transition-colors ${
                  isActive
                    ? "bg-zinc-800/80 text-zinc-50"
                    : "text-zinc-300 hover:bg-zinc-800/40"
                }`}
              >
                <span className="text-lg leading-none">{f.emoji}</span>
                <span className="flex flex-1 flex-col min-w-0">
                  <span className="flex items-center gap-1.5 truncate">
                    <span className="truncate">{f.display_name}</span>
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        online ? "bg-emerald-400" : "bg-zinc-600"
                      }`}
                    />
                  </span>
                  <span className="truncate text-[10px] uppercase tracking-widest text-zinc-500">
                    {f.role}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {current ? (
        <section className="border-t border-zinc-800 px-4 py-3 text-xs">
          <div className="mb-2 text-zinc-500">Configurator</div>
          <dl className="grid grid-cols-[88px_1fr] gap-y-1 text-zinc-300">
            <dt className="text-zinc-500">Status</dt>
            <dd className="font-mono">{current.status ?? "—"}</dd>
            <dt className="text-zinc-500">Last seen</dt>
            <dd className="font-mono truncate">{current.last_seen ?? "—"}</dd>
            <dt className="text-zinc-500">Sessions</dt>
            <dd className="font-mono">{current.active_sessions ?? 0}</dd>
            <dt className="text-zinc-500">Memory</dt>
            <dd className="font-mono truncate">{current.memory_freshness ?? "—"}</dd>
          </dl>
        </section>
      ) : null}
    </aside>
  );
}
