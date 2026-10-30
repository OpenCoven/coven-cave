import type { SessionRow } from "@/lib/types";
import type { ChangedFile } from "@/lib/session-changes-api";
import type { TreeEntry } from "@/components/project-tree";
import type { SkillStageUpdate } from "@/lib/skill-blocks";

export const shellRoot = "/fixture/project";
export const shellSessions: SessionRow[] = Array.from({ length: 12 }, (_, index) => ({
  id: `fixture-thread-${index + 1}`, project_root: shellRoot, harness: "codex", familiarId: "fixture-review",
  title: `Review project dependencies and preserve authored decisions ${index + 1}`, status: "idle", exit_code: 0, archived_at: null,
  created_at: "2026-10-24T09:00:00.000Z", updated_at: "2026-10-24T09:00:00.000Z", origin: "chat", attention: { state: "none", since: null, reason: null },
}));
export const shellSkills: SkillStageUpdate[] = Array.from({ length: 8 }, (_, index) => ({
  name: `Project review ${index + 1}`, stage: index % 3 ? "done" : "error",
  note: "Synthetic execution detail: preserve authored decisions and record unresolved dependencies.\n\n".repeat(12),
}));
const files: ChangedFile[] = Array.from({ length: 12 }, (_, index) => ({ path: `docs/review-${index + 1}.md`, status: "modified", insertions: 12, deletions: 4, changeVersion: `fixture-${index}` }));
const entries: TreeEntry[] = Array.from({ length: 12 }, (_, index) => ({ name: `review-${index + 1}.md`, path: `${shellRoot}/review-${index + 1}.md`, isDir: false }));
export const shellMigrationStatus = {
  pending: [], conflicts: ["review-state-1.json"], migrated: false, backupRoot: "/fixture/recovery", journalPath: "/fixture/recovery/journal.json",
  details: Array.from({ length: 6 }, (_, index) => ({
    legacy: `review-state-${index + 1}.json`, next: `review-state-${index + 1}.json`, strategy: "state", state: "unresolved",
    legacyPath: `/fixture/legacy/review-state-${index + 1}.json`, canonicalPath: `/fixture/canonical/review-state-${index + 1}.json`,
    summary: "Both synthetic copies are preserved. Review their differences before choosing a migration action.",
    differences: ["The canonical copy contains the newer owner decision.", "The legacy copy contains additional unresolved dependencies."],
    legacySize: 8192, canonicalSize: 4096, legacyMtimeMs: 1792832400000, canonicalMtimeMs: 1792836000000,
    backupPath: `/fixture/recovery/review-state-${index + 1}/verified-bundle.json`, actions: ["keep-canonical", "recover-legacy", "defer"],
  })),
};

export function modalShellResponse(url: URL) {
  if (url.pathname === "/api/projects") return { ok: true, projects: [{ id: "fixture-project", name: "Project review", root: shellRoot, access: "write" }] };
  if (url.pathname === "/api/familiars") return { ok: true, familiars: [{ id: "fixture-review", display_name: "Review familiar", harness: "codex", status: "active" }] };
  if (url.pathname === "/api/project-tree") return { ok: true, entries };
  if (url.pathname === "/api/project-file") return { ok: true, kind: "text", content: "# Project review\n\nSynthetic source evidence.\n", size: 64, version: "fixture-only", utf8: true };
  if (url.pathname === "/api/cave-home-migration") return { ok: true, status: shellMigrationStatus };
  if (url.pathname === "/api/changes") {
    if (url.searchParams.has("checkpoints")) return { ok: true, checkpoints: [] };
    if (url.searchParams.has("branches")) return { ok: true, branches: [{ name: "fixture-review" }] };
    if (url.searchParams.has("path")) return { ok: true, diff: "--- a/docs/review.md\n+++ b/docs/review.md\n@@ -1 +1 @@\n-Prior notes\n+Preserve authored decisions.\n" };
    return { ok: true, repo: true, repoRoot: shellRoot, branch: "fixture-review", head: "fixture-only", githubOrigin: false, files, totalFiles: files.length, totals: { insertions: 144, deletions: 48 } };
  }
  return null;
}
