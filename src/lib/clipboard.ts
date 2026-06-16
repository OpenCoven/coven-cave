// Robust clipboard write that works outside secure contexts.
//
// `navigator.clipboard` only exists in a *secure context* — https or
// http://localhost. Inside the Tauri webview (custom `tauri://`/`app://`
// protocol) and when the app is reached over Tailscale Serve (plain http on a
// LAN/Tailscale hostname), `navigator.clipboard` is `undefined`. The bare
// `navigator.clipboard.writeText(...)` calls scattered across the UI therefore
// threw a synchronous TypeError *before* their `.catch()` could attach, so
// every copy button silently no-op'd off-localhost and never showed feedback.
//
// `copyText` guards that path and falls back to a transient-textarea +
// `document.execCommand("copy")`, which still works in non-secure contexts and
// older webviews. It resolves to whether the copy actually landed, so callers
// can gate their "Copied" confirmation on real success instead of faking it.
export async function copyText(text: string): Promise<boolean> {
  // Preferred path: the async Clipboard API (secure contexts).
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied, non-secure context, transient focus loss, etc. —
    // fall through to the legacy path rather than failing the copy.
  }

  if (typeof document === "undefined") return false;

  // Legacy fallback: select a hidden textarea and execCommand("copy").
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    // Keep it out of layout and invisible, but still selectable.
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.left = "-9999px";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);

    // Preserve any selection we're about to clobber.
    const selection = document.getSelection();
    const prevRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand("copy");

    document.body.removeChild(ta);
    if (prevRange && selection) {
      selection.removeAllRanges();
      selection.addRange(prevRange);
    }
    return ok;
  } catch {
    return false;
  }
}
