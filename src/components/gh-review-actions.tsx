"use client";

import { useState } from "react";

import { Icon } from "@/lib/icon";
import type { Familiar } from "@/lib/types";
import { generateArtifactCode } from "@/lib/canvas-generate";
import {
  buildReviewArtifact,
  buildReviewPrompt,
  saveCanvasArtifact,
} from "@/lib/gh-review-export";
import type { ReviewComment, ReviewThread } from "@/lib/gh-review-html";

/** Minimal PR shape this surface needs — a subset of github-view's ItemDetail. */
type PrInfo = {
  repo: string;
  number: number | null;
  title: string;
  state: string;
  author: string | null;
  url: string | null;
  body: string | null;
};

type FetchedReview = { comments: ReviewComment[]; threads: ReviewThread[] };

async function fetchReviewBundle(repo: string, number: number): Promise<FetchedReview> {
  const res = await fetch(
    `/api/github/comments?repo=${encodeURIComponent(repo)}&number=${encodeURIComponent(String(number))}&isPull=1`,
    { cache: "no-store" },
  );
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) return { comments: [], threads: [] };
  const comments: ReviewComment[] = (json.issueComments ?? []).map((c: { author?: { login?: string } | null; body?: string; createdAt?: string | null }) => ({
    author: c.author?.login ?? null,
    body: c.body ?? "",
    createdAt: c.createdAt ?? null,
  }));
  const threads: ReviewThread[] = (json.reviewThreads ?? []).map((t: { path?: string | null; diffHunk?: string | null; isResolved?: boolean; comments?: Array<{ author?: { login?: string } | null; body?: string }> }) => ({
    path: t.path ?? null,
    diffHunk: t.diffHunk ?? null,
    isResolved: Boolean(t.isResolved),
    comments: (t.comments ?? []).map((c) => ({ author: c.author?.login ?? null, body: c.body ?? "" })),
  }));
  return { comments, threads };
}

/** Open the Canvas surface (where HTML artifacts render) on the Sketch layer. */
function openCanvasArtifacts() {
  try {
    window.localStorage.setItem("cave:canvas:layer", "sketch");
  } catch {
    /* ignore storage failures */
  }
  window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "canvas" } }));
}

function newArtifactId(repo: string, number: number | null): string {
  const slug = `${repo}-${number ?? "x"}`.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return `ghreview-${slug}-${Date.now().toString(36)}`;
}

/**
 * Review actions for the PR detail pane: export the PR review as a standalone
 * HTML artifact, or have a familiar write a review that's saved the same way.
 * Both land a Canvas "html" artifact and jump to Canvas to view/share it.
 */
export function GhReviewActions({ pr, familiars }: { pr: PrInfo; familiars: Familiar[] }) {
  const [busy, setBusy] = useState<null | "export" | "review">(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [familiarId, setFamiliarId] = useState<string>(familiars[0]?.id ?? "");

  const reset = () => {
    setError(null);
    setStatus(null);
  };

  async function onExport() {
    if (pr.number == null || busy) return;
    reset();
    setBusy("export");
    setStatus("Collecting review…");
    try {
      const bundle = await fetchReviewBundle(pr.repo, pr.number);
      const artifact = buildReviewArtifact({
        id: newArtifactId(pr.repo, pr.number),
        nowIso: new Date().toISOString(),
        input: { ...pr, comments: bundle.comments, threads: bundle.threads, generatedAt: "" },
      });
      const ok = await saveCanvasArtifact(artifact);
      if (!ok) throw new Error("Couldn’t save the artifact.");
      setStatus("Opening in Canvas…");
      openCanvasArtifacts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setBusy(null);
    }
  }

  async function onReview() {
    if (pr.number == null || busy || !familiarId) return;
    reset();
    setBusy("review");
    const familiarName = familiars.find((f) => f.id === familiarId)?.display_name ?? "Familiar";
    setStatus(`${familiarName} is reviewing…`);
    try {
      const bundle = await fetchReviewBundle(pr.repo, pr.number);
      const prompt = buildReviewPrompt({ ...pr, threads: bundle.threads });
      const result = await generateArtifactCode({ familiarId, prompt });
      const review = (result.text ?? "").trim();
      if (result.error && !review) throw new Error(result.error);
      if (!review) throw new Error("The familiar returned an empty review.");
      const artifact = buildReviewArtifact({
        id: newArtifactId(pr.repo, pr.number),
        nowIso: new Date().toISOString(),
        input: {
          ...pr,
          comments: bundle.comments,
          threads: bundle.threads,
          familiarReview: { familiarName, body: review },
          generatedAt: "",
        },
      });
      const ok = await saveCanvasArtifact(artifact);
      if (!ok) throw new Error("Couldn’t save the review artifact.");
      setStatus("Opening in Canvas…");
      openCanvasArtifacts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="gh-review-actions">
      <button
        type="button"
        className="gh-review-action"
        onClick={onExport}
        disabled={busy != null || pr.number == null}
        title="Export this PR review as a standalone HTML page"
      >
        <Icon name="ph:file-code" width={13} />
        {busy === "export" ? "Exporting…" : "Open as HTML"}
      </button>

      {familiars.length > 0 && (
        <span className="gh-review-action-group">
          <button
            type="button"
            className="gh-review-action gh-review-action--accent"
            onClick={onReview}
            disabled={busy != null || pr.number == null || !familiarId}
            title="Have a familiar write a code review, saved as HTML"
          >
            <Icon name="ph:sparkle" width={13} />
            {busy === "review" ? "Reviewing…" : "Review with"}
          </button>
          <select
            className="gh-review-familiar"
            aria-label="Familiar to review with"
            value={familiarId}
            onChange={(e) => setFamiliarId(e.currentTarget.value)}
            disabled={busy != null}
          >
            {familiars.map((f) => (
              <option key={f.id} value={f.id}>
                {f.display_name}
              </option>
            ))}
          </select>
        </span>
      )}

      {status && !error && <span className="gh-review-status" aria-live="polite">{status}</span>}
      {error && <span className="gh-review-error" role="alert">{error}</span>}
    </div>
  );
}
