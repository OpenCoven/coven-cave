import { parseMdDocument, serializeMdDocument, splitLeadingMdComments, type MdDocument } from "../lib/md-frontmatter.ts";
import type { KnowledgeCollectionMeta } from "../lib/knowledge-pack-types.ts";

export type GrimoireKnowledgeEntry = {
  id: string;
  collection?: string;
  title: string;
  tags: string[];
  scope: "global" | string[];
  enabled: boolean;
  body: string;
  extra?: Record<string, unknown>;
  /** File mtime (ISO) from the list API — powers the launcher recency pool. */
  modified?: string;
};

export type KnowledgeCollectionSummary = {
  id: string;
  meta: KnowledgeCollectionMeta | null;
  count: number;
};

export type KnowledgePayload = {
  id?: string;
  collection?: string;
  title: string;
  tags: string[];
  scope?: unknown;
  enabled: boolean;
  body: string;
  extra?: Record<string, unknown>;
};

/** A vault entry as one raw markdown doc: unknown entity frontmatter first,
 * then reserved editor-owned keys so stored schema data can't shadow them. */
export function knowledgeEntryToRaw(entry: GrimoireKnowledgeEntry): string {
  const doc: MdDocument = {
    hasFrontmatter: true,
    title: entry.title,
    tags: entry.tags,
    rest: {
      ...(entry.extra ?? {}),
      scope: entry.scope === "global" ? "global" : entry.scope.join(", "),
      enabled: entry.enabled,
    },
    body: entry.body,
  };
  return serializeMdDocument(doc);
}

export function rawToKnowledgePayload(id: string | null, raw: string, collection?: string): KnowledgePayload {
  const doc = parseMdDocument(raw);
  const { scope, enabled, ...extra } = doc.rest;
  const payload: KnowledgePayload = {
    ...(id ? { id } : {}),
    ...(collection ? { collection } : {}),
    title: doc.title ?? "",
    tags: doc.tags,
    scope: scope ?? "global",
    enabled: enabled !== false,
    body: doc.body.trim(),
  };
  // Always send extra — omitting it means "client is extra-unaware" to the
  // route, which then resurrects stored keys; an explicit `{}` clears them, so
  // deleting the last entity field in the raw editor actually sticks.
  payload.extra = extra;
  return payload;
}

export function knowledgeDocKey(id: string, collection?: string): string {
  return collection ? `${collection}/${id}` : id;
}

export function sameKnowledgeDoc(
  entry: { id: string; collection?: string | null },
  ref: { id: string; collection?: string | null },
): boolean {
  return entry.id === ref.id && (entry.collection ?? undefined) === (ref.collection ?? undefined);
}

export function groupKnowledgeByCollection(
  entries: readonly GrimoireKnowledgeEntry[],
  collections: readonly KnowledgeCollectionSummary[],
): {
  root: GrimoireKnowledgeEntry[];
  collections: Array<KnowledgeCollectionSummary & { label: string; storyQuestion?: string; entries: GrimoireKnowledgeEntry[] }>;
} {
  const root: GrimoireKnowledgeEntry[] = [];
  const byCollection = new Map<string, GrimoireKnowledgeEntry[]>();
  for (const entry of entries) {
    if (!entry.collection) {
      root.push(entry);
      continue;
    }
    const group = byCollection.get(entry.collection) ?? [];
    group.push(entry);
    byCollection.set(entry.collection, group);
  }

  const metaById = new Map(collections.map((c) => [c.id, c]));
  const ids = [
    ...collections.map((c) => c.id).filter((id) => byCollection.has(id)),
    ...[...byCollection.keys()].filter((id) => !metaById.has(id)).sort((a, b) => a.localeCompare(b)),
  ];
  return {
    root,
    collections: ids.map((id) => {
      const collection = metaById.get(id) ?? { id, meta: null, count: byCollection.get(id)?.length ?? 0 };
      // Meta values come from hand-edited YAML; tolerate non-string types.
      const name = collection.meta?.name;
      const storyQuestion = collection.meta?.storyQuestion;
      return {
        ...collection,
        label: (typeof name === "string" && name.trim()) || id,
        storyQuestion: (typeof storyQuestion === "string" && storyQuestion.trim()) || undefined,
        entries: byCollection.get(id) ?? [],
      };
    }),
  };
}

export type ResearchStitchGroup = {
  kind: "entry" | "research";
  key: string;
  label: string;
  missionId?: string;
  entries: GrimoireKnowledgeEntry[];
};

function researchTopicTitle(value: string): string {
  const title = value.trim().split(/\r?\n/)[0]
    .replace(/\*\*/g, "")
    .replace(/^(?:#{1,6}\s*|(?:Research and compare|(?:Deep )?Research Prompt|Report topic):\s*)+/i, "")
    .trim();
  return /^(?:findings|research log|source ledger|(?:primary )?(?:report|brief)|research prompt)$/i.test(title)
    ? ""
    : title;
}

/** Group before filtering so a document-only search keeps its topic context.
 * Mission identity, never title similarity, determines membership. */
export function groupResearchStitches(
  entries: readonly GrimoireKnowledgeEntry[],
  query = "",
): ResearchStitchGroup[] {
  const groups: ResearchStitchGroup[] = [];
  const byMission = new Map<string, ResearchStitchGroup>();
  for (const entry of entries) {
    const missionId = entry.tags.includes("research")
      ? entry.tags.find((tag) => tag.startsWith("mission:") && tag.slice(8).trim())?.slice(8).trim()
      : undefined;
    if (!missionId) {
      groups.push({ kind: "entry", key: knowledgeDocKey(entry.id, entry.collection), label: entry.title, entries: [entry] });
      continue;
    }
    const key = `research:${JSON.stringify([entry.collection ?? "", missionId])}`;
    let group = byMission.get(key);
    if (!group) {
      group = { kind: "research", key, missionId, label: "", entries: [] };
      byMission.set(key, group);
      groups.push(group);
    }
    group.entries.push(entry);
  }

  const q = query.trim().toLowerCase();
  return groups.flatMap((group) => {
    if (group.kind === "research") {
      group.label = group.entries.map((entry) => researchTopicTitle(entry.title)).find(Boolean)
        || group.entries.map((entry) => {
          const { visibleBody } = splitLeadingMdComments(entry.body);
          const heading = visibleBody.trimStart().match(/^#\s+([^\r\n]+)/)?.[1];
          return heading ? researchTopicTitle(heading) : "";
        }).find(Boolean)
        || `Research run ${group.missionId}`;
    }
    const topicMatches = !q || group.label.toLowerCase().includes(q);
    const visible = topicMatches ? group.entries : group.entries.filter((entry) =>
      [entry.title, entry.id, entry.collection, entry.tags.join(" ")]
        .some((field) => field?.toLowerCase().includes(q)),
    );
    return visible.length ? [{ ...group, entries: visible }] : [];
  });
}

export function buildStubPayload(
  display: string,
  collection: KnowledgeCollectionSummary | null,
  sourceTitle: string,
): KnowledgePayload {
  const payload: KnowledgePayload = {
    title: display,
    ...(collection ? { collection: collection.id } : {}),
    enabled: false,
    tags: [],
    body: `Stubbed from [[${sourceTitle}]].`,
  };
  if (collection?.meta) {
    const extra: Record<string, unknown> = {};
    for (const field of collection.meta.fields ?? []) {
      if (field.key) extra[field.key] = "";
    }
    if (collection.meta.entityType) extra.type = collection.meta.entityType;
    if (Object.keys(extra).length > 0) payload.extra = extra;
  }
  return payload;
}
