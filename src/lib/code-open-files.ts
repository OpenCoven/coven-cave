/**
 * Open-file tabs for the Coding Desk viewer (#5705).
 *
 * The viewer used to show one file and forget the last: picking a second file
 * from the tree replaced the first with no way back but the tree. This is the
 * tab model behind the strip above the viewer. It is a plain ordered list plus
 * an active path so every transition (open, close, cycle) is a pure function
 * the tests can pin without a DOM.
 *
 * Paths are absolute, as the workbench resolves them. The strip is bounded so
 * a long reading session cannot grow it into a second file tree: past the
 * limit the oldest inactive tab is evicted.
 */

export const CODE_OPEN_FILES_LIMIT = 12;

export type CodeOpenFiles = {
  paths: string[];
  active: string | null;
};

export function emptyCodeOpenFiles(): CodeOpenFiles {
  return { paths: [], active: null };
}

/**
 * Do two paths name one file (#5795)? Compared in one Unicode form: the disk
 * stores a name decomposed on macOS and git reports it precomposed, so the
 * tree and the change list spelled one file two ways, and it opened twice.
 * The spelling itself is kept for reading and writing, since a Linux disk
 * holds exactly the bytes it was given.
 */
export function sameCodePath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return false;
  return a === b || a.normalize("NFC") === b.normalize("NFC");
}

/** Open `path` (or re-activate it) — appends new tabs, keeps existing order.
 *  A tab already open under another spelling of the path is the one used. */
export function openCodeFile(
  state: CodeOpenFiles,
  path: string,
  limit = CODE_OPEN_FILES_LIMIT,
): CodeOpenFiles {
  if (!path) return state;
  const open = state.paths.find((candidate) => sameCodePath(candidate, path));
  if (open) {
    return state.active === open ? state : { paths: state.paths, active: open };
  }
  let paths = [...state.paths, path];
  while (paths.length > Math.max(1, limit)) {
    const victim = paths.find((candidate) => candidate !== path && candidate !== state.active);
    if (!victim) break;
    paths = paths.filter((candidate) => candidate !== victim);
  }
  return { paths, active: path };
}

/**
 * A tab for every unsaved draft under `root` (#5756), so edits recovered
 * after a reload or a restart of the desktop app show their unsaved marker
 * instead of waiting, unseen, in the draft store. Keeps the active tab; with
 * none, the first recovered draft becomes active. The tab limit doesn't
 * apply here (#5760 review): it would close earlier recovered drafts' tabs
 * to make room for later ones, hiding the very edits this surfaces.
 */
export function withDraftTabs(
  state: CodeOpenFiles,
  dirtyPaths: Iterable<string>,
  root: string | null | undefined,
): CodeOpenFiles {
  if (!root) return state;
  const prefix = root.endsWith("/") ? root : `${root}/`;
  let next = state;
  for (const path of dirtyPaths) {
    if (!path.normalize("NFC").startsWith(prefix.normalize("NFC")) || next.paths.some((open) => sameCodePath(open, path))) continue;
    const active = next.active;
    next = openCodeFile(next, path, Number.POSITIVE_INFINITY);
    if (active) next = { ...next, active };
  }
  return next;
}

/**
 * Close `path`. Closing the active tab activates its left neighbour, or the
 * right one when it was first — the file you were reading before, not the
 * newest arrival.
 */
export function closeCodeFile(state: CodeOpenFiles, path: string): CodeOpenFiles {
  const index = state.paths.indexOf(path);
  if (index < 0) return state;
  const paths = state.paths.filter((candidate) => candidate !== path);
  if (state.active !== path) return { paths, active: state.active };
  const next = paths[index - 1] ?? paths[index] ?? null;
  return { paths, active: next };
}

/** Move the active tab by `direction`, wrapping at either end. */
export function cycleCodeFile(state: CodeOpenFiles, direction: 1 | -1): CodeOpenFiles {
  if (state.paths.length < 2) return state;
  const current = state.active ? state.paths.indexOf(state.active) : -1;
  const start = current < 0 ? (direction === 1 ? -1 : state.paths.length) : current;
  const next = (start + direction + state.paths.length) % state.paths.length;
  return { paths: state.paths, active: state.paths[next] ?? state.active };
}

function baseName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || trimmed;
}

/**
 * Tab labels: the file name, with just enough parent directory added to tell
 * two same-named files apart (`index.ts` twice becomes `api/index.ts` and
 * `ui/index.ts`).
 */
export function codeOpenFileLabels(paths: readonly string[]): Map<string, string> {
  const labels = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const path of paths) {
    const name = baseName(path);
    byName.set(name, [...(byName.get(name) ?? []), path]);
  }
  for (const [name, group] of byName) {
    if (group.length === 1) {
      labels.set(group[0], name);
      continue;
    }
    let depth = 1;
    // Grow the shared suffix until every label in the group is distinct, or
    // we have used the whole path.
    for (;;) {
      const candidates = group.map((path) => {
        const parts = path.split("/").filter(Boolean);
        return parts.slice(Math.max(0, parts.length - 1 - depth)).join("/");
      });
      const distinct = new Set(candidates).size === candidates.length;
      const exhausted = group.every((path) => path.split("/").filter(Boolean).length <= depth + 1);
      if (distinct || exhausted) {
        group.forEach((path, index) => labels.set(path, candidates[index]));
        break;
      }
      depth += 1;
    }
  }
  return labels;
}
