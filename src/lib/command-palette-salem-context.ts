export type SalemContextRow =
  | { kind: "familiar"; familiar: { display_name: string; role?: string } }
  | { kind: "session"; session: { title?: string; familiarId?: string | null; harness?: string | null }; familiar: { display_name: string } | null }
  | { kind: "card"; card: { title: string; status: string; priority: string; labels: string[] }; familiar: { display_name: string } | null }
  | { kind: "coven-memory"; entry: { title: string; familiar_id: string; path: string }; familiar: { display_name: string } | null }
  | { kind: "fs-memory"; entry: { relPath: string; rootLabel: string } };

export type SalemSearchContext = {
  source: "top-search";
  query: string;
  matches: Array<{ type: string; title: string; detail?: string }>;
};

const SALEM_CONTEXT_LIMIT = 8;

/** Exclude command and UI-only rows before sending local context to Salem. */
export function isSalemContextRow<T extends { kind: string }>(row: T): row is T & SalemContextRow {
  return row.kind === "familiar" || row.kind === "session" || row.kind === "card" || row.kind === "coven-memory" || row.kind === "fs-memory";
}

/** Keep the AI fallback grounded in the same local rows that the palette shows. */
export function buildSalemSearchContext(rows: readonly SalemContextRow[], query: string): SalemSearchContext {
  const matches = rows.slice(0, SALEM_CONTEXT_LIMIT).map((row) => {
    if (row.kind === "familiar") return { type: "familiar", title: row.familiar.display_name, detail: row.familiar.role };
    if (row.kind === "session") return {
      type: "chat", title: row.session.title || "(untitled chat)",
      detail: `${row.familiar?.display_name ?? row.session.familiarId ?? "Unknown familiar"} · ${row.session.harness}`,
    };
    if (row.kind === "card") return {
      type: "task", title: row.card.title,
      detail: [row.card.status, row.card.priority, row.familiar?.display_name, ...row.card.labels].filter(Boolean).join(" · "),
    };
    if (row.kind === "coven-memory") return {
      type: "memory", title: row.entry.title,
      detail: [row.familiar?.display_name ?? row.entry.familiar_id, row.entry.path].filter(Boolean).join(" · "),
    };
    return { type: "memory-file", title: row.entry.relPath, detail: row.entry.rootLabel };
  });
  return { source: "top-search", query, matches };
}
