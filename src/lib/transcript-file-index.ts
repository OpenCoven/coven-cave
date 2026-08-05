export const MAX_TRANSCRIPT_FILE_INDEX_ROOTS = 8;
export const TRANSCRIPT_FILE_INDEX_CONCURRENCY = 2;

export function boundedTranscriptFileRoots(
  roots: Iterable<string | null>,
  limit = MAX_TRANSCRIPT_FILE_INDEX_ROOTS,
): string[] {
  if (limit <= 0) return [];
  const recent: string[] = [];
  for (const root of roots) {
    if (!root) continue;
    const previous = recent.indexOf(root);
    if (previous >= 0) recent.splice(previous, 1);
    recent.push(root);
    if (recent.length > limit) recent.shift();
  }
  return recent;
}

export async function loadTranscriptFileRefIndexes({
  roots,
  load,
  signal,
  concurrency = TRANSCRIPT_FILE_INDEX_CONCURRENCY,
}: {
  roots: readonly string[];
  load: (root: string, signal: AbortSignal) => Promise<ReadonlySet<string>>;
  signal: AbortSignal;
  concurrency?: number;
}): Promise<Map<string, ReadonlySet<string>>> {
  const boundedRoots = roots.slice(-MAX_TRANSCRIPT_FILE_INDEX_ROOTS);
  const indexes = new Map<string, ReadonlySet<string>>();
  let cursor = 0;

  const worker = async () => {
    while (!signal.aborted) {
      const index = cursor;
      cursor += 1;
      const root = boundedRoots[index];
      if (!root) return;
      let files: ReadonlySet<string> = new Set();
      try {
        files = await load(root, signal);
      } catch {
        // A failed or aborted request remains unverified and therefore empty.
      }
      if (signal.aborted) return;
      indexes.set(root, files);
    }
  };

  const workerCount = Math.min(
    boundedRoots.length,
    Math.max(1, Math.floor(concurrency)),
  );
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return signal.aborted ? new Map() : indexes;
}
