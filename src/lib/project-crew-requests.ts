import type { Familiar } from "./types.ts";
import { PROJECT_ACCESS_CHANGED_EVENT, projectAccessChangedId } from "./project-access-events.ts";

export type ProjectCrewResult =
  | { status: "loading" }
  | { status: "loaded"; familiars: Familiar[] }
  | { status: "error" };

type Listener = (projectId: string, result: ProjectCrewResult) => void;
type ProjectRead = {
  projectId: string;
  listeners: Set<Listener>;
  request: CrewRequest | null;
};
type CrewRequest = {
  controller: AbortController;
  reads: Set<ProjectRead>;
};
type CrewPayload = {
  ok?: boolean;
  familiars?: Familiar[];
  familiarsByProject?: Record<string, Familiar[]>;
};

// Only live subscribers and pending requests are retained, never membership.
const reads = new Map<string, ProjectRead>();
let eventWindow: Window | null = null;

function onProjectAccessChanged(event: Event): void {
  const projectId = projectAccessChangedId(event);
  if (projectId) reloadProjectCrew(projectId);
}

function detachRequest(read: ProjectRead): void {
  const request = read.request;
  read.request = null;
  if (!request) return;
  request.reads.delete(read);
  // An invalidated/cancelled project may share transport with other projects.
  if (request.reads.size === 0) request.controller.abort();
}

function publish(read: ProjectRead, result: ProjectCrewResult): void {
  for (const listener of read.listeners) listener(read.projectId, result);
}

function requestCrew(pending: ProjectRead[]): void {
  if (pending.length === 0) return;
  const request: CrewRequest = {
    controller: new AbortController(),
    reads: new Set(pending),
  };
  for (const read of pending) {
    read.request = request;
    publish(read, { status: "loading" });
  }

  const ids = pending.map((read) => read.projectId);
  const search = new URLSearchParams();
  for (const projectId of ids) search.append("projectId", projectId);
  void (async () => {
    let payload: CrewPayload | null = null;
    try {
      const response = await fetch(`/api/familiars?${search}`, {
        cache: "no-store",
        signal: request.controller.signal,
      });
      if (response.ok) payload = await response.json() as CrewPayload | null;
    } catch {
      // A failed request stays a failure, never an authorized empty roster.
    } finally {
      for (const read of request.reads) {
        // Request identity is the generation fence, including body parsing.
        if (read.request !== request) continue;
        read.request = null;
        const familiars = ids.length === 1 && Array.isArray(payload?.familiars)
          ? payload.familiars
          : payload?.familiarsByProject?.[read.projectId];
        publish(read, payload?.ok && Array.isArray(familiars)
          ? { status: "loaded", familiars }
          : { status: "error" });
      }
      request.reads.clear();
    }
  })();
}

/** Invalidate before notifying subscribers so old responses cannot win a race. */
export function reloadProjectCrew(projectId: string): void {
  const read = reads.get(projectId);
  if (!read) return;
  detachRequest(read);
  requestCrew([read]);
}

/**
 * Share pending reads per project across single and batch consumers, batching
 * only the missing projects. A later subscriber revalidates completed reads:
 * past membership is not current action authority.
 */
export function subscribeProjectCrew(projectIds: readonly string[], listener: Listener): () => void {
  const subscriptions: ProjectRead[] = [];
  const pending: ProjectRead[] = [];
  for (const projectId of new Set(projectIds)) {
    let read = reads.get(projectId);
    if (!read) {
      read = { projectId, listeners: new Set(), request: null };
      reads.set(projectId, read);
    }
    read.listeners.add(listener);
    subscriptions.push(read);
    if (read.request) listener(projectId, { status: "loading" });
    else pending.push(read);
  }
  if (reads.size > 0 && !eventWindow && typeof window !== "undefined") {
    eventWindow = window;
    eventWindow.addEventListener(PROJECT_ACCESS_CHANGED_EVENT, onProjectAccessChanged);
  }
  requestCrew(pending);

  return () => {
    for (const read of subscriptions) {
      read.listeners.delete(listener);
      if (read.listeners.size > 0) continue;
      detachRequest(read);
      if (reads.get(read.projectId) === read) reads.delete(read.projectId);
    }
    if (reads.size === 0 && eventWindow) {
      eventWindow.removeEventListener(PROJECT_ACCESS_CHANGED_EVENT, onProjectAccessChanged);
      eventWindow = null;
    }
  };
}
