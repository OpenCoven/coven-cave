import type { LibraryDoc } from "@/lib/library-types";

// Sort options for the Library docs list — parity with the bookmarks / reading
// / github lists, which already sort. (Type-only import above is erased at
// runtime, so this module is dependency-free and runs in the plain test runner.)

export type DocSortKey = "modified" | "title";
export type DocSortDir = "asc" | "desc";

export const DOC_SORT_OPTIONS: { id: string; key: DocSortKey; dir: DocSortDir; label: string }[] = [
  { id: "modified:desc", key: "modified", dir: "desc", label: "Recently modified" },
  { id: "modified:asc", key: "modified", dir: "asc", label: "Oldest first" },
  { id: "title:asc", key: "title", dir: "asc", label: "Title A–Z" },
  { id: "title:desc", key: "title", dir: "desc", label: "Title Z–A" },
];

/** Stable sort by the chosen key/direction; ties always break title-ascending. */
export function sortLibraryDocs(
  docs: readonly LibraryDoc[],
  key: DocSortKey,
  dir: DocSortDir,
): LibraryDoc[] {
  const sign = dir === "asc" ? 1 : -1;
  const byTitle = (a: LibraryDoc, b: LibraryDoc) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  return [...docs].sort((a, b) => {
    const primary =
      key === "title"
        ? byTitle(a, b)
        : new Date(a.modifiedAt).getTime() - new Date(b.modifiedAt).getTime();
    if (primary !== 0) return primary * sign;
    return byTitle(a, b);
  });
}
