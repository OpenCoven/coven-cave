import {
  deactivateAllNativeBrowserWebviews,
  withNativeBrowserSequence,
} from "./native-browser-lifecycle";

export type TauriBrowserBridge = {
  invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  listen: <T = unknown>(event: string, cb: (e: { payload: T }) => void) => Promise<() => void>;
};

/** Load desktop-only APIs lazily so browser and mobile fallbacks remain import-safe. */
export async function loadTauriBrowserBridge(): Promise<TauriBrowserBridge | null> {
  if (typeof window === "undefined") return null;
  // @ts-expect-error Tauri runtime
  if (!window.__TAURI_INTERNALS__) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  return { invoke, listen };
}

/** Deactivate native children through Tauri when present, or the browser fallback otherwise. */
export function deactivateNativeBrowserTabs(bridge: TauriBrowserBridge | null, label: string): void {
  if (bridge) {
    void bridge.invoke("browser_deactivate_all", withNativeBrowserSequence({ label }));
    return;
  }
  deactivateAllNativeBrowserWebviews(label);
}
