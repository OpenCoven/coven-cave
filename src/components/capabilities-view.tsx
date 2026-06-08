"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/lib/icon";
import {
  CapabilitiesView as CapabilitiesGrid,
  type HarnessCapabilityManifest,
} from "@/components/capability-card";

type CovenSkill = {
  id: string;
  name: string;
  description?: string;
  version?: string;
  tags?: string[];
};

type CapabilitiesResponse = {
  ok: boolean;
  coven_skills?: CovenSkill[];
  harness_capabilities?: HarnessCapabilityManifest[];
  scanned_at?: string;
  error?: string;
};

const HARNESS_LABEL: Record<string, string> = {
  codex: "Codex",
  claude: "Claude Code",
  cursor: "Cursor",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
  "coven-code": "Coven Code",
  copilot: "GitHub Copilot",
};

function harnessLabel(id: string): string {
  return HARNESS_LABEL[id] ?? id;
}

export function CapabilitiesViewSurface({
  activeHarness,
}: {
  activeHarness?: string | null;
}) {
  const [items, setItems] = useState<HarnessCapabilityManifest[]>([]);
  const [covenSkills, setCovenSkills] = useState<CovenSkill[]>([]);
  const [scannedAt, setScannedAt] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<string | null>(activeHarness ?? null);

  const load = useCallback(async (refresh = false) => {
    setRefreshing(refresh);
    if (!refresh) setLoaded(false);
    try {
      const url = refresh ? "/api/capabilities?refresh=1" : "/api/capabilities";
      const res = await fetch(url, { cache: "no-store" });
      const json = (await res.json()) as CapabilitiesResponse;
      if (!json.ok) {
        setError(json.error ?? `daemon http ${res.status}`);
        setItems([]);
        setCovenSkills([]);
        setScannedAt(null);
      } else {
        setError(null);
        setItems(json.harness_capabilities ?? []);
        setCovenSkills(json.coven_skills ?? []);
        setScannedAt(json.scanned_at ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "fetch failed");
      setItems([]);
      setCovenSkills([]);
      setScannedAt(null);
    } finally {
      setLoaded(true);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    if (activeHarness !== undefined) setFilter(activeHarness ?? null);
  }, [activeHarness]);

  const visible = filter
    ? items.filter((m) => m.harness_id === filter)
    : items;

  const totalSkills = items.reduce((sum, m) => sum + m.skills.length, 0);
  const totalPlugins = items.reduce((sum, m) => sum + m.plugins.length, 0);
  const totalAgentsMd = items.filter((m) => m.global_instructions.present).length;
  const totalWarnings = items.reduce((sum, m) => sum + m.warnings.length, 0);

  return (
    <div className="flex h-full min-w-0 flex-col bg-background text-foreground">
      <header className="shrink-0 border-b border-border px-4 sm:px-8">
        <div className="flex h-12 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Icon name="ph:lightning-bold" width={14} className="text-muted-foreground" />
            <h1 className="truncate text-[13px] font-medium text-foreground">Capabilities</h1>
            <span className="text-[11px] text-muted-foreground">read-only</span>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
            {scannedAt && (
              <span title={scannedAt}>
                Scanned {new Date(scannedAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={refreshing}
              className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              <Icon
                name="ph:arrows-clockwise-bold"
                width={11}
                className={refreshing ? "animate-spin" : undefined}
              />
              <span>{refreshing ? "Refreshing" : "Refresh"}</span>
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1200px] px-4 pb-12 sm:px-8">
          <div className="pb-4 pt-6">
            <h2 className="text-[20px] font-semibold text-[var(--text-primary)]">
              Harness capabilities
            </h2>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Per-harness manifest of skills, plugins, global instructions, and version detected
              by the Coven daemon. Read-only — edits happen in the harness&apos;s own config files.
            </p>
          </div>

          {loaded && !error && items.length > 0 && (
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <SummaryTile
                icon="ph:cube-bold"
                label="Harnesses"
                value={items.length.toString()}
              />
              <SummaryTile
                icon="ph:note-pencil"
                label="With AGENTS.md"
                value={`${totalAgentsMd}/${items.length}`}
              />
              <SummaryTile icon="ph:sparkle" label="Skills" value={totalSkills.toString()} />
              <SummaryTile icon="ph:plug" label="Plugins" value={totalPlugins.toString()} />
            </div>
          )}

          {loaded && !error && items.length > 1 && (
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              <FilterPill
                label="All"
                count={items.length}
                active={filter === null}
                onClick={() => setFilter(null)}
              />
              {items.map((m) => (
                <FilterPill
                  key={m.harness_id}
                  label={harnessLabel(m.harness_id)}
                  count={
                    (m.global_instructions.present ? 1 : 0) +
                    m.skills.length +
                    m.plugins.length
                  }
                  active={filter === m.harness_id}
                  onClick={() =>
                    setFilter(filter === m.harness_id ? null : m.harness_id)
                  }
                />
              ))}
            </div>
          )}

          {loaded && !error && totalWarnings > 0 && filter === null && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2 text-[11px] text-muted-foreground">
              <Icon name="ph:warning-fill" width={12} className="mt-0.5 shrink-0" />
              <span>
                {totalWarnings} parse warning{totalWarnings === 1 ? "" : "s"} across
                harness configs — expand a harness below to see details.
              </span>
            </div>
          )}

          <CapabilitiesGrid
            items={visible}
            loaded={loaded}
            error={error}
            onRefresh={() => void load(true)}
          />

          {loaded && !error && covenSkills.length > 0 && filter === null && (
            <section className="mt-8">
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                Coven skills · {covenSkills.length}
              </h3>
              <p className="mb-3 text-[12px] text-muted-foreground">
                Skills shipped with the Coven daemon and available to every familiar.
              </p>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {covenSkills.map((s) => (
                  <li
                    key={s.id}
                    className="rounded-lg border border-border bg-card px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Icon
                        name="ph:sparkle"
                        width={11}
                        className="shrink-0 text-muted-foreground"
                      />
                      <p className="min-w-0 truncate text-[12px] font-medium text-foreground">
                        {s.name}
                      </p>
                      {s.version && (
                        <span className="rounded-full bg-muted px-1.5 py-px text-[9px] text-muted-foreground">
                          v{s.version}
                        </span>
                      )}
                    </div>
                    {s.description && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {s.description}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryTile({
  icon,
  label,
  value,
}: {
  icon: Parameters<typeof Icon>[0]["name"];
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon name={icon} width={11} />
        <span className="text-[10px] uppercase tracking-widest">{label}</span>
      </div>
      <p className="mt-1 text-[18px] font-semibold tabular-nums text-foreground">
        {value}
      </p>
    </div>
  );
}

function FilterPill({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
      aria-pressed={active}
    >
      <span>{label}</span>
      <span
        className={`rounded-full px-1.5 py-px text-[9px] ${
          active ? "bg-background/20 text-background" : "bg-muted text-muted-foreground"
        }`}
      >
        {count}
      </span>
    </button>
  );
}
