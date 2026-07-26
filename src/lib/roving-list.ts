export type RovingKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

export function resolveRovingId(
  ids: readonly string[],
  currentId: string | null,
  preferredId: string | null,
): string | null {
  if (currentId && ids.includes(currentId)) return currentId;
  if (preferredId && ids.includes(preferredId)) return preferredId;
  return ids[0] ?? null;
}

export function nextRovingId(
  ids: readonly string[],
  currentId: string | null,
  key: RovingKey,
): string | null {
  if (ids.length === 0) return null;
  const currentIndex = currentId ? ids.indexOf(currentId) : -1;
  const index = currentIndex === -1 ? 0 : currentIndex;

  switch (key) {
    case "ArrowDown":
      return ids[Math.min(ids.length - 1, index + 1)] ?? null;
    case "ArrowUp":
      return ids[Math.max(0, index - 1)] ?? null;
    case "Home":
      return ids[0] ?? null;
    case "End":
      return ids.at(-1) ?? null;
  }
}
