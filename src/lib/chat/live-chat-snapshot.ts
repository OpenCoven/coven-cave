/**
 * Liveness rule for an in-flight chat-generation snapshot.
 *
 * ChatView tracks active generations in a module-level registry so a stream
 * survives navigating between threads. The component that started the stream
 * clears its registry entry in a `finally` when the stream ends normally — but
 * if that component unmounts mid-stream, or the stream dies without running
 * cleanup, the entry is never cleared. Without a liveness check, any view that
 * later mounts on the same session adopts a zombie `busy = true` and shows
 * "Streaming…" forever with nothing actually streaming.
 *
 * A snapshot counts as still streaming only while its controller is unaborted
 * AND it emitted an update recently. A healthy stream refreshes `updatedAt` on
 * every chunk (see persistLiveTurns in chat-view), so the TTL is generous
 * enough to span long tool/think gaps without tripping on a live generation.
 *
 * Pure + dependency-light (it only needs the controller's aborted flag and the
 * timestamp) so the liveness decision can be unit-tested without React.
 */

/** Max idle time before a registry snapshot is presumed dead. Generous on
 *  purpose: a live stream pings `updatedAt` every chunk, so only a genuinely
 *  stalled/orphaned generation goes quiet this long. */
export const LIVE_SNAPSHOT_TTL_MS = 90_000;

/** Minimal shape the liveness check needs. The real LiveChatGenerationSnapshot
 *  (with a full AbortController and Turn[]) is structurally assignable. */
export type SnapshotLiveness = {
  controller: { signal: { aborted: boolean } };
  updatedAt: number;
};

export function isLiveSnapshotActive(snapshot: SnapshotLiveness, now: number): boolean {
  if (snapshot.controller.signal.aborted) return false;
  return now - snapshot.updatedAt < LIVE_SNAPSHOT_TTL_MS;
}
