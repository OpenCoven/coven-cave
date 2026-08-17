"use client";

import { useEffect, useRef, useState } from "react";

import { createStreamingPresentationBuffer } from "./streaming-presentation-buffer.ts";

export function useStreamingPresentationSource(source: string, pending: boolean): string {
  const [presented, setPresented] = useState(source);
  const setPresentedRef = useRef(setPresented);
  setPresentedRef.current = setPresented;

  const bufferRef = useRef<ReturnType<typeof createStreamingPresentationBuffer> | null>(null);
  const ensureBuffer = () => {
    if (bufferRef.current) return bufferRef.current;
    const buffer = createStreamingPresentationBuffer({
      initialSource: source,
      onFlush: (next) => setPresentedRef.current(next),
      sourceMode: "append-only",
    });
    bufferRef.current = buffer;
    return buffer;
  };
  ensureBuffer();

  useEffect(() => {
    ensureBuffer().update(source, !pending);
  }, [pending, source]);

  useEffect(
    () => () => {
      const buffer = bufferRef.current;
      bufferRef.current = null;
      buffer?.dispose();
    },
    [],
  );

  return pending ? presented : source;
}
