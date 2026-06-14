// Open a URL in the user's *system* browser (not the embedded browser pane).
// In the Tauri desktop shell this uses the built-in `shell_open` command; on the
// web it falls back to window.open. Mirrors the pattern in library-doc-preview.
export async function openExternalUrl(url: string): Promise<void> {
  if (typeof window === "undefined") return;
  if ("__TAURI_INTERNALS__" in window) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("shell_open", { url });
      return;
    } catch {
      // fall through to window.open
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
