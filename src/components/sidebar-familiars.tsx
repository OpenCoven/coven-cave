"use client";

import { useEffect, useMemo, useState } from "react";
import type { Familiar, SessionRow } from "@/lib/types";
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
  sessions: SessionRow[];
  responseNeeded: Set<string>;
  onSelect: (id: string) => void;
  error?: string | null;
};

export function SidebarFamiliars({
  familiars,
  activeId,
  sessions,
  responseNeeded,
  onSelect,
  error,
}: Props) {
  const glyphOverrides = useGlyphOverrides();
  const [harnesses, setHarnesses] = useState<HarnessReport[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/harnesses", { cache: "no-store" });
        const json = await res.json();
        if (!cancelled && json.ok) setHarnesses(json.harnesses ?? []);
      } catch {
        /* harness availability unknown */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const current = familiars.find((f) => f.id === activeId) ?? null;

  const harnessReport = current
    ? harnesses.find((h) => h.id === current.harness) ?? null
    : null;

  const liveCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sessions) {
      if (!s.familiarId || s.status !== "running") continue;
      map.set(s.familiarId, (map.get(s.familiarId) ?? 0) + 1);
    }
    return map;
  }, [sessions]);

  if (error) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">{error}</p>;
  }

  if (familiars.length === 0) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">No familiars</p>;
  }

  return (
    <div className="flex flex-col gap-0.5">
      {familiars.map((f) => {
        const isActive = activeId === f.id;
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
          <button
            key={f.id}
            onClick={() => onSelect(f.id)}
            className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors ${
              isActive
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-card"
            }`}
          >
            <span className="grid h-5 w-5 shrink-0 place-items-center">
              <FamiliarGlyph
                glyph={resolveFamiliarGlyph(f, glyphOverrides)}
                size="sm"
              />
            </span>
            <span className="flex flex-1 flex-col min-w-0">
              <span className="truncate text-xs leading-tight">
                {f.display_name}
              </span>
              <span className="truncate text-[10px] text-muted-foreground leading-tight">
                {f.role}
              </span>
            </span>
            <span
              title={presence.label}
              className={`shrink-0 rounded px-1 py-px text-[8px] font-bold uppercase tracking-widest ${presence.pill}`}
            >
              {presence.label}
            </span>
          </button>
        );
      })}

      {current ? (
        <div className="mt-2 border-t border-border px-2 pt-2">
          <dl className="grid grid-cols-[52px_1fr] gap-y-0.5 text-[10px]">
            <dt className="text-muted-foreground">Harness</dt>
            <dd className="font-mono truncate text-foreground">
              {current.harness ?? "\u2014"}
              {harnessReport?.version ? (
                <span className="ml-1 text-muted-foreground">
                  {harnessReport.version.split(/\s/).pop()}
                </span>
              ) : null}
            </dd>
            <dt className="text-muted-foreground">Model</dt>
            <dd className="font-mono truncate text-foreground">
              {current.model ?? "\u2014"}
            </dd>
          </dl>
        </div>
      ) : null}
    </div>
  );
}
