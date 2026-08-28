"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { Familiar, SessionRow } from "@/lib/types";
import { SLASH_COMMANDS, canonicalize } from "@/lib/slash-commands";
import { Icon } from "@/lib/icon";
import { platformizeHint, useKeySymbols } from "@/lib/platform-keys";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { parseFamiliarToken, resolveFamiliarIds } from "@/lib/command-palette-scope";
import { fuzzyMatch, bestFuzzyScore } from "@/lib/fuzzy-match";
import { relativeTime } from "@/lib/relative-time";
import { useDateTimePrefs } from "@/lib/datetime-format";
import { MarkdownBlock } from "@/components/message-bubble";
import { type WorkspaceNavMode } from "@/lib/workspace-navigation";
import { paletteDestinations } from "@/lib/workspace-destination-policy";
import { useProjects } from "@/lib/use-projects";
import {
  PALETTE_CATEGORIES,
  PALETTE_CATEGORY_LABEL,
  filterPaletteRows,
  paletteResultCounts,
  paletteResultSummary,
  type PaletteCategory,
} from "@/lib/command-palette-search";
import {
  clearRecentSearches,
  readRecentSearches,
  recordRecentSearch,
} from "@/lib/recent-searches";
import {
  SETTINGS_INDEX,
  settingsSectionLabel,
  type SettingsIndexEntry,
} from "@/components/settings-sections";
import { paletteGroup, shortProjectRoot } from "@/lib/command-palette-grouping";
import { buildSalemSearchContext, isSalemContextRow } from "@/lib/command-palette-salem-context";
import {
  broadenToGlobal,
  parseSearchQuery,
  searchQueryFromUrlParams,
  searchQueryToUrlString,
} from "@/lib/search-query";
import { chipLabelFor, type SearchFilter, type SearchQueryState, type SearchScope } from "@/lib/search-filters";
import { deriveImplicitScopes } from "@/lib/search-context";
import type { CanonicalMemorySummary } from "@/lib/canonical-memory";
import { loadCanonicalMemoryList } from "@/lib/canonical-memory-resources";

// Status → dot class for session rows, mirroring the Sessions tab's colors. Only
// "notable" states get a dot (running pulses green, failed/queued/paused tint);
// completed/idle sessions stay dotless so the Recent list doesn't get speckled.
const SESSION_DOT: Record<string, string> = {
  running: "bg-[var(--color-success)] animate-pulse",
  failed: "bg-[var(--color-danger)]",
  queued: "bg-[var(--color-warning)]",
  paused: "bg-[var(--accent-presence-soft)]",
};

type PaletteIntent =
  | { kind: "switch-familiar"; familiarId: string }
  | { kind: "open-session"; sessionId: string; familiarId?: string | null; findQuery?: string }
  | { kind: "new-chat"; familiarId?: string }
  | { kind: "slash"; command: string; args?: string }
  | { kind: "back-to-list" }
  | { kind: "open-tui-session"; sessionId: string }
  | { kind: "open-board" }
  | { kind: "set-board-view"; view: "kanban" | "table" | "gantt" }
  | { kind: "go-to-surface"; mode: WorkspaceNavMode | `surface:${string}`; familiarId?: string }
  | { kind: "open-project"; root: string }
  | { kind: "focus-card"; cardId: string }
  | { kind: "create-task"; title: string }
  | { kind: "open-memory-file"; path: string }
  | {
      kind: "open-coven-memory";
      id: string;
      familiarId: string;
    }
  | {
      kind: "open-setting";
      section: SettingsIndexEntry["section"];
      group?: string;
    }
  | { kind: "open-href"; href: string };

type Card = {
  id: string;
  title: string;
  status: string;
  priority: string;
  familiarId: string | null;
  labels: string[];
  updatedAt?: string;
};

type CanonicalPaletteEntry = Pick<
  CanonicalMemorySummary,
  | "id"
  | "familiarId"
  | "title"
  | "excerpt"
  | "source"
  | "verification"
  | "relativeUpdatedAt"
>;

type CanonicalPaletteState =
  | { state: "loading"; entries: CanonicalPaletteEntry[] }
  | { state: "ready"; entries: CanonicalPaletteEntry[] }
  | { state: "error"; entries: CanonicalPaletteEntry[] };

type FsMemoryEntry = {
  root: string;
  rootLabel: string;
  relPath: string;
  fullPath: string;
  modified: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  familiars: Familiar[];
  sessions: SessionRow[];
  activeFamiliarId: string | null;
  /** Role Surface rooms visible for the active scope — appended to the
   *  "Go to" launcher rows so ⌘K reaches rooms exactly like sidebar surfaces
   *  (cave-cc5r). Registry-driven; empty/omitted adds nothing. */
  roleSurfaces?: readonly {
    mode: `surface:${string}`;
    label: string;
    description: string;
    familiarId?: string;
  }[];
  initialQuery?: string;
  onQueryChange?: (query: string) => void;
  /** Active workspace state used to derive implicit context scopes (cave-ychtl.6). */
  activeProjectId?: string | null;
  activeProjectName?: string | null;
  activeSessionId?: string | null;
  runtime?: string | null;
  onIntent: (intent: PaletteIntent) => void;
};

// One hit from the conversation content search (/api/chat/search).
type ConversationHit = {
  sessionId: string;
  title?: string;
  snippet: string;
  matchCount: number;
};

type Row =
  | { id: string; kind: "familiar"; familiar: Familiar }
  | { id: string; kind: "session"; session: SessionRow; familiar: Familiar | null }
  | { id: string; kind: "card"; card: Card; familiar: Familiar | null }
  | { id: string; kind: "coven-memory"; entry: CanonicalPaletteEntry; familiar: Familiar | null }
  | { id: string; kind: "fs-memory"; entry: FsMemoryEntry }
  | { id: string; kind: "command"; name: string; hint: string; intent: PaletteIntent }
  | { id: string; kind: "shortcut"; label: string; shortcut: string; action: () => void }
  | { id: string; kind: "create-task"; title: string }
  | { id: string; kind: "conversation-hit"; hit: ConversationHit }
  | { id: string; kind: "setting"; entry: SettingsIndexEntry }
  | { id: string; kind: "salem-answer"; query: string }
  | { id: string; kind: "search-result"; result: GlobalSearchHit };

/** A coordinator result row rendered by the global-search mode (cave-ychtl.6). */
type GlobalSearchHit = {
  id: string;
  providerId: string;
  entityType: string;
  title: string;
  excerpt: string;
  href: string;
  status: string | null;
};

const scopeKey = (scope: SearchScope) => `${scope.dimension}:${scope.id}`;
const filterKey = (filter: SearchFilter) => `${filter.key}=${String(filter.value)}`;

/** Icon per global-search entity type (cave-ychtl.6). */
const resultIcon = (entityType: string): string => {
  switch (entityType) {
    case "project": return "ph:folder-open-bold";
    case "familiar": return "ph:user-circle-bold";
    case "task": return "ph:check-square-bold";
    case "file": return "ph:file-text-bold";
    case "session":
    case "chat": return "ph:chat-circle-dots-bold";
    case "command": return "ph:terminal-window";
    case "setting": return "ph:gear-six";
    case "destination": return "ph:compass";
    case "memory": return "ph:bookmark-simple-bold";
    default: return "ph:magnifying-glass";
  }
};

const RESULT_LIMITS = {
  familiar: 6,
  session: 6,
  card: 6,
  covenMemory: 5,
  fsMemory: 8,
  command: 6,
  conversation: 6,
  setting: 8,
};

// ── @familiar query parsing ────────────────────────────────────────────────
// Users can scope the palette to a single familiar by typing `@<name>` anywhere
// in the query. The token matches a familiar's id / name / display_name
// (case- and whitespace-insensitive, substring). Everything else in the query
// becomes a free-text filter applied *within* that scope.
//
//   "@researcher"        → scope: researcher,  rest: ""
//   "@val readme"        → scope: valentina,   rest: "readme"
//   "browser @researcher"  → scope: researcher, rest: "browser"
//   "@"                  → scope: all (suggest list), rest: ""
//   "hello"              → no scope
//
// We only honour the *first* `@token` in the query — multiple `@`s collapse
// down to the first (the rest stay as literal text in the free-text portion).
// The parsing/resolution lives in the React-free `command-palette-scope` lib
// module (imported above) so it can be unit-tested directly; re-exported here
// to preserve the existing public import site.
export { parseFamiliarToken, resolveFamiliarIds };

export function CommandPalette({
  open,
  onClose,
  familiars,
  sessions,
  activeFamiliarId,
  roleSurfaces,
  initialQuery = "",
  onQueryChange,
  activeProjectId,
  activeProjectName,
  activeSessionId,
  runtime,
  onIntent,
}: Props) {
  useDateTimePrefs(); // subscribe: re-render when the date/time density pref changes
  // "Open project" rows jump into the Projects hub, which is itself scoped to
  // the active familiar — offer only projects that familiar can actually reach.
  // The palette is always mounted (it self-returns null when closed), so gate
  // the fetch on `open`, or it re-requests /api/projects on every active-familiar
  // change while the user can't even see the palette.
  const { projects } = useProjects({ familiarId: activeFamiliarId, enabled: open });
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<PaletteCategory>("all");
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [cards, setCards] = useState<Card[]>([]);
  const [canonicalMemoryState, setCanonicalMemoryState] =
    useState<CanonicalPaletteState>({ state: "loading", entries: [] });
  const [fsMemory, setFsMemory] = useState<FsMemoryEntry[]>([]);
  const [salemLoading, setSalemLoading] = useState(false);
  const [salemAnswer, setSalemAnswer] = useState<string | null>(null);
  const [salemError, setSalemError] = useState<string | null>(null);
  const [contentHits, setContentHits] = useState<ConversationHit[]>([]);
  // Global-search mode state (cave-ychtl.6). Active when the query carries a
  // structured filter, a shared link was restored, or Cmd/Ctrl+Enter broadened
  // the search; results then come from the coordinator via /api/search.
  const [globalMode, setGlobalMode] = useState(false);
  const [globalBroadened, setGlobalBroadened] = useState(false);
  const [linkState, setLinkState] = useState<SearchQueryState | null>(null);
  const [removedScopeKeys, setRemovedScopeKeys] = useState<Set<string>>(new Set());
  const [removedFilterKeys, setRemovedFilterKeys] = useState<Set<string>>(new Set());
  const [globalResults, setGlobalResults] = useState<GlobalSearchHit[]>([]);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [globalPartial, setGlobalPartial] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const keys = useKeySymbols();



  // Conversation content search (CHAT-D9-02 backend, surfaced here). Plain,
  // unscoped queries of length ≥2 hit /api/chat/search, debounced ~250ms with a
  // retype aborting the in-flight request — same shape the chat-list uses.
  useEffect(() => {
    const { token, rest } = parseFamiliarToken(query);
    const text = rest.trim();
    if (token !== null || text.startsWith("/") || text.length < 2) {
      setContentHits([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/chat/search?q=${encodeURIComponent(text)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const json = await res.json().catch(() => ({ ok: false }));
        if (controller.signal.aborted) return;
        setContentHits(json.ok && Array.isArray(json.hits) ? (json.hits as ConversationHit[]) : []);
      } catch {
        /* aborted retype or network hiccup — a newer effect owns the state */
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const updateQuery = (next: string) => {
    setQuery(next);
    onQueryChange?.(next);
    setSalemAnswer(null);
    setSalemError(null);
  };

  // ── Global-search mode (cave-ychtl.6) ────────────────────────────────────
  // Implicit context scopes derived from the active workspace state. These are
  // the chips Cmd/Ctrl+Enter removes; explicit filters always survive.
  const implicitScopes = useMemo(
    () =>
      deriveImplicitScopes({
        activeFamiliarId,
        familiars,
        activeProjectId,
        activeProjectName,
        activeSessionId,
        runtime,
      }),
    [activeFamiliarId, familiars, activeProjectId, activeProjectName, activeSessionId, runtime],
  );

  // A restored shared link is authoritative until the text is edited; typing
  // past its text re-parses from scratch (the link's chips only describe the
  // exact query it was shared with).
  const liveLinkState = linkState !== null && query === linkState.text ? linkState : null;

  const parsed = useMemo(
    () => parseSearchQuery(query, { scopes: implicitScopes }),
    [query, implicitScopes],
  );

  // Effective state for the request: the restored link, or the parsed query
  // minus whatever the user removed via chip buttons / Backspace.
  const effectiveState = useMemo(() => {
    if (liveLinkState) return liveLinkState;
    const scopes = parsed.state.scopes.filter((scope) => !removedScopeKeys.has(scopeKey(scope)));
    const filters = parsed.state.filters.filter((filter) => !removedFilterKeys.has(filterKey(filter)));
    return { ...parsed.state, scopes, filters };
  }, [liveLinkState, parsed, removedScopeKeys, removedFilterKeys]);

  // Cmd/Ctrl+Enter broadens: only implicit scopes go, explicit filters stay.
  const effectiveGlobalState = useMemo(() => {
    if (!effectiveState) return null;
    return globalBroadened ? broadenToGlobal(effectiveState) : effectiveState;
  }, [effectiveState, globalBroadened]);

  // Global mode is on when the query is structured (any filter), a shared link
  // was restored, or the user explicitly broadened. Plain text keeps the rich
  // palette rows.
  const globalModeActive =
    globalMode || liveLinkState !== null || parsed.state.filters.length > 0;

  const globalStateKey = useMemo(
    () => (globalModeActive && effectiveGlobalState ? JSON.stringify(effectiveGlobalState) : null),
    [globalModeActive, effectiveGlobalState],
  );

  // Coordinator-backed results, debounced and abortable (retype cancels).
  useEffect(() => {
    if (!open || !globalStateKey || !effectiveGlobalState) return;
    const controller = new AbortController();
    setGlobalLoading(true);
    setGlobalError(null);
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: effectiveGlobalState, limit: 20 }),
          signal: controller.signal,
        });
        const json = (await res.json().catch(() => ({ ok: false }))) as {
          ok?: boolean;
          results?: GlobalSearchHit[];
          partial?: boolean;
        };
        if (controller.signal.aborted) return;
        if (!json.ok) {
          setGlobalError("Search is unavailable right now.");
        } else {
          setGlobalResults(json.results ?? []);
          setGlobalPartial(Boolean(json.partial));
        }
      } catch {
        if (!controller.signal.aborted) setGlobalError("Search is unavailable right now.");
      } finally {
        if (!controller.signal.aborted) setGlobalLoading(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // effectiveGlobalState is stable because it derives from the key string.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, globalStateKey]);

  const removeScopeChip = (scope: SearchScope) => {
    setRemovedScopeKeys((previous) => {
      const next = new Set(previous);
      next.add(scopeKey(scope));
      return next;
    });
    setActiveIdx(0);
  };

  const removeFilterChip = (filter: SearchFilter) => {
    setRemovedFilterKeys((previous) => {
      const next = new Set(previous);
      next.add(filterKey(filter));
      return next;
    });
    setActiveIdx(0);
  };

  // Backspace with empty free text removes the final chip (scope or filter).
  const removeLastChip = () => {
    const state = effectiveState;
    if (!state) return;
    const chips = [
      ...state.filters.map((filter) => ({ kind: "filter" as const, filter })),
      ...state.scopes.map((scope) => ({ kind: "scope" as const, scope })),
    ];
    const last = chips[chips.length - 1];
    if (!last) return;
    if (last.kind === "scope") removeScopeChip(last.scope);
    else removeFilterChip(last.filter);
  };

  // Cmd/Ctrl+Enter: drop every implicit scope and search globally.
  const broadenGlobal = () => {
    setGlobalMode(true);
    setGlobalBroadened(true);
    setActiveIdx(0);
    inputRef.current?.focus();
  };

  const copySearchLink = async () => {
    const state = effectiveGlobalState ?? effectiveState;
    if (!state) return;
    const url = `${window.location.origin}${window.location.pathname}?${searchQueryToUrlString(state)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      /* clipboard unavailable — the link stays visible in the URL */
    }
  };

  // Close while serializing the canonical search state into the URL. Transient
  // typing never touches history; only a committed close (navigate, scrim
  // dismiss) writes, and only when the search is structured/global — a plain
  // palette use must not clobber unrelated query params the page already has.
  const closeWithState = () => {
    if (globalModeActive && effectiveGlobalState) {
      const state = effectiveGlobalState;
      const shareWorthy =
        state.text.trim() !== "" ||
        state.filters.length > 0 ||
        state.scopes.length > 0 ||
        state.phrases.length > 0;
      if (shareWorthy) {
        const url = new URL(window.location.href);
        url.search = searchQueryToUrlString(state);
        window.history.replaceState(null, "", url.toString());
      }
    }
    onClose();
  };

  useFocusTrap(open, dialogRef, { onEscape: closeWithState });

  // Fetch the searchable corpora once on first open. Cheap calls; refreshed
  // every time the palette opens so the index doesn't go stale.
  useEffect(() => {
    if (!open) return;
    setQuery(initialQuery);
    setCategory("all");
    setRecentSearches(readRecentSearches(window.localStorage));
    setActiveIdx(0);
    setSalemAnswer(null);
    setSalemError(null);
    const t = setTimeout(() => inputRef.current?.focus(), 10);

    let cancelled = false;
    setCanonicalMemoryState({ state: "loading", entries: [] });

    const loadBoardCorpus = async () => {
      try {
        const boardRes = await fetch("/api/board", { cache: "no-store" });
        const board = await boardRes.json();
        if (cancelled) return;
        if (board.ok) setCards(board.cards ?? []);
      } catch {
        /* board search stays independently usable from its last snapshot */
      }
    };

    const loadCanonicalCorpus = async () => {
      try {
        const canonical = await loadCanonicalMemoryList();
        if (cancelled) return;
        setCanonicalMemoryState(
          canonical.state === "ready"
            ? { state: "ready", entries: canonical.entries }
            : { state: "error", entries: [] },
        );
      } catch {
        if (cancelled) return;
        setCanonicalMemoryState({ state: "error", entries: [] });
      }
    };

    const loadFileMemoryCorpus = async () => {
      try {
        const fsRes = await fetch("/api/memory", { cache: "no-store" });
        const fs = await fsRes.json();
        if (cancelled) return;
        if (fs.ok) setFsMemory(fs.entries ?? []);
      } catch {
        /* file-memory search stays independently usable from its last snapshot */
      }
    };

    void Promise.allSettled([
      loadBoardCorpus(),
      loadCanonicalCorpus(),
      loadFileMemoryCorpus(),
    ]);

    return () => { cancelled = true; clearTimeout(t); };
  }, [open]);

  // Keep the keyboard-highlighted option visible: arrowing past the bottom of
  // the max-h-[60vh] list must scroll it into view, not just advance the index.
  useEffect(() => {
    if (!open) return;
    document
      .getElementById(`command-palette-option-${activeIdx}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, open]);

  useEffect(() => {
    if (!open) return;
    // Shared-link restoration (cave-ychtl.6): search params in the URL restore
    // the same chips, text, and presentation. The restored text seeds the
    // input; linkState keeps the restored filters/scopes authoritative until
    // the text is edited.
    const params = new URLSearchParams(window.location.search);
    const hasSearchState = ["v", "q", "phrase", "scope", "type", "view"].some((key) => params.has(key));
    const restored = searchQueryFromUrlParams(params);
    const restorable =
      hasSearchState &&
      (restored.text.trim() !== "" ||
        restored.filters.length > 0 ||
        restored.scopes.length > 0 ||
        restored.presentation !== "top");
    setLinkState(restorable ? restored : null);
    setGlobalMode(false);
    setGlobalBroadened(false);
    setRemovedScopeKeys(new Set());
    setRemovedFilterKeys(new Set());
    setGlobalResults([]);
    setGlobalError(null);
    setCopiedLink(false);
    setQuery(restorable ? restored.text : initialQuery);
    setCategory("all");
    setActiveIdx(0);
    setSalemAnswer(null);
    setSalemError(null);
  }, [initialQuery, open]);

  const familiarById = useMemo(() => new Map(familiars.map((f) => [f.id, f])), [familiars]);
  const allRows: Row[] = useMemo(() => {
    const { token, rest } = parseFamiliarToken(query);
    const q = rest.trim().toLowerCase();
    // Fuzzy match: power users type subsequences ("brd" → Board). `fz` widens the
    // per-field predicates; `rank` sorts a matched set by best fuzzy score (over
    // its label fields) so the closest match floats to the top while searching.
    const fz = (text: string) => fuzzyMatch(q, text);
    const rank = <T,>(items: T[], fields: (item: T) => Array<string | null | undefined>): T[] =>
      q
        ? [...items].sort((a, b) => (bestFuzzyScore(q, fields(b)) ?? -Infinity) - (bestFuzzyScore(q, fields(a)) ?? -Infinity))
        : items;
    const scope = resolveFamiliarIds(familiars, token);
    const scoped = scope !== null;
    // When the user has typed `@token` but no familiar matches it yet, we
    // surface the familiar suggestions only (so they can complete the handle)
    // and suppress everything else. This is also what we do for a bare `@`.
    const noFamiliarMatch = scoped && scope!.size === 0;

    const familiarSuggestionPool = rank(noFamiliarMatch ? familiars : familiars.filter((f) => {
      if (scoped && !scope!.has(f.id)) return false;
      if (!q) return true;
      return fz(f.display_name) || fz(f.role) || fz(f.harness ?? "");
    }), (f) => [f.display_name, f.role, f.harness]);
    const familiarRows: Row[] = familiarSuggestionPool
      .slice(0, RESULT_LIMITS.familiar)
      .map((f) => ({ id: `f:${f.id}`, kind: "familiar", familiar: f }));

    // If the familiar-handle resolved to nothing, only suggestions are useful.
    if (noFamiliarMatch) return familiarRows;

    const byRecency = (a: SessionRow, b: SessionRow) =>
      (Date.parse(b.updated_at || b.created_at) || 0) -
      (Date.parse(a.updated_at || a.created_at) || 0);
    const matchedSessions = sessions.filter((s) => {
      if (!s.familiarId) return false;
      // Browse mode is the "Recent chats" jump list — archived chats never
      // resurface there (the chat list's "Show archived" toggle is their
      // home). A typed query still finds them, like any explicit search.
      if (!q && s.archived_at) return false;
      if (scoped) {
        if (!scope!.has(s.familiarId)) return false;
        if (!q) return true;
        return fz(s.title ?? "") || fz(s.harness);
      }
      // Empty query → the "Recent" jump list: every familiar's sessions, not
      // just the active one. Recency ordering happens below the filter.
      if (!q) return true;
      return fz(s.title ?? "") || fz(s.harness) || fz(s.familiarId ?? "");
    });
    // Browse → recency; searching → best fuzzy match first.
    const sessionRows: Row[] = (!q
      ? [...matchedSessions].sort(byRecency)
      : rank(matchedSessions, (s) => [s.title, s.familiarId]))
      .slice(0, RESULT_LIMITS.session)
      .map((s) => ({
        id: `s:${s.id}`,
        kind: "session",
        session: s,
        familiar: s.familiarId ? familiarById.get(s.familiarId) ?? null : null,
      }));

    const cardRows: Row[] = rank(cards
      .filter((c) => {
        if (scoped) {
          if (!c.familiarId || !scope!.has(c.familiarId)) return false;
        }
        if (!q) return true;
        return (
          fz(c.title) ||
          (c.labels ?? []).some((l) => fz(l)) ||
          fz(c.status) ||
          fz(c.priority)
        );
      })
      // Empty query → lead with the most-recently-updated tasks ("recent tasks"
      // jump-list); while searching `rank` (below) orders by fuzzy score.
      .sort((a, b) => (q ? 0 : new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime())), (c) => [c.title, ...(c.labels ?? [])])
      .slice(0, RESULT_LIMITS.card)
      .map((c) => ({
        id: `card:${c.id}`,
        kind: "card",
        card: c,
        familiar: c.familiarId ? familiarById.get(c.familiarId) ?? null : null,
      }));

    const covenMemoryRows: Row[] = canonicalMemoryState.entries
      .filter((entry) => {
        if (scoped && !scope!.has(entry.familiarId)) return false;
        if (!q) return true;
        return (
          fz(entry.title) ||
          entry.excerpt.toLowerCase().includes(q) ||
          fz(entry.familiarId) ||
          fz(entry.source.label) ||
          fz(entry.verification.state) ||
          fz(entry.relativeUpdatedAt)
        );
      })
      .slice(0, RESULT_LIMITS.covenMemory)
      .map((entry) => ({
        id: `cm:${entry.id}`,
        kind: "coven-memory",
        entry,
        familiar: null,
      }));

    // fs-memory, slash commands, and shortcuts are not familiar-scoped, so
    // they're suppressed entirely whenever the user is using `@familiar`.
    const fsMemoryRows: Row[] = scoped
      ? []
      : fsMemory
          .filter((e) => !q || fz(e.relPath) || fz(e.rootLabel))
          .slice(0, RESULT_LIMITS.fsMemory)
          .map((e) => ({ id: `fm:${e.fullPath}`, kind: "fs-memory", entry: e }));

    // Slash queries carry arguments ("/remind in 30m …").
    // Command rows previously matched the whole query against the command
    // name, so any args made every command disappear and the query fell
    // through to create-task. Match on the first token and thread the rest
    // through the intent so commands run with their arguments.
    const slashMatch = rest.trim().match(/^(\/\S+)(?:\s+(\S[\s\S]*))?$/);
    const slashToken = slashMatch?.[1].toLowerCase() ?? null;
    const slashArgs = slashMatch?.[2]?.trim() ?? "";
    const slashCanonical = slashToken ? canonicalize(slashToken) : null;

    const cmdRows: Row[] = scoped
      ? []
      : SLASH_COMMANDS.filter((c) =>
          slashToken
            ? c.name.startsWith(slashToken) ||
              (c.aliases ?? []).some((a) => a.startsWith(slashToken))
            : !q ||
              fz(c.name) ||
              (c.aliases ?? []).some((a) => fz(a)) ||
              c.description.toLowerCase().includes(q),
        )
          .slice(0, RESULT_LIMITS.command)
          .map((c) => ({
            id: `c:${c.name}`,
            kind: "command",
            name: c.name,
            hint: c.hint,
            intent: {
              kind: "slash",
              command: c.name,
              ...(slashArgs ? { args: slashArgs } : {}),
            },
          }));

    // Reuse Settings' canonical index so a control relocated behind progressive
    // disclosure remains one search away. Settings stay out of empty browse mode
    // (83 rows would drown the useful recency list) and appear only for a query.
    const settingRows: Row[] = (scoped || slashToken || !q)
      ? []
      : rank(
          SETTINGS_INDEX.filter((entry) => {
            const section = settingsSectionLabel(entry.section);
            return (
              fz(section) ||
              fz(entry.group ?? "") ||
              entry.keywords.toLowerCase().includes(q)
            );
          }),
          (entry) => [settingsSectionLabel(entry.section), entry.group, entry.keywords],
        )
          .slice(0, RESULT_LIMITS.setting)
          .map((entry) => ({
            id: `setting:${entry.section}:${entry.group ?? "overview"}`,
            kind: "setting" as const,
            entry,
          }));

    const shortcutRows: Row[] = [];
    const toggleLabel = "Toggle Familiar Chat";
    if (!scoped && (!q || fz(toggleLabel) || "⌘⇧b".includes(q))) {
      shortcutRows.push({
        id: "shortcut:toggle-agent",
        kind: "shortcut",
        label: toggleLabel,
        shortcut: "⌘⇧B",
        action: () => {
          window.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "B",
              code: "KeyB",
              metaKey: true,
              shiftKey: true,
              bubbles: true,
            }),
          );
        },
      });
    }

    // Strip a leading "/task" so the slash command never leaks into the
    // created card's title (e.g. "/task fix login" → "fix login").
    const trimmedTitle = query.trim().replace(/^\/task(\s+|$)/i, "").trim();
    // A query that names a real slash command is a command invocation, not a
    // task title.
    const createRows: Row[] = trimmedTitle && !slashCanonical
      ? [{ id: "create-task", kind: "create-task", title: trimmedTitle }]
      : [];

    // "Go to <surface>" rows make ⌘K a launcher for every canonical workspace
    // destination, including on-demand rows hidden from the sidebar. Hidden
    // while typing a slash command or a familiar scope (where surface nav would
    // be noise). Role Surface rooms (cave-cc5r) append with the same treatment.
    const surfaceRows: Row[] = (scoped || slashToken)
      ? []
      : [
          ...rank(
            paletteDestinations().filter((destination) => {
              // Fuzzy on the short title/id; substring-only on the long
              // description (subsequence-matching prose surfaces irrelevant items).
              return (
                !q ||
                fz(destination.title) ||
                fz(destination.id) ||
                destination.description.toLowerCase().includes(q)
              );
            }),
            (destination) => [destination.title, destination.id, destination.description, destination.kbd],
          ).map((destination) => {
            return {
              id: `surface:${destination.id}`,
              kind: "command" as const,
              name: `Go to ${destination.title}`,
              hint: destination.kbd ? `${destination.description} · ${destination.kbd}` : destination.description,
              intent: { kind: "go-to-surface", mode: destination.id } as PaletteIntent,
            };
          }),
          ...rank(
            (roleSurfaces ?? []).filter(
              (room) => !q || fz(room.label) || room.description.toLowerCase().includes(q),
            ),
            (room) => [room.label],
          ).map((room) => ({
            id: `room:${room.mode}`,
            kind: "command" as const,
            name: `Go to ${room.label}`,
            hint: room.description,
            intent: { kind: "go-to-surface", mode: room.mode, familiarId: room.familiarId } as PaletteIntent,
          })),
        ];

    // "Open project <name>" rows jump into a project's chats (the Projects tab,
    // expanded + scrolled to that project). Hidden while scoped or typing slash.
    const projectRows: Row[] = (scoped || slashToken)
      ? []
      : rank(projects.filter((p) => !q || fz(p.name) || fz(p.root)), (p) => [p.name, p.root])
          .slice(0, 6)
          .map((p) => ({
            id: `project:${p.id}`,
            kind: "command" as const,
            name: `Open project ${p.name}`,
            hint: shortProjectRoot(p.root),
            intent: { kind: "open-project", root: p.root },
          }));

    // "Tasks: …" rows jump to the Tasks board and switch its view directly.
    // Hidden while scoped or typing a slash command.
    const BOARD_VIEWS: Array<{ view: "kanban" | "table" | "gantt"; label: string; hint: string; terms: string }> = [
      { view: "kanban", label: "Tasks: Kanban", hint: "Columns by status", terms: "tasks board kanban columns" },
      { view: "table", label: "Tasks: Table", hint: "Sortable task table", terms: "tasks board table list" },
      { view: "gantt", label: "Tasks: Gantt timeline", hint: "Schedule timeline", terms: "tasks board gantt timeline schedule" },
    ];
    const boardViewRows: Row[] = (scoped || slashToken)
      ? []
      : rank(BOARD_VIEWS.filter((v) => !q || fz(v.label) || fz(v.terms)), (v) => [v.label, v.terms])
          .map((v) => ({
            id: `board-view:${v.view}`,
            kind: "command" as const,
            name: v.label,
            hint: v.hint,
            intent: { kind: "set-board-view", view: v.view },
          }));

    // Empty, unscoped query → "browse" mode: lead with the recency jump-list,
    // then the launcher surfaces, and group the rest under section headers
    // (see browseGroup + the render). While the user is typing it falls back to
    // the flat, mixed-relevance order.
    // Conversation content hits, deduped against sessions already surfaced by a
    // title match, and never shown while scoped/typing a slash command. Each
    // carries the familiar from its session (if known) so opening lands scoped.
    const shownSessionIds = new Set(
      sessionRows.map((r) => (r.kind === "session" ? r.session.id : "")).filter(Boolean),
    );
    const conversationRows: Row[] =
      scoped || slashToken
        ? []
        : contentHits
            .filter((h) => !shownSessionIds.has(h.sessionId))
            .slice(0, RESULT_LIMITS.conversation)
            .map((h) => ({ id: `conv:${h.sessionId}`, kind: "conversation-hit" as const, hit: h }));

    const browsing = !q && !scoped;
    const localRows: Row[] = browsing
      ? [
          ...sessionRows,
          ...surfaceRows,
          ...familiarRows,
          ...cardRows,
          ...projectRows,
          ...boardViewRows,
          ...covenMemoryRows,
          ...fsMemoryRows,
          ...cmdRows,
          ...shortcutRows,
        ]
      : [
          ...familiarRows,
          ...sessionRows,
          ...cardRows,
          ...covenMemoryRows,
          ...fsMemoryRows,
          ...settingRows,
          ...cmdRows,
          ...surfaceRows,
          ...boardViewRows,
          ...projectRows,
          ...shortcutRows,
          ...createRows,
          ...conversationRows,
        ];

    const salemRows: Row[] = query.trim() && !slashCanonical && !noFamiliarMatch
      ? [{ id: "salem-answer", kind: "salem-answer", query: query.trim() }]
      : [];

    // Ask-Salem is the FALLBACK row, not the default (cave-42r5): Enter on a
    // typed query must open the best local match (sessions, familiars, cards,
    // surfaces), not fire a network AI call. With zero local matches the
    // Salem row is still rows[0], so unmatched queries keep their one-Enter
    // AI path.
    return [...localRows, ...salemRows];
  }, [familiars, familiarById, sessions, cards, canonicalMemoryState.entries, fsMemory, contentHits, query, activeFamiliarId, projects, roleSurfaces]);

  const counts = useMemo(() => paletteResultCounts(allRows), [allRows]);
  const rows = useMemo(
    () => filterPaletteRows(allRows, category) as Row[],
    [allRows, category],
  );

  // Global-search rows (cave-ychtl.6): coordinator results replace the palette
  // corpus while the query is structured, link-restored, or broadened.
  const globalRows: Row[] = useMemo(
    () =>
      globalResults.map((result) => ({
        id: `search-result:${result.providerId}:${result.id}`,
        kind: "search-result",
        result,
      })),
    [globalResults],
  );

  const displayRows = globalModeActive ? globalRows : rows;
  const resultSummary = useMemo(
    () => paletteResultSummary(rows, category, parseFamiliarToken(query).rest),
    [rows, category, query],
  );

  useEffect(() => {
    if (activeIdx >= displayRows.length) setActiveIdx(Math.max(0, displayRows.length - 1));
  }, [rows.length, activeIdx]);

  // Visible familiar-scope state. When the query carries an `@token`, surface a
  // chip below the input so the active scope is explicit (and announced) rather
  // than only implied by the filtered results.
  const scopeInfo = useMemo(() => {
    const { token } = parseFamiliarToken(query);
    if (token === null) return null;
    const ids = resolveFamiliarIds(familiars, token);
    const matched = familiars.filter((f) => ids?.has(f.id));
    return { token, matched, isBare: token === "" };
  }, [query, familiars]);

  // Render-time mirror of the in-memo `browsing` flag (empty + unscoped query),
  // so the section headers only show in the default browse list, not in search.
  const browsing = useMemo(() => {
    const { token, rest } = parseFamiliarToken(query);
    return rest.trim() === "" && resolveFamiliarIds(familiars, token) === null;
  }, [query, familiars]);

  const askSalem = async () => {
    const message = query.trim();
    if (!message || salemLoading) return;
    setSalemLoading(true);
    setSalemAnswer(null);
    setSalemError(null);
    try {
      // Use the local familiar (the one you're scoped to, falling back to the
      // Salem persona's familiar if one exists, then ANY available familiar)
      // so the answer is synthesized through it and the AI credits attribute
      // to its connected model. No invented ids: when the coven is empty the
      // request goes familiar-less and the route uses its hosted fallback.
      const localFamiliarId =
        activeFamiliarId ??
        familiars.find((f) => f.id === "salem")?.id ??
        familiars[0]?.id;
      const localModel =
        familiars.find((f) => f.id === localFamiliarId)?.model ??
        undefined;
      const res = await fetch("/api/salem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: query.trim(),
          context: buildSalemSearchContext(
            rows.filter(isSalemContextRow),
            query.trim(),
          ),
          familiarId: localFamiliarId,
          model: localModel,
        }),
      });
      const data = (await res.json()) as { reply?: string; error?: string };
      // If the user kept typing while the request was in flight, ignore the stale result.
      if ((inputRef.current?.value ?? "").trim() !== message) return;
      if (!res.ok || data.error) throw new Error(data.error ?? "Salem could not answer.");
      setSalemAnswer(data.reply ?? "Salem did not return an answer.");
    } catch (err) {
      if ((inputRef.current?.value ?? "").trim() !== message) return;
      setSalemError(err instanceof Error ? err.message : "Salem could not answer.");
    } finally {
      setSalemLoading(false);
    }
  };

  const fire = (row: Row) => {
    if (row.kind === "salem-answer") {
      void askSalem();
      return;
    }
    const search = query.trim();
    if (search.length >= 2 && row.kind !== "create-task") {
      setRecentSearches(recordRecentSearch(window.localStorage, search));
    }
    if (row.kind === "familiar") {
      onIntent({ kind: "switch-familiar", familiarId: row.familiar.id });
    } else if (row.kind === "session") {
      onIntent({
        kind: "open-session",
        sessionId: row.session.id,
        familiarId: row.session.familiarId ?? null,
      });
    } else if (row.kind === "card") {
      onIntent({ kind: "open-board" });
      // Focus card after the view switches
      setTimeout(() => onIntent({ kind: "focus-card", cardId: row.card.id }), 0);
    } else if (row.kind === "coven-memory") {
      onIntent({
        kind: "open-coven-memory",
        id: row.entry.id,
        familiarId: row.entry.familiarId,
      });
    } else if (row.kind === "fs-memory") {
      onIntent({ kind: "open-memory-file", path: row.entry.fullPath });
    } else if (row.kind === "shortcut") {
      row.action();
    } else if (row.kind === "create-task") {
      onIntent({ kind: "create-task", title: row.title });
    } else if (row.kind === "conversation-hit") {
      const familiarId = sessions.find((s) => s.id === row.hit.sessionId)?.familiarId ?? null;
      // Carry the matched query so the opened chat jumps to it via in-thread find.
      onIntent({
        kind: "open-session",
        sessionId: row.hit.sessionId,
        familiarId,
        findQuery: parseFamiliarToken(query).rest.trim(),
      });
    } else if (row.kind === "setting") {
      onIntent({
        kind: "open-setting",
        section: row.entry.section,
        ...(row.entry.group ? { group: row.entry.group } : {}),
      });
    } else if (row.kind === "search-result") {
      if (row.result.href) onIntent({ kind: "open-href", href: row.result.href });
    } else {
      onIntent(row.intent);
    }
    closeWithState();
  };

  const onComposerKey = (e: React.KeyboardEvent) => {
    // The Enter/arrows that drive an IME candidate picker (CJK input) belong
    // to the IME — confirming a character must not fire the active row or
    // move the highlight. Mirrors the ChatView / group-chat composer guards.
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      // Command/Control+Enter — remove ONLY implicit context scopes. Explicit
      // filters survive into the global query (cave-ychtl.6).
      e.preventDefault();
      broadenGlobal();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = displayRows[activeIdx];
      if (row) fire(row);
    } else if (e.key === "Backspace" && query === "") {
      // Free text empty: Backspace removes the final chip instead of doing
      // nothing (cave-ychtl.6).
      removeLastChip();
    }
  };

  // Click-through dismissal. Pressing the scrim closes the palette AND forwards
  // that same press to whatever interactive control sits underneath, so a user
  // reaching past the open palette for (say) a top-bar familiar avatar gets the
  // selection in one gesture. Without this the full-viewport backdrop swallowed
  // the first click as a throwaway dismiss, and the real target only registered
  // on a second click ("doesn't grab unless I unfocus first").
  const onScrimPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const { clientX, clientY, button } = e;
    const scrim = e.currentTarget;
    let target: HTMLElement | null = null;
    // Only a primary (left) press forwards through; secondary/middle just close.
    // Presses inside the dialog never reach here (it stops propagation), so the
    // hit point is always over the backdrop itself.
    if (button === 0) {
      // Make the scrim transparent to hit-testing so elementFromPoint reports
      // the app control beneath it, then restore it before unmounting.
      const prev = scrim.style.pointerEvents;
      scrim.style.pointerEvents = "none";
      const under = document.elementFromPoint(clientX, clientY);
      scrim.style.pointerEvents = prev;
      target =
        under?.closest<HTMLElement>(
          'a[href], button:not([disabled]), input, textarea, select, [role="button"], [role="option"], [role="menuitem"], [role="tab"], [role="link"], [role="checkbox"], [role="switch"]',
        ) ?? null;
    }
    onClose();
    if (!target) return;
    // Defer activation until the overlay has unmounted so the forwarded click
    // lands with the palette already gone (and any close side-effects settled).
    requestAnimationFrame(() => {
      const tag = target!.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") target!.focus();
      else target!.click();
    });
  };

  if (!open) return null;

  return (
    <div
      // Dismiss on press (pointerdown), not click, so the backdrop never lingers
      // "armed" to swallow the next click. onScrimPointerDown also forwards the
      // press to the control underneath (click-through) — see its definition.
      onPointerDown={onScrimPointerDown}
      role="presentation"
      className="fixed inset-0 z-50 flex items-start justify-center bg-[var(--backdrop-scrim)] backdrop-blur-sm [animation:ui-modal-fade-in_var(--duration-fast)_var(--ease-decelerate)]!"
    >
      <div
        ref={dialogRef}
        // Keep presses inside the dialog from bubbling to the backdrop's
        // pointerdown dismissal (matches the dismissal event above).
        onPointerDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        tabIndex={-1}
        className="command-palette glass-overlay [animation:ui-modal-enter_var(--duration-base)_var(--ease-decelerate)]!"
      >
        <div className="command-palette__search">
          <Icon
            name="ph:magnifying-glass"
            className="command-palette__search-icon"
            aria-hidden
          />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              updateQuery(e.target.value);
              setActiveIdx(0);
            }}
            onKeyDown={onComposerKey}
            placeholder="Search Cave…"
            role="combobox"
            aria-label="Search and jump to anything"
            aria-expanded={displayRows.length > 0}
            aria-autocomplete="list"
            aria-controls="command-palette-listbox"
            aria-activedescendant={
              displayRows.length > 0 ? `command-palette-option-${activeIdx}` : undefined
            }
            className="command-palette__input"
          />
          {query ? (
            <button
              type="button"
              className="command-palette__clear focus-ring"
              aria-label="Clear search query"
              onClick={() => {
                updateQuery("");
                setCategory("all");
                setActiveIdx(0);
                inputRef.current?.focus();
              }}
            >
              <Icon name="ph:x-circle-fill" width="1rem" height="1rem" aria-hidden />
            </button>
          ) : null}
        </div>
        {browsing && recentSearches.length > 0 ? (
          <div className="flex items-center gap-2 overflow-x-auto border-b border-[var(--border-hairline)] px-4 py-2" aria-label="Recent searches">
            <Icon name="ph:clock-counter-clockwise" width="0.9rem" height="0.9rem" className="shrink-0 text-[var(--text-muted)]" aria-hidden />
            {recentSearches.map((recent) => (
              <button
                key={recent}
                type="button"
                className="focus-ring shrink-0 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-subtle)] px-2.5 py-1 text-[length:var(--text-xs)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                onClick={() => {
                  updateQuery(recent);
                  setActiveIdx(0);
                  inputRef.current?.focus();
                }}
              >
                {recent}
              </button>
            ))}
            <button
              type="button"
              className="focus-ring ml-auto shrink-0 rounded px-1.5 py-1 text-[length:var(--text-2xs)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              aria-label="Clear recent searches"
              onClick={() => {
                clearRecentSearches(window.localStorage);
                setRecentSearches([]);
                inputRef.current?.focus();
              }}
            >
              Clear
            </button>
          </div>
        ) : null}
        {salemLoading || salemAnswer || salemError ? (
          <div
            role={salemLoading ? "status" : salemError ? "alert" : "region"}
            aria-label="Salem AI response"
            // Long answers scroll inside the palette instead of growing it past
            // the viewport (issue #2988) — mirrors the listbox's own cap below.
            className="max-h-[45vh] overflow-y-auto border-b border-[var(--border-hairline)] bg-[var(--bg-subtle)] px-4 py-3 text-xs text-[var(--text-secondary)]"
          >
            {salemLoading ? (
              <span>Asking Salem through salem.opencoven.ai...</span>
            ) : salemError ? (
              <span className="text-[var(--color-danger)]">{salemError}</span>
            ) : (
              <div className="salem-msg__md">
                <MarkdownBlock text={salemAnswer ?? ""} />
              </div>
            )}
          </div>
        ) : null}
        {globalModeActive ? (
          <div
            role="group"
            aria-label="Active search filters"
            className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border-hairline)] px-4 py-2"
          >
            {effectiveGlobalState?.scopes.map((scope) => (
              <span
                key={scopeKey(scope)}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-subtle)] px-2 py-0.5 text-[length:var(--text-xs)] text-[var(--text-primary)]"
              >
                {scope.label}
                <button
                  type="button"
                  className="focus-ring rounded-full p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  aria-label={`Remove scope ${scope.label}`}
                  onClick={() => removeScopeChip(scope)}
                >
                  <Icon name="ph:x" width={10} aria-hidden />
                </button>
              </span>
            ))}
            {effectiveGlobalState?.filters.map((filter) => (
              <span
                key={filterKey(filter)}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-subtle)] px-2 py-0.5 text-[length:var(--text-xs)] text-[var(--text-primary)]"
              >
                {chipLabelFor(filter)}
                <button
                  type="button"
                  className="focus-ring rounded-full p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  aria-label={`Remove filter ${chipLabelFor(filter)}`}
                  onClick={() => removeFilterChip(filter)}
                >
                  <Icon name="ph:x" width={10} aria-hidden />
                </button>
              </span>
            ))}
            {globalBroadened ? (
              <span
                role="status"
                className="text-[length:var(--text-xs)] text-[var(--text-muted)]"
              >
                Searching all of Cave — context removed
              </span>
            ) : null}
            <button
              type="button"
              className="focus-ring ml-auto shrink-0 rounded px-1.5 py-1 text-[length:var(--text-xs)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              onClick={() => void copySearchLink()}
            >
              {copiedLink ? "Link copied" : "Copy search link"}
            </button>
          </div>
        ) : null}
        {scopeInfo ? (
          <div
            role="status"
            aria-live="polite"
            aria-label={
              scopeInfo.isBare
                ? "Scoped to all familiars"
                : scopeInfo.matched.length > 0
                  ? `Scoped to ${scopeInfo.matched.map((f) => f.display_name).join(", ")}`
                  : `No familiar matches @${scopeInfo.token}`
            }
            className="flex items-center gap-2 border-b border-[var(--border-hairline)] px-4 py-2 text-xs"
          >
            <span
              className="inline-flex shrink-0 items-center rounded-full bg-[var(--bg-subtle)] px-2 py-0.5 font-medium text-[var(--text-primary)]"
              aria-hidden
            >
              @{scopeInfo.token || "…"}
            </span>
            <span className="min-w-0 flex-1 truncate text-[var(--text-muted)]">
              {scopeInfo.isBare
                ? "All familiars — type a handle to narrow"
                : scopeInfo.matched.length > 0
                  ? scopeInfo.matched
                      .slice(0, 3)
                      .map((f) => f.display_name)
                      .join(", ") +
                    (scopeInfo.matched.length > 3 ? ` +${scopeInfo.matched.length - 3} more` : "")
                  : "no familiar match — showing suggestions"}
            </span>
          </div>
        ) : null}
        <div
          role="toolbar"
          aria-label="Filter search results"
          className="command-palette__filters"
        >
          {PALETTE_CATEGORIES.filter(
            // Zero-count scopes are dead tabs — hide them. "All" always shows,
            // and the active scope stays visible even at 0 so the filter can't
            // vanish from under the user mid-narrowing (cave-4gg0).
            (option) => option === "all" || option === category || counts[option] > 0,
          ).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={category === option}
              data-active={category === option}
              className="command-palette__filter focus-ring"
              onClick={() => {
                setCategory(option);
                setActiveIdx(0);
                inputRef.current?.focus();
              }}
            >
              {PALETTE_CATEGORY_LABEL[option]}
              <span className="command-palette__filter-count">{counts[option]}</span>
            </button>
          ))}
        </div>
        {globalModeActive && globalLoading ? (
          <div role="status" className="border-b border-[var(--border-hairline)] px-4 py-2 text-[length:var(--text-xs)] text-[var(--text-muted)]">
            Searching…
          </div>
        ) : null}
        {globalModeActive && globalError ? (
          <div role="alert" className="border-b border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-4 py-2 text-[length:var(--text-xs)] text-[var(--color-danger)]">
            {globalError}
          </div>
        ) : null}
        {globalModeActive && globalPartial && !globalError ? (
          <div role="status" className="border-b border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 px-4 py-2 text-[length:var(--text-xs)] text-[var(--color-warning)]">
            Some sources couldn&apos;t be searched — results may be partial.
          </div>
        ) : null}
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {globalModeActive
            ? `${globalResults.length} result${globalResults.length === 1 ? "" : "s"} in global search`
            : resultSummary}
        </div>
        {canonicalMemoryState.state === "error" ? (
          <div
            role="status"
            className="border-b border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 px-4 py-2 text-[length:var(--text-xs)] text-[var(--color-warning)]"
          >
            Familiar memories unavailable. Other local results are still available.
          </div>
        ) : null}
        <ul
          id="command-palette-listbox"
          role="listbox"
          className="command-palette__results"
        >
          {displayRows.length === 0 ? (
            <li role="presentation" className="px-4 py-6 text-center text-xs text-[var(--text-muted)]">
              {globalModeActive ? (
                <p>{globalLoading ? "Searching…" : globalError ? globalError : "No matches across Cave."}</p>
              ) : (
                <>
                  <p>{resultSummary}</p>
                  {category !== "all" ? (
                    <button
                      type="button"
                      className="focus-ring mt-2 rounded-full border border-[var(--border-hairline)] px-3 py-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                      onClick={() => setCategory("all")}
                    >
                      Search all categories
                    </button>
                  ) : null}
                </>
              )}
            </li>
          ) : null}
          {displayRows.map((row, i) => {
            const active = i === activeIdx;
            // In browse mode, print a section header above the first row of each
            // group. Headers are role="presentation", so they stay out of the
            // listbox option indexing that keyboard nav and activeIdx rely on.
            const group = paletteGroup(row, browsing);
            const showHeader =
              group !== "" && (i === 0 || paletteGroup(rows[i - 1], browsing) !== group);
            // Recency hint for session rows ("4m ago" / "just now"), honoring the
            // user's compact/verbose density pref. Right-aligned in place of the
            // redundant "open" affordance label.
            const sessionAgo =
              row.kind === "session"
                ? relativeTime(row.session.updated_at || row.session.created_at)
                : "";
            const sessionDot =
              row.kind === "session" ? SESSION_DOT[row.session.status] : undefined;
            return (
              <Fragment key={row.id}>
                {showHeader ? (
                  <li
                    role="presentation"
                    className="command-palette__group"
                  >
                    {group}
                  </li>
                ) : null}
              <li
                role="option"
                id={`command-palette-option-${i}`}
                aria-selected={active}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => fire(row)}
                  data-active={active}
                  className="command-palette-row focus-ring-inset"
                >
                  {row.kind === "familiar" ? (
                    <>
                      <span className="flex flex-1 flex-col">
                        <span className="text-[var(--text-primary)]">{row.familiar.display_name}</span>
                        <span className="text-[length:var(--text-2xs)] uppercase tracking-widest text-[var(--text-secondary)]">
                          {row.familiar.role}
                        </span>
                      </span>
                      {active ? <span className="text-[length:var(--text-2xs)] text-[var(--text-muted)]">switch</span> : null}
                    </>
                  ) : null}
                  {row.kind === "session" ? (
                    <>
                      <Icon name="ph:chat-circle-dots-bold" className="text-[var(--text-secondary)]" width="1.1rem" height="1.1rem" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex min-w-0 items-center gap-1.5">
                          {sessionDot ? (
                            <span
                              role="img"
                              aria-label={`${row.session.status} session`}
                              className={`block h-2 w-2 shrink-0 rounded-full ${sessionDot}`}
                            />
                          ) : null}
                          <span className="truncate text-[var(--text-primary)]">
                            {row.session.title || "(untitled chat)"}
                          </span>
                        </span>
                        <span className="truncate text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                          {row.familiar?.display_name ?? row.session.familiarId} ·{" "}
                          {row.session.harness}
                        </span>
                      </span>
                      <span className="shrink-0 text-[length:var(--text-2xs)] text-[var(--text-muted)]">{sessionAgo || "open"}</span>
                    </>
                  ) : null}
                  {row.kind === "card" ? (
                    <>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[var(--text-primary)]">{row.card.title}</span>
                        <span className="truncate text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                          {row.card.status} · {row.card.priority}
                          {row.familiar ? ` · ${row.familiar.display_name}` : ""}
                          {row.card.labels.length ? ` · ${row.card.labels.join(", ")}` : ""}
                        </span>
                      </span>
                      {active ? <span className="text-[length:var(--text-2xs)] text-[var(--text-muted)]">card</span> : null}
                    </>
                  ) : null}
                  {row.kind === "coven-memory" ? (                    <>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[var(--text-primary)]">{row.entry.title}</span>
                        <span className="truncate text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                          {row.entry.familiarId} ·{" "}
                          {row.entry.source.label} · {row.entry.verification.state} ·{" "}
                          {row.entry.relativeUpdatedAt}
                        </span>
                        <span className="truncate text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                          {row.entry.excerpt}
                        </span>
                      </span>
                      {active ? <span className="text-[length:var(--text-2xs)] text-[var(--text-muted)]">memory</span> : null}
                    </>
                  ) : null}
                  {row.kind === "fs-memory" ? (
                    <>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[var(--text-primary)]">{row.entry.relPath}</span>
                        <span className="truncate text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                          {row.entry.rootLabel}
                        </span>
                      </span>
                      {active ? <span className="text-[length:var(--text-2xs)] text-[var(--text-muted)]">file</span> : null}
                    </>
                  ) : null}
                  {row.kind === "setting" ? (
                    <>
                      <Icon name="ph:gear-six" className="text-[var(--text-secondary)]" width="1.1rem" height="1.1rem" aria-hidden />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[var(--text-primary)]">
                          {settingsSectionLabel(row.entry.section)}
                          {row.entry.group ? ` › ${row.entry.group}` : ""}
                        </span>
                        <span className="truncate text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                          {row.entry.keywords}
                        </span>
                      </span>
                      {active ? <span className="text-[length:var(--text-2xs)] text-[var(--text-muted)]">open</span> : null}
                    </>
                  ) : null}
                  {row.kind === "command" ? (
                    <>
                      <span className="font-mono text-[var(--text-secondary)]">{row.name}</span>
                      <span className="flex-1 text-[var(--text-muted)]">{platformizeHint(row.hint, keys)}</span>
                      {active ? <span className="text-[length:var(--text-2xs)] text-[var(--text-muted)]">run</span> : null}
                    </>
                  ) : null}
                  {row.kind === "shortcut" ? (
                    <>
                      <span className="flex-1 text-[var(--text-primary)]">{row.label}</span>
                      <kbd className="palette-kbd touch-hidden">{platformizeHint(row.shortcut, keys)}</kbd>
                    </>
                  ) : null}
                  {row.kind === "create-task" ? (
                    <>
                      <Icon name="ph:plus-bold" className="text-[var(--text-secondary)]" width="1.1rem" height="1.1rem" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[var(--text-primary)]">Create task: {row.title}</span>
                        <span className="truncate text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                          New task in Tasks, scoped to the active familiar
                        </span>
                      </span>
                      {active ? <span className="text-[length:var(--text-2xs)] text-[var(--text-muted)]">create</span> : null}
                    </>
                  ) : null}
                  {row.kind === "conversation-hit" ? (
                    <>
                      <Icon name="ph:chat-circle-dots-bold" className="text-[var(--text-secondary)]" width="1.1rem" height="1.1rem" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[var(--text-primary)]">
                          {row.hit.title || "(untitled chat)"}
                        </span>
                        <span className="truncate text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                          {row.hit.snippet}
                        </span>
                      </span>
                      <span className="shrink-0 text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                        {row.hit.matchCount} match{row.hit.matchCount !== 1 ? "es" : ""}
                      </span>
                    </>
                  ) : null}
                  {row.kind === "salem-answer" ? (
                    <>
                      <Icon name="ph:sparkle-bold" className="text-[var(--accent-presence)]" width="1.1rem" height="1.1rem" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[var(--text-primary)]">Ask Salem: {row.query}</span>
                        <span className="truncate text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                          Salem is the docs familiar — answers from the OpenCoven docs
                        </span>
                      </span>
                      {active ? <span className="text-[length:var(--text-2xs)] text-[var(--text-muted)]">ask</span> : null}
                    </>
                  ) : null}
                  {row.kind === "search-result" ? (
                    <>
                      <Icon name={resultIcon(row.result.entityType)} className="text-[var(--text-secondary)]" width="1.1rem" height="1.1rem" aria-hidden />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[var(--text-primary)]">{row.result.title}</span>
                        <span className="truncate text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                          {row.result.entityType}
                          {row.result.status ? ` · ${row.result.status}` : ""}
                          {row.result.excerpt ? ` · ${row.result.excerpt}` : ""}
                        </span>
                      </span>
                      {active ? <span className="text-[length:var(--text-2xs)] text-[var(--text-muted)]">open</span> : null}
                    </>
                  ) : null}
                </button>
              </li>
              </Fragment>
            );
          })}
        </ul>
        <div className="command-palette__footer">
          {/* Keyboard hints are desktop vocabulary — hidden on coarse-pointer
              devices where there is no ⌘/esc to press (cave-4gg0). */}
          <span className="touch-hidden flex items-center gap-1">
            <kbd className="palette-kbd">{keys.up}{keys.down}</kbd> navigate ·{" "}
            <kbd className="palette-kbd">{keys.enter}</kbd> select ·{" "}
            <kbd className="palette-kbd">esc</kbd> close
          </span>
          <span className="flex items-center gap-1">
            {counts[category]} results
            <span className="touch-hidden flex items-center gap-1">
              {" "}· <kbd className="palette-kbd">{keys.mod}K</kbd>
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

export type { PaletteIntent };
