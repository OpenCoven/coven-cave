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
  sourceMode: StreamingPresentationSourceMode;
};

export function useStreamingPresentationSource(
  source: string,
  pending: boolean,
  options: StreamingPresentationSourceOptions = {},
): string {
  const [presented, setPresented] = useState(source);
  const setPresentedRef = useRef(setPresented);
  setPresentedRef.current = setPresented;
  const presentedRef = useRef(presented);
  presentedRef.current = presented;

  const sourceMode = options.sourceMode ?? "replaceable";
  const bufferRef = useRef<BufferEntry | null>(null);
  const ensureBuffer = () => {
    const current = bufferRef.current;
    if (current?.sourceMode === sourceMode) return current.buffer;
    current?.buffer.dispose();

    const buffer = createStreamingPresentationBuffer({
      initialSource: presentedRef.current,
      onFlush: (next) => setPresentedRef.current(next),
      sourceMode,
    });
    bufferRef.current = { buffer, sourceMode };
    return buffer;
  };
  ensureBuffer();

  useEffect(() => {
    ensureBuffer().update(source, !pending);
  }, [pending, source, sourceMode]);

  useEffect(
    () => () => {
      const entry = bufferRef.current;
      bufferRef.current = null;
      entry?.buffer.dispose();
    },
    [],
  );

  return pending ? presented : source;
}
