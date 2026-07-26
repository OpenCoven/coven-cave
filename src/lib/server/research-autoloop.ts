import { existsSync, watch, type FSWatcher } from "node:fs";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import {
  mergeAutoresearchRows,
  parseAutoresearchEvents,
  parseAutoresearchLedger,
  type AutoresearchRow,
  type AutoresearchSnapshot,
} from "../research-autoloop.ts";

const MAX_LEDGER_BYTES = 2 * 1024 * 1024;
const MAX_EVENT_BYTES = 2 * 1024 * 1024;
const MAX_INDEX_BYTES = 2 * 1024 * 1024;
export const MAX_AUTORESEARCH_DOCUMENT_BYTES = 4 * 1024 * 1024;

type AutoresearchPaths = {
  researchRoot: string;
  ledgerPath: string;
  eventPath: string;
  synthesisRoot: string;
  synthesisIndexPath: string;
  skillsRoot: string;
};

function autoresearchPaths(home: string): AutoresearchPaths {
  const researchRoot = path.join(home, ".coven", "research");
  return {
    researchRoot,
    ledgerPath: path.join(researchRoot, "autoresearch", "results.tsv"),
    eventPath: path.join(home, ".coven", "logs", "autoloop.jsonl"),
    synthesisRoot: path.join(researchRoot, "synthesis"),
    synthesisIndexPath: path.join(researchRoot, "synthesis", "INDEX.md"),
    skillsRoot: path.join(researchRoot, "skills"),
  };
}

async function readBoundedIfPresent(filePath: string, maxBytes: number): Promise<string | null> {
  try {
    const info = await stat(/* turbopackIgnore: true */ filePath);
    if (!info.isFile() || info.size > maxBytes) return null;
    return await readFile(/* turbopackIgnore: true */ filePath, "utf8");
  } catch {
    return null;
  }
}

function normalizedSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[`'"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Read the generated index only as a path lookup. It never creates rows. */
function synthesisIndexPaths(raw: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of raw.split(/\r?\n/)) {
    const match =
      /^\|[^|]*\|\s*\[[^\]]+\]\(\.\/([^)]+)\)\s*\|[^|]*\|\s*`+([^`]+)`+\s*\|/.exec(line);
    if (!match) continue;
    const key = normalizedSlug(match[2]);
    if (key && !result.has(key)) result.set(key, `synthesis/${match[1]}`);
  }
  return result;
}

function summarySynthesisPath(summary: string): string | null {
  const match = /(?:~\/\.coven\/)?research\/(synthesis\/[^\s)]+\.md)\b/.exec(summary);
  return match?.[1] ?? null;
}

function isWithinRoot(target: string, root: string): boolean {
  return target === root || target.startsWith(root + path.sep);
}

function candidateAbsolutePath(candidate: string, paths: AutoresearchPaths): string {
  const trimmed = candidate.trim();
  if (path.isAbsolute(trimmed)) return path.resolve(trimmed);
  if (trimmed.startsWith("~/.coven/research/")) {
    return path.resolve(paths.researchRoot, trimmed.slice("~/.coven/research/".length));
  }
  if (trimmed.startsWith("research/")) {
    return path.resolve(paths.researchRoot, trimmed.slice("research/".length));
  }
  return path.resolve(paths.researchRoot, trimmed);
}

async function resolveAllowedDocument(
  candidate: string | null,
  allowedRoot: string,
  paths: AutoresearchPaths,
): Promise<string | null> {
  if (!candidate) return null;
  try {
    const [realRoot, realTarget] = await Promise.all([
      realpath(/* turbopackIgnore: true */ allowedRoot),
      realpath(/* turbopackIgnore: true */ candidateAbsolutePath(candidate, paths)),
    ]);
    if (!isWithinRoot(realTarget, realRoot)) return null;
    const info = await lstat(/* turbopackIgnore: true */ realTarget);
    if (!info.isFile() || info.size > MAX_AUTORESEARCH_DOCUMENT_BYTES) return null;
    return realTarget;
  } catch {
    return null;
  }
}

export async function loadAutoresearchSnapshot(
  home = homedir(),
): Promise<AutoresearchSnapshot> {
  const paths = autoresearchPaths(home);
  const [ledgerRaw, eventRaw, indexRaw] = await Promise.all([
    readBoundedIfPresent(paths.ledgerPath, MAX_LEDGER_BYTES),
    readBoundedIfPresent(paths.eventPath, MAX_EVENT_BYTES),
    readBoundedIfPresent(paths.synthesisIndexPath, MAX_INDEX_BYTES),
  ]);
  if (ledgerRaw === null) {
    return {
      type: "snapshot",
      rows: [],
      available: false,
      updatedAt: new Date().toISOString(),
    };
  }

  const ledger = parseAutoresearchLedger(ledgerRaw);
  const enriched = mergeAutoresearchRows(
    ledger,
    eventRaw === null ? [] : parseAutoresearchEvents(eventRaw),
  );
  const indexedPaths = synthesisIndexPaths(indexRaw ?? "");
  const rows: AutoresearchRow[] = await Promise.all(enriched.map(async (row) => {
    const legacySlug = normalizedSlug(row.slug.split(":", 1)[0] ?? row.slug);
    const synthesisCandidate =
      row.synthesisPath ??
      summarySynthesisPath(row.summary) ??
      indexedPaths.get(legacySlug) ??
      null;
    return {
      ...row,
      synthesisPath: await resolveAllowedDocument(
        synthesisCandidate,
        paths.synthesisRoot,
        paths,
      ),
      stagedSkillPath: await resolveAllowedDocument(
        row.stagedSkillPath,
        paths.skillsRoot,
        paths,
      ),
    };
  }));

  return {
    type: "snapshot",
    rows,
    available: true,
    updatedAt: new Date().toISOString(),
  };
}

export async function readAutoresearchDocument(
  requestedPath: string,
  home = homedir(),
): Promise<string> {
  const paths = autoresearchPaths(home);
  const synthesis = await resolveAllowedDocument(
    requestedPath,
    paths.synthesisRoot,
    paths,
  );
  const skill = synthesis
    ? null
    : await resolveAllowedDocument(requestedPath, paths.skillsRoot, paths);
  const resolved = synthesis ?? skill;
  if (!resolved) throw new Error("document path is not allowed");
  const content = await readBoundedIfPresent(resolved, MAX_AUTORESEARCH_DOCUMENT_BYTES);
  if (content === null) throw new Error("document could not be read");
  return content;
}

/**
 * Subscribe to the three source locations. `fs.watch` supplies invalidation;
 * the callback re-reads an authoritative snapshot. No interval or mtime poll
 * exists, and every watcher is closed when the last stream disconnects.
 */
export function watchAutoresearchSources(
  onChange: () => void,
  home = homedir(),
): () => void {
  const paths = autoresearchPaths(home);
  const watchers: FSWatcher[] = [];
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(onChange, 40);
  };
  const specs = [
    { dir: path.dirname(paths.ledgerPath), names: new Set([path.basename(paths.ledgerPath)]) },
    { dir: path.dirname(paths.eventPath), names: new Set([path.basename(paths.eventPath)]) },
    {
      dir: path.dirname(paths.synthesisIndexPath),
      names: new Set([path.basename(paths.synthesisIndexPath)]),
    },
  ];
  for (const spec of specs) {
    if (!existsSync(spec.dir)) continue;
    try {
      watchers.push(watch(
        /* turbopackIgnore: true */ spec.dir,
        { persistent: false },
        (_event, filename) => {
          if (filename && !spec.names.has(filename.toString())) return;
          schedule();
        },
      ));
    } catch {
      // A missing/unwatchable optional directory degrades to the initial
      // snapshot; EventSource reconnection retries when Cave remounts.
    }
  }
  return () => {
    if (debounce) clearTimeout(debounce);
    for (const watcher of watchers) watcher.close();
  };
}
