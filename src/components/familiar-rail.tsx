"use client";

import type { Familiar, SessionRow } from "@/lib/types";
import { useEffect, useMemo, useState } from "react";
import { computePresence, REMOTE_HARNESSES } from "@/lib/presence";
import { resolveFamiliarGlyph } from "@/lib/familiar-glyph";
import { useGlyphOverrides } from "@/lib/cave-glyph-overrides";
import { FamiliarGlyph } from "@/components/familiar-glyph";

type HarnessReport = {
  id: string;
  label: string;
  installed: boolean;
  chatSupported: boolean;
  version: string | null;
};

type Props = {
  familiars: Familiar[];
  activeId: string | null;
  onSelect: (id: string) => void;
  /** Right-click on a row opens the glyph picker for that familiar. */
  onEditGlyph?: (familiar: Familiar) => void;
  error?: string | null;
  sessions: SessionRow[];
  responseNeeded: Set<string>;
  onOpenOnboarding?: () => void;
};

export function FamiliarRail({
  familiars,
  activeId,
  onSelect,
  onEditGlyph,
  error,
  sessions,
  responseNeeded,
  onOpenOnboarding,
}: Props) {
  const glyphOverrides = useGlyphOverrides();
  const current = familiars.find((f) => f.id === activeId) ?? null;
  const [harnesses, setHarnesses] = useState<HarnessReport[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/harnesses", { cache: "no-store" });
        const json = await res.json();
        if (!cancelled && json.ok) setHarnesses(json.harnesses ?? []);
      } catch {
        /* keep empty — UI just won't show availability */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const harnessReport = current
    ? harnesses.find((h) => h.id === current.harness) ?? null
    : null;

  // Compute presence for the currently selected familiar so the configurator
  // panel can show session-derived status instead of the raw daemon string.
  const currentPresence = current
    ? computePresence({
        familiar: current,
        sessions,
        needsReply: responseNeeded.has(current.id),
        harnessInstalled: current.harness
          ? harnesses.find((h) => h.id === current.harness)?.installed
          : undefined,
        isRemoteHarness: current.harness ? REMOTE_HARNESSES.has(current.harness) : false,
      })
    : null;

  const liveCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sessions) {
      if (!s.familiarId || s.status !== "running") continue;
      map.set(s.familiarId, (map.get(s.familiarId) ?? 0) + 1);
    }
    return map;
  }, [sessions]);

  return (
    <aside className="flex h-full flex-col border-r border-border bg-background">
      <header className="border-b border-border px-4 py-3">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Coven</div>
        <div className="text-sm font-semibold text-foreground">Familiars</div>
      </header>

      <ul className="flex-1 overflow-y-auto py-2">
        {familiars.length === 0 && !error ? (
          <li className="mx-3 my-2 rounded-md border border-border bg-card px-3 py-2.5 text-xs text-foreground">
            <div className="font-medium">No familiars yet</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              Run setup to scaffold the canonical roster.
            </div>
            {onOpenOnboarding ? (
              <button
                onClick={onOpenOnboarding}
                className="mt-2 w-full rounded border border-border bg-muted px-2 py-1 text-[11px] text-foreground transition-colors hover:bg-card"
              >
                Open setup →
              </button>
            ) : null}
          </li>
        ) : null}

        {error ? (
          <li className="mx-3 my-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
            <div>Familiars unavailable: {error}</div>
            {onOpenOnboarding ? (
              <button
                onClick={onOpenOnboarding}
                className="mt-2 w-full rounded border border-border bg-muted px-2 py-1 text-[11px] text-foreground transition-colors hover:bg-card"
              >
                Open setup →
              </button>
            ) : null}
          </li>
        ) : null}

        {familiars.map((f) => {
          const isActive = activeId === f.id;
          const liveCount = liveCounts.get(f.id) ?? 0;
          const needsReply = responseNeeded.has(f.id);
          const harnessInstalled = f.harness
            ? harnesses.find((h) => h.id === f.harness)?.installed
            : undefined;
          const isRemoteHarness = f.harness ? REMOTE_HARNESSES.has(f.harness) : false;
          const presence = computePresence({
            familiar: f,
            sessions,
            needsReply,
            harnessInstalled,
            isRemoteHarness,
          });
          return (
            <li key={f.id}>
              <button
                onClick={() => onSelect(f.id)}
                onContextMenu={(e) => {
                  if (!onEditGlyph) return;
                  e.preventDefault();
                  onEditGlyph(f);
                }}
                className={`flex w-full items-center gap-3 px-4 py-2 text-left transition-colors ${
                  isActive
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-card"
                }`}
                title={onEditGlyph ? "Right-click to change glyph" : undefined}
              >
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    if (!onEditGlyph) return;
                    e.stopPropagation();
                    onEditGlyph(f);
                  }}
                  className="grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-md bg-card transition-colors hover:bg-muted"
                  aria-label="Change glyph"
                  title="Change glyph"
                >
                  <FamiliarGlyph
                    glyph={resolveFamiliarGlyph(f, glyphOverrides)}
                    size="sm"
                  />
                </span>
                <span className="flex flex-1 flex-col min-w-0">
                  <span className="flex items-center gap-1.5 truncate">
                    <span className="truncate">{f.display_name}</span>
                    <span
                      title={`${presence.label}${liveCount > 0 ? ` · ${liveCount} live` : ""}`}
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${presence.dot} ${
                        presence.state === "focused" || presence.state === "blocked"
                          ? "animate-pulse"
                          : ""
                      }`}
                    />
                    <span
                      title={presence.label}
                      className={`ml-auto rounded px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-widest ${presence.pill}`}
                    >
                      {presence.label}
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5 truncate text-[10px] uppercase tracking-widest text-muted-foreground">
                    <span className="truncate">{f.role}</span>
                    {liveCount > 0 ? (
                      <span className="rounded border border-border bg-card px-1 font-mono text-foreground">
                        {liveCount}
                      </span>
                    ) : null}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {current ? (
        <section className="border-t border-border px-4 py-3 text-xs">
          <div className="mb-2 flex items-center justify-between text-muted-foreground">
            <span>Configurator</span>
            {harnessReport ? (
              <span
                title={
                  !harnessReport.installed
                    ? `${harnessReport.label} not installed on this machine`
                    : harnessReport.chatSupported
                      ? "Native chat is wired for this harness"
                      : `${harnessReport.label} is installed but chat isn't wired yet — open in TUI`
                }
                className="rounded border border-border bg-card px-1.5 py-px text-[9px] uppercase tracking-widest text-muted-foreground"
              >
                {!harnessReport.installed
                  ? "missing"
                  : harnessReport.chatSupported
                    ? "chat ready"
                    : "tui only"}
              </span>
            ) : null}
          </div>
          <dl className="grid grid-cols-[72px_1fr] gap-y-1 text-foreground">
            <dt className="text-muted-foreground">Harness</dt>
            <dd className="font-mono truncate" title={harnessReport?.version ?? undefined}>
              {current.harness ?? "—"}
              {harnessReport?.version ? (
                <span className="ml-1 text-[10px] text-muted-foreground">
                  {harnessReport.version.split(/\s/).pop()}
                </span>
              ) : null}
            </dd>
            <dt className="text-muted-foreground">Model</dt>
            <dd className="font-mono truncate" title={current.model}>
              {current.model ?? "—"}
            </dd>
            <dt className="text-muted-foreground">Presence</dt>
            <dd className="font-mono">
              {currentPresence ? (
                <span className={`rounded px-1.5 py-px text-[9px] font-bold uppercase tracking-widest ${currentPresence.pill}`}>
                  {currentPresence.label}
                </span>
              ) : "—"}
            </dd>
            <dt className="text-muted-foreground">Sessions</dt>
            <dd className="font-mono">{liveCounts.get(current.id) ?? 0} live</dd>
            <dt className="text-muted-foreground">Memory</dt>
            <dd className="font-mono truncate">{current.memory_freshness ?? "—"}</dd>
          </dl>
        </section>
      ) : null}
    </aside>
  );
}
