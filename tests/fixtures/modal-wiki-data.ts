import type { CovenWikiManifest, CovenWikiPage } from "@/lib/covenwiki-render";

export const modalWikiManifest: CovenWikiManifest = {
  schemaVersion: "1", slug: "fixture-review", title: "Project review wiki",
  source: { kind: "local", repoRoot: "/fixture/project", revision: "fixture-only" },
  generation: { generatedAt: "2026-10-24T09:00:00.000Z", backend: "fixture", status: "complete" },
  navigation: [], pages: [{ slug: "review", title: "Project review", path: "review.md", meta: "review.meta.json", priority: "required" }],
  counts: { pages: 1 },
};
const page: CovenWikiPage = {
  markdown: "# Project review\n\nPreserve authored decisions and record the next action.\n",
  meta: { citations: [{ path: "docs/review.md", startLine: 4, endLine: 8 }], coverageNotes: ["Synthetic local source for browser layout review."], relatedPages: [] },
};

export function modalWikiResponse(path: string) {
  if (path === "/api/wikis/fixture-review/page/review") return { ok: true, page };
  if (path === "/api/project-file") return { ok: true, kind: "text", content: "# Source review notes\n\n" + "Synthetic source evidence.\n\n".repeat(24), size: 1024, version: "fixture-only", utf8: true };
  return null;
}
