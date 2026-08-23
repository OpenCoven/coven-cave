/**
 * Familiar removal — the detach half of the dual-track lifecycle (Archive, in
 * cave-familiar-archive.ts, is the hide half). Pure helpers shared by the
 * DELETE /api/familiars/[id] and /api/familiars/removed routes: `[[familiar]]`
 * block surgery on familiars.toml, plus tombstone bookkeeping for the
 * undo/restore path. No filesystem access here — the on-disk store lives in
 * src/lib/server/familiar-tombstones.ts.
 */

export type RemovedFamiliarTombstone = {
  id: string;
  /** Roster label at removal time — drives "Recently removed" copy. */
  displayName: string;
  /** ISO timestamp of the removal. */
  removedAt: string;
  /** Verbatim `[[familiar]]` block removed from familiars.toml (null when the
   *  familiar only existed as a cave-config binding). Restore re-appends it. */
  tomlBlock: string | null;
  /** The cave-config.json binding entry at removal time. */
  binding: Record<string, unknown> | null;
};

/** Tombstones stay restorable for 30 days, capped at 20 entries (newest win). */
export const TOMBSTONE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const TOMBSTONE_MAX_ENTRIES = 20;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Remove the `[[familiar]]` block whose `id` matches from a familiars.toml
 * document. Returns the new document plus the removed block verbatim (trimmed)
 * so callers can tombstone it; `removed` is null (and the document unchanged)
 * when no block matches.
 */
export function removeFamiliarBlockFromToml(
  toml: string,
  id: string,
): { toml: string; removed: string | null } {
  const lines = toml.split("\n");
  const idLine = new RegExp(`^\\s*id\\s*=\\s*"${escapeRegExp(id)}"\\s*$`);

  for (let start = 0; start < lines.length; start++) {
    if (!/^\s*\[\[familiar\]\]\s*$/.test(lines[start])) continue;
    // A block runs to the next table header — another `[[familiar]]` OR an
    // unrelated `[table]`, both of which must survive the cut — or EOF. Blank
    // lines in between travel with the block so the survivors don't accumulate
    // a widening gap.
    let end = start + 1;
    while (end < lines.length && !/^\s*\[/.test(lines[end])) end++;
    const block = lines.slice(start, end);
    if (!block.some((line) => idLine.test(line))) {
      start = end - 1; // skip past the scanned block
      continue;
    }

    const removed = block.join("\n").trim();
    const rest = [...lines.slice(0, start), ...lines.slice(end)];
    // Drop blank lines left dangling at EOF (loop, not /\n+$/ — anchored
    // quantifier replaces have burned us in CodeQL polynomial-ReDoS review).
    while (rest.length > 0 && rest[rest.length - 1].trim() === "") rest.pop();
    let next = rest.join("\n");
    if (next && !next.endsWith("\n")) next += "\n";
    return { toml: next, removed };
  }

  return { toml, removed: null };
}

/** Best-effort `display_name` out of a `[[familiar]]` block, for toast copy. */
export function displayNameFromTomlBlock(block: string): string | null {
  const match = /^\s*display_name\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/m.exec(block);
  if (!match) return null;
  const unescaped = match[1].replace(/\\(["\\])/g, "$1");
  return unescaped || null;
}

function unescapeTomlBasicString(value: string): string | null {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== "\\") {
      output += character;
      continue;
    }

    const escape = value[index + 1];
    if (!escape) return null;
    index += 1;
    const simple: Record<string, string> = {
      b: "\b",
      t: "\t",
      n: "\n",
      f: "\f",
      r: "\r",
      '"': '"',
      "\\": "\\",
    };
    if (escape in simple) {
      output += simple[escape];
      continue;
    }

    const digits = escape === "u" ? 4 : escape === "U" ? 8 : 0;
    if (!digits) return null;
    const hex = value.slice(index + 1, index + 1 + digits);
    if (!new RegExp(`^[0-9a-fA-F]{${digits}}$`).test(hex)) return null;
    const codePoint = Number.parseInt(hex, 16);
    if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return null;
    output += String.fromCodePoint(codePoint);
    index += digits;
  }
  return output;
}

/** True when a tombstoned block can be restored without violating the roster schema. */
export function hasNonemptyDescriptionFromTomlBlock(block: string): boolean {
  const multilineBasic = /^\s*description\s*=\s*"""([\s\S]*?)"""\s*(?:#.*)?$/m.exec(block);
  if (multilineBasic) return (unescapeTomlBasicString(multilineBasic[1]) ?? "").trim().length > 0;

  const multilineLiteral = /^\s*description\s*=\s*'''([\s\S]*?)'''\s*(?:#.*)?$/m.exec(block);
  if (multilineLiteral) return multilineLiteral[1].trim().length > 0;

  const basic = /^\s*description\s*=\s*"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$/m.exec(block);
  if (basic) return (unescapeTomlBasicString(basic[1]) ?? "").trim().length > 0;

  const literal = /^\s*description\s*=\s*'([^']*)'\s*(?:#.*)?$/m.exec(block);
  return literal ? literal[1].trim().length > 0 : false;
}

/** Age out tombstones past the restore window and cap the list, newest first. */
export function pruneTombstones(
  entries: RemovedFamiliarTombstone[],
  nowMs: number,
): RemovedFamiliarTombstone[] {
  const fresh = entries.filter((entry) => {
    const removed = Date.parse(entry.removedAt);
    return Number.isFinite(removed) && nowMs - removed <= TOMBSTONE_MAX_AGE_MS;
  });
  fresh.sort((a, b) => Date.parse(b.removedAt) - Date.parse(a.removedAt));
  return fresh.slice(0, TOMBSTONE_MAX_ENTRIES);
}

/** Parse an untrusted store file value into well-formed tombstones. */
export function normalizeTombstones(value: unknown): RemovedFamiliarTombstone[] {
  const list =
    value && typeof value === "object" && Array.isArray((value as { entries?: unknown }).entries)
      ? ((value as { entries: unknown[] }).entries)
      : [];
  const out: RemovedFamiliarTombstone[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry.id !== "string" || entry.id === "") continue;
    if (typeof entry.removedAt !== "string") continue;
    out.push({
      id: entry.id,
      displayName:
        typeof entry.displayName === "string" && entry.displayName !== ""
          ? entry.displayName
          : entry.id,
      removedAt: entry.removedAt,
      tomlBlock: typeof entry.tomlBlock === "string" ? entry.tomlBlock : null,
      binding:
        entry.binding && typeof entry.binding === "object" && !Array.isArray(entry.binding)
          ? (entry.binding as Record<string, unknown>)
          : null,
    });
  }
  return out;
}
