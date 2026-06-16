"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "@/lib/icon";
import { copyText } from "@/lib/clipboard";
import { MarkdownBlock } from "@/components/message-bubble";
import type { HarnessCapabilityManifest } from "@/components/capability-card";
import {
  filterCapabilityItems,
  normalizeCapabilities,
  type CapabilityMapItem,
  type CapabilityStatus,
  type CapabilityType,
  type CovenSkill,
} from "@/components/capabilities-normalize";

type CapabilitiesResponse = {
  ok: boolean;
  coven_skills?: CovenSkill[];
  harness_capabilities?: HarnessCapabilityManifest[];
  scanned_at?: string;
  error?: string;
};

const TYPE_LABEL: Record<CapabilityType, string> = {
  instructions: "Instructions",
  skill: "Skills",
  plugin: "Plugins",
  mcp: "MCP Servers",
  warning: "Warnings",
};

const TYPE_ICON: Record<CapabilityType, Parameters<typeof Icon>[0]["name"]> = {
  instructions: "ph:note-pencil",
  skill: "ph:sparkle",
  plugin: "ph:plug",
  mcp: "ph:plug-bold",
  warning: "ph:warning-fill",
};

const STATUS_LABEL: Record<CapabilityStatus, string> = {
  available: "available",
  enabled: "enabled",
  disabled: "disabled",
  warning: "warning",
};

const CAPABILITY_TYPES = new Set<CapabilityType>(["instructions", "skill", "plugin", "mcp", "warning"]);
const CAPABILITY_STATUSES = new Set<CapabilityStatus>(["available", "enabled", "disabled", "warning"]);
const MARKDOWN_PREVIEW_FILE_NAMES = new Set(["skill.md", "claude.md", "agents.md"]);
// Codex automation descriptors preview as their `automation.toml` (#737); the
// server skill-file reader allow-lists this exact name. It isn't markdown, but
// it renders through the same styled preview, so the gate accepts it too.
const AUTOMATION_PREVIEW_FILE_NAME = "automation.toml";

function readUrlParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

function readCapabilityTypeParam(name: string): CapabilityType | "all" {
  const value = readUrlParam(name);
  return value && CAPABILITY_TYPES.has(value as CapabilityType) ? (value as CapabilityType) : "all";
}

function readCapabilityStatusParam(name: string): CapabilityStatus | "all" {
  const value = readUrlParam(name);
  return value && CAPABILITY_STATUSES.has(value as CapabilityStatus) ? (value as CapabilityStatus) : "all";
}

function initialHarness(activeHarness?: string | null): string | null {
  return activeHarness ?? readUrlParam("harness");
}

function initialQuery(): string {
  return readUrlParam("q") ?? "";
}

function initialTypeFilter(): CapabilityType | "all" {
  return readCapabilityTypeParam("type");
}

function initialStatusFilter(): CapabilityStatus | "all" {
  return readCapabilityStatusParam("status");
}

function isMarkdownPreviewable(path?: string): boolean {
  if (!path) return false;
  const normalized = path.toLowerCase();
  const filename = normalized.split("/").pop() ?? "";
  // #742 limited previews to known markdown files; #737 added Codex automation
  // descriptors whose path ends in automation.toml. Without this the automation
  // preview never renders client-side even though the server serves it.
  if (filename === AUTOMATION_PREVIEW_FILE_NAME) return true;
  if (!normalized.endsWith(".md")) return false;
  return MARKDOWN_PREVIEW_FILE_NAMES.has(filename);
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
  const [harnessFilter, setHarnessFilter] = useState<string | null>(activeHarness ?? null);
  const [typeFilter, setTypeFilter] = useState<CapabilityType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<CapabilityStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [urlFiltersHydrated, setUrlFiltersHydrated] = useState(false);
  const [selectionId, setSelectionId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<SkillPreviewState>({
    path: null,
    status: "idle",
    text: null,
    error: null,
  });

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
    if (urlFiltersHydrated) return;
    setHarnessFilter(initialHarness(activeHarness));
    setQuery(initialQuery());
    setTypeFilter(initialTypeFilter());
    setStatusFilter(initialStatusFilter());
    setUrlFiltersHydrated(true);
  }, [activeHarness, urlFiltersHydrated]);

  useEffect(() => {
    if (!urlFiltersHydrated) return;
    if (activeHarness) {
      setHarnessFilter(activeHarness);
      setSelectionId(null);
    }
  }, [activeHarness, urlFiltersHydrated]);

  useEffect(() => {
    if (!urlFiltersHydrated) return;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (harnessFilter) params.set("harness", harnessFilter);
    else params.delete("harness");
    if (query.trim()) params.set("q", query.trim());
    else params.delete("q");
    if (typeFilter !== "all") params.set("type", typeFilter);
    else params.delete("type");
    if (statusFilter !== "all") params.set("status", statusFilter);
    else params.delete("status");
    const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
    window.history.replaceState(null, "", next);
  }, [harnessFilter, query, typeFilter, statusFilter, urlFiltersHydrated]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key !== "r" && e.key !== "R") return;
      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      void load(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [load]);

  const operatorView = useMemo(
    () => normalizeCapabilities({ manifests: items, covenSkills }),
    [items, covenSkills],
  );

  const filteredItems = useMemo(
    () =>
      filterCapabilityItems(operatorView.items, {
        query,
        harnessId: harnessFilter,
        types: typeFilter === "all" ? undefined : new Set([typeFilter]),
        status: statusFilter,
      }),
    [operatorView.items, query, harnessFilter, typeFilter, statusFilter],
  );

  const selectedItem = useMemo(
    () => operatorView.items.find((item) => item.id === selectionId) ?? null,
    [operatorView.items, selectionId],
  );

  // Load the selected capability markdown so the inspector can render a styled
  // Markdown preview. Skills are normalized to SKILL.md; instructions report a
  // CLAUDE.md/AGENTS.md file directly. Out-of-tree paths (403) fall back to the
  // description.
  const previewPath = selectedItem?.sourcePath ?? null;
  const isPreviewable = isMarkdownPreviewable(previewPath ?? undefined);
  useEffect(() => {
    if (!previewPath || !isPreviewable) {
      setPreview({ path: null, status: "idle", text: null, error: null });
      return;
    }
    let cancelled = false;
    setPreview({ path: previewPath, status: "loading", text: null, error: null });
    void (async () => {
      try {
        const res = await fetch(`/api/skills/file?path=${encodeURIComponent(previewPath)}`, {
          cache: "no-store",
        });
        const json = (await res.json()) as { ok: boolean; path?: string; text?: string; error?: string };
        if (cancelled) return;
        if (!json.ok) {
          setPreview({ path: previewPath, status: "error", text: null, error: json.error ?? `http ${res.status}` });
        } else {
          setPreview({ path: json.path ?? previewPath, status: "loaded", text: json.text ?? "", error: null });
        }
      } catch (err) {
        if (cancelled) return;
        setPreview({
          path: previewPath,
          status: "error",
          text: null,
          error: err instanceof Error ? err.message : "fetch failed",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [previewPath, isPreviewable]);

  const copyCapabilityDetail = useCallback(async (key: string, value?: string) => {
    if (!value) return;
    try {
      await copyText(value);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1200);
    } catch {
      setCopiedKey(null);
    }
  }, []);

  const openLocalPath = useCallback((path?: string) => {
    if (!path || !path.startsWith("/")) return;
    window.open(`file://${path}`, "_blank", "noopener");
  }, []);

  const applyHarnessFilter = (id: string | null) => {
    setHarnessFilter(id);
    setSelectionId(null);
  };

  const applyQueryFilter = (value: string) => {
    setQuery(value);
    setSelectionId(null);
  };

  const applyTypeFilter = (value: CapabilityType | "all") => {
    setTypeFilter(value);
    setSelectionId(null);
  };

  const applyStatusFilter = (value: CapabilityStatus | "all") => {
    setStatusFilter(value);
    setSelectionId(null);
  };

  const applySummaryFilter = (type: CapabilityType | "all", status: CapabilityStatus | "all" = "all") => {
    setTypeFilter(type);
    setStatusFilter(status);
    setSelectionId(null);
  };

  const readinessStatus = operatorView.summary.warnings > 0 ? "warning" : operatorView.summary.disabled > 0 ? "disabled" : "all";

  return (
    <div className="capabilities-view flex h-full min-w-0 flex-col bg-background text-foreground">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1280px] px-4 pb-12 sm:px-8">
          <div className="pb-4 pt-5">
            <div className="mb-3 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0">
                <h2 className="text-[18px] font-semibold text-[var(--text-primary)]">
                  Harness capabilities
                </h2>
                <p className="mt-1 max-w-3xl text-[12px] text-muted-foreground">
                  Read-only operator map of skills, plugins, MCP servers, global instructions,
                  warnings, and Coven daemon skills discovered across connected harnesses.
                </p>
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
                  title="Refresh (⌘R)"
                  className="focus-ring flex h-7 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-foreground transition-colors hover:bg-muted disabled:opacity-50"
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
          </div>

          {!loaded ? (
            <CapabilitiesSkeleton />
          ) : error ? (
            <CapabilitiesError error={error} onRefresh={() => void load(true)} />
          ) : operatorView.items.length === 0 ? (
            <CapabilitiesEmpty onRefresh={() => void load(true)} />
          ) : (
            <>
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <label className="focus-within:ring-ring flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] focus-within:ring-1">
                  <Icon name="ph:magnifying-glass" width={13} className="shrink-0 text-muted-foreground" />
                  <input
                    type="search"
                    aria-label="Search capabilities"
                    value={query}
                    onChange={(e) => applyQueryFilter(e.target.value)}
                    placeholder="Search skills, plugins, paths, commands"
                    className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
                  />
                </label>
                <select
                  value={statusFilter}
                  onChange={(e) => applyStatusFilter(e.target.value as CapabilityStatus | "all")}
                  className="focus-ring h-8 rounded-md border border-border bg-background px-2 text-[12px] text-foreground"
                  aria-label="Filter by status"
                >
                  <option value="all">All statuses</option>
                  <option value="enabled">Enabled</option>
                  <option value="available">Available</option>
                  <option value="disabled">Disabled</option>
                  <option value="warning">Warnings</option>
                </select>
              </div>

              {/* Summary tiles double as the primary type/status filters. */}
              <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-7">
                <SummaryTile
                  icon="ph:heartbeat"
                  label="Readiness"
                  value={operatorView.summary.warnings + operatorView.summary.disabled === 0 ? "Clear" : `${operatorView.summary.warnings + operatorView.summary.disabled} issue${operatorView.summary.warnings + operatorView.summary.disabled === 1 ? "" : "s"}`}
                  active={statusFilter === "warning" || statusFilter === "disabled"}
                  onClick={() => applySummaryFilter("all", readinessStatus)}
                />
                <SummaryTile
                  icon="ph:cube-bold"
                  label="Harnesses"
                  value={operatorView.summary.harnesses.toString()}
                  active={harnessFilter === null && typeFilter === "all" && statusFilter === "all"}
                  onClick={() => {
                    applyHarnessFilter(null);
                    applySummaryFilter("all");
                  }}
                />
                <SummaryTile
                  icon="ph:note-pencil"
                  label="Instructions"
                  value={operatorView.summary.instructions.toString()}
                  active={typeFilter === "instructions"}
                  onClick={() => applySummaryFilter("instructions")}
                />
                <SummaryTile
                  icon="ph:sparkle"
                  label="Skills"
                  value={operatorView.summary.skills.toString()}
                  active={typeFilter === "skill"}
                  onClick={() => applySummaryFilter("skill")}
                />
                <SummaryTile
                  icon="ph:plug"
                  label="Plugins"
                  value={operatorView.summary.plugins.toString()}
                  active={typeFilter === "plugin"}
                  onClick={() => applySummaryFilter("plugin")}
                />
                <SummaryTile
                  icon="ph:plug-bold"
                  label="MCP"
                  value={operatorView.summary.mcpServers.toString()}
                  active={typeFilter === "mcp"}
                  onClick={() => applySummaryFilter("mcp")}
                />
                <SummaryTile
                  icon="ph:warning-fill"
                  label="Disabled"
                  value={operatorView.summary.disabled.toString()}
                  active={statusFilter === "disabled"}
                  onClick={() => applySummaryFilter("all", "disabled")}
                />
              </div>

              {operatorView.harnesses.length > 1 ? (
                <div className="mb-4 flex flex-wrap items-center gap-1.5">
                  <FilterPill
                    label="All harnesses"
                    count={operatorView.harnesses.length}
                    active={harnessFilter === null}
                    onClick={() => applyHarnessFilter(null)}
                  />
                  {operatorView.harnesses.map((harness) => (
                    <FilterPill
                      key={harness.id}
                      label={harness.label}
                      count={harness.itemCount + harness.warningCount}
                      active={harnessFilter === harness.id}
                      warning={harness.warningCount > 0 || harness.disabledCount > 0}
                      onClick={() => applyHarnessFilter(harnessFilter === harness.id ? null : harness.id)}
                    />
                  ))}
                </div>
              ) : null}

              <CapabilityMap
                items={filteredItems}
                selectedId={selectedItem?.id ?? null}
                preview={preview}
                copiedKey={copiedKey}
                onSelect={(item) => setSelectionId((cur) => (cur === item.id ? null : item.id))}
                onTypeFilter={(type) => applyTypeFilter(type)}
                onCopy={copyCapabilityDetail}
                onOpenPath={openLocalPath}
                onSelectHarness={applyHarnessFilter}
              />
            </>
          )}
        </div>
      </div>
      <footer className="shrink-0 border-t border-border px-3 py-1.5 text-center text-[10px] text-muted-foreground">
        ⌘R refresh · search narrows the operator map · read-only
      </footer>
    </div>
  );
}

function CapabilityMap({
  items,
  selectedId,
  preview,
  copiedKey,
  onSelect,
  onTypeFilter,
  onCopy,
  onOpenPath,
  onSelectHarness,
}: {
  items: CapabilityMapItem[];
  selectedId: string | null;
  preview: SkillPreviewState;
  copiedKey: string | null;
  onSelect: (item: CapabilityMapItem) => void;
  onTypeFilter: (type: CapabilityType) => void;
  onCopy: (key: string, value?: string) => void;
  onOpenPath: (path?: string) => void;
  onSelectHarness: (id: string | null) => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<CapabilityType, CapabilityMapItem[]>();
    for (const item of items) {
      const list = map.get(item.type);
      if (list) list.push(item);
      else map.set(item.type, [item]);
    }
    return map;
  }, [items]);

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-[13px] text-muted-foreground">
        No capabilities match the current filters.
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-3">
      {(Object.keys(TYPE_LABEL) as CapabilityType[]).map((type) => {
        const group = grouped.get(type);
        if (!group?.length) return null;
        return (
          <section key={type} className="rounded-lg border border-border bg-card">
            <button
              type="button"
              onClick={() => onTypeFilter(type)}
              className="focus-ring flex w-full items-center gap-2 rounded-t-lg border-b border-border bg-[color-mix(in_oklch,var(--bg-base)_86%,var(--foreground)_14%)] px-3 py-2 text-left"
            >
              <Icon name={TYPE_ICON[type]} width={13} className="text-muted-foreground" />
              <h3 className="text-[12px] font-bold uppercase tracking-widest text-[var(--text-primary)]">
                {TYPE_LABEL[type]}
              </h3>
              <span className="ml-auto rounded bg-muted px-1.5 py-px text-[10px] tabular-nums text-muted-foreground">
                {group.length}
              </span>
            </button>
            <div className="divide-y divide-border">
              {group.map((item) => (
                <CapabilityMapRow
                  key={item.id}
                  item={item}
                  active={selectedId === item.id}
                  preview={preview}
                  copiedKey={copiedKey}
                  onSelect={() => onSelect(item)}
                  onCopy={onCopy}
                  onOpenPath={onOpenPath}
                  onSelectHarness={onSelectHarness}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function CapabilityMapRow({
  item,
  active,
  preview,
  copiedKey,
  onSelect,
  onCopy,
  onOpenPath,
  onSelectHarness,
}: {
  item: CapabilityMapItem;
  active: boolean;
  preview: SkillPreviewState;
  copiedKey: string | null;
  onSelect: () => void;
  onCopy: (key: string, value?: string) => void;
  onOpenPath: (path?: string) => void;
  onSelectHarness: (id: string | null) => void;
}) {
  // Every row expands inline to reveal its inspector details. Known markdown
  // capability files render beneath the details as styled markdown.
  const isPreviewable = isMarkdownPreviewable(item.sourcePath);
  const previewMatches = preview.path === item.sourcePath;
  return (
    <div>
      <button
        type="button"
        onClick={onSelect}
        aria-expanded={active}
        className={`focus-ring flex min-w-0 w-full items-start gap-2 px-3 py-2 text-left transition-colors ${
          active ? "bg-muted" : "hover:bg-muted/60"
        }`}
      >
        <Icon
          name={active ? "ph:caret-down" : "ph:caret-right"}
          width={11}
          className="mt-1 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${statusDotClass(item.status)}`} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="min-w-0 truncate text-[12px] font-medium text-foreground">{item.label}</span>
            <span className="rounded bg-background px-1.5 py-px text-[9px] uppercase tracking-wide text-muted-foreground">
              {item.harnessLabel}
            </span>
            {item.version ? (
              <span className="rounded bg-muted px-1.5 py-px text-[9px] text-muted-foreground">v{item.version}</span>
            ) : null}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
            {item.warningMessage ?? item.description ?? item.sourcePath ?? item.command ?? item.id}
          </span>
        </span>
        <span className="shrink-0 rounded-full bg-background px-1.5 py-px text-[9px] text-muted-foreground">
          {STATUS_LABEL[item.status]}
        </span>
      </button>
      {active ? (
        <div className="space-y-3 border-t border-border bg-background/40 px-3 py-3">
          <CapabilityDetails
            item={item}
            copiedKey={copiedKey}
            onCopy={onCopy}
            onOpenPath={onOpenPath}
            onSelectHarness={onSelectHarness}
          />
          {isPreviewable ? (
            <SkillPreviewBlock
              preview={previewMatches ? preview : { path: item.sourcePath ?? null, status: "loading", text: null, error: null }}
              fallbackDescription={item.description}
              title={item.label}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// Inspector details rendered inline inside an expanded capability row: chips,
// provenance blocks, and the read-only copy/open actions. This previously lived
// in a separate right-hand column; it now travels with the row it describes.
function CapabilityDetails({
  item,
  copiedKey,
  onCopy,
  onOpenPath,
  onSelectHarness,
}: {
  item: CapabilityMapItem;
  copiedKey: string | null;
  onCopy: (key: string, value?: string) => void;
  onOpenPath: (path?: string) => void;
  onSelectHarness: (id: string | null) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="capability-chips flex flex-wrap items-center gap-1.5">
        <Badge>{TYPE_LABEL[item.type]}</Badge>
        <Badge tone={item.status}>{STATUS_LABEL[item.status]}</Badge>
        <button
          type="button"
          onClick={() => onSelectHarness(item.harnessId === "coven" ? null : item.harnessId)}
          className="focus-ring inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {item.harnessLabel}
        </button>
      </div>

      {item.description ? <InspectorBlock label="Detail" value={item.description} /> : null}
      {item.warningMessage ? <InspectorBlock label="Warning" value={item.warningMessage} tone="warning" /> : null}
      {item.sourcePath ? <InspectorBlock label="Path" value={item.sourcePath} mono /> : null}
      {item.command ? <InspectorBlock label="Command" value={item.command} mono /> : null}
      {item.tags?.length ? <InspectorBlock label="Tags" value={item.tags.join(", ")} /> : null}
      {item.scannedAt ? <InspectorBlock label="Scanned" value={new Date(item.scannedAt).toLocaleString()} /> : null}

      <div className="flex flex-wrap gap-1.5 border-t border-border pt-3">
        <InspectorAction
          icon={copiedKey === "id" ? "ph:check" : "ph:copy"}
          label={copiedKey === "id" ? "Copied id" : "Copy id"}
          onClick={() => void onCopy("id", item.id)}
        />
        {item.sourcePath ? (
          <>
            <InspectorAction
              icon={copiedKey === "path" ? "ph:check" : "ph:copy"}
              label={copiedKey === "path" ? "Copied path" : "Copy path"}
              onClick={() => void onCopy("path", item.sourcePath)}
            />
            <InspectorAction
              icon="ph:file-text"
              label="Open file"
              onClick={() => onOpenPath(item.sourcePath)}
            />
          </>
        ) : null}
        {item.command ? (
          <InspectorAction
            icon={copiedKey === "command" ? "ph:check" : "ph:copy"}
            label={copiedKey === "command" ? "Copied command" : "Copy command"}
            onClick={() => void onCopy("command", item.command)}
          />
        ) : null}
      </div>
    </div>
  );
}

function SummaryTile({
  icon,
  label,
  value,
  active,
  onClick,
}: {
  icon: Parameters<typeof Icon>[0]["name"];
  label: string;
  value: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`focus-ring rounded-lg border px-3 py-2 text-left transition-colors ${
        active ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:bg-muted"
      }`}
    >
      <div className={`flex items-center gap-1.5 ${active ? "text-background/75" : "text-[var(--text-secondary)]"}`}>
        <Icon name={icon} width={11} />
        <span className="text-[10px] uppercase tracking-widest">{label}</span>
      </div>
      <p className="mt-1 truncate text-[18px] font-semibold tabular-nums">{value}</p>
    </button>
  );
}

function FilterPill({
  icon,
  label,
  count,
  active,
  warning,
  onClick,
}: {
  icon?: Parameters<typeof Icon>[0]["name"];
  label: string;
  count?: number;
  active: boolean;
  warning?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`focus-ring flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
        active
          ? "border-foreground bg-foreground text-background"
          : warning
            ? "border-[color-mix(in_oklch,var(--color-warning)_45%,var(--border))] bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
            : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
      aria-pressed={active}
    >
      {icon ? <Icon name={icon} width={11} /> : null}
      <span>{label}</span>
      {count !== undefined ? (
        <span className={`rounded-full px-1.5 py-px text-[9px] ${active ? "bg-background/20 text-background" : "bg-muted text-muted-foreground"}`}>
          {count}
        </span>
      ) : null}
    </button>
  );
}

type SkillPreviewState = {
  path: string | null;
  status: "idle" | "loading" | "loaded" | "error";
  text: string | null;
  error: string | null;
};

// Skill/instructions markdown opens with a YAML frontmatter block (name,
// description, tags) which the inspector already surfaces as the title/badges.
// Strip it so the preview shows the prose body, not raw `key: value` lines.
function stripFrontmatter(text: string): string {
  return text.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, "").trimStart();
}

function SkillPreviewBlock({
  preview,
  fallbackDescription,
  title,
}: {
  preview: SkillPreviewState;
  fallbackDescription?: string;
  title?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const body = preview.text ? stripFrontmatter(preview.text) : "";
  const canExpand = preview.status === "loaded" && !!body;
  // Rendered the file content as styled markdown. On error (e.g. the path is
  // outside the previewable roots) fall back to the scanned description so the
  // inspector never goes blank.
  if (preview.status === "error") {
    return fallbackDescription ? (
      <InspectorBlock label="Detail" value={fallbackDescription} />
    ) : (
      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Markdown preview</p>
        <p className="rounded-md bg-muted px-2 py-1.5 text-[11px] leading-5 text-muted-foreground">
          Preview unavailable for this file.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Markdown preview</p>
        {canExpand ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-label="Open full-size preview"
            title="Open full-size preview"
            className="focus-ring inline-flex h-6 items-center gap-1 rounded-md border border-border px-1.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Icon name="ph:arrows-out-simple" width={11} />
            <span>Expand</span>
          </button>
        ) : null}
      </div>
      <div className="max-h-[440px] overflow-y-auto rounded-md border border-border bg-background px-3 py-2">
        {preview.status === "loaded" && body ? (
          <MarkdownBlock text={body} className="text-[12px]" />
        ) : preview.status === "loaded" ? (
          <p className="text-[11px] italic text-muted-foreground">This file is empty.</p>
        ) : (
          <div className="space-y-2 py-1" aria-hidden>
            {["88%", "96%", "72%", "90%", "64%"].map((w, i) => (
              <span key={i} className="block h-2.5 animate-pulse rounded bg-muted" style={{ width: w }} />
            ))}
          </div>
        )}
      </div>
      {expanded ? (
        <CapabilityPreviewModal
          title={title}
          path={preview.path}
          body={body}
          onClose={() => setExpanded(false)}
        />
      ) : null}
    </div>
  );
}

// Full-size reader for a capability's markdown. Mirrors the familiars memory
// reader modal: a centered overlay with a wide, scrollable column rendering the
// same MarkdownBlock at reader scale. The body is already loaded by the
// inspector, so this is purely presentational — no extra fetch.
function CapabilityPreviewModal({
  title,
  path,
  body,
  onClose,
}: {
  title?: string;
  path: string | null;
  body: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const heading = title ?? path?.split("/").pop() ?? "Preview";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview: ${heading}`}
    >
      <div
        className="relative flex h-[92vh] w-[94vw] max-w-[1100px] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
          <Icon name="ph:book-open" width={13} className="shrink-0 text-muted-foreground" aria-hidden />
          <span className="flex-1 truncate text-[12px] text-[var(--text-secondary)]" title={path ?? undefined}>
            {heading}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring ml-1 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close preview"
          >
            <Icon name="ph:x-bold" width={11} aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
          <div className="mx-auto w-full max-w-[820px]">
            <MarkdownBlock text={body} className="cave-md--expanded" />
          </div>
        </div>
      </div>
    </div>
  );
}

function InspectorBlock({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "warning";
}) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">{label}</p>
      <p className={`break-words rounded-md bg-muted px-2 py-1.5 text-[11px] leading-5 ${mono ? "font-mono" : ""} ${tone === "warning" ? "text-[var(--color-warning)]" : "text-muted-foreground"}`}>
        {value}
      </p>
    </div>
  );
}

function InspectorAction({
  icon,
  label,
  onClick,
}: {
  icon: Parameters<typeof Icon>[0]["name"];
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Icon name={icon} width={12} />
      <span>{label}</span>
    </button>
  );
}

function Badge({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: CapabilityStatus;
}) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] ${badgeClass(tone)}`}>
      {children}
    </span>
  );
}

function CapabilitiesSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border bg-card p-3">
          <span className="block h-3 w-32 animate-pulse rounded bg-muted" />
          <span className="mt-3 block h-12 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

function CapabilitiesError({ error, onRefresh }: { error: string; onRefresh: () => void }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-6 sm:px-5">
      <p className="mb-3 text-[13px] text-muted-foreground">
        {error === "daemon offline"
          ? "Coven daemon is offline — harness capabilities require a running daemon."
          : `Could not load capabilities: ${error}`}
      </p>
      <button
        onClick={onRefresh}
        className="focus-ring rounded-md border border-border bg-card px-3 py-1.5 text-[12px] text-foreground hover:bg-muted"
      >
        Retry
      </button>
    </div>
  );
}

function CapabilitiesEmpty({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
      <p className="text-[13px] text-muted-foreground">
        No harness capabilities found. Start the daemon or add a local harness to see its instructions, skills, and plugins.
      </p>
      <button
        type="button"
        onClick={onRefresh}
        className="focus-ring mt-3 rounded-md border border-border px-3 py-1.5 text-[12px] text-foreground hover:bg-muted"
      >
        Refresh
      </button>
    </div>
  );
}

function statusDotClass(status: CapabilityStatus): string {
  if (status === "enabled" || status === "available") return "bg-[var(--color-success)]";
  if (status === "disabled") return "bg-[var(--color-warning)]";
  return "bg-[var(--color-danger,var(--color-warning))]";
}

function badgeClass(status?: CapabilityStatus): string {
  if (status === "enabled" || status === "available") {
    return "bg-[color-mix(in_oklch,var(--color-success)_15%,transparent)] text-[var(--color-success)]";
  }
  if (status === "disabled" || status === "warning") {
    return "bg-[color-mix(in_oklch,var(--color-warning)_15%,transparent)] text-[var(--color-warning)]";
  }
  return "bg-muted text-muted-foreground";
}
