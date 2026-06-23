import type { Familiar } from "@/lib/types";

// Familiar-scoping for the command palette.
//
//   "@nova"              → scope: nova,        rest: ""
//   "@val readme"        → scope: val,         rest: "readme"
//   "browser @nova"      → scope: nova,        rest: "browser"
//   "@"                  → scope: all (suggest list), rest: ""
//   "hello"              → no scope
//
// We only honour the *first* `@token` in the query — multiple `@`s collapse
// down to the first (the rest stay as literal text in the free-text portion).
export function parseFamiliarToken(query: string): { token: string | null; rest: string } {
  const m = query.match(/(^|\s)@([\w-]*)/);
  if (!m) return { token: null, rest: query };
  const token = m[2].toLowerCase();
  const rest = (query.slice(0, m.index! + m[1].length) + query.slice(m.index! + m[1].length + 1 + m[2].length))
    .replace(/\s+/g, " ")
    .trim();
  return { token, rest };
}

function normalizeFamiliarHandle(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

// Resolve a parsed `@token` to the set of familiar ids it scopes to:
//   - null token            → null (no scope active)
//   - "" (bare `@`)         → every familiar (suggestion list)
//   - non-empty, matches    → the matching familiar ids
//   - non-empty, no matches → empty set (caller shows suggestions only)
export function resolveFamiliarIds(familiars: Familiar[], token: string | null): Set<string> | null {
  if (token === null) return null;
  if (token === "") return new Set(familiars.map((f) => f.id));
  const t = token.toLowerCase();
  const out = new Set<string>();
  for (const f of familiars) {
    const candidates = [f.id, f.name ?? "", f.display_name];
    if (candidates.some((c) => normalizeFamiliarHandle(c).includes(t))) {
      out.add(f.id);
    }
  }
  return out;
}
