"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/lib/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { MarkdownBlock, SyntaxBlock } from "@/components/message-bubble";

// ─── API response shape (mirrors src/app/api/project-file/route.ts) ───────────

type ProjectFileBody =
  | { ok: true; kind: "text"; content: string; size: number }
  | { ok: true; kind: "image"; dataUrl: string; mimeType: string; size: number }
  | { ok: false; error: string };

type Loaded =
  | { kind: "text"; content: string; size: number }
  | { kind: "image"; dataUrl: string; mimeType: string; size: number };

const MARKDOWN_EXTS = new Set(["md", "mdx", "markdown"]);

function isMarkdownPath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase();
  return Boolean(ext && MARKDOWN_EXTS.has(ext));
}

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

/**
 * Read-only preview for a single file selected in the code rail's Files tab.
 *
 * Fetches `/api/project-file` whenever `path` changes and renders:
 *  - a muted "Select a file" empty state when no file is selected,
 *  - a skeleton while loading,
 *  - highlighted text (SyntaxBlock), rendered markdown (MarkdownBlock), or an
 *    `<img>` for images, and
 *  - a graceful error state on failure.
 *
 * There is deliberately NO editing/save affordance — the comux view owns the
 * editable preview; this is a lightweight reader for the rail.
 */
export function RailFilePreview({
  path,
  projectRoot,
  familiarId,
}: {
  path: string | null;
  projectRoot: string | null;
  familiarId?: string | null;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!path) {
      setFile(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setFile(null);
    const params = new URLSearchParams({ path });
    if (familiarId) params.set("familiarId", familiarId);
    void fetch(`/api/project-file?${params.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json()) as ProjectFileBody;
        if (cancelled) return;
        if (!json.ok) {
          setError(json.error || "Couldn't open this file.");
          setLoading(false);
          return;
        }
        setFile(json.kind === "image"
          ? { kind: "image", dataUrl: json.dataUrl, mimeType: json.mimeType, size: json.size }
          : { kind: "text", content: json.content, size: json.size });
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Couldn't open this file.");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [path, familiarId, projectRoot]);

  if (!path) {
    return (
      <div className="workspace-rail__files-empty">
        <Icon name="ph:file" width={22} aria-hidden />
        <p>Select a file to preview it here.</p>
      </div>
    );
  }

  const name = fileName(path);

  return (
    <div className="workspace-rail__preview">
      <header className="workspace-rail__preview-head">
        <Icon
          name={file?.kind === "image" ? "ph:file-image" : isMarkdownPath(path) ? "ph:file-text" : "ph:file-code"}
          width={12}
          aria-hidden
        />
        <span className="workspace-rail__preview-name" title={path}>{name}</span>
      </header>
      <div className="workspace-rail__preview-body">
        {loading ? (
          <div className="workspace-rail__preview-skeleton" aria-busy="true" aria-label="Loading file">
            {["94%", "82%", "97%", "70%", "88%", "60%"].map((w, i) => (
              <Skeleton key={i} variant="text" width={w} />
            ))}
          </div>
        ) : error ? (
          <div className="workspace-rail__preview-error" role="alert">
            <Icon name="ph:warning-circle" width={24} aria-hidden />
            <p>{error}</p>
          </div>
        ) : file?.kind === "image" ? (
          <div className="workspace-rail__preview-image">
            <img src={file.dataUrl} alt={`Preview of ${name}`} />
            <span className="workspace-rail__preview-meta">
              {file.mimeType}
              {typeof file.size === "number" ? ` · ${file.size.toLocaleString()} bytes` : ""}
            </span>
          </div>
        ) : file?.kind === "text" && isMarkdownPath(path) ? (
          <MarkdownBlock text={file.content} className="comux-md max-w-[72ch]" />
        ) : file?.kind === "text" ? (
          <SyntaxBlock text={file.content} lang={path.split(".").pop()} className="leading-relaxed" />
        ) : null}
      </div>
    </div>
  );
}
