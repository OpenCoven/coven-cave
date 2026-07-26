export const PALETTE_CATEGORIES = [
  "all",
  "chats",
  "tasks",
  "memory",
  "settings",
  "actions",
] as const;

export type PaletteCategory = (typeof PALETTE_CATEGORIES)[number];
export type PaletteCategorizedRow = { kind: string };

export const PALETTE_CATEGORY_LABEL: Record<PaletteCategory, string> = {
  all: "All",
  chats: "Chats",
  tasks: "Tasks",
  memory: "Memory",
  settings: "Settings",
  actions: "Actions",
};

const SUMMARY_NOUN: Record<PaletteCategory, string> = {
  all: "result",
  chats: "chat result",
  tasks: "task result",
  memory: "memory result",
  settings: "setting result",
  actions: "action result",
};

export function paletteCategoryForKind(kind: string): Exclude<PaletteCategory, "all"> {
  switch (kind) {
    case "familiar":
    case "session":
    case "conversation-hit":
      return "chats";
    case "card":
      return "tasks";
    case "coven-memory":
    case "fs-memory":
      return "memory";
    case "setting":
      return "settings";
    default:
      return "actions";
  }
}

export function filterPaletteRows<T extends PaletteCategorizedRow>(
  rows: readonly T[],
  category: PaletteCategory,
): readonly T[] {
  if (category === "all") return rows;
  return rows.filter((row) => paletteCategoryForKind(row.kind) === category);
}

function isLocalResult(row: PaletteCategorizedRow): boolean {
  return row.kind !== "salem-answer";
}

export function paletteResultCounts(rows: readonly PaletteCategorizedRow[]): Record<PaletteCategory, number> {
  const counts: Record<PaletteCategory, number> = {
    all: 0,
    chats: 0,
    tasks: 0,
    memory: 0,
    settings: 0,
    actions: 0,
  };
  for (const row of rows) {
    if (!isLocalResult(row)) continue;
    counts.all += 1;
    counts[paletteCategoryForKind(row.kind)] += 1;
  }
  return counts;
}

export function paletteResultSummary(
  rows: readonly PaletteCategorizedRow[],
  category: PaletteCategory,
  query: string,
): string {
  const count = rows.filter(isLocalResult).length;
  const noun = SUMMARY_NOUN[category];
  const suffix = count === 1 ? "" : "s";
  const trimmed = query.trim();
  if (count === 0) return `No ${noun}s for ${trimmed || "this search"}.`;
  if (category === "all") {
    return `${count} local result${suffix}${trimmed ? ` for ${trimmed}` : ""} across all categories.`;
  }
  return `${count} ${noun}${suffix}${trimmed ? ` for ${trimmed}` : ""}.`;
}

