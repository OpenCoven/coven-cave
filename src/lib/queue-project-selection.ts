/**
 * Queue selection is persisted for the whole Cave home, so mounted Queue
 * surfaces in every window must invalidate together. A local CustomEvent keeps
 * same-window listeners simple; BroadcastChannel carries that intent to the
 * other Cave windows sharing this origin.
 */
export const QUEUE_PROJECT_SELECTED_EVENT = "cave:queue-project-selected";

export type QueueProjectSelection = {
  id: string;
  name: string;
  root: string;
};

type QueueProjectSelectionMessage = {
  type: "queue-project-selected";
  project: QueueProjectSelection | null;
};

const CHANNEL_NAME = "cave:queue-project-selection";
let channel: BroadcastChannel | null = null;

function validProject(value: unknown): value is QueueProjectSelection {
  if (!value || typeof value !== "object") return false;
  const project = value as Partial<QueueProjectSelection>;
  return typeof project.id === "string" && typeof project.name === "string" && typeof project.root === "string";
}

function projectFromMessage(value: unknown): QueueProjectSelection | null | undefined {
  if (!value || typeof value !== "object") return undefined;
  const message = value as Partial<QueueProjectSelectionMessage>;
  if (message.type !== "queue-project-selected") return undefined;
  return message.project === null || validProject(message.project) ? message.project : undefined;
}

function selectionChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  channel ??= new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

function dispatch(project: QueueProjectSelection | null): void {
  window.dispatchEvent(new CustomEvent(QUEUE_PROJECT_SELECTED_EVENT, { detail: { project } }));
}

/** Publish immediately in this window and asynchronously to every other Cave window. */
export function publishQueueProjectSelection(project: QueueProjectSelection | null): void {
  if (typeof window === "undefined") return;
  dispatch(project);
  selectionChannel()?.postMessage({ type: "queue-project-selected", project } satisfies QueueProjectSelectionMessage);
}

/** Subscribe to both local selections and cross-window BroadcastChannel messages. */
export function subscribeToQueueProjectSelection(listener: (project: QueueProjectSelection | null) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onLocal = (event: Event) => {
    const selected = event as CustomEvent<{ project?: unknown }>;
    const project = selected.detail?.project;
    if (project === null || validProject(project)) listener(project ?? null);
  };
  window.addEventListener(QUEUE_PROJECT_SELECTED_EVENT, onLocal);
  const activeChannel = selectionChannel();
  const onMessage = (event: MessageEvent<unknown>) => {
    const project = projectFromMessage(event.data);
    if (project !== undefined) dispatch(project);
  };
  activeChannel?.addEventListener("message", onMessage);
  return () => {
    window.removeEventListener(QUEUE_PROJECT_SELECTED_EVENT, onLocal);
    activeChannel?.removeEventListener("message", onMessage);
  };
}
