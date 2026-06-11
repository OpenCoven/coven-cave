"use client";

import { useEffect, useMemo, useState } from "react";
import type { Familiar } from "@/lib/types";

type FailureDistillation = {
  id: string;
  type: string;
  title: string;
  date: string;
  severity: string;
  domain: string;
  status: string;
  path: string;
  body: string;
  sections: Record<string, string>;
  wikilinks: string[];
};

type MemoryTierHealth = {
  path: string;
  exists: boolean;
  modified: string | null;
  size: number | null;
  writeAuthority: "workspace" | "familiar";
};

type DreamArtifactSummary = {
  path: string;
  exists: boolean;
  modified: string | null;
  updatedAt: string | null;
  entryCount: number;
  topLevelKeys: string[];
};

type MemoryInspectorReport = {
  ok: true;
  familiarId: string;
  workspacePath: string;
  failures: FailureDistillation[];
  memoryTier: MemoryTierHealth;
  dreams: {
    active: boolean;
    phaseSignals: DreamArtifactSummary | null;
    shortTermRecall: DreamArtifactSummary | null;
  };
};

type FilterKey = "severity" | "domain" | "status";
type Filters = Record<FilterKey, string>;

const BODY_SECTIONS = ["Signal", "What happened", "Root cause", "Lesson", "Watch for"];

const EMPTY_FILTERS: Filters = {
  severity: "all",
  domain: "all",
  status: "all",
};

function compactPath(filePath: string): string {
  return filePath.replace(/^\/Users\/[^/]+/, "~");
}

function formatDate(value: string | null): string {
  if (!value) return "missing";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export function MemoryInspectorPanel({ familiar }: { familiar: Familiar | null }) {
  const familiarId = familiar?.id ?? "main";
  const [report, setReport] = useState<MemoryInspectorReport | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setError(null);
    setSelectedId(null);
    setFilters(EMPTY_FILTERS);
    void (async () => {
      try {
        const res = await fetch(`/api/memory/inspector?familiarId=${encodeURIComponent(familiarId)}`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (cancelled) return;
        if (json.ok) {
          setReport(json as MemoryInspectorReport);
          setSelectedId(((json as MemoryInspectorReport).failures[0] ?? null)?.id ?? null);
        } else {
          setError(json.error ?? "memory inspector failed");
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "fetch failed");
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [familiarId]);

  const failures = report?.failures ?? [];
  const options = useMemo(() => {
    const by = (key: FilterKey) => [...new Set(failures.map((entry) => entry[key]).filter(Boolean))].sort();
    return {
      severity: by("severity"),
      domain: by("domain"),
      status: by("status"),
    };
  }, [failures]);

  const filtered = useMemo(() => {
    return failures.filter((entry) => {
      return (
        (filters.severity === "all" || entry.severity === filters.severity) &&
        (filters.domain === "all" || entry.domain === filters.domain) &&
        (filters.status === "all" || entry.status === filters.status)
      );
    });
  }, [failures, filters]);

  const selected = useMemo(() => {
    return filtered.find((entry) => entry.id === selectedId) ?? filtered[0] ?? null;
  }, [filtered, selectedId]);

  if (!loaded) {
    return <p className="p-4 text-xs text-[var(--text-muted)]">Loading memory inspector…</p>;
  }

  if (error) {
    return <p className="p-4 text-xs text-[var(--color-warning)]">Memory Inspector unavailable: {error}</p>;
  }

  if (!report) {
    return <p className="p-4 text-xs text-[var(--text-muted)]">No memory inspector report.</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col text-xs">
      <div className="border-b border-[var(--border-hairline)] p-3">
        <p className="text-[11px] uppercase tracking-widest text-[var(--text-muted)]">
          {familiar?.display_name ?? "Main"} memory
        </p>
        <p className="mt-1 truncate font-mono text-[10px] text-[var(--text-muted)]">
          {compactPath(report.workspacePath)}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2 border-b border-[var(--border-hairline)] p-2">
        <MemoryTierCard tier={report.memoryTier} />
        <DreamsCard dreams={report.dreams} />
      </div>

      {/* Filters and the list/detail panes are noise when the workspace has
          no failure distillations — collapse to a single quiet line. */}
      {failures.length === 0 ? (
        <p className="p-3 text-[11px] text-[var(--text-muted)]">
          No failure distillations yet.
        </p>
      ) : (
        <>
          <FilterBar filters={filters} options={options} onChange={setFilters} />

          <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <FailureList
              failures={filtered}
              selectedId={selected?.id ?? null}
              onSelect={setSelectedId}
            />
            <FailureDetail
              failure={selected}
              allFailures={failures}
              onNavigate={setSelectedId}
            />
          </div>
        </>
      )}
    </div>
  );
}

function MemoryTierCard({ tier }: { tier: MemoryTierHealth }) {
  return (
    <div className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-2 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-[var(--text-primary)]">MEMORY.md tier</span>
        <span className="rounded bg-[var(--bg-raised)] px-1 py-px text-[9px] uppercase tracking-widest text-[var(--text-muted)]">
          {tier.writeAuthority}
        </span>
      </div>
      <p className="mt-1 truncate font-mono text-[10px] text-[var(--text-muted)]">{compactPath(tier.path)}</p>
      <p className="mt-1 text-[10px] text-[var(--text-secondary)]">
        {tier.exists
          ? `last modified ${formatDate(tier.modified)} · ${Math.round((tier.size ?? 0) / 1024)} KB`
          : "not created yet"}
      </p>
    </div>
  );
}

function DreamsCard({ dreams }: { dreams: MemoryInspectorReport["dreams"] }) {
  return (
    <div className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-2 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-[var(--text-primary)]">Dream cycle</span>
        <span className="rounded bg-[var(--bg-raised)] px-1 py-px text-[9px] uppercase tracking-widest text-[var(--text-muted)]">
          {dreams.active ? "active" : "inactive"}
        </span>
      </div>
      {!dreams.active ? (
        <p className="mt-1 text-[10px] text-[var(--text-muted)]">dream cycle inactive</p>
      ) : (
        <div className="mt-1 grid grid-cols-2 gap-1">
          <DreamArtifact label="Phase" artifact={dreams.phaseSignals} />
          <DreamArtifact label="Recall" artifact={dreams.shortTermRecall} />
        </div>
      )}
    </div>
  );
}

function DreamArtifact({ label, artifact }: { label: string; artifact: DreamArtifactSummary | null }) {
  if (!artifact?.exists) {
    return <span className="rounded bg-[var(--bg-base)] px-2 py-1 text-[10px] text-[var(--text-muted)]">{label}: missing</span>;
  }
  return (
    <span className="rounded bg-[var(--bg-base)] px-2 py-1 text-[10px] text-[var(--text-secondary)]">
      {label}: {artifact.entryCount} signal{artifact.entryCount === 1 ? "" : "s"}
    </span>
  );
}

function FilterBar({
  filters,
  options,
  onChange,
}: {
  filters: Filters;
  options: Record<FilterKey, string[]>;
  onChange: (filters: Filters) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-1 border-b border-[var(--border-hairline)] p-2">
      {(["severity", "domain", "status"] as const).map((key) => (
        <select
          key={key}
          value={filters[key]}
          onChange={(e) => onChange({ ...filters, [key]: e.target.value })}
          className="min-w-0 rounded border border-[var(--border-hairline)] bg-[var(--bg-base)] px-1 py-1 text-[10px] text-[var(--text-primary)] outline-none"
          aria-label={`Filter by ${key}`}
        >
          <option value="all">{key}</option>
          {options[key].map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ))}
    </div>
  );
}

function FailureList({
  failures,
  selectedId,
  onSelect,
}: {
  failures: FailureDistillation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="min-h-0 overflow-y-auto border-b border-[var(--border-hairline)] p-2">
      {failures.length === 0 ? (
        <li className="px-2 py-4 text-center text-[var(--text-muted)]">
          No failure-distillation entries found.
        </li>
      ) : null}
      {failures.map((entry) => (
        <li key={entry.id}>
          <button
            onClick={() => onSelect(entry.id)}
            className={`mb-1 w-full rounded-md border px-2 py-1.5 text-left transition-colors ${
              selectedId === entry.id
                ? "border-[color-mix(in_oklch,var(--accent-presence)_60%,transparent)] bg-[color-mix(in_oklch,var(--accent-presence)_10%,transparent)]"
                : "border-[var(--border-hairline)] bg-[var(--bg-raised)]/30 hover:bg-[var(--bg-raised)]"
            }`}
          >
            <span className="line-clamp-2 text-[11px] font-medium text-[var(--text-primary)]">{entry.title}</span>
            <span className="mt-1 flex flex-wrap items-center gap-1 text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
              <span>{entry.date}</span>
              <Badge>{entry.severity}</Badge>
              <Badge>{entry.status}</Badge>
              <Badge>{entry.domain}</Badge>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function FailureDetail({
  failure,
  allFailures,
  onNavigate,
}: {
  failure: FailureDistillation | null;
  allFailures: FailureDistillation[];
  onNavigate: (id: string) => void;
}) {
  if (!failure) {
    return <p className="p-4 text-center text-[var(--text-muted)]">Select an entry.</p>;
  }

  const resolveLink = (link: string) => {
    return allFailures.find((entry) => entry.id === link || entry.title === link);
  };

  return (
    <article className="min-h-0 overflow-y-auto p-3">
      <h3 className="text-[13px] font-semibold leading-snug text-[var(--text-primary)]">{failure.title}</h3>
      <p className="mt-1 truncate font-mono text-[10px] text-[var(--text-muted)]">{compactPath(failure.path)}</p>
      <div className="mt-2 flex flex-wrap gap-1 text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
        <Badge>{failure.severity}</Badge>
        <Badge>{failure.status}</Badge>
        <Badge>{failure.domain}</Badge>
      </div>
      <div className="mt-3 space-y-3">
        {BODY_SECTIONS.map((section) => (
          <section key={section}>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-widest text-[var(--text-muted)]">{section}</p>
            <WikilinkText
              text={failure.sections[section] ?? "Not captured."}
              resolveLink={resolveLink}
              onNavigate={onNavigate}
            />
          </section>
        ))}
      </div>
    </article>
  );
}

function WikilinkText({
  text,
  resolveLink,
  onNavigate,
}: {
  text: string;
  resolveLink: (link: string) => FailureDistillation | undefined;
  onNavigate: (id: string) => void;
}) {
  const parts = text.split(/(\[\[[^\]]+\]\])/g);
  return (
    <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--text-secondary)]">
      {parts.map((part, index) => {
        const match = part.match(/^\[\[([^\]#|]+)(?:[#|][^\]]*)?\]\]$/);
        if (!match) return <span key={index}>{part}</span>;
        const target = resolveLink(match[1].trim());
        if (!target) {
          return (
            <span key={index} className="text-[var(--accent-presence)]">
              {part}
            </span>
          );
        }
        return (
          <button
            key={index}
            type="button"
            onClick={() => onNavigate(target.id)}
            className="text-[var(--accent-presence)] underline decoration-[color-mix(in_oklch,var(--accent-presence)_40%,transparent)] underline-offset-2 hover:text-[var(--accent-presence)]"
          >
            {part}
          </button>
        );
      })}
    </p>
  );
}

function Badge({ children }: { children: string }) {
  return (
    <span className="rounded bg-[var(--bg-raised)] px-1 py-px text-[9px] text-[var(--text-muted)]">
      {children}
    </span>
  );
}
