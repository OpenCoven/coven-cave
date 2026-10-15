/**
 * Run an invalidation at most once per event and key (#5869).
 *
 * Several surfaces can subscribe to the same event-plane topic and share one
 * warm-cache resource: the board view and the workspace's Tasks badge both
 * read `board:cards`. Invalidating a resource cancels its in-flight request,
 * so if each listener invalidated, the second would cancel the fresh fetch the
 * first had just started. The client delivers one event object to every
 * listener, so the first listener for an event invalidates and the rest only
 * read, joining that fetch, whatever order they run in.
 */
export function createInvalidateOnce(invalidate: (key: string) => void) {
  const handled = new WeakMap<object, Set<string>>();
  return (token: object, ...keys: string[]): void => {
    let seen = handled.get(token);
    if (!seen) {
      seen = new Set();
      handled.set(token, seen);
    }
    for (const key of keys) {
      if (seen.has(key)) continue;
      seen.add(key);
      invalidate(key);
    }
  };
}
