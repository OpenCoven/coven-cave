import fs from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import type { LibraryBookmark, LibraryReadingItem, LibraryGitHubItem } from "./library-types";

export type IndexEntry = {
  url: string;
  sessionId: string | null;
  turnId: string | null;
  list: "bookmarks" | "reading" | "github";
  itemId: string;
};
export type LibraryIndex = { version: 1; entries: IndexEntry[] };

const DEFAULT_ROOT = process.env.CAVE_LIBRARY_DIR
  ? process.env.CAVE_LIBRARY_DIR
  : path.join(homedir(), ".coven", "library");

type Mutex = { p: Promise<void> };
const mutex: Mutex = { p: Promise.resolve() };

function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = mutex.p.then(fn, fn);
  mutex.p = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function readJson<T>(p: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(p, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(p: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf-8");
  await fs.rename(tmp, p);
}

export function createLibraryStore(root: string = DEFAULT_ROOT) {
  const paths = {
    bookmarks: path.join(root, "bookmarks.json"),
    reading: path.join(root, "reading.json"),
    github: path.join(root, "github.json"),
    index: path.join(root, ".index.json"),
  };

  const emptyIndex: LibraryIndex = { version: 1, entries: [] };

  return {
    readBookmarks: () => readJson<LibraryBookmark[]>(paths.bookmarks, []),
    readReading: () => readJson<LibraryReadingItem[]>(paths.reading, []),
    readGithub: () => readJson<LibraryGitHubItem[]>(paths.github, []),
    readIndex: () => readJson<LibraryIndex>(paths.index, emptyIndex),

    appendBookmark: (item: LibraryBookmark) =>
      runExclusive(async () => {
        const items = await readJson<LibraryBookmark[]>(paths.bookmarks, []);
        items.push(item);
        await writeJsonAtomic(paths.bookmarks, items);
      }),

    appendReading: (item: LibraryReadingItem) =>
      runExclusive(async () => {
        const items = await readJson<LibraryReadingItem[]>(paths.reading, []);
        items.push(item);
        await writeJsonAtomic(paths.reading, items);
      }),

    appendGithub: (item: LibraryGitHubItem) =>
      runExclusive(async () => {
        const items = await readJson<LibraryGitHubItem[]>(paths.github, []);
        items.push(item);
        await writeJsonAtomic(paths.github, items);
      }),

    appendIndexEntry: (entry: IndexEntry) =>
      runExclusive(async () => {
        const idx = await readJson<LibraryIndex>(paths.index, emptyIndex);
        idx.entries.push(entry);
        await writeJsonAtomic(paths.index, idx);
      }),

    hasIndexEntry: async (
      url: string,
      sessionId: string | null,
      turnId: string | null,
    ) => {
      const idx = await readJson<LibraryIndex>(paths.index, emptyIndex);
      return idx.entries.some(
        (e) => e.url === url && e.sessionId === sessionId && e.turnId === turnId,
      );
    },

    deleteById: (
      list: "bookmarks" | "reading" | "github",
      id: string,
    ) =>
      runExclusive(async () => {
        const p = paths[list];
        const items = await readJson<any[]>(p, []);
        await writeJsonAtomic(p, items.filter((i) => i.id !== id));
      }),

    paths,
  };
}

export type LibraryStore = ReturnType<typeof createLibraryStore>;
