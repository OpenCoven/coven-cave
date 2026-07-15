type NativeBrowserInternals = {
  invoke?: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
};

// Passive React cleanup from an older Browser render can be dispatched after
// a newer render has already requested visibility. Use a process-wide,
// reload-safe sequence so Rust can reject that stale renderer intent.
// Date.now() keeps a freshly reloaded renderer ahead of the previous one;
// the monotonic fallback handles many commands issued in the same millisecond.
let lastNativeBrowserSequence = 0;

export function nextNativeBrowserSequence(): number {
  lastNativeBrowserSequence = Math.max(
    lastNativeBrowserSequence + 1,
    Date.now() * 1024,
  );
  return lastNativeBrowserSequence;
}

export function withNativeBrowserSequence(
  args: Record<string, unknown> = {},
): Record<string, unknown> {
  return { ...args, sequence: nextNativeBrowserSequence() };
}

export function deactivateAllNativeBrowserWebviews(label?: string): void {
  if (typeof window === "undefined") return;
  const internals = (window as typeof window & {
    __TAURI_INTERNALS__?: NativeBrowserInternals;
  }).__TAURI_INTERNALS__;
  void internals?.invoke?.(
    "browser_deactivate_all",
    withNativeBrowserSequence(label === undefined ? {} : { label }),
  );
}
