/** Dispatch the shared in-shell navigation event from familiar capability CTAs. */
export function navigateFamiliarSurface(mode: "roles" | "capabilities" | "marketplace"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode } }));
}
