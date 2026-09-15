/** Keep a Settings search jump pending until its lazy section mounts. */
export function observeSettingsTarget(
  root: HTMLElement,
  id: string,
  onFound: (element: HTMLElement) => void,
  createObserver: (notify: () => void) => Pick<MutationObserver, "observe" | "disconnect"> =
    (notify) => new MutationObserver(notify),
): () => void {
  let stopped = false;
  let observer: ReturnType<typeof createObserver> | undefined;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    observer?.disconnect();
  };
  const find = () => {
    if (stopped) return;
    const element = Array.from(root.querySelectorAll<HTMLElement>("[id]"))
      .find((candidate) => candidate.id === id);
    if (!element) return;
    stop();
    onFound(element);
  };
  find();
  if (!stopped) {
    observer = createObserver(find);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["id"] });
  }
  return stop;
}
