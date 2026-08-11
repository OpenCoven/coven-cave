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
  const focusedBeforeCopy = typeof document === "undefined"
    ? null
    : document.activeElement as HTMLElement | null;

  try {
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
    let ta: HTMLTextAreaElement | null = null;
    let appended = false;
    let selection: Selection | null = null;
    let previousRange: Range | null = null;
    try {
      selection = document.getSelection();
      previousRange = selection && selection.rangeCount > 0
        ? selection.getRangeAt(0)
        : null;
    } catch {
      // Selection preservation is best effort; copying remains available.
    }
    try {
      ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      // Keep it out of layout and invisible, but still selectable.
      ta.style.position = "fixed";
      ta.style.top = "-9999px";
      ta.style.left = "-9999px";
      ta.style.opacity = "0";
      ta.style.pointerEvents = "none";
      document.body.appendChild(ta);
      appended = true;

      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      if (ta && appended) {
        try {
          document.body.removeChild(ta);
        } catch {
          // The copy result remains authoritative if the webview already
          // detached the transient node.
        }
      }
      if (previousRange && selection) {
        try {
          selection.removeAllRanges();
          selection.addRange(previousRange);
        } catch {
          // A webview may invalidate a saved range while the copy runs.
        }
      }
    }
  } finally {
    if (focusedBeforeCopy?.isConnected !== false) {
      try {
        focusedBeforeCopy?.focus({ preventScroll: true });
      } catch {
        try {
          focusedBeforeCopy?.focus();
        } catch {
          // A detached or inert trigger cannot be restored; the modal trap
          // remains responsible for containing subsequent keyboard focus.
        }
      }
    }
  }
}
