"use client";

import { useEffect, useState } from "react";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { useGlyphOverrides } from "@/lib/cave-glyph-overrides";
import { useFamiliarImages } from "@/lib/cave-familiar-images";
import { useFamiliarOverrides } from "@/lib/cave-familiar-overrides";
import { resolveFamiliar } from "@/lib/familiar-resolve";
import { useFamiliarStudio } from "@/lib/familiar-studio-context";
import { Icon } from "@/lib/icon";
import type { Familiar } from "@/lib/types";
import {
  pickFamiliarMemory,
  formatRelTime,
  statusMeta,
  type FamiliarStatusInfo,
  type MemoryPeekEntry,
  type RawMemoryEntry,
} from "@/lib/familiar-card-data";

let familiarsCache: Promise<Record<string, FamiliarStatusInfo>> | null = null;
function loadFamiliarStatus(): Promise<Record<string, FamiliarStatusInfo>> {
  if (!familiarsCache) {
    familiarsCache = fetch("/api/familiars", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        const map: Record<string, FamiliarStatusInfo> = {};
        if (j?.ok && Array.isArray(j.familiars)) {
          for (const f of j.familiars) {
            map[f.id] = {
              status: f.status,
              lastSeen: f.last_seen ?? null,
              activeSessions: f.active_sessions,
            };
          }
        }
        return map;
      })
      .catch(() => ({}));
  }
  return familiarsCache;
}

let memoryCache: Promise<RawMemoryEntry[]> | null = null;
function loadMemoryEntries(): Promise<RawMemoryEntry[]> {
  if (!memoryCache) {
    memoryCache = fetch("/api/memory", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => (j?.ok && Array.isArray(j.entries) ? (j.entries as RawMemoryEntry[]) : []))
      .catch(() => []);
  }
  return memoryCache;
}

function useFamiliarStatus(id: string): { info: FamiliarStatusInfo | null; failed: boolean } {
  const [info, setInfo] = useState<FamiliarStatusInfo | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    loadFamiliarStatus().then((map) => {
      if (!alive) return;
      if (map[id]) setInfo(map[id]);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [id]);
  return { info, failed };
}

function useFamiliarMemory(id: string): { entries: MemoryPeekEntry[]; loading: boolean } {
  const [entries, setEntries] = useState<MemoryPeekEntry[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    loadMemoryEntries().then((all) => {
      if (!alive) return;
      setEntries(pickFamiliarMemory(all, id, 3));
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [id]);
  return { entries, loading };
}

export function FamiliarInlineCard({
  familiar,
  cardId,
  onClose,
}: {
  familiar: Familiar;
  cardId: string;
  onClose: () => void;
}) {
  const overrides = useGlyphOverrides();
  const images = useFamiliarImages();
  const familiarOverrides = useFamiliarOverrides();
  const resolved = resolveFamiliar(familiar, {
    override: familiarOverrides[familiar.id],
    image: images[familiar.id],
    glyphOverride: overrides[familiar.id],
    archived: false,
  });

  const { openFamiliarStudio } = useFamiliarStudio();
  const { info, failed } = useFamiliarStatus(familiar.id);
  const { entries, loading } = useFamiliarMemory(familiar.id);

  const meta = statusMeta(info?.status);

  function act(fn: () => void) {
    fn();
    onClose();
  }

  return (
    <div id={cardId} role="region" aria-label={`${familiar.display_name} details`} className="familiar-inline-card">
      <button type="button" aria-label="Close" className="familiar-inline-card__close" onClick={onClose}>
        <Icon name="ph:x" width={12} aria-hidden />
      </button>

      <div className="familiar-inline-card__identity">
        <FamiliarAvatar familiar={resolved} size="xl" />
        <div className="familiar-inline-card__id-text">
          <div className="familiar-inline-card__name">{familiar.display_name}</div>
          <div className="familiar-inline-card__role">{familiar.role}</div>
          {familiar.description ? (
            <p className="familiar-inline-card__desc">{familiar.description}</p>
          ) : null}
        </div>
      </div>

      <div className="familiar-inline-card__status">
        {!info ? (
          <span className="familiar-inline-card__status-muted">status unavailable</span>
        ) : (
          <>
            <span
              className="familiar-inline-card__dot"
              style={{ backgroundColor: meta.color }}
              data-pulse={meta.pulse ? "1" : undefined}
              aria-hidden
            />
            <span>{meta.label}</span>
            <span className="familiar-inline-card__status-muted">· seen {formatRelTime(info?.lastSeen)}</span>
            {info?.activeSessions ? (
              <span className="familiar-inline-card__status-muted">· {info.activeSessions} active</span>
            ) : null}
          </>
        )}
      </div>

      <div className="familiar-inline-card__actions">
        <button
          type="button"
          onClick={() =>
            act(() => window.dispatchEvent(new CustomEvent("cave:familiar-select", { detail: { familiarId: familiar.id } })))
          }
        >
          <Icon name="ph:users-three" width={13} aria-hidden /> Switch to
        </button>
        <button type="button" onClick={() => act(() => openFamiliarStudio(familiar.id))}>
          <Icon name="ph:sliders-horizontal" width={13} aria-hidden /> Studio
        </button>
        <button type="button" onClick={() => act(() => openFamiliarStudio(familiar.id, "identity"))}>
          <Icon name="ph:pencil-simple" width={13} aria-hidden /> Edit profile
        </button>
        <button
          type="button"
          onClick={() =>
            act(() => window.dispatchEvent(new CustomEvent("cave:agents-new-chat", { detail: { familiarId: familiar.id } })))
          }
        >
          <Icon name="ph:chat-circle-dots" width={13} aria-hidden /> New chat
        </button>
      </div>

      <div className="familiar-inline-card__memory">
        <div className="familiar-inline-card__memory-head">
          <span>Recent memory</span>
          <button type="button" aria-label="View all memory" className="familiar-inline-card__view-all" onClick={() => act(() => openFamiliarStudio(familiar.id, "memory"))}>
            View all →
          </button>
        </div>
        {loading ? (
          <div className="familiar-inline-card__memory-muted">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="familiar-inline-card__memory-muted">No memory yet</div>
        ) : (
          <ul className="familiar-inline-card__memory-list">
            {entries.map((m) => (
              <li key={m.fullPath} className="familiar-inline-card__memory-item">
                <span className="familiar-inline-card__memory-title">{m.title}</span>
                {m.excerpt ? <span className="familiar-inline-card__memory-excerpt">{m.excerpt}</span> : null}
                <span className="familiar-inline-card__memory-time">{formatRelTime(m.modified)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
