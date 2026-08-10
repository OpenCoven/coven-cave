/**
 * search-query — the deterministic parser, natural-language rules, and
 * canonical URL contract for global intelligent search (cave-ychtl.1).
 *
 * The governing rule, from the spec: **search never fails because a user typed
 * a colon.** Unknown keys, unknown values, unmatched quotes, and half-typed
 * tokens are not errors — they stay searchable text and earn a suggestion. The
 * only thing that ever "fails" here is an unknown query VERSION, which falls
 * closed to plain text rather than applying filters we cannot interpret.
 *
 * Everything is pure and clock-free: relative-date rules take `now` from the
 * caller, so `last week` is testable without freezing time.
 *
 * Spec: docs/superpowers/specs/2026-08-03-global-intelligent-search-design.md
 * Plan: docs/superpowers/plans/2026-08-09-global-intelligent-search-implementation.md
 */

import {
  SEARCH_QUERY_VERSION,
  SEARCH_FILTER_DEFINITIONS,
  completeFilterKeys,
  completeFilterValues,
  emptySearchQueryState,
  filterDefinition,
  filterDefinitionForUrlKey,
  isValidFilterValue,
  type SearchFilter,
  type SearchFilterDefinition,
  type SearchFilterOrigin,
  type SearchPresentation,
  type SearchQueryState,
  type SearchScope,
  type SearchScopeDimension,
} from "./search-filters.ts";

export type SearchSuggestion =
  | { kind: "filter-key"; token: string; options: string[] }
  | { kind: "filter-value"; token: string; key: string; options: string[] }
  | { kind: "unmatched-quote"; token: string; options: [] };

export type SearchParseResult = {
  state: SearchQueryState;
  /** Advisory completions for tokens that stayed in text. Never an error. */
  suggestions: SearchSuggestion[];
};

export type ParseSearchQueryOptions = {
  /** Reference instant for relative dates. Required for `last week` etc. */
  now?: Date;
  /** Scopes carried in from workspace context or a restored link. */
  scopes?: SearchScope[];
  presentation?: SearchPresentation;
  /** Set false to parse syntax only, leaving language untouched. */
  naturalLanguage?: boolean;
};

type RawToken = {
  /** Text as typed, with quote characters removed. */
  value: string;
  /**
   * The token opened with a quote, so it is an exact phrase.
   *
   * Position matters, not mere presence: `room:"code workshop"` also contains
   * quotes but is a filter with a quoted VALUE, and treating any quoted token
   * as a phrase silently drops the filter.
   */
  startedQuoted: boolean;
  /** A quote was opened and never closed. */
  unterminated: boolean;
};

const FILTER_TOKEN = /^([A-Za-z_][A-Za-z0-9_-]*):([\s\S]*)$/;

/**
 * Split on whitespace while respecting double quotes, including quoted filter
 * values (`room:"code workshop"`), and report an unterminated quote rather than
 * throwing on it.
 */
function tokenize(input: string): RawToken[] {
  const tokens: RawToken[] = [];
  let buffer = "";
  let quoted = false;
  let sawQuote = false;
  let startedQuoted = false;
  let unterminated = false;

  const flush = () => {
    if (buffer.length === 0 && !sawQuote) return;
    tokens.push({ value: buffer, startedQuoted, unterminated });
    buffer = "";
    sawQuote = false;
    startedQuoted = false;
    unterminated = false;
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    if (char === '"') {
      if (!sawQuote && buffer.length === 0) startedQuoted = true;
      sawQuote = true;
      quoted = !quoted;
      continue;
    }
    if (!quoted && /\s/.test(char)) {
      flush();
      continue;
    }
    buffer += char;
  }
  if (quoted) unterminated = true;
  flush();
  return tokens;
}

function addFilter(
  filters: SearchFilter[],
  definition: SearchFilterDefinition,
  value: string,
  origin: SearchFilterOrigin,
): void {
  const normalized = definition.valueKind === "enum" ? value.toLowerCase() : value;
  const duplicate = filters.some(
    (filter) => filter.key === definition.key && filter.value === normalized,
  );
  if (duplicate) return;
  if (!definition.multiple) {
    // The registry permits one value for this key, so a later occurrence is a
    // correction rather than an addition. Last one wins, deterministically.
    const existing = filters.findIndex((filter) => filter.key === definition.key);
    if (existing >= 0) filters.splice(existing, 1);
  }
  filters.push({
    key: definition.key,
    operator: definition.operator,
    value: normalized,
    origin,
  });
}

const ENTITY_PLURALS: ReadonlyMap<string, string> = new Map([
  ["tasks", "task"],
  ["task", "task"],
  ["sessions", "session"],
  ["session", "session"],
  ["chats", "chat"],
  ["chat", "chat"],
  ["projects", "project"],
  ["project", "project"],
  ["familiars", "familiar"],
  ["familiar", "familiar"],
  ["files", "file"],
  ["file", "file"],
]);

const STATUS_WORDS: ReadonlyMap<string, string> = new Map([
  ["blocked", "blocked"],
  ["failed", "failed"],
  ["failing", "failed"],
  ["open", "open"],
  ["done", "done"],
  ["closed", "closed"],
  ["running", "running"],
]);

/**
 * Filler that only ever introduces a query. Stripped when it LEADS the input,
 * never mid-sentence — the spec's own example, `show blocked tasks for Cody`,
 * has to reduce to three chips, and leaving "show" behind would silently
 * require the word "show" to appear in every result.
 */
const LEADING_FILLER = ["show", "show me", "find", "find me", "search for", "search", "list", "get"]
  // Longest first, computed once: parsing runs on every keystroke.
  .sort((a, b) => b.length - a.length);

const STOP_WORDS = new Set([
  "the", "a", "an", "this", "that", "these", "those", "my", "our", "all", "any",
  "last", "next", "today", "yesterday", "week", "days", "day",
]);

function isoDate(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

function shiftDays(instant: Date, days: number): Date {
  return new Date(instant.getTime() + days * 24 * 60 * 60 * 1000);
}

/** A capitalized run reads as a proper noun — a familiar or project name. */
function properNounRun(words: string[], start: number, limit = 3): string[] {
  const run: string[] = [];
  for (let index = start; index < words.length && run.length < limit; index += 1) {
    const word = words[index]!;
    if (!/^[A-Z][\w'-]*$/.test(word)) break;
    if (STOP_WORDS.has(word.toLowerCase())) break;
    run.push(word);
  }
  return run;
}

/**
 * Consume only high-confidence language. Anything ambiguous stays in `text`;
 * there is deliberately no low-confidence interpretation, because a hidden
 * wrong filter is worse than an unfiltered search.
 */
function applyNaturalLanguage(
  words: string[],
  filters: SearchFilter[],
  now: Date | undefined,
): string[] {
  let remaining = [...words];

  // Leading filler, longest match first.
  for (const filler of LEADING_FILLER) {
    const parts = filler.split(" ");
    const head = remaining.slice(0, parts.length).map((word) => word.toLowerCase());
    if (parts.length <= remaining.length && head.join(" ") === filler) {
      remaining = remaining.slice(parts.length);
      break;
    }
  }

  const kept: string[] = [];
  for (let index = 0; index < remaining.length; index += 1) {
    const word = remaining[index]!;
    const lower = word.toLowerCase();
    const nextLower = remaining[index + 1]?.toLowerCase();

    // Relative dates. Skipped entirely when the caller supplied no clock,
    // rather than inventing one.
    if (now) {
      if (lower === "today") {
        addFilter(filters, filterDefinition("after")!, isoDate(now), "natural-language");
        continue;
      }
      if (lower === "yesterday") {
        addFilter(filters, filterDefinition("after")!, isoDate(shiftDays(now, -1)), "natural-language");
        addFilter(filters, filterDefinition("before")!, isoDate(now), "natural-language");
        continue;
      }
      if (lower === "last" && nextLower === "week") {
        addFilter(filters, filterDefinition("after")!, isoDate(shiftDays(now, -7)), "natural-language");
        index += 1;
        continue;
      }
      const days = Number(nextLower);
      if (
        lower === "last" &&
        Number.isInteger(days) &&
        days > 0 &&
        remaining[index + 2]?.toLowerCase() === "days"
      ) {
        addFilter(filters, filterDefinition("after")!, isoDate(shiftDays(now, -days)), "natural-language");
        index += 2;
        continue;
      }
    }

    // Signals.
    if (lower === "with" && nextLower === "errors") {
      addFilter(filters, filterDefinition("has")!, "errors", "natural-language");
      index += 1;
      continue;
    }
    if (
      (lower === "needs" || lower === "needing") &&
      (nextLower === "a" || nextLower === "decision") &&
      (nextLower === "decision" || remaining[index + 2]?.toLowerCase() === "decision")
    ) {
      addFilter(filters, filterDefinition("has")!, "decision", "natural-language");
      index += nextLower === "decision" ? 1 : 2;
      continue;
    }

    // Entity + status, the spec's `blocked tasks` / `failed sessions`.
    const status = STATUS_WORDS.get(lower);
    const entityAfterStatus = nextLower ? ENTITY_PLURALS.get(nextLower) : undefined;
    if (status && entityAfterStatus) {
      addFilter(filters, filterDefinition("status")!, status, "natural-language");
      addFilter(filters, filterDefinition("type")!, entityAfterStatus, "natural-language");
      index += 1;
      continue;
    }

    // `for <Familiar>` and `in <Project>`.
    if ((lower === "for" || lower === "in") && index + 1 < remaining.length) {
      const run = properNounRun(remaining, index + 1);
      if (run.length > 0) {
        const key = lower === "for" ? "familiar" : "project";
        addFilter(filters, filterDefinition(key)!, run.join(" "), "natural-language");
        index += run.length;
        continue;
      }
    }

    kept.push(word);
  }

  return kept;
}

/**
 * Parse raw input into query state plus advisory suggestions.
 *
 * Never throws and never rejects input. Callers render `state` immediately and
 * may show `suggestions` alongside it.
 */
export function parseSearchQuery(
  input: string,
  options: ParseSearchQueryOptions = {},
): SearchParseResult {
  const { now, scopes = [], presentation = "top", naturalLanguage = true } = options;
  const filters: SearchFilter[] = [];
  const phrases: string[] = [];
  const suggestions: SearchSuggestion[] = [];
  const words: string[] = [];
  /** Text that must reach the query verbatim, never through inference. */
  const literalWords: string[] = [];

  for (const token of tokenize(input)) {
    if (token.unterminated) {
      // An open quote is a half-typed phrase, not a syntax error. Keep the
      // content searchable and say why the phrase did not form.
      //
      // It is held OUT of the natural-language pass on purpose. Someone typing
      // `"blocked tasks` is spelling an exact phrase, and letting the language
      // rules consume those words would turn a half-typed quote into
      // `status:blocked` + `type:task` chips — the opposite of the contract
      // that unmatched quotes stay searchable text.
      if (token.value.length > 0) literalWords.push(token.value);
      suggestions.push({ kind: "unmatched-quote", token: token.value, options: [] });
      continue;
    }

    if (token.startedQuoted) {
      // A closed quote is an exact phrase — including an empty one, which we
      // simply drop rather than treating as a match-everything phrase.
      if (token.value.length > 0 && !phrases.includes(token.value)) phrases.push(token.value);
      continue;
    }

    const match = FILTER_TOKEN.exec(token.value);
    if (!match) {
      if (token.value.length > 0) words.push(token.value);
      continue;
    }

    const rawKey = match[1] ?? "";
    const rawValue = match[2] ?? "";
    const definition = filterDefinition(rawKey);

    if (!definition) {
      // Unknown key: searchable text, plus key completions if it looks like a
      // near miss.
      words.push(token.value);
      const options_ = completeFilterKeys(rawKey).map((candidate) => candidate.key);
      if (options_.length > 0) {
        suggestions.push({ kind: "filter-key", token: token.value, options: options_ });
      }
      continue;
    }

    if (rawValue.length === 0) {
      // `status:` — incomplete, so it stays text and offers its values.
      words.push(token.value);
      suggestions.push({
        kind: "filter-value",
        token: token.value,
        key: definition.key,
        options: definition.values,
      });
      continue;
    }

    if (!isValidFilterValue(definition, rawValue)) {
      words.push(token.value);
      suggestions.push({
        kind: "filter-value",
        token: token.value,
        key: definition.key,
        options: completeFilterValues(definition, rawValue),
      });
      continue;
    }

    addFilter(filters, definition, rawValue, "syntax");
  }

  const remainingWords = [
    ...(naturalLanguage ? applyNaturalLanguage(words, filters, now) : words),
    ...literalWords,
  ];

  return {
    state: {
      version: SEARCH_QUERY_VERSION,
      text: remainingWords.join(" "),
      phrases,
      filters,
      scopes,
      presentation,
    },
    suggestions,
  };
}

/* ---------------------------------------------------------------------- */
/* Canonical URL contract                                                  */
/* ---------------------------------------------------------------------- */

const VERSION_PARAM = "v";
const TEXT_PARAM = "q";
const PHRASE_PARAM = "phrase";
const SCOPE_PARAM = "scope";
const VIEW_PARAM = "view";

const SCOPE_DIMENSIONS = new Set<SearchScopeDimension>([
  "project",
  "familiar",
  "room",
  "session",
  "runtime",
]);

/**
 * Serialize to canonical, ordered parameters so the same state always produces
 * a byte-identical link — otherwise "Copy search link" yields a different URL
 * each time and nothing downstream can cache or compare it.
 *
 * Implicit scopes are deliberately NOT serialized: they are derived from the
 * sharer's workspace, and re-asserting them in a recipient's context would
 * silently narrow their results to a room they are not in.
 */
export function searchQueryToUrlParams(state: SearchQueryState): URLSearchParams {
  const params = new URLSearchParams();
  params.set(VERSION_PARAM, String(state.version));
  if (state.text.trim().length > 0) params.set(TEXT_PARAM, state.text.trim());
  for (const phrase of [...state.phrases].sort()) params.append(PHRASE_PARAM, phrase);

  for (const definition of SEARCH_FILTER_DEFINITIONS) {
    const values = state.filters
      .filter((filter) => filter.key === definition.key)
      .map((filter) => String(filter.value))
      .sort();
    for (const value of values) params.append(definition.urlKey, value);
  }

  const explicitScopes = state.scopes
    .filter((scope) => !scope.implicit)
    .map((scope) => `${scope.dimension}:${scope.id}`)
    .sort();
  for (const scope of explicitScopes) params.append(SCOPE_PARAM, scope);

  if (state.presentation !== "top") params.set(VIEW_PARAM, state.presentation);
  return params;
}

export function searchQueryToUrlString(state: SearchQueryState): string {
  return searchQueryToUrlParams(state).toString();
}

/**
 * Restore state from a link.
 *
 * An unknown version falls closed to plain text: we keep whatever free text the
 * link carried and drop every filter and scope, because applying a filter whose
 * meaning changed between versions is worse than searching too broadly. A
 * missing version is treated as the current one so hand-written links work.
 */
export function searchQueryFromUrlParams(params: URLSearchParams): SearchQueryState {
  const rawVersion = params.get(VERSION_PARAM);
  const text = (params.get(TEXT_PARAM) ?? "").trim();

  if (rawVersion !== null && Number(rawVersion) !== SEARCH_QUERY_VERSION) {
    return { ...emptySearchQueryState(), text };
  }

  const filters: SearchFilter[] = [];
  for (const [key, value] of params.entries()) {
    const definition = filterDefinitionForUrlKey(key);
    if (!definition) continue;
    if (!isValidFilterValue(definition, value)) continue;
    addFilter(filters, definition, value, "syntax");
  }

  const scopes: SearchScope[] = [];
  for (const raw of params.getAll(SCOPE_PARAM)) {
    const separator = raw.indexOf(":");
    if (separator <= 0) continue;
    const dimension = raw.slice(0, separator) as SearchScopeDimension;
    const id = raw.slice(separator + 1);
    if (!SCOPE_DIMENSIONS.has(dimension) || id.length === 0) continue;
    if (scopes.some((scope) => scope.dimension === dimension && scope.id === id)) continue;
    scopes.push({ dimension, id, label: id, implicit: false });
  }

  const view = params.get(VIEW_PARAM);
  return {
    version: SEARCH_QUERY_VERSION,
    text,
    phrases: [...new Set(params.getAll(PHRASE_PARAM).filter((phrase) => phrase.length > 0))].sort(),
    filters,
    scopes,
    presentation: view === "grouped" ? "grouped" : "top",
  };
}

/**
 * Drop implicit (context) scopes — the Command/Control+Enter behavior.
 *
 * Explicit filters survive on purpose: broadening means "stop assuming where I
 * am", not "throw away what I asked for".
 */
export function broadenToGlobal(state: SearchQueryState): SearchQueryState {
  return { ...state, scopes: state.scopes.filter((scope) => !scope.implicit) };
}
