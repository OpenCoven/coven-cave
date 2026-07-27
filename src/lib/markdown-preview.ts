type MarkdownPreviewModule = typeof import("@create-markdown/preview");

let previewPromise: Promise<MarkdownPreviewModule> | null = null;

/** Load the browser-only serializer once per app runtime. */
export function loadMarkdownPreview(): Promise<MarkdownPreviewModule> {
  if (!previewPromise) {
    previewPromise = import("@create-markdown/preview").catch((error) => {
      previewPromise = null;
      throw error;
    });
  }
  return previewPromise;
}

/** Start the preview chunk early without evaluating it during server render. */
export function preloadMarkdownPreview(): void {
  if (typeof window === "undefined") return;
  void loadMarkdownPreview().catch(() => {});
}
