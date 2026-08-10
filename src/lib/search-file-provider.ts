/**
 * search-file-provider — current-project file bodies as a LIVE search provider
 * (cave-ychtl.3).
 *
 * This is the security-sensitive provider, and its design rule is that it adds
 * no new access path. Every guard the existing project-search route relies on
 * is reused here rather than reimplemented:
 *
 *   - the root must resolve through `resolveAllowedProjectPath`, or be a root
 *     the daemon already holds a live session for;
 *   - ripgrep is spawned through `execFile` with an ARGUMENT ARRAY — never a
 *     shell — so a query can never be interpreted as a command;
 *   - the query is passed after `--`, so it can never be read as a flag;
 *   - `.env*` stays excluded by glob at both depths;
 *   - ripgrep's own `.gitignore`/hidden/binary defaults keep results on the
 *     same git-visible surface as the rest of the product.
 *
 * A second implementation of any of those is a second thing to get wrong, and
 * the reason the file corpus is LIVE rather than indexed is the same instinct:
 * indexing repository bodies would copy content out of the place whose
 * permissions govern it.
 *
 * Spec: docs/superpowers/specs/2026-08-03-global-intelligent-search-design.md
 */

import { execFile } from "node:child_process";
import path from "node:path";
import { parseRipgrepJson } from "./project-search.ts";
import { resolveAllowedProjectPath } from "./server/project-paths.ts";
import { normalizeSearchDocument, type SearchDocument } from "./search-document.ts";
import {
  permitsByProject,
  type SearchProvider,
  type SearchProviderDiagnostic,
  type SearchProviderQuery,
  type SearchRequesterContext,
} from "./search-provider.ts";

export const FILE_PROVIDER_ID = "files";

/** Mirrors the route's caps so neither side can drift into being the loose one. */
const RG_TIMEOUT_MS = 15_000;
const MAX_RG_BUFFER = 16 * 1024 * 1024;
const MAX_QUERY_LEN = 1024;
const RG_MAX_COUNT = 50;

export type FileProviderOptions = {
  /** Resolves the active project root; null when no project scope is active. */
  activeProjectRoot: () => string | null;
  /** Project id for the active root, used for permissions and result scope. */
  activeProjectId: () => string | null;
  /** Roots the daemon holds a live session for — the route's second allowance. */
  sessionRoots?: () => string[];
  /** Injectable for tests. Defaults to a real ripgrep spawn. */
  runSearch?: (cwd: string, args: string[]) => Promise<{ stdout: string; code: number }>;
};

function runRipgrep(cwd: string, args: string[]): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve, reject) => {
    execFile(
      "rg",
      args,
      { windowsHide: true, cwd, timeout: RG_TIMEOUT_MS, maxBuffer: MAX_RG_BUFFER },
      (error, stdout) => {
        if (!error) return resolve({ stdout, code: 0 });
        // Exit 1 is "no matches", which is a successful search.
        if ((error as { code?: number }).code === 1) return resolve({ stdout: stdout ?? "", code: 1 });
        reject(error);
      },
    );
  });
}

/**
 * Build ripgrep's arguments.
 *
 * The query goes last, after `--`, and is never interpolated anywhere. Keep it
 * that way: this array is the only reason a query containing `-e` or `--type`
 * is data rather than instruction.
 */
export function buildFileSearchArgs(query: string): string[] {
  return [
    "--json",
    "--max-count",
    String(RG_MAX_COUNT),
    "--max-columns",
    "2000",
    "--no-messages",
    "--fixed-strings",
    "--smart-case",
    "--glob",
    "!.env*",
    "--glob",
    "!**/.env*",
    "--",
    query,
    ".",
  ];
}

/**
 * Whether `root` is a root this provider may search.
 *
 * Exported so the contract is testable directly: the allowance is the static
 * project allow-list OR a root the daemon already booted a session in, and
 * nothing else.
 */
export function resolveSearchableRoot(
  root: string,
  sessionRoots: string[],
): string | null {
  const allowed = resolveAllowedProjectPath(root);
  if (allowed) return allowed;
  const normalized = path.resolve(root);
  return sessionRoots.some((candidate) => path.resolve(candidate) === normalized)
    ? normalized
    : null;
}

export function createFileSearchProvider(options: FileProviderOptions): SearchProvider {
  const run = options.runSearch ?? runRipgrep;

  return {
    id: FILE_PROVIDER_ID,
    kind: "live",
    entityTypes: ["file"],
    // No status, runtime, room or tag on a file. Declaring them would make the
    // provider selectable for queries it cannot honor, which is exactly the
    // silent widening the spec forbids.
    supportedFilters: ["type", "project", "has"],

    async fingerprint() {
      // A live provider is never indexed, so its fingerprint only has to be
      // stable. Returning a changing value would invite a caller to try to
      // index it.
      return `${FILE_PROVIDER_ID}:live`;
    },

    permits(document, context) {
      return permitsByProject(document, context);
    },

    async query(
      query: SearchProviderQuery,
      context: SearchRequesterContext,
    ): Promise<{ documents: SearchDocument[]; diagnostics: SearchProviderDiagnostic[] }> {
      const diagnostics: SearchProviderDiagnostic[] = [];
      const term = [query.text, ...query.phrases].join(" ").trim();
      if (term.length === 0) return { documents: [], diagnostics };
      if (term.length > MAX_QUERY_LEN) {
        return {
          documents: [],
          diagnostics: [
            { providerId: FILE_PROVIDER_ID, code: "malformed-source", message: "query too long" },
          ],
        };
      }

      const requestedRoot = options.activeProjectRoot();
      if (!requestedRoot) {
        // No project scope means nothing to search. This is not an error and
        // must not read as one — a file result simply cannot exist yet.
        return { documents: [], diagnostics };
      }

      const root = resolveSearchableRoot(requestedRoot, options.sessionRoots?.() ?? []);
      if (!root) {
        // Refused, and the diagnostic deliberately names no path — a denial
        // must not disclose the location it denied.
        return {
          documents: [],
          diagnostics: [
            {
              providerId: FILE_PROVIDER_ID,
              code: "permission-denied",
              message: "project root is not searchable",
            },
          ],
        };
      }

      const projectId = options.activeProjectId();
      if (
        context.allowedProjectIds !== null &&
        projectId !== null &&
        !context.allowedProjectIds.includes(projectId)
      ) {
        return {
          documents: [],
          diagnostics: [
            {
              providerId: FILE_PROVIDER_ID,
              code: "permission-denied",
              message: "project is not readable by this requester",
            },
          ],
        };
      }

      let stdout: string;
      try {
        ({ stdout } = await run(root, buildFileSearchArgs(term)));
      } catch (error) {
        return {
          documents: [],
          diagnostics: [
            {
              providerId: FILE_PROVIDER_ID,
              code: "unavailable",
              // Category only. The underlying error can carry a path.
              message: error instanceof Error && /ENOENT/.test(error.message)
                ? "ripgrep is not installed"
                : "file search failed",
            },
          ],
        };
      }

      const parsed = parseRipgrepJson(stdout, { maxMatches: query.limit });
      const documents: SearchDocument[] = [];
      for (const group of parsed.files) {
        const relativePath = group.path;
        const firstMatch = group.matches[0];
        const document = normalizeSearchDocument({
          // Relative path only: `providerId + id` must not embed an absolute
          // filesystem location, since the id travels into result payloads.
          id: relativePath,
          providerId: FILE_PROVIDER_ID,
          entityType: "file",
          title: path.basename(relativePath),
          body: group.matches.map((match) => match.preview).join("\n"),
          excerpt: firstMatch?.preview?.trim() ?? "",
          projectId,
          // projectRoot stays null: the coordinator permission-checks on
          // projectId, and emitting the absolute root would put it in a payload
          // the requester may not be entitled to see.
          projectRoot: null,
          familiarId: null,
          roomId: null,
          sessionId: null,
          runtime: null,
          status: null,
          tags: [],
          createdAt: null,
          updatedAt: null,
          sourceType: "file",
          permissions: projectId ? [{ kind: "project", id: projectId }] : [],
          // Live results are never indexed, so the version only needs to
          // distinguish this answer from another for the same path.
          sourceVersion: `${group.matches.length}:${firstMatch?.line ?? 0}`,
          action: {
            id: "open-file",
            label: `Open ${path.basename(relativePath)}`,
            href: `/projects/files?path=${encodeURIComponent(relativePath)}`,
          },
          secondaryActions: [],
        });
        if (document) documents.push(document);
      }

      if (parsed.truncated) {
        diagnostics.push({
          providerId: FILE_PROVIDER_ID,
          code: "malformed-source",
          message: "file results were truncated",
        });
      }

      return {
        documents: documents.filter((document) => permitsByProject(document, context)),
        diagnostics,
      };
    },
  };
}
