"use client";

import { useEffect, useRef, useState } from "react";

import {
  createStreamingPresentationBuffer,
  type StreamingPresentationSourceMode,
} from "./streaming-presentation-buffer.ts";

export type StreamingPresentationSourceOptions = {
  sourceMode?: StreamingPresentationSourceMode;
};

type BufferEntry = {
  buffer: ReturnType<typeof createStreamingPresentationBuffer>;
  pending: boolean;
  source: string;
};

function forwardToBuffer(entry: BufferEntry, source: string, pending: boolean): void {
  if (entry.source === source && entry.pending === pending) return;
  entry.source = source;
  entry.pending = pending;
  entry.buffer.update(source, !pending);
}

export function useStreamingPresentationSource(
  source: string,
  pending: boolean,
  options: StreamingPresentationSourceOptions = {},
): string {
  const [presented, setPresented] = useState(source);
  const presentedRef = useRef(presented);
  presentedRef.current = presented;
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const sourceMode = options.sourceMode ?? "replaceable";
  const bufferRef = useRef<BufferEntry | null>(null);

  useEffect(() => {
    const buffer = createStreamingPresentationBuffer({
      initialSource: presentedRef.current,
      onFlush: setPresented,
      sourceMode,
    });
    const entry: BufferEntry = {
      buffer,
      pending: true,
      source: presentedRef.current,
    };
    bufferRef.current = entry;
    forwardToBuffer(entry, sourceRef.current, pendingRef.current);

    return () => {
      buffer.dispose();
      if (bufferRef.current === entry) bufferRef.current = null;
    };
  }, [sourceMode]);

  useEffect(() => {
    const entry = bufferRef.current;
    if (entry) forwardToBuffer(entry, source, pending);
  }, [pending, source]);

  return pending ? presented : source;
}
