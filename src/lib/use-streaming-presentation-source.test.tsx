// @ts-nocheck
import { StrictMode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, test, vi } from "vitest";

import { extractChatRenderedText } from "./chat-rendered-text.ts";
import type { StreamingPresentationSourceMode } from "./streaming-presentation-buffer.ts";
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

function ModeProbe({
  pending,
  snapshots,
  source,
  sourceMode,
}: {
  pending: boolean;
  snapshots: string[];
  source: string;
  sourceMode: StreamingPresentationSourceMode;
}) {
  snapshots.push(useStreamingPresentationSource(source, pending, { sourceMode }));
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

  test("default mode promptly replaces a longer non-prefix marker projection", async () => {
    vi.useFakeTimers();

    const partialRaw = [
      "I prepared the file",
      "```coven:attachment",
      JSON.stringify({ path: "/workspace/report.pdf", name: "report.pdf" }),
    ].join("\n");
    const completeRaw = `${partialRaw}
\`\`\`
<thinking>Checking the attachment</thinking>
${"Here is the finished explanation with stable visible prose ".repeat(4)}ready`;
    const partialProjection = extractChatRenderedText(partialRaw, { pending: true }).visible;
    const completeProjection = extractChatRenderedText(completeRaw, { pending: true }).visible;
    expect(completeProjection.length).toBeGreaterThan(partialProjection.length);
    expect(completeProjection.startsWith(partialProjection)).toBe(false);

    const snapshots: string[] = [];
    let renderer: ReactTestRenderer | null = null;
    const render = (source: string) => (
      <Probe pending snapshots={snapshots} source={source} />
    );

    try {
      await act(async () => {
        renderer = create(render(partialProjection));
      });
      await act(async () => {
        renderer?.update(render(completeProjection));
      });
      expect(snapshots.at(-1)).toBe(partialProjection);

      await act(async () => {
        vi.advanceTimersByTime(15);
      });
      expect(snapshots.at(-1)).toBe(partialProjection);

      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(snapshots.at(-1)).toBe(completeProjection);
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
    }
  });

  test("explicit append-only mode presents genuine accumulated snapshots", async () => {
    vi.useFakeTimers();

    const snapshots: string[] = [];
    let renderer: ReactTestRenderer | null = null;
    const render = (source: string) => (
      <StrictMode>
        <ModeProbe pending snapshots={snapshots} source={source} sourceMode="append-only" />
      </StrictMode>
    );

    try {
      await act(async () => {
        renderer = create(render("Alpha"));
      });
      await act(async () => {
        renderer?.update(render("Alpha."));
        renderer?.update(render("Alpha. genuine raw tail"));
      });
      expect(snapshots.at(-1)).toBe("Alpha");

      await act(async () => {
        vi.advanceTimersByTime(16);
      });
      expect(snapshots.at(-1)).toBe("Alpha. genuine raw tail");
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
    }
  });

  test("changing source mode recreates the buffer with current presentation state", async () => {
    vi.useFakeTimers();

    const snapshots: string[] = [];
    let renderer: ReactTestRenderer | null = null;
    const render = (source: string, sourceMode: StreamingPresentationSourceMode) => (
      <ModeProbe
        pending
        snapshots={snapshots}
        source={source}
        sourceMode={sourceMode}
      />
    );

    try {
      await act(async () => {
        renderer = create(render("Alpha tail", "append-only"));
      });
      await act(async () => {
        renderer?.update(render("Omega tail grows", "append-only"));
      });
      expect(snapshots.at(-1)).toBe("Alpha tail");

      await act(async () => {
        renderer?.update(render("Omega tail grows", "replaceable"));
      });
      await act(async () => {
        vi.advanceTimersByTime(16);
      });
      expect(snapshots.at(-1)).toBe("Omega tail grows");
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
    }
  });
});
