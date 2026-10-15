/**
 * Publishes `familiars` to the event plane when a roster source changes (#5843).
 *
 * The visible roster combines Cave's `config.json`, the removed-familiar
 * tombstones, and Coven's `familiars.toml`, and several writers touch them:
 * Cave routes, the daemon and the Coven CLI. Watching the three files catches
 * every writer at once. Changes are coalesced over 100 ms into one topic-wide
 * invalidation, because a file change can't prove which familiar changed.
 * A `config.json` write for a session also fires this; an extra invalidation
 * only means "may be stale" and costs one refetch.
 */

import { watch } from "node:fs";
import path from "node:path";
import { caveHome, covenHome } from "../coven-paths.ts";
import { markResourceChanged } from "./cave-event-plane-publisher.ts";

export const FAMILIAR_WATCH_COALESCE_MS = 100;

/** The roster's source files. */
export function familiarRosterSourceFiles(): string[] {
  return [
    path.join(caveHome(), "config.json"),
    path.join(caveHome(), "removed-familiars.json"),
    path.join(covenHome(), "familiars.toml"),
  ];
}

export type FamiliarRosterWatchOptions = {
  files: readonly string[];
  /** Watch one directory; returns a closer, or null when it can't be watched. */
  watchDirectory(dir: string, onChange: (filename: string | null) => void): (() => void) | null;
  publish(): void;
  coalesceMs?: number;
  setTimeout?: (callback: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
};

export type FamiliarRosterWatch = { stop(): void; watchedDirectories(): string[] };

export function createFamiliarRosterWatch(options: FamiliarRosterWatchOptions): FamiliarRosterWatch {
  const coalesceMs = options.coalesceMs ?? FAMILIAR_WATCH_COALESCE_MS;
  const schedule = options.setTimeout ?? ((callback, ms) => {
    const handle = setTimeout(callback, ms);
    handle.unref?.();
    return handle;
  });
  const cancel = options.clearTimeout ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
  let pending: unknown = null;

  const changed = () => {
    if (pending !== null) return;
    pending = schedule(() => {
      pending = null;
      options.publish();
    }, coalesceMs);
  };

  const byDirectory = new Map<string, Set<string>>();
  for (const file of options.files) {
    const dir = path.dirname(file);
    if (!byDirectory.has(dir)) byDirectory.set(dir, new Set());
    byDirectory.get(dir)!.add(path.basename(file));
  }

  const closers: (() => void)[] = [];
  const watched: string[] = [];
  for (const [dir, names] of byDirectory) {
    const close = options.watchDirectory(dir, (filename) => {
      // An atomic write renames a temp file onto the target, so the target's
      // name arrives. A platform that omits the name counts as a change.
      if (filename === null || names.has(path.basename(filename))) changed();
    });
    if (close) {
      closers.push(close);
      watched.push(dir);
    }
  }

  return {
    stop() {
      if (pending !== null) cancel(pending);
      pending = null;
      for (const close of closers.splice(0)) close();
    },
    watchedDirectories: () => [...watched],
  };
}

/** Watch one directory with `fs.watch`; null when it can't be watched. Shared
 *  with the board watch (#5858). */
export function watchDirectoryWithFs(dir: string, onChange: (filename: string | null) => void): (() => void) | null {
  try {
    const watcher = watch(dir, { persistent: false }, (_event, filename) => onChange(filename ? String(filename) : null));
    watcher.on("error", () => watcher.close());
    return () => watcher.close();
  } catch {
    // A directory that doesn't exist yet can't be watched. Polling still
    // covers the topic, so this is a missed optimization, not an error.
    return null;
  }
}

/** The production watch: real files, `fs.watch`, and the event-plane bridge. */
export function startFamiliarRosterWatch(): FamiliarRosterWatch {
  return createFamiliarRosterWatch({
    files: familiarRosterSourceFiles(),
    watchDirectory: watchDirectoryWithFs,
    publish: () => {
      markResourceChanged("familiars");
    },
  });
}
