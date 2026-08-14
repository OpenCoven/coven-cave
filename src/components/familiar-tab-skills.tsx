"use client";

/**
 * Familiar tab · Skills section (design-handoff rebuild).
 *
 * One card: header row [uppercase label + mono count · Segmented source filter ·
 * result note · search], then a scrollable list of skill rows. Row click opens
 * the skill detail modal (file rail + content pane fed by /api/skills/files).
 * The familiar filter's empty state is the design's two-column teach state with
 * live marketplace recommendations from /api/skills/directory — real entries
 * only, nothing invented.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FamiliarSectionData, FamiliarSkillRow } from "@/lib/familiar-tab-section-model";
import { navigateFamiliarSurface } from "@/lib/familiar-surface-navigation";
import { Segmented } from "@/components/ui/settings-controls";
import { SearchInput } from "@/components/ui/search-input";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon, type IconName } from "@/lib/icon";

import "@/styles/familiar-tab-skills.css";

/* ── Source filter ── */

const SOURCE_TABS = ["all", "role", "familiar", "global"] as const;
type SourceTab = (typeof SOURCE_TABS)[number];

const TAB_LABEL: Record<SourceTab, string> = {
  all: "All",
  role: "Role-granted",
  familiar: "Familiar",
  global: "Global",
};

/** Search haystack: skills match on name, description, and tags. */
function rowHaystack(row: FamiliarSkillRow): string {
  return `${row.name} ${row.description ?? ""} ${row.tags.join(" ")}`.toLowerCase();
}

function sourcePillClass(kind: FamiliarSkillRow["sourceKind"]): string {
  return `familiar-skills__source-pill familiar-skills__source-pill--${kind}`;
}

/** Human provenance line for the modal meta row. */
function grantedByLabel(row: FamiliarSkillRow): string {
  if (row.sourceKind === "role") return `${row.source} role`;
  if (row.sourceKind === "familiar") return "familiar";
  return "Coven (global)";
}

/* ── Skill files (modal) — contract for GET /api/skills/files ── */

type SkillFileEntry = {
  name: string;
  kind: "file" | "dir";
  size?: number;
  children?: string[];
};

function fileIcon(entry: SkillFileEntry): IconName {
  if (entry.kind === "dir") return "ph:folder";
  if (entry.name.endsWith(".md")) return "ph:file-text";
  if (entry.name.endsWith(".toml")) return "ph:gear-six";
  return "ph:file";
}

function formatSize(size?: number): string {
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) return "";
  if (size < 1024) return `${size} B`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

/* ── Marketplace recommendations (familiar-empty state) ── */

/** Client-side subset of SkillDirectoryEntry (src/lib/server/skills-directory.ts). */
type DirectoryEntry = {
  id: string;
  name: string;
  description?: string;
  owner?: string;
  repo?: string;
  packageName?: string;
  installed?: boolean;
  installsAllTime?: number;
  trust?: { official?: boolean };
  source?: string;
};

function isInstallable(entry: DirectoryEntry): boolean {
  return Boolean((entry.owner && entry.repo) || entry.packageName);
}

/** Disambiguator the install route actually matches on (owner/repo or package
 *  name) — NOT entry.source, which is a provenance enum the server would
 *  never match, 404ing every install. */
function installSource(entry: DirectoryEntry): string | undefined {
  if (entry.owner && entry.repo) return `${entry.owner}/${entry.repo}`;
  return entry.packageName ?? undefined;
}

/* ═══════════════════════════════════════════════════════════════ */

export function FamiliarSkillsSection({ data }: { data: FamiliarSectionData }) {
  const [tab, setTab] = useState<SourceTab>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<FamiliarSkillRow | null>(null);

  const rows = data.skillRows;
  const counts = useMemo(
    () => ({
      all: rows.length,
      role: rows.filter((r) => r.sourceKind === "role").length,
      familiar: rows.filter((r) => r.sourceKind === "familiar").length,
      global: rows.filter((r) => r.sourceKind === "global").length,
    }),
    [rows],
  );

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    let list = tab === "all" ? rows : rows.filter((r) => r.sourceKind === tab);
    if (q) list = list.filter((r) => rowHaystack(r).includes(q));
    return list;
  }, [rows, tab, q]);

  // The familiar filter with zero familiar-installed skills gets the teach
  // state (recommendations), not a bare "no results" line.
  const familiarEmpty = tab === "familiar" && counts.familiar === 0;
  const noResults = !familiarEmpty && visible.length === 0;

  const resultNote = q
    ? `${visible.length} ${visible.length === 1 ? "match" : "matches"}`
    : tab === "role"
      ? "granted by active roles"
      : tab === "global"
        ? "shared across the coven"
        : "";

  return (
    <section aria-label="Skills" className="familiar-tab__card familiar-skills">
      <div className="familiar-skills__head">
        <div className="familiar-skills__title-group">
          <span className="familiar-skills__title">Skills</span>
          <span className="familiar-skills__total">{counts.all}</span>
        </div>
        <Segmented
          options={SOURCE_TABS}
          value={tab}
          onChange={setTab}
          getLabel={(o) => `${TAB_LABEL[o]}\u00A0${counts[o]}`}
          ariaLabel="Skill source"
        />
        <span className="familiar-skills__note">{resultNote}</span>
        <div className="familiar-skills__search">
          <SearchInput
            value={query}
            onValueChange={setQuery}
            onClear={() => setQuery("")}
            placeholder="Filter skills…"
            aria-label="Filter skills"
          />
        </div>
      </div>

      {familiarEmpty ? (
        <FamiliarEmptyTeachState familiarName={data.familiar.display_name} />
      ) : noResults ? (
        <div className="familiar-skills__no-results">
          {q ? (
            <EmptyState
              compact
              icon="ph:magnifying-glass"
              headline="No matching skills"
              subtitle="Try a different search — skills match on name, description, and tags."
            />
          ) : (
            <p className="familiar-skills__quiet-empty">No skills from this source yet.</p>
          )}
        </div>
      ) : (
        <div className="familiar-skills__list">
          {visible.map((row) => (
            <button
              key={`${row.sourceKind}:${row.key}`}
              type="button"
              className="familiar-skills__row focus-ring"
              onClick={() => setSelected(row)}
              aria-label={`Open skill ${row.name}`}
            >
              <span className="familiar-skills__row-main">
                <span className="familiar-skills__row-title">
                  <span className="familiar-skills__row-name">{row.name}</span>
                  <span className="familiar-skills__kind-pill">{row.kind}</span>
                </span>
                {row.description ? (
                  <span className="familiar-skills__row-desc">{row.description}</span>
                ) : null}
                {row.tags.length > 0 ? (
                  <span className="familiar-skills__row-tags">{row.tags.join(" · ")}</span>
                ) : null}
              </span>
              <span className={sourcePillClass(row.sourceKind)}>{row.source}</span>
            </button>
          ))}
        </div>
      )}

      {selected ? (
        <SkillDetailModal data={data} row={selected} onClose={() => setSelected(null)} />
      ) : null}
    </section>
  );
}

/* ── Familiar-empty teach state: two columns, live recommendations ── */

function FamiliarEmptyTeachState({ familiarName }: { familiarName: string }) {
  const [entries, setEntries] = useState<DirectoryEntry[] | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "done" | "error">("loading");
  const [installState, setInstallState] = useState<Record<string, "busy" | "done" | "error">>({});

  useEffect(() => {
    let cancelled = false;
    fetch("/api/skills/directory")
      .then((res) => res.json())
      .then((json: { ok?: boolean; entries?: DirectoryEntry[] }) => {
        if (cancelled) return;
        if (json?.ok && Array.isArray(json.entries)) {
          // Real marketplace entries only; recommending already-installed
          // skills would be noise.
          setEntries(json.entries.filter((e) => !e.installed).slice(0, 6));
          setLoadState("done");
        } else {
          setLoadState("error");
        }
      })
      .catch(() => {
        if (!cancelled) setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const install = useCallback((entry: DirectoryEntry) => {
    setInstallState((s) => ({ ...s, [entry.id]: "busy" }));
    fetch("/api/skills/directory/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: entry.id, source: installSource(entry) }),
    })
      .then((res) => res.json())
      .then((json: { ok?: boolean }) => {
        setInstallState((s) => ({ ...s, [entry.id]: json?.ok ? "done" : "error" }));
      })
      .catch(() => {
        setInstallState((s) => ({ ...s, [entry.id]: "error" }));
      });
  }, []);

  return (
    <div className="familiar-skills__teach">
      <div className="familiar-skills__teach-intro">
        <span className="familiar-skills__teach-badge" aria-hidden>
          <Icon name="ph:sparkle" width={18} />
        </span>
        <div className="familiar-skills__teach-copy">
          <span className="familiar-skills__teach-headline">
            Nothing installed on {familiarName} yet
          </span>
          <span className="familiar-skills__teach-sub">
            Skills installed directly on the familiar appear here. Start from a recommendation, or
            browse the full marketplace.
          </span>
        </div>
        <div className="familiar-skills__teach-actions">
          <Button
            variant="secondary"
            size="sm"
            trailingIcon="ph:arrow-right-bold"
            onClick={() => navigateFamiliarSurface("marketplace")}
          >
            Browse marketplace
          </Button>
        </div>
        <span className="familiar-skills__teach-footnote">
          Recommendations come from the coven marketplace directory.
        </span>
      </div>

      <div className="familiar-skills__recs">
        <div className="familiar-skills__recs-head">
          <span className="familiar-skills__recs-title">Recommended</span>
          {entries && entries.length > 0 ? (
            <span className="familiar-skills__recs-count">
              {entries.length} {entries.length === 1 ? "pick" : "picks"}
            </span>
          ) : null}
        </div>
        {loadState === "loading" ? (
          <p className="familiar-skills__muted-line">Loading marketplace recommendations…</p>
        ) : loadState === "error" ? (
          <p className="familiar-skills__muted-line">
            Couldn't reach the marketplace directory. Browse the marketplace instead.
          </p>
        ) : entries && entries.length === 0 ? (
          <p className="familiar-skills__muted-line">
            No uninstalled skills in the directory right now.
          </p>
        ) : (
          <div className="familiar-skills__recs-grid">
            {entries?.map((entry, i) => {
              const state = installState[entry.id];
              return (
                <div
                  key={entry.id}
                  className={`familiar-skills__rec-card${i === 0 ? " familiar-skills__rec-card--featured" : ""}`}
                >
                  <div className="familiar-skills__rec-title">
                    <span className="familiar-skills__rec-name">{entry.name}</span>
                    {entry.trust?.official ? (
                      <span className="familiar-skills__kind-pill">official</span>
                    ) : null}
                  </div>
                  {entry.description ? (
                    <span className="familiar-skills__rec-desc">{entry.description}</span>
                  ) : null}
                  <div className="familiar-skills__rec-foot">
                    <span className="familiar-skills__rec-installs">
                      {typeof entry.installsAllTime === "number" && entry.installsAllTime > 0
                        ? `${entry.installsAllTime.toLocaleString()} installs`
                        : ""}
                    </span>
                    {isInstallable(entry) ? (
                      state === "done" ? (
                        <span className="familiar-skills__rec-installed">Installed</span>
                      ) : state === "error" ? (
                        <span className="familiar-skills__rec-retry">
                          <span className="familiar-skills__rec-error">Install failed</span>
                          <Button
                            variant="ghost"
                            size="xs"
                            leadingIcon="ph:arrow-clockwise"
                            onClick={() => install(entry)}
                            aria-label={`Retry installing ${entry.name}`}
                          >
                            Retry
                          </Button>
                        </span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="xs"
                          leadingIcon="ph:plus"
                          loading={state === "busy"}
                          onClick={() => install(entry)}
                          aria-label={`Install ${entry.name}`}
                        >
                          Install
                        </Button>
                      )
                    ) : (
                      <Button
                        variant="ghost"
                        size="xs"
                        trailingIcon="ph:arrow-right-bold"
                        onClick={() => navigateFamiliarSurface("marketplace")}
                        aria-label={`View ${entry.name} in marketplace`}
                      >
                        View in marketplace
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Skill detail modal ── */

function SkillDetailModal({
  data,
  row,
  onClose,
}: {
  data: FamiliarSectionData;
  row: FamiliarSkillRow;
  onClose: () => void;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      wide
      breadcrumb={[data.familiar.display_name, "Skills", row.name]}
      footerActions={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="familiar-skills__modal">
        <div className="familiar-skills__modal-head">
          <div className="familiar-skills__modal-title">
            <span className="familiar-skills__modal-name">{row.name}</span>
            <span className="familiar-skills__kind-pill">{row.kind}</span>
            <span className={sourcePillClass(row.sourceKind)}>{row.source}</span>
          </div>
          {row.description ? (
            <p className="familiar-skills__modal-desc">{row.description}</p>
          ) : null}
        </div>

        {row.path ? (
          <SkillFilesPane dir={row.path} />
        ) : (
          <p className="familiar-skills__muted-line familiar-skills__modal-uninstalled">
            This grant comes from the {grantedByLabel(row)}, but the skill body isn't installed on
            this machine — there are no files to browse.
          </p>
        )}

        <div className="familiar-skills__modal-meta">
          <span>
            <span className="familiar-skills__meta-label">Granted by </span>
            {grantedByLabel(row)}
          </span>
          {row.tags.length > 0 ? (
            <span className="familiar-skills__meta-tags">
              {row.tags.map((tag) => (
                <span key={tag} className="familiar-skills__tag-chip">
                  {tag}
                </span>
              ))}
            </span>
          ) : null}
          {row.path ? (
            <span className="familiar-skills__meta-path" title={row.path}>
              {row.path}
            </span>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

/** File rail + content pane, fed by the skills-files route. */
function SkillFilesPane({ dir }: { dir: string }) {
  const [entries, setEntries] = useState<SkillFileEntry[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [active, setActive] = useState<SkillFileEntry | null>(null);
  const [fileText, setFileText] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number | undefined>(undefined);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setListError(null);
    setActive(null);
    setFileText(null);
    setFileSize(undefined);
    setFileError(null);
    fetch(`/api/skills/files?dir=${encodeURIComponent(dir)}`)
      .then((res) => res.json())
      .then((json: { ok?: boolean; entries?: SkillFileEntry[]; error?: string }) => {
        if (cancelled) return;
        if (json?.ok && Array.isArray(json.entries)) {
          setEntries(json.entries);
          // Default-select SKILL.md when present, else the first file.
          const skillMd = json.entries.find((e) => e.kind === "file" && e.name === "SKILL.md");
          setActive(skillMd ?? json.entries.find((e) => e.kind === "file") ?? json.entries[0] ?? null);
        } else {
          setListError(typeof json?.error === "string" ? json.error : "Couldn't list skill files.");
        }
      })
      .catch(() => {
        if (!cancelled) setListError("Couldn't list skill files.");
      });
    return () => {
      cancelled = true;
    };
  }, [dir]);

  useEffect(() => {
    if (!active || active.kind !== "file") {
      setFileText(null);
      setFileSize(undefined);
      setFileError(null);
      setFileLoading(false);
      return;
    }
    let cancelled = false;
    setFileLoading(true);
    setFileText(null);
    setFileSize(undefined);
    setFileError(null);
    fetch(`/api/skills/files?dir=${encodeURIComponent(dir)}&file=${encodeURIComponent(active.name)}`)
      .then((res) => res.json())
      .then((json: { ok?: boolean; text?: string; size?: number; error?: string }) => {
        if (cancelled) return;
        if (json?.ok && typeof json.text === "string") {
          setFileText(json.text);
          setFileSize(json.size);
        } else {
          setFileError(typeof json?.error === "string" ? json.error : "Couldn't read this file.");
        }
        setFileLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFileError("Couldn't read this file.");
        setFileLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dir, active]);

  const paneMeta =
    active?.kind === "dir"
      ? `${active.children?.length ?? 0} items`
      : formatSize(fileSize ?? active?.size);

  return (
    <div className="familiar-skills__files">
      <div className="familiar-skills__files-rail">
        <div className="familiar-skills__files-label">Files</div>
        <div className="familiar-skills__files-tree">
          <div className="familiar-skills__files-dir" title={dir}>
            {dir}/
          </div>
          {listError ? (
            <p className="familiar-skills__muted-line">{listError}</p>
          ) : entries === null ? (
            <p className="familiar-skills__muted-line">Loading files…</p>
          ) : entries.length === 0 ? (
            <p className="familiar-skills__muted-line">No files in this skill.</p>
          ) : (
            entries.map((entry) => (
              <button
                key={entry.name}
                type="button"
                className="familiar-skills__file-row focus-ring"
                aria-current={active?.name === entry.name || undefined}
                onClick={() => setActive(entry)}
              >
                <span className="familiar-skills__file-icon" aria-hidden>
                  <Icon name={fileIcon(entry)} width={12} />
                </span>
                <span className="familiar-skills__file-name">
                  {entry.kind === "dir" ? `${entry.name}/` : entry.name}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
      <div className="familiar-skills__file-pane">
        <div className="familiar-skills__file-pane-head">
          <span className="familiar-skills__file-pane-name">
            {active ? (active.kind === "dir" ? `${active.name}/` : active.name) : ""}
          </span>
          <span className="familiar-skills__file-pane-meta">{paneMeta}</span>
        </div>
        {active?.kind === "dir" ? (
          <ul className="familiar-skills__dir-list">
            {(active.children ?? []).map((child) => (
              <li key={child}>{child}</li>
            ))}
            {(active.children ?? []).length === 0 ? (
              <li className="familiar-skills__muted-line">Empty folder.</li>
            ) : null}
          </ul>
        ) : fileLoading ? (
          <p className="familiar-skills__muted-line">Loading file…</p>
        ) : fileError ? (
          <p className="familiar-skills__muted-line">{fileError}</p>
        ) : (
          <pre className="familiar-skills__file-content">{fileText ?? ""}</pre>
        )}
      </div>
    </div>
  );
}
