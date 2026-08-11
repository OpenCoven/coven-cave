/**
 * search-document — the normalized document and result contracts every search
 * provider emits (cave-ychtl.2).
 *
 * One shape for every corpus is what lets the coordinator rank projects,
 * familiars, tasks, sessions and files against each other at all. Providers
 * normalize INTO this and stop there: they never return pre-ranked rows, never
 * decide presentation, and never leak storage detail a requester cannot see.
 *
 * Pure module: types, guards, and normalization only. The store that persists
 * these lives in ./search-index-store.ts.
 *
 * Spec: docs/superpowers/specs/2026-08-03-global-intelligent-search-design.md
 */

export type SearchPermission = {
  /** Permission dimension, e.g. "project" or "familiar". */
  kind: string;
  /** Identifier within that dimension the requester must hold. */
  id: string;
};

export type SearchAction = {
  /** Stable action id the surface maps to a handler. */
  id: string;
  label: string;
  /** In-app target. Never an absolute filesystem path. */
  href?: string;
};

export type SearchDocument = {
  /** Unique within the provider. `providerId + id` is the index identity. */
  id: string;
  providerId: string;
  entityType: string;
  title: string;
  body: string;
  excerpt: string;
  projectId: string | null;
  projectRoot: string | null;
  familiarId: string | null;
  roomId: string | null;
  sessionId: string | null;
  runtime: string | null;
  status: string | null;
  tags: string[];
  createdAt: string | null;
  updatedAt: string | null;
  sourceType: string;
  permissions: SearchPermission[];
  /**
   * Provider-owned fingerprint of the SOURCE for this document — an mtime, a
   * store revision, a content digest. Changing it is what marks the document
   * dirty; equal fingerprints let a refresh skip the row entirely.
   */
  sourceVersion: string;
  action: SearchAction;
  secondaryActions: SearchAction[];
};

/**
 * The index identity. Providers may reuse ids; the pair must be unique.
 *
 * The separator is an explicit NUL rather than a space because either half may
 * legitimately contain spaces, and `"a b" + "c"` must not collide with
 * `"a" + "b c"`. Every caller uses THIS function — building the key by hand
 * somewhere else is how the two spellings drift apart and a refresh starts
 * deleting the rows it just wrote.
 */
export const SEARCH_DOCUMENT_KEY_SEPARATOR = "\u0000";

export function searchDocumentKey(document: Pick<SearchDocument, "providerId" | "id">): string {
  return `${document.providerId}${SEARCH_DOCUMENT_KEY_SEPARATOR}${document.id}`;
}

/**
 * Recover just the index identity from a row that failed to normalize.
 *
 * A refresh needs to know that the source still PRODUCED an id even when the
 * row around it is unusable, so the deletion pass does not read a malformed
 * row as a withdrawn one and drop the last good copy of that document.
 */
export function rawDocumentIdentity(
  input: unknown,
): Pick<SearchDocument, "providerId" | "id"> | null {
  if (!isPlainObject(input)) return null;
  const id = stringOrNull(input.id);
  const providerId = stringOrNull(input.providerId);
  return id && providerId ? { providerId, id } : null;
}

export type SearchMatchReason =
  | "exact-title"
  | "phrase"
  | "title-prefix"
  | "title-token"
  | "fuzzy-title"
  | "text";

export type SearchResult = {
  document: SearchDocument;
  /** Why this matched, for tests and for explaining a row in the UI. */
  reasons: SearchMatchReason[];
  /** Raw FTS relevance. The coordinator normalizes across providers. */
  relevance: number;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

function normalizeAction(value: unknown, fallbackId: string): SearchAction {
  if (!isPlainObject(value)) return { id: fallbackId, label: "" };
  const href = stringOrNull(value.href);
  return {
    id: typeof value.id === "string" ? value.id : fallbackId,
    label: typeof value.label === "string" ? value.label : "",
    ...(href ? { href } : {}),
  };
}

/**
 * Coerce a provider's object into a well-formed document.
 *
 * Deliberately total rather than throwing: a provider emitting one malformed
 * row should cost that row its fidelity, not abort a whole refresh and leave
 * the index stale. Missing text becomes empty, not `undefined`, so FTS never
 * sees a null column.
 */
export function normalizeSearchDocument(input: unknown): SearchDocument | null {
  if (!isPlainObject(input)) return null;
  const id = stringOrNull(input.id);
  const providerId = stringOrNull(input.providerId);
  const entityType = stringOrNull(input.entityType);
  if (!id || !providerId || !entityType) return null;

  const tags = Array.isArray(input.tags)
    ? [...new Set(input.tags.filter((tag): tag is string => typeof tag === "string" && tag.length > 0))]
    : [];
  const permissions = Array.isArray(input.permissions)
    ? input.permissions.flatMap((entry) => {
        if (!isPlainObject(entry)) return [];
        const kind = stringOrNull(entry.kind);
        const permissionId = stringOrNull(entry.id);
        return kind && permissionId ? [{ kind, id: permissionId }] : [];
      })
    : [];
  const secondaryActions = Array.isArray(input.secondaryActions)
    ? input.secondaryActions.map((entry, index) => normalizeAction(entry, `${id}:secondary:${index}`))
    : [];

  return {
    id,
    providerId,
    entityType,
    title: typeof input.title === "string" ? input.title : "",
    body: typeof input.body === "string" ? input.body : "",
    excerpt: typeof input.excerpt === "string" ? input.excerpt : "",
    projectId: stringOrNull(input.projectId),
    projectRoot: stringOrNull(input.projectRoot),
    familiarId: stringOrNull(input.familiarId),
    roomId: stringOrNull(input.roomId),
    sessionId: stringOrNull(input.sessionId),
    runtime: stringOrNull(input.runtime),
    status: stringOrNull(input.status),
    tags,
    createdAt: stringOrNull(input.createdAt),
    updatedAt: stringOrNull(input.updatedAt),
    sourceType: typeof input.sourceType === "string" ? input.sourceType : providerId,
    permissions,
    sourceVersion: typeof input.sourceVersion === "string" ? input.sourceVersion : "",
    action: normalizeAction(input.action, `${id}:open`),
    secondaryActions,
  };
}
