"use client";

/**
 * Scribe Surface — the Writing Desk.
 *
 * Drafting and durable publishing for a scribe familiar. Left rail: the
 * scribe's local drafts plus real source material (the familiar's memory
 * inventory and recent journal days). Center: the writing canvas — title,
 * prose, tags, live word count. Right sidebar: publishing controls that write
 * REAL Knowledge Vault entries (`POST /api/knowledge`, republish-in-place by
 * id, deep link into the Grimoire) and the selected draft's facts. Bottom
 * drawer: the vault's published works visible to this familiar.
 *
 * Drafts live in per-familiar Role Surface state until published — publishing
 * is the real durable write. Panels with nothing to show say so.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import type { RoleSurfaceContext, SurfaceMemoryEntry } from "@/lib/role-surfaces";
import { useRoleSurfaceState } from "@/lib/role-surface-state";
import { openGrimoireDoc } from "@/lib/grimoire-link";
import { relativeTime } from "@/lib/relative-time";
import { countWords, deskSummary, parseTags, readingTimeLabel, type ScribeDraft } from "./scribe-craft";
import { RailSection, SurfaceCanvas, SurfaceEmpty, SurfaceRail, SurfaceRoom } from "./surface-room";
import { SCRIBE_SURFACE_ID } from "./ids";

export type ScribeState = {
  drafts: ScribeDraft[];
  selectedId: string | null;
  /** Publish visibility: this familiar only, or every familiar. */
  scope: "familiar" | "global";
  drawerOpen: boolean;
  /** Latest desk counts — read by the registration manifest's status chip. */
  lastSummary: { drafts: number; words: number } | null;
};

export const SCRIBE_INITIAL_STATE: ScribeState = {
  drafts: [],
  selectedId: null,
  scope: "familiar",
  drawerOpen: false,
  lastSummary: null,
};

type KnowledgeEntryWire = {
  id: string;
  title: string;
  tags: string[];
  scope: "global" | string[];
  enabled: boolean;
};

type JournalDayWire = {
  date: string;
  preview: string;
  reflectedBy: string | null;
  modified: string | null;
};

const uid = () => Math.random().toString(36).slice(2, 10);

export function ScribeSurface({ context }: { context: RoleSurfaceContext }) {
  const familiarId = context.activeFamiliar.id;
  const [state, patch] = useRoleSurfaceState<ScribeState>(familiarId, SCRIBE_SURFACE_ID, SCRIBE_INITIAL_STATE);

  const selected = state.drafts.find((d) => d.id === state.selectedId) ?? null;

  // Keep the manifest's status chip in step with the persisted drafts.
  const summary = useMemo(() => deskSummary(state.drafts), [state.drafts]);
  useEffect(() => {
    if (state.lastSummary?.drafts === summary.drafts && state.lastSummary?.words === summary.words) return;
    patch({ lastSummary: { drafts: summary.drafts, words: summary.words } });
  }, [summary, state.lastSummary, patch]);

  // ── Source material: the familiar's real memory inventory ─────────────────
  const [sources, setSources] = useState<SurfaceMemoryEntry[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    context.memory.listEntries().then((entries) => {
      if (cancelled) return;
      const recent = [...entries]
        .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime())
        .slice(0, 8);
      setSources(recent);
    });
    return () => {
      cancelled = true;
    };
  }, [context.memory]);

  // ── Source material: recent journal days ──────────────────────────────────
  const [journalDays, setJournalDays] = useState<JournalDayWire[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/journal", { cache: "no-store" });
        const json = res.ok ? ((await res.json()) as { ok?: boolean; days?: JournalDayWire[] }) : null;
        if (!cancelled) setJournalDays((json?.days ?? []).slice(0, 5));
      } catch {
        if (!cancelled) setJournalDays([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Published works: real Knowledge Vault entries for this familiar ───────
  const [works, setWorks] = useState<KnowledgeEntryWire[] | null>(null);
  const loadWorks = useCallback(async () => {
    try {
      const res = await fetch(`/api/knowledge?familiarId=${encodeURIComponent(familiarId)}`, { cache: "no-store" });
      const json = res.ok ? ((await res.json()) as { ok?: boolean; entries?: KnowledgeEntryWire[] }) : null;
      setWorks(json?.entries ?? []);
    } catch {
      setWorks([]);
    }
  }, [familiarId]);
  useEffect(() => {
    void loadWorks();
  }, [loadWorks]);

  // ── Draft editing (local until published) ─────────────────────────────────
  const newDraft = () => {
    const now = new Date().toISOString();
    const draft: ScribeDraft = {
      id: uid(),
      title: "",
      body: "",
      tags: "",
      createdAt: now,
      updatedAt: now,
      publishedId: null,
    };
    patch({ drafts: [draft, ...state.drafts], selectedId: draft.id });
  };

  const updateSelected = (update: Partial<ScribeDraft>) => {
    if (!selected) return;
    patch({
      drafts: state.drafts.map((d) =>
        d.id === selected.id ? { ...d, ...update, updatedAt: new Date().toISOString() } : d,
      ),
    });
  };

  const discardSelected = () => {
    if (!selected) return;
    patch({ drafts: state.drafts.filter((d) => d.id !== selected.id), selectedId: null });
  };

  // ── Publishing: the real durable write ────────────────────────────────────
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const publishSelected = async () => {
    if (!selected || publishing) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const res = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(selected.publishedId ? { id: selected.publishedId } : {}),
          title: selected.title.trim(),
          body: selected.body,
          tags: parseTags(selected.tags),
          scope: state.scope === "global" ? "global" : [familiarId],
        }),
      });
      const json = res.ok ? ((await res.json()) as { ok?: boolean; entry?: { id: string } }) : null;
      if (!json?.ok || !json.entry?.id) {
        throw new Error(`status ${res.status}`);
      }
      updateSelected({ publishedId: json.entry.id });
      await loadWorks();
    } catch {
      setPublishError("Publish failed — the Knowledge Vault didn't accept the entry.");
    } finally {
      setPublishing(false);
    }
  };

  const words = selected ? countWords(selected.body) : 0;
  const publishable = selected != null && (selected.title.trim().length > 0 || selected.body.trim().length > 0);

  return (
    <SurfaceRoom
      accentHue={320}
      drawerTitle="Published works"
      drawerOpen={state.drawerOpen}
      onToggleDrawer={() => patch({ drawerOpen: !state.drawerOpen })}
      drawer={
        <div className="role-surface-drawer-grid">
          <RailSection title="In the Knowledge Vault" iconName="ph:books">
            {works == null ? (
              <SurfaceEmpty title="Loading the vault…" />
            ) : works.length === 0 ? (
              <SurfaceEmpty
                title="Nothing published yet."
                hint="Entries this familiar can read appear here once published."
              />
            ) : (
              <ul className="role-surface-list" aria-label="Published works">
                {works.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className="role-surface-row-btn focus-ring-inset"
                      onClick={() => openGrimoireDoc("knowledge", entry.id)}
                    >
                      {entry.title || entry.id}
                      <span className="role-surface-tag">{entry.scope === "global" ? "all familiars" : "scoped"}</span>
                      {!entry.enabled && <span className="role-surface-tag">disabled</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </RailSection>
        </div>
      }
    >
      <SurfaceRail side="left" label="Drafts and sources">
        <RailSection
          title="Drafts"
          iconName="ph:pencil-line-bold"
          actions={
            <button type="button" className="role-surface-chip focus-ring" onClick={newDraft}>
              <Icon name="ph:plus" width={11} height={11} aria-hidden /> New
            </button>
          }
        >
          {state.drafts.length === 0 ? (
            <SurfaceEmpty title="No drafts on the desk." hint="Start one — drafts stay local until you publish." />
          ) : (
            <ul className="role-surface-list" aria-label="Drafts">
              {state.drafts.map((draft) => (
                <li key={draft.id}>
                  <button
                    type="button"
                    className={`role-surface-row-btn focus-ring-inset${draft.id === state.selectedId ? " role-surface-row-btn--active" : ""}`}
                    aria-current={draft.id === state.selectedId ? "true" : undefined}
                    onClick={() => patch({ selectedId: draft.id })}
                  >
                    {draft.title.trim() || "Untitled"}
                    {draft.publishedId != null && <span className="role-surface-tag">published</span>}
                    <span className="role-surface-tag">{countWords(draft.body)}w</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </RailSection>
        <RailSection title="Source material" iconName="ph:books">
          {sources == null ? (
            <SurfaceEmpty title="Loading memory…" />
          ) : sources.length === 0 ? (
            <SurfaceEmpty title="No memory on file." hint="The familiar's memory inventory feeds this shelf." />
          ) : (
            <ul className="role-surface-list" aria-label="Recent memory">
              {sources.map((entry) => (
                <li key={entry.fullPath} className="role-surface-list-row">
                  <span className="role-surface-memory-path">{entry.relPath}</span>
                  <span className="role-surface-tag">{relativeTime(entry.modified)}</span>
                </li>
              ))}
            </ul>
          )}
        </RailSection>
        <RailSection title="Recent journal" iconName="ph:book-open">
          {journalDays == null ? (
            <SurfaceEmpty title="Loading journal…" />
          ) : journalDays.length === 0 ? (
            <SurfaceEmpty title="No journal entries yet." />
          ) : (
            <ul className="role-surface-list" aria-label="Recent journal days">
              {journalDays.map((day) => (
                <li key={day.date}>
                  <button
                    type="button"
                    className="role-surface-row-btn focus-ring-inset"
                    onClick={() => openGrimoireDoc("journal", day.date)}
                  >
                    {day.date}
                    <span className="role-surface-memory-excerpt">{day.preview}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </RailSection>
      </SurfaceRail>

      <SurfaceCanvas label="Writing canvas">
        {!selected ? (
          <SurfaceEmpty
            iconName="ph:feather"
            title="The desk is clear."
            hint="Start a draft from the rail — it stays local until you publish it to the Knowledge Vault."
          />
        ) : (
          <div className="role-surface-canvas-stack">
            <div className="role-surface-inline-form">
              <input
                value={selected.title}
                onChange={(e) => updateSelected({ title: e.target.value })}
                placeholder="Title…"
                aria-label="Draft title"
              />
            </div>
            <textarea
              className="role-surface-notes"
              value={selected.body}
              onChange={(e) => updateSelected({ body: e.target.value })}
              placeholder="Write…"
              aria-label="Draft body"
            />
            <div className="role-surface-inline-form">
              <input
                value={selected.tags}
                onChange={(e) => updateSelected({ tags: e.target.value })}
                placeholder="Tags (comma separated)…"
                aria-label="Draft tags"
              />
            </div>
            <p className="role-surface-hint" aria-label="Draft stats">
              {words} words · {readingTimeLabel(words)} · edited {relativeTime(selected.updatedAt)}
            </p>
          </div>
        )}
      </SurfaceCanvas>

      <SurfaceRail side="right" label="Publishing">
        {!selected ? (
          <RailSection title="Publish" iconName="ph:book-open-bold">
            <SurfaceEmpty title="Select a draft to publish it." />
          </RailSection>
        ) : (
          <>
            <RailSection title="Publish" iconName="ph:book-open-bold">
              <p className="role-surface-field-label">Visible to</p>
              <div className="role-surface-btn-row" role="group" aria-label="Publish scope">
                <button
                  type="button"
                  className={`role-surface-chip focus-ring${state.scope === "familiar" ? " role-surface-chip--accent" : ""}`}
                  aria-pressed={state.scope === "familiar"}
                  onClick={() => patch({ scope: "familiar" })}
                >
                  This familiar
                </button>
                <button
                  type="button"
                  className={`role-surface-chip focus-ring${state.scope === "global" ? " role-surface-chip--accent" : ""}`}
                  aria-pressed={state.scope === "global"}
                  onClick={() => patch({ scope: "global" })}
                >
                  All familiars
                </button>
              </div>
              {publishError ? (
                <p role="alert" className="role-surface-hint">
                  {publishError}
                </p>
              ) : null}
              <div className="role-surface-btn-row">
                <button
                  type="button"
                  className="role-surface-chip role-surface-chip--accent focus-ring"
                  disabled={!publishable || publishing}
                  onClick={() => void publishSelected()}
                >
                  {publishing ? "Publishing…" : selected.publishedId ? "Republish" : "Publish to vault"}
                </button>
                {selected.publishedId && (
                  <button
                    type="button"
                    className="role-surface-chip focus-ring"
                    onClick={() => openGrimoireDoc("knowledge", selected.publishedId as string)}
                  >
                    Open in Grimoire
                    <Icon name="ph:arrow-square-out" width={12} height={12} aria-hidden />
                  </button>
                )}
              </div>
              <p className="role-surface-hint">
                Publishing writes a real Knowledge Vault entry; republishing updates it in place.
              </p>
            </RailSection>
            <RailSection title="Draft facts" iconName="ph:note">
              <dl className="role-surface-facts">
                <dt>Started</dt>
                <dd>{new Date(selected.createdAt).toLocaleString()}</dd>
                <dt>Edited</dt>
                <dd>{new Date(selected.updatedAt).toLocaleString()}</dd>
                <dt>Length</dt>
                <dd>
                  {words} words · {readingTimeLabel(words)}
                </dd>
                <dt>Vault entry</dt>
                <dd>{selected.publishedId ?? "Not published"}</dd>
              </dl>
              <div className="role-surface-btn-row">
                <button type="button" className="role-surface-chip focus-ring" onClick={discardSelected}>
                  Discard draft
                </button>
              </div>
            </RailSection>
          </>
        )}
      </SurfaceRail>
    </SurfaceRoom>
  );
}
