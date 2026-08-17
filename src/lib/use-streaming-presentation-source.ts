"use client";

import { useEffect, useRef, useState } from "react";

import { createStreamingPresentationBuffer } from "./streaming-presentation-buffer.ts";

export function useStreamingPresentationSource(source: string, pending: boolean): string {
  const [presented, setPresented] = useState(source);
  const setPresentedRef = useRef(setPresented);
  setPresentedRef.current = setPresented;

  const bufferRef = useRef<ReturnType<typeof createStreamingPresentationBuffer> | null>(null);
  if (!bufferRef.current) {
    bufferRef.current = createStreamingPresentationBuffer({
      initialSource: source,
      onFlush: (next) => setPresentedRef.current(next),
    });
  }

  useEffect(() => {
    bufferRef.current?.update(source, !pending);
  }, [pending, source]);

  useEffect(
    () => () => {
      bufferRef.current?.dispose();
    },
    [],
  );

  return pending ? presented : source;
}

