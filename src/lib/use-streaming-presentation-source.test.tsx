// @ts-nocheck
import { StrictMode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, test, vi } from "vitest";

import { useStreamingPresentationSource } from "./use-streaming-presentation-source.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe({
  pending,
  snapshots,
  source,
}: {
  pending: boolean;
  snapshots: string[];
  source: string;
}) {
  snapshots.push(useStreamingPresentationSource(source, pending));
  return null;
}

describe("useStreamingPresentationSource", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("StrictMode effect replay still lets later pending text flush", async () => {
    vi.useFakeTimers();

    const snapshots: string[] = [];
    let renderer: ReactTestRenderer | null = null;
    const render = (source: string, pending: boolean) => (
      <StrictMode>
        <Probe pending={pending} snapshots={snapshots} source={source} />
      </StrictMode>
    );

    try {
      await act(async () => {
        renderer = create(render("Alpha", true));
      });
      expect(snapshots.at(-1)).toBe("Alpha");

      await act(async () => {
        renderer?.update(render("Alpha tail", true));
      });
      expect(snapshots.at(-1)).toBe("Alpha");

      await act(async () => {
        vi.advanceTimersByTime(89);
      });
      expect(snapshots.at(-1)).toBe("Alpha");

      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(snapshots.at(-1)).toBe("Alpha tail");
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
    }
  });
});
