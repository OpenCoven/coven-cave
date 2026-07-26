"use client";

import "@/styles/cave-chat.css";

import { useEffect, useState } from "react";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { useGlyphOverrides } from "@/lib/cave-glyph-overrides";
import { useFamiliarImages } from "@/lib/cave-familiar-images";
import { useFamiliarOverrides } from "@/lib/cave-familiar-overrides";
import { resolveFamiliar } from "@/lib/familiar-resolve";
import { useFamiliarStudio } from "@/lib/familiar-studio-context";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { SkeletonRows } from "@/components/ui/skeleton";
import { openGrimoireDoc } from "@/lib/grimoire-link";
import type { Familiar } from "@/lib/types";
import {
  loadFamiliarAnalyticsData,
  buildFamiliarAnalyticsModel,
} from "@/components/familiar-analytics-data";
import {
  deriveFamiliarCardInsights,
  type FamiliarCardInsights,
  type CardAction,
} from "@/lib/familiar-card-insights";
import {
  pickFamiliarMemory,
  formatRelTime,
  statusMeta,
  type FamiliarStatusInfo,
  type MemoryPeekEntry,
  type RawMemoryEntry,
} from "@/lib/familiar-card-data";

// Module-level caches keep repeated card opens cheap, but a FAILED load must
// not be cached for the app's lifetime — that turned one transient error into
// a permanent "No memory yet" on every card until a full reload (cave-2ex2).
// Failures resolve to null AND clear the cache so the next mount retries.
let familiarsCache: Promise<Record<string, FamiliarStatusInfo> | null> | null = null;
function loadFamiliarStatus(): Promise<Record<string, FamiliarStatusInfo> | null> {
  if (!familiarsCache) {
    familiarsCache = fetch("/api/familiars", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j?.ok || !Array.isArray(j.familiars)) throw new Error("familiars load failed");
        const map: Record<string, FamiliarStatusInfo> = {};
        for (const f of j.familiars) {
          map[f.id] = {
            status: f.status,
            lastSeen: f.last_seen ?? null,
            activeSessions: f.active_sessions,
          };
        }
        return map;
      })
      .catch(() => {
        familiarsCache = null;
        return null;
      });
  }
  return familiarsCache;
}

let memoryCache: Promise<RawMemoryEntry[] | null> | null = null;
function loadMemoryEntries(): Promise<RawMemoryEntry[] | null> {
  if (!memoryCache) {
    memoryCache = fetch("/api/memory", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j?.ok || !Array.isArray(j.entries)) throw new Error("memory load failed");
        return j.entries as RawMemoryEntry[];
      })
      .catch(() => {
        memoryCache = null;
        return null;
      });
  }
  return memoryCache;
}

// Insight layer (cave-ck70): reuse the analytics loader + model builder the
// full analytics view already has, reduced to card-sized judgment aids by
// deriveFamiliarCardInsights. Cached per familiar for cheap re-opens; a load
// that yields no familiar (daemon down, roster fetch failed) resolves null
// and CLEARS the cache so the next open retries (cave-2ex2 discipline).
const insightsCache = new Map<string, Promise<FamiliarCardInsights | null>>();
function loadCardInsights(familiarId: string): Promise<FamiliarCardInsights | null> {
  let cached = insightsCache.get(familiarId);
  if (!cached) {
    cached = loadFamiliarAnalyticsData(familiarId)
      .then((data) => {
        const model = buildFamiliarAnalyticsModel(data);
        if (!model.familiar) throw new Error("familiar roster unavailable");
        return deriveFamiliarCardInsights(model);
      })
      .catch(() => {
        insightsCache.delete(familiarId);
        return null;
      });
    insightsCache.set(familiarId, cached);
  }
  return cached;
}

function useCardInsights(id: string): FamiliarCardInsights | null {
  const [insights, setInsights] = useState<FamiliarCardInsights | null>(null);
  useEffect(() => {
    let alive = true;
    loadCardInsights(id).then((value) => {
      if (alive) setInsights(value);
    });
    return () => {
      alive = false;
    };
  }, [id]);
  return insights;
}

function useFamiliarStatus(id: string): { info: FamiliarStatusInfo | null; failed: boolean } {
  const [info, setInfo] = useState<FamiliarStatusInfo | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    loadFamiliarStatus().then((map) => {
      if (!alive) return;
      if (map?.[id]) setInfo(map[id]);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [id]);
  return { info, failed };
}

function useFamiliarMemory(id: string): { entries: MemoryPeekEntry[]; loading: boolean; failed: boolean } {
  const [entries, setEntries] = useState<MemoryPeekEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);
    loadMemoryEntries().then((all) => {
      if (!alive) return;
      // null = the load FAILED — an error is not evidence of an empty memory
      // (the old path rendered "No memory yet" over it; cave-2ex2).
      if (all === null) setFailed(true);
      else setEntries(pickFamiliarMemory(all, id, 3));
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [id]);
  return { entries, loading, failed };
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
  const { info, failed: statusFailed } = useFamiliarStatus(familiar.id);
  const { entries, loading, failed: memoryFailed } = useFamiliarMemory(familiar.id);
  const insights = useCardInsights(familiar.id);

  const meta = statusMeta(info?.status);

  function act(fn: () => void) {
    fn();
    onClose();
  }

  function openSession(sessionId: string) {
    act(() => window.dispatchEvent(new CustomEvent("cave:agents-open-session", { detail: { sessionId } })));
  }

  function runCardAction(action: CardAction) {
    switch (action.kind) {
      case "resume-session":
        if (action.sessionId) openSession(action.sessionId);
        break;
      case "fix-contract":
        act(() => openFamiliarStudio(familiar.id, "contract"));
        break;
      case "review-heals":
        act(() => window.location.assign(`/dashboard/familiars/${encodeURIComponent(familiar.id)}/analytics`));
        break;
      case "refresh-memory":
        act(() => openFamiliarStudio(familiar.id, "memory"));
        break;
    }
  }

  return (
    <div id={cardId} role="region" aria-label={`${familiar.display_name} details`} className="familiar-inline-card">
      <button type="button" aria-label="Close" className="familiar-inline-card__close" onClick={onClose}>
        <Icon name="ph:x" width={12} aria-hidden />
      </button>

      <div className="familiar-inline-card__identity">
        {/* The enlarged preview allows editing too — same identity-tab target
            as the "Edit profile" quick action below. */}
        <FamiliarAvatar
          familiar={resolved}
          size="xl"
          expandable
          expandFooterActions={
            <Button
              variant="secondary"
              size="sm"
              leadingIcon="ph:pencil-simple"
              onClick={() => act(() => openFamiliarStudio(familiar.id, "identity"))}
            >
              Edit profile
            </Button>
          }
        />
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
          <span className="familiar-inline-card__status-muted">
            {statusFailed ? "status unavailable — reopen to retry" : "checking status…"}
          </span>
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

      {/* Trust & health one-liner — should I hand this familiar the task? */}
      {insights ? (
        <div className="familiar-inline-card__insight" data-tone={insights.insight.tone}>
          {insights.insight.text}
        </div>
      ) : null}

      {/* Activity meta: 7-day pulse, thumbs approval, top attention signal. */}
      {insights && (insights.sessionsLast7d > 0 || insights.feedback || insights.topSignal) ? (
        <div className="familiar-inline-card__meta">
          {insights.sessionsLast7d > 0 ? (
            <span className="familiar-inline-card__meta-item">
              <Icon name="ph:heartbeat" width={12} aria-hidden /> {insights.sessionsLast7d} session
              {insights.sessionsLast7d === 1 ? "" : "s"} · 7d
            </span>
          ) : null}
          {insights.feedback ? (
            <span
              className="familiar-inline-card__meta-item"
              title={insights.feedback.topModel ? `most-rated model: ${insights.feedback.topModel}` : undefined}
            >
              <Icon name="ph:thumbs-up" width={12} aria-hidden /> {Math.round(insights.feedback.approval * 100)}% of{" "}
              {insights.feedback.total} rated
            </span>
          ) : null}
          {insights.topSignal ? (
            <span className="familiar-inline-card__signal" data-severity={insights.topSignal.severity}>
              <Icon name="ph:warning-circle" width={12} aria-hidden /> {insights.topSignal.label}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Live workload — WHAT it's doing, not just an "N active" count. */}
      {insights && insights.runningSessions.length > 0 ? (
        <div className="familiar-inline-card__workload">
          <div className="familiar-inline-card__workload-head">Working on</div>
          <ul className="familiar-inline-card__workload-list">
            {insights.runningSessions.map((s) => (
              <li key={s.id}>
                <button type="button" className="familiar-inline-card__workload-item" onClick={() => openSession(s.id)}>
                  <Icon name="ph:play" width={12} aria-hidden />
                  <span className="familiar-inline-card__workload-title">{s.title}</span>
                  <span className="familiar-inline-card__workload-time">{formatRelTime(s.updatedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="familiar-inline-card__actions">
        {/* State-driven quick actions ride ahead of the static row. */}
        {insights?.actions.map((action) => (
          <button
            key={action.kind}
            type="button"
            className="familiar-inline-card__action-contextual"
            onClick={() => runCardAction(action)}
          >
            <Icon
              name={
                action.kind === "resume-session"
                  ? "ph:play"
                  : action.kind === "fix-contract"
                    ? "ph:shield-warning"
                    : action.kind === "review-heals"
                      ? "ph:wrench"
                      : "ph:arrows-clockwise"
              }
              width={13}
              aria-hidden
            />{" "}
            {action.label}
          </button>
        ))}
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
          <SkeletonRows count={3} className="familiar-inline-card__memory-loading" />
        ) : memoryFailed ? (
          // A failed load is NOT an empty memory (cave-2ex2). The cache
          // self-clears on failure, so reopening the card retries.
          <div className="familiar-inline-card__memory-muted">Memory unavailable right now — reopen to retry</div>
        ) : entries.length === 0 ? (
          <div className="familiar-inline-card__memory-muted">No memory yet</div>
        ) : (
          <ul className="familiar-inline-card__memory-list">
            {entries.map((m) => (
              <li key={m.fullPath}>
                {/* Each peek row is a card that lands on the doc itself in the
                    Grimoire editor — same deep link the command palette uses. */}
                <button
                  type="button"
                  className="familiar-inline-card__memory-item focus-ring-inset"
                  title={`Open in Grimoire — ${m.relPath}`}
                  onClick={() => act(() => openGrimoireDoc("memory", m.fullPath))}
                >
                  <span className="familiar-inline-card__memory-title">
                    {m.title}
                    {m.stale ? <span className="familiar-inline-card__memory-stale">stale</span> : null}
                  </span>
                  {m.excerpt ? <span className="familiar-inline-card__memory-excerpt">{m.excerpt}</span> : null}
                  <span className="familiar-inline-card__memory-time">
                    {formatRelTime(m.modified)}
                    <Icon name="ph:arrow-bend-up-right" width={10} className="familiar-inline-card__memory-open" aria-hidden />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
