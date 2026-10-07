/** Project positions through the same pure text cleanup used by persistence.
 * Prefixes may end inside a removed marker: retain only the prefix shared with
 * the complete projection, never count a partial marker as displayed text.
 * A mismatched full projection has no defensible positions, so leave them absent. */
export function projectTextOffsets<T extends { textOffset?: number }>(
  entries: readonly T[], source: string, target: string, project: (text: string) => string,
): T[] {
  const matches = project(source) === target;
  const cache = new Map<number, number>();
  let sentinel = "\uE002";
  while (source.includes(sentinel) || target.includes(sentinel)) sentinel += "\uE002";
  return entries.map((entry) => {
    if (entry.textOffset === undefined) return entry;
    const { textOffset, ...rest } = entry;
    if (!matches || !Number.isSafeInteger(textOffset) || textOffset < 0) return rest as T;
    let offset = cache.get(textOffset);
    if (offset === undefined) {
      // Keep whitespace before the anchor from becoming trailing trim merely
      // because this is a prefix. The sentinel never enters persisted output.
      const prefix = project(source.slice(0, textOffset) + sentinel);
      offset = 0;
      while (offset < prefix.length && offset < target.length && prefix[offset] === target[offset]) offset++;
      // A boundary must not bisect a Unicode surrogate pair.
      if (offset > 0 && /[\uD800-\uDBFF]/.test(target[offset - 1]!) && /[\uDC00-\uDFFF]/.test(target[offset] ?? "")) offset--;
      cache.set(textOffset, offset);
    }
    return { ...entry, textOffset: offset };
  });
}
