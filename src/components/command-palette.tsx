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
import { FOLDER_MODES, type FolderMode } from "@/components/sidebar-minimal";
import { useProjects } from "@/lib/use-projects";

function shortProjectRoot(root: string): string {
  const parts = root.replace(/\/+$/, "").split("/").filter(Boolean);
  return parts.length <= 2 ? root : `…/${parts.slice(-2).join("/")}`;
}

// Section label for a row in empty-query "browse" mode, so the default palette
// reads as grouped clusters (Recent / Go to / …) instead of one flat dump.
// Returns "" for rows that never appear while browsing (salem-answer, etc.).
function browseGroup(row: Row): string {
  switch (row.kind) {
    case "session":
      return "Recent";
    case "command":
      if (row.id.startsWith("surface:")) return "Go to";
      if (row.id.startsWith("project:")) return "Projects";
      return "Commands";
    case "familiar":
      return "Familiars";
    case "card":
      return "Tasks";
    case "coven-memory":
    case "fs-memory":
      return "Memory";
    case "shortcut":
      return "Shortcuts";
    default:
      return "";
  }
}

// Section label for a row, used to print group headers. Conversation hits get a
// "Conversations" header in BOTH browse and search mode (they're a distinct
// content-search cluster); everything else only groups while browsing.
function paletteGroup(row: Row, browsing: boolean): string {
  if (row.kind === "conversation-hit") return "Conversations";
  return browsing ? browseGroup(row) : "";
}

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
  | { kind: "go-to-surface"; mode: FolderMode }
  | { kind: "open-project"; root: string }
  | { kind: "focus-card"; cardId: string }
  | { kind: "create-task"; title: string }
  | { kind: "open-memory-file"; path: string };

type Card = {
  id: string;
  title: string;
  status: string;
  priority: string;
  familiarId: string | null;
  labels: string[];
  updatedAt?: string;
};

type CovenMemoryEntry = {
  id: string;
  familiar_id: string;
  title: string;
  path: string;
  updated_at: string;
  excerpt?: string;
};

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
  initialQuery?: string;
  onQueryChange?: (query: string) => void;
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
  | { id: string; kind: "coven-memory"; entry: CovenMemoryEntry; familiar: Familiar | null }
  | { id: string; kind: "fs-memory"; entry: FsMemoryEntry }
  | { id: string; kind: "command"; name: string; hint: string; intent: PaletteIntent }
  | { id: string; kind: "shortcut"; label: string; shortcut: string; action: () => void }
  | { id: string; kind: "create-task"; title: string }
  | { id: string; kind: "conversation-hit"; hit: ConversationHit }
  | { id: string; kind: "salem-answer"; query: string };

type SalemSearchContextItem = {
  type: string;
  title: string;
  detail?: string;
};

type SalemSearchContext = {
  source: "top-search";
  query: string;
  matches: SalemSearchContextItem[];
};

const RESULT_LIMITS = {
  familiar: 6,
  session: 6,
  card: 6,
  covenMemory: 5,
  fsMemory: 8,
  command: 6,
  conversation: 6,
};

const SALEM_CONTEXT_LIMIT = 8;

function buildSalemSearchContext(rows: Row[], query: string): SalemSearchContext {
  const matches = rows
    .filter((row) =>
      row.kind === "familiar" ||
      row.kind === "session" ||
      row.kind === "card" ||
      row.kind === "coven-memory" ||
      row.kind === "fs-memory",
    )
    .slice(0, SALEM_CONTEXT_LIMIT)
    .map((row): SalemSearchContextItem => {
      if (row.kind === "familiar") {
        return {
          type: "familiar",
          title: row.familiar.display_name,
          detail: row.familiar.role,
        };
      }
      if (row.kind === "session") {
        return {
          type: "chat",
          title: row.session.title || "(untitled chat)",
          detail: `${row.familiar?.display_name ?? row.session.familiarId ?? "Unknown familiar"} · ${row.session.harness}`,
        };
      }
      if (row.kind === "card") {
        return {
          type: "task",
          title: row.card.title,
          detail: [row.card.status, row.card.priority, row.familiar?.display_name, ...row.card.labels]
            .filter(Boolean)
            .join(" · "),
        };
      }
      if (row.kind === "coven-memory") {
        return {
          type: "memory",
          title: row.entry.title,
          detail: [row.familiar?.display_name ?? row.entry.familiar_id, row.entry.path].filter(Boolean).join(" · "),
        };
      }
      return {
        type: "memory-file",
        title: row.entry.relPath,
        detail: row.entry.rootLabel,
      };
    });

  return { source: "top-search", query, matches };
}

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
  initialQuery = "",
  onQueryChange,
  onIntent,
}: Props) {
  useDateTimePrefs(); // subscribe: re-render when the date/time density pref changes
  const { projects } = useProjects();
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [cards, setCards] = useState<Card[]>([]);
  const [covenMemory, setCovenMemory] = useState<CovenMemoryEntry[]>([]);
  const [fsMemory, setFsMemory] = useState<FsMemoryEntry[]>([]);
  const [salemLoading, setSalemLoading] = useState(false);
  const [salemAnswer, setSalemAnswer] = useState<string | null>(null);
  const [salemError, setSalemError] = useState<string | null>(null);
  const [contentHits, setContentHits] = useState<ConversationHit[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const keys = useKeySymbols();

  useFocusTrap(open, dialogRef, { onEscape: onClose });

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

  // Fetch the searchable corpora once on first open. Cheap calls; refreshed
  // every time the palette opens so the index doesn't go stale.
  useEffect(() => {
    if (!open) return;
    setQuery(initialQuery);
    setActiveIdx(0);
    setSalemAnswer(null);
    setSalemError(null);
    const t = setTimeout(() => inputRef.current?.focus(), 10);

    let cancelled = false;
    void (async () => {
      try {
        const [boardRes, covenRes, fsRes] = await Promise.all([
          fetch("/api/board", { cache: "no-store" }),
          fetch("/api/coven-memory", { cache: "no-store" }),
          fetch("/api/memory", { cache: "no-store" }),
        ]);
        const board = await boardRes.json();
        const coven = await covenRes.json();
        const fs = await fsRes.json();
        // Don't apply a corpus refresh after the palette closed/unmounted.
        if (cancelled) return;
        if (board.ok) setCards(board.cards ?? []);
        if (coven.ok) setCovenMemory(coven.entries ?? []);
        if (fs.ok) setFsMemory(fs.entries ?? []);
      } catch {
        /* keep what we had */
      }
    })();

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
    setQuery(initialQuery);
    setActiveIdx(0);
    setSalemAnswer(null);
    setSalemError(null);
  }, [initialQuery, open]);

  const familiarById = useMemo(() => new Map(familiars.map((f) => [f.id, f])), [familiars]);
  const rows: Row[] = useMemo(() => {
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

    const covenMemoryRows: Row[] = covenMemory
      .filter((e) => {
        if (scoped && !scope!.has(e.familiar_id)) return false;
        if (!q) return true;
        return fz(e.title) || (e.excerpt ?? "").toLowerCase().includes(q) || fz(e.familiar_id);
      })
      .slice(0, RESULT_LIMITS.covenMemory)
      .map((e) => ({
        id: `cm:${e.id}`,
        kind: "coven-memory",
        entry: e,
        familiar: e.familiar_id ? familiarById.get(e.familiar_id) ?? null : null,
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

    // "Go to <surface>" rows make ⌘K a launcher for the visible sidebar
    // surfaces. Hidden while typing a slash command or a familiar scope (where
    // surface nav would be noise).
    const surfaceRows: Row[] = (scoped || slashToken)
      ? []
      : rank(FOLDER_MODES
          // Fuzzy on the short label/id; substring-only on the long description
          // (subsequence-matching prose surfaces irrelevant items).
          .filter((fm) => !q || fz(fm.label) || fz(fm.id) || fm.description.toLowerCase().includes(q)),
          (fm) => [fm.label, fm.id])
          .map((fm) => ({
            id: `surface:${fm.id}`,
            kind: "command" as const,
            name: `Go to ${fm.label}`,
            hint: fm.kbd ? `${fm.description} · ${fm.kbd}` : fm.description,
            intent: { kind: "go-to-surface", mode: fm.id },
          }));

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

    // "Board: …" rows jump to the board and switch its view directly. Hidden
    // while scoped or typing a slash command.
    const BOARD_VIEWS: Array<{ view: "kanban" | "table" | "gantt"; label: string; hint: string; terms: string }> = [
      { view: "kanban", label: "Board: Kanban", hint: "Columns by status", terms: "board kanban columns" },
      { view: "table", label: "Board: Table", hint: "Sortable task table", terms: "board table list" },
      { view: "gantt", label: "Board: Gantt timeline", hint: "Schedule timeline", terms: "board gantt timeline schedule" },
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

    return [...salemRows, ...localRows];
  }, [familiars, familiarById, sessions, cards, covenMemory, fsMemory, contentHits, query, activeFamiliarId, projects]);

  useEffect(() => {
    if (activeIdx >= rows.length) setActiveIdx(Math.max(0, rows.length - 1));
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
      // Use the local familiar (the one you're scoped to, falling back to Salem)
      // so the answer is synthesized through it and the AI credits attribute to
      // its connected model.
      const localFamiliarId =
        activeFamiliarId ??
        familiars.find((f) => f.id === "salem")?.id ??
        "salem";
      const localModel =
        familiars.find((f) => f.id === activeFamiliarId)?.model ??
        familiars.find((f) => f.id === "salem")?.model ??
        undefined;
      const res = await fetch("/api/salem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: query.trim(),
          context: buildSalemSearchContext(rows, query.trim()),
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
      onIntent({ kind: "open-memory-file", path: row.entry.path });
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
    } else {
      onIntent(row.intent);
    }
    onClose();
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
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[activeIdx];
      if (row) fire(row);
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
      className="fixed inset-0 z-50 flex items-start justify-center bg-[var(--backdrop-scrim)] backdrop-blur-sm"
      style={{ animation: "ui-modal-fade-in var(--duration-fast) var(--ease-decelerate)" }}
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
        className="mt-[12vh] w-[640px] max-w-[92vw] overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-2xl"
        style={{ animation: "ui-modal-enter var(--duration-base) var(--ease-decelerate)" }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            updateQuery(e.target.value);
            setActiveIdx(0);
          }}
          onKeyDown={onComposerKey}
          placeholder="Search familiars · chats · cards · memory · commands… (try @familiar to scope)"
          role="combobox"
          aria-label="Search and jump to anything"
          aria-expanded={rows.length > 0}
          aria-autocomplete="list"
          aria-controls="command-palette-listbox"
          aria-activedescendant={
            rows.length > 0 ? `command-palette-option-${activeIdx}` : undefined
          }
          className="focus-ring-inset w-full border-b border-[var(--border-hairline)] bg-transparent px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
        />
        {salemLoading || salemAnswer || salemError ? (
          <div
            role={salemLoading ? "status" : salemError ? "alert" : "region"}
            aria-label="Salem AI response"
            className="border-b border-[var(--border-hairline)] bg-[var(--bg-subtle)] px-4 py-3 text-xs text-[var(--text-secondary)]"
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
        <ul
          id="command-palette-listbox"
          role="listbox"
          className="max-h-[60vh] overflow-y-auto py-1"
        >
          {rows.length === 0 ? (
            <li role="presentation" className="px-4 py-6 text-center text-xs text-[var(--text-muted)]">No matches.</li>
          ) : null}
          {rows.map((row, i) => {
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
                    className="px-4 pb-1 pt-3 text-[10px] font-medium uppercase tracking-widest text-[var(--text-muted)] first:pt-1.5"
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
                  className={`command-palette-row focus-ring-inset flex w-full items-center gap-3 border-l-2 px-4 py-2 text-left text-sm transition-colors ${
                    active
                      ? "border-l-[var(--accent-presence)] bg-[var(--bg-hover)]"
                      : "border-l-transparent hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  {row.kind === "familiar" ? (
                    <>
                      <span className="flex flex-1 flex-col">
                        <span className="text-[var(--text-primary)]">{row.familiar.display_name}</span>
                        <span className="text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">
                          {row.familiar.role}
                        </span>
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)]">switch</span>
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
                        <span className="truncate text-[10px] text-[var(--text-muted)]">
                          {row.familiar?.display_name ?? row.session.familiarId} ·{" "}
                          {row.session.harness}
                        </span>
                      </span>
                      <span className="shrink-0 text-[10px] text-[var(--text-muted)]">{sessionAgo || "open"}</span>
                    </>
                  ) : null}
                  {row.kind === "card" ? (
                    <>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[var(--text-primary)]">{row.card.title}</span>
                        <span className="truncate text-[10px] text-[var(--text-muted)]">
                          {row.card.status} · {row.card.priority}
                          {row.familiar ? ` · ${row.familiar.display_name}` : ""}
                          {row.card.labels.length ? ` · ${row.card.labels.join(", ")}` : ""}
                        </span>
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)]">card</span>
                    </>
                  ) : null}
                  {row.kind === "coven-memory" ? (
                    <>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[var(--text-primary)]">{row.entry.title}</span>
                        <span className="truncate text-[10px] text-[var(--text-muted)]">
                          {row.entry.familiar_id} · {row.entry.updated_at}
                          {row.entry.excerpt ? ` · ${row.entry.excerpt.slice(0, 70)}` : ""}
                        </span>
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)]">memory</span>
                    </>
                  ) : null}
                  {row.kind === "fs-memory" ? (
                    <>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[var(--text-primary)]">{row.entry.relPath}</span>
                        <span className="truncate text-[10px] text-[var(--text-muted)]">
                          {row.entry.rootLabel}
                        </span>
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)]">file</span>
                    </>
                  ) : null}
                  {row.kind === "command" ? (
                    <>
                      <span className="font-mono text-[var(--text-secondary)]">{row.name}</span>
                      <span className="flex-1 text-[var(--text-muted)]">{platformizeHint(row.hint, keys)}</span>
                      <span className="text-[10px] text-[var(--text-muted)]">run</span>
                    </>
                  ) : null}
                  {row.kind === "shortcut" ? (
                    <>
                      <span className="flex-1 text-[var(--text-primary)]">{row.label}</span>
                      <span className="font-mono text-[10px] text-[var(--text-muted)]">{platformizeHint(row.shortcut, keys)}</span>
                    </>
                  ) : null}
                  {row.kind === "create-task" ? (
                    <>
                      <Icon name="ph:plus-bold" className="text-[var(--text-secondary)]" width="1.1rem" height="1.1rem" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[var(--text-primary)]">Create task: {row.title}</span>
                        <span className="truncate text-[10px] text-[var(--text-muted)]">
                          New card on the board, scoped to the active familiar
                        </span>
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)]">create</span>
                    </>
                  ) : null}
                  {row.kind === "conversation-hit" ? (
                    <>
                      <Icon name="ph:chat-circle-dots-bold" className="text-[var(--text-secondary)]" width="1.1rem" height="1.1rem" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[var(--text-primary)]">
                          {row.hit.title || "(untitled chat)"}
                        </span>
                        <span className="truncate text-[10px] text-[var(--text-muted)]">
                          {row.hit.snippet}
                        </span>
                      </span>
                      <span className="shrink-0 text-[10px] text-[var(--text-muted)]">
                        {row.hit.matchCount} match{row.hit.matchCount !== 1 ? "es" : ""}
                      </span>
                    </>
                  ) : null}
                  {row.kind === "salem-answer" ? (
                    <>
                      <Icon name="ph:sparkle-bold" className="text-[var(--accent-presence)]" width="1.1rem" height="1.1rem" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[var(--text-primary)]">Ask Salem: {row.query}</span>
                        <span className="truncate text-[10px] text-[var(--text-muted)]">
                          Salem is the docs familiar — answers from the OpenCoven docs
                        </span>
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)]">ask</span>
                    </>
                  ) : null}
                </button>
              </li>
              </Fragment>
            );
          })}
        </ul>
        <div className="flex items-center justify-between border-t border-[var(--border-hairline)] px-4 py-2 text-[10px] text-[var(--text-muted)]">
          <span>{keys.up}{keys.down} navigate · {keys.enter} select · esc close</span>
          <span className="hidden sm:inline">@familiar scopes results</span>
          <span>{keys.mod}K</span>
        </div>
      </div>
    </div>
  );
}

export type { PaletteIntent };
