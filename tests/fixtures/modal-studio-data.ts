import type { FileMemoryEntry } from "@/components/familiars-memory-utils";

export const studioFamiliarId = "fixture-review";
export const studioAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 320'%3E%3Crect width='320' height='320' fill='slateblue'/%3E%3Ctext x='100' y='220' font-size='180' fill='white'%3EF%3C/text%3E%3C/svg%3E";
export const studioMemoryEntries: FileMemoryEntry[] = Array.from({ length: 12 }, (_, index) => ({
  root: "/fixture/memory", rootLabel: "Synthetic familiar memory", rootPath: "/fixture/memory",
  relPath: `review-${index + 1}.md`, fullPath: `/fixture/memory/review-${index + 1}.md`,
  size: 2048 + index * 100, modified: "2026-10-24T09:00:00.000Z",
  sourceId: "fixture-coven", sourceKind: "coven-origin", sourceKindLabel: "Coven memory",
  familiarId: studioFamiliarId, origin: "coven",
}));

export const studioNoteText = "Synthetic dated note. Preserve authored dependencies and record the next action.\n\n".repeat(20);

export function modalStudioResponse(url: URL) {
  if (url.pathname === "/api/memory") return { ok: true, entries: studioMemoryEntries };
  if (url.pathname === `/api/familiars/${studioFamiliarId}/notes`) return url.searchParams.has("date")
    ? { ok: true, note: { notes: studioNoteText, reflection: "Synthetic reflection for layout review." }, modified: "2026-10-24T09:00:00.000Z" }
    : { ok: true, dates: Array.from({ length: 20 }, (_, index) => ({ date: `2026-10-${String(24 - index).padStart(2, "0")}`, preview: "Synthetic project review note", hasReflection: true, modified: "2026-10-24T09:00:00.000Z" })) };
  if (url.pathname === "/api/familiars") return { ok: true, familiars: [{ id: studioFamiliarId, display_name: "Review familiar", harness: "codex", avatarUrl: studioAvatar }] };
  if (url.pathname === "/api/queue/issues") return { ok: true, data: { id: "fixture-issue", title: "Review the project plan and preserve all authored dependencies", description: "Review each dependency and record the next action before execution.\n\n".repeat(30), status: "blocked", priority: 1, assignee: "Review familiar", labels: ["review", "human approval required", "preserve authored dependencies", "component migration"], dependencies: [{ id: "fixture-owner-decision" }], comment_count: 12, updated_at: "2026-10-24T09:00:00.000Z" } };
  if (url.pathname === "/api/vault") return { ok: true, mappings: Array.from({ length: 8 }, (_, index) => ({ key: `SYNTHETIC_REVIEW_SETTING_${index + 1}`, ref: null, storage: null, scope: index % 2 ? [studioFamiliarId] : "shared", description: "Synthetic mapping with no secret value. Review its familiar grant before use.", required: true, status: "no-ref", hasValue: false })) };
  return null;
}
