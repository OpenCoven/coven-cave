const RENDER_CACHE_MAX = 200;
const renderCache = new Map<string, string>();

/** Small LRU keyed by final markdown snapshots; transient stream frames never enter it. */
export function getRenderedMarkdown(key: string): string | undefined {
  const value = renderCache.get(key);
  if (value !== undefined) {
    renderCache.delete(key);
    renderCache.set(key, value);
  }
  return value;
}

export function cacheRenderedMarkdown(key: string, value: string): void {
  if (renderCache.has(key)) renderCache.delete(key);
  renderCache.set(key, value);
  if (renderCache.size > RENDER_CACHE_MAX) {
    const oldest = renderCache.keys().next().value;
    if (oldest !== undefined) renderCache.delete(oldest);
  }
}

/** Close an incomplete streaming fence only for the transient render. */
export function closeTrailingFence(markdown: string): string {
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*```/.test(line)) inFence = !inFence;
  }
  return inFence ? `${markdown}\n\`\`\`` : markdown;
}

/** Preserve filename labels while normalizing fence info for the markdown parser. */
export function scanFenceFilenames(markdown: string): Array<string | null> {
  const filenames: Array<string | null> = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (!/^\s*```/.test(line)) continue;
    if (inFence) {
      inFence = false;
      continue;
    }
    const match = /^\s*```\s*[\w+.-]*(?:(:\S+))?\s*$/.exec(line);
    filenames.push(match?.[1]?.slice(1) ?? null);
    inFence = true;
  }
  return filenames;
}
