import type { Card } from "@/lib/cave-board-types";
import type { Familiar } from "@/lib/types";

export type BoardSearchToken = {
  key: string | null;
  value: string;
  negated: boolean;
};

function normalize(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function tokenize(query: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quoted = false;

  for (const char of query.trim()) {
    if (char === "\"") {
      quoted = !quoted;
      continue;
    }
    if (!quoted && /\s/.test(char)) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  if (current) tokens.push(current);
  return tokens;
}

export function parseBoardSearchQuery(query: string): BoardSearchToken[] {
  return tokenize(query)
    .map((raw) => {
      const negated = raw.startsWith("-");
      const token = negated ? raw.slice(1) : raw;
      const separator = token.indexOf(":");
      if (separator <= 0) {
        return { key: null, value: normalize(token), negated };
      }
      return {
        key: normalize(token.slice(0, separator)),
        value: normalize(token.slice(separator + 1)),
        negated,
      };
    })
    .filter((token) => token.value.length > 0);
}

function includesAny(values: string[], needle: string): boolean {
  return values.some((value) => normalize(value).includes(needle));
}

function familiarValues(card: Card, familiarsById: Map<string, Pick<Familiar, "id" | "display_name" | "name">>): string[] {
  const familiar = card.familiarId ? familiarsById.get(card.familiarId) : null;
  return [
    card.familiarId ?? "",
    familiar?.id ?? "",
    familiar?.name ?? "",
    familiar?.display_name ?? "",
  ];
}

function tokenMatches(
  card: Card,
  token: BoardSearchToken,
  familiarsById: Map<string, Pick<Familiar, "id" | "display_name" | "name">>,
): boolean {
  const value = token.value;
  const labelValues = card.labels ?? [];
  const familiar = familiarValues(card, familiarsById);

  switch (token.key) {
    case "status":
      return normalize(card.status).includes(value);
    case "priority":
      return normalize(card.priority).includes(value);
    case "label":
    case "labels":
    case "tag":
    case "tags":
      return includesAny(labelValues, value);
    case "familiar":
    case "agent":
    case "assignee":
      return includesAny(familiar, value);
    case "title":
      return normalize(card.title).includes(value);
    case "note":
    case "notes":
      return normalize(card.notes).includes(value);
    case "session":
      return normalize(card.sessionId).includes(value);
    case "id":
      return normalize(card.id).includes(value);
    default:
      return includesAny(
        [
          card.id,
          card.title,
          card.notes,
          card.status,
          card.priority,
          card.sessionId ?? "",
          ...labelValues,
          ...familiar,
        ],
        value,
      );
  }
}

export function cardMatchesBoardSearch(
  card: Card,
  query: string,
  familiarsById: Map<string, Pick<Familiar, "id" | "display_name" | "name">> = new Map(),
): boolean {
  const tokens = parseBoardSearchQuery(query);
  if (tokens.length === 0) return true;

  return tokens.every((token) => {
    const matched = tokenMatches(card, token, familiarsById);
    return token.negated ? !matched : matched;
  });
}
