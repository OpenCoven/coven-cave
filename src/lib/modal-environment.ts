/** Shared viewport-modal environment. Pane gates deliberately do not acquire it. */
type Layer = { element: HTMLElement; portals: () => readonly HTMLElement[]; order: number };
const layers = new Set<Layer>();
const inertBefore = new Map<HTMLElement, boolean>();
let observer: MutationObserver | null = null;
let scrollOwners = 0;
let restoreScroll: (() => void) | null = null;

export function acquirePageScrollLock(): () => void {
  if (scrollOwners++ === 0) {
    const saved = [document.documentElement, document.body].map(element => ({
      element, overflow: element.style.overflow, overscroll: element.style.overscrollBehavior,
    }));
    for (const { element } of saved) {
      element.style.overflow = 'hidden';
      element.style.overscrollBehavior = 'none';
    }
    restoreScroll = () => {
      for (const { element, overflow, overscroll } of saved) {
        element.style.overflow = overflow;
        element.style.overscrollBehavior = overscroll;
      }
    };
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--scrollOwners === 0) { restoreScroll?.(); restoreScroll = null; }
  };
}

/** Recompute when a portaled control registers as well as when body nodes change. */
export function refreshModalEnvironment(): void {
  const top = [...layers].sort((a, b) => a.order - b.order).at(-1);
  const blocked = new Set<HTMLElement>();
  if (top) {
    // Only the app's dedicated announcers escape background inert, not arbitrary
    // status/error content or interactive controls elsewhere on the page.
    const allowed = [top.element, ...top.portals(), ...document.querySelectorAll<HTMLElement>('[data-modal-announcer]')];
    const visit = (element: HTMLElement) => {
      if (allowed.includes(element)) return;
      if (allowed.some(node => element.contains(node))) {
        for (const child of Array.from(element.children)) visit(child as HTMLElement);
      } else blocked.add(element);
    };
    for (const child of Array.from(document.body.children)) visit(child as HTMLElement);
  }
  // Restore ancestors before allowing newly opened portaled descendants.
  for (const [element, previous] of inertBefore) {
    if (!blocked.has(element)) { element.inert = previous; inertBefore.delete(element); }
  }
  for (const element of blocked) {
    if (!inertBefore.has(element)) inertBefore.set(element, element.inert);
    element.inert = true;
  }
}

export function acquireModalEnvironment(element: HTMLElement, portals: Layer['portals'], order: number): () => void {
  const layer = {element, portals, order};
  const releaseScroll = acquirePageScrollLock();
  layers.add(layer);
  if (!observer && typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(refreshModalEnvironment);
    observer.observe(document.body, {childList: true, subtree: true});
  }
  refreshModalEnvironment();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    layers.delete(layer);
    refreshModalEnvironment();
    releaseScroll();
    if (layers.size === 0) { observer?.disconnect(); observer = null; }
  };
}
