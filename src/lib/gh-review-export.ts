// Client helpers that turn a GitHub PR review into a saved Canvas HTML artifact.
//
// Two flows share the same artifact plumbing:
//   • Export — assemble the PR's own review (detail + comments + inline threads)
//     into an HTML document.
//   • Familiar review — ask a familiar to write a review (Markdown), then wrap it
//     into the same HTML document.
//
// The HTML construction (gh-review-html) and the artifact shaping below are pure
// + deterministic (ids/timestamps injected), so they unit-test directly. Only
// saveCanvasArtifact touches the network.

import type { CanvasArtifact } from "@/lib/canvas-artifacts";
import { buildReviewHtml, type ReviewHtmlInput, type ReviewThread } from "@/lib/gh-review-html";

/** Short, stable artifact title: `coven-cave #42 review`. */
export function reviewArtifactTitle(repo: string, number?: number | null): string {
  const short = repo.split("/").pop() || repo;
  const base = number != null ? `${short} #${number} review` : `${short} review`;
  return base.slice(0, 60);
}

/** Shape a review HTML document into a Canvas artifact (id + timestamps injected). */
export function buildReviewArtifact(opts: {
  input: ReviewHtmlInput;
  id: string;
  nowIso: string;
}): CanvasArtifact {
  const { input, id, nowIso } = opts;
  const ref = `${input.repo}${input.number != null ? ` #${input.number}` : ""}`;
  return {
    id,
    title: reviewArtifactTitle(input.repo, input.number),
    prompt: input.familiarReview
      ? `${input.familiarReview.familiarName}'s review of ${ref}`
      : `HTML export of ${ref} review`,
    code: buildReviewHtml({ ...input, generatedAt: nowIso }),
    kind: "html",
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

/** Build the prompt that asks a familiar to review the PR (Markdown output). */
export function buildReviewPrompt(input: {
  title: string;
  repo: string;
  number?: number | null;
  body?: string | null;
  threads?: Pick<ReviewThread, "path" | "diffHunk">[];
}): string {
  const ref = `${input.repo}${input.number != null ? ` #${input.number}` : ""}`;
  const diffs = (input.threads ?? [])
    .filter((t) => t.diffHunk)
    .map((t) => `### ${t.path ?? "diff"}\n\`\`\`diff\n${t.diffHunk}\n\`\`\``)
    .join("\n\n");
  return [
    `You are reviewing the GitHub pull request **${input.title}** (${ref}).`,
    input.body?.trim() ? `\nPR description:\n${input.body.trim()}` : "",
    diffs ? `\nKey diffs under discussion:\n${diffs}` : "",
    "\nWrite a concise, well-structured code review in Markdown: a one-line summary, " +
      "then findings grouped by severity (blocking, then nits), then an overall " +
      "recommendation (approve or request changes). Be specific and reference files where possible.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Persist an artifact to the Canvas store. Returns whether the write landed. */
export async function saveCanvasArtifact(artifact: CanvasArtifact): Promise<boolean> {
  try {
    const res = await fetch("/api/canvas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ artifact }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
