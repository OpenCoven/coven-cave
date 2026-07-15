/**
 * Token-stream chunk coalescer (cave-w50e).
 *
 * SSE delivers roughly one `assistant_chunk` frame per network packet, i.e.
 * one React commit per token at 50–100 tokens/s. Each commit mapped the whole
 * turns array, advanced the live-chat registry and re-rendered the streaming
 * subtree. Coalescing buffers chunk text and flushes it on a short timer so
 * dozens of tokens collapse into one state update, while every non-chunk
 * event (progress, attachments, done) forces a flush first — ordering between
 * text and tool/progress records is preserved exactly.
 *
 * Timer-based (not requestAnimationFrame) on purpose: chunks keep landing
 * after the view unmounts or the window is hidden (the live-chat registry
 * accumulates at module scope), and rAF stalls in hidden windows would leave
 * an unbounded buffer.
 */

export type ChunkCoalescer = {
  /** Buffer a chunk; schedules a flush if one isn't already pending. */
  push(text: string): void;
  /**
   * Apply everything buffered NOW (cancels the pending timer). Call before
   * handling any non-chunk event and at stream end/error/abort so ordering
   * and final text are exact.
   */
  flush(): void;
  /** Buffered-but-unapplied text length (introspection/tests). */
  pending(): number;
};

export function createChunkCoalescer(options: {
  /** How long buffered chunks may wait before a scheduled flush applies them. */
  flushMs: number;
  /** Applies the coalesced text — exactly once per flush with a non-empty buffer. */
  apply: (text: string) => void;
  /** Injectable timer hooks for tests. Default: global setTimeout/clearTimeout. */
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}): ChunkCoalescer {
  const { flushMs, apply } = options;
  const schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = options.cancel ?? ((handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]));

  let buffer = "";
  let timer: unknown = null;

  const flush = () => {
    if (timer != null) {
      cancel(timer);
      timer = null;
    }
    if (!buffer) return;
    const text = buffer;
    buffer = "";
    apply(text);
  };

  return {
    push(text) {
      if (!text) return;
      buffer += text;
      if (timer == null) {
        timer = schedule(flush, flushMs);
      }
    },
    flush,
    pending: () => buffer.length,
  };
}
