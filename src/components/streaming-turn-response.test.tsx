// @ts-nocheck — react-test-renderer ships no types; matches the repository convention.
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

import type { StreamingTurnViewModel } from "@/lib/streaming-turn-view-model";
import { StreamingTurnResponse } from "./streaming-turn-response";

vi.mock("./message-bubble", () => ({
  ProgressiveMarkdownBlock: ({
    text,
    pending,
    showCaret,
  }: {
    text: string;
    pending?: boolean;
    showCaret?: boolean;
  }) => (
    <span
      data-progressive-markdown={true}
      data-pending={pending || undefined}
      data-show-caret={showCaret}
    >
      {text}
      {pending && showCaret !== false ? (
        <span aria-hidden={true} data-stream-caret={true} />
      ) : null}
    </span>
  ),
}));

vi.mock("@/lib/icon", () => ({
  Icon: ({ name }: { name: string }) => <span aria-hidden={true} data-icon={name} />,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const firstActivity = {
  id: "tool:1",
  label: "Running focused tests…",
  state: "running" as const,
  source: "tool" as const,
};

function model(overrides: Partial<StreamingTurnViewModel> = {}): StreamingTurnViewModel {
  return {
    committedBlocks: [
      {
        id: "t:0-5",
        kind: "markdown",
        source: "Done\n\n",
        renderMode: "markdown",
      },
    ],
    activeBlock: {
      id: "t:6-10",
      kind: "markdown",
      source: "More",
      renderMode: "markdown",
    },
    committedText: "Done\n\n",
    activity: [firstActivity],
    currentActivity: firstActivity,
    results: [],
    status: "answering",
    emptySuccessful: false,
    ...overrides,
  };
}

async function render(
  element: React.ReactElement,
): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | null = null;
  await act(async () => {
    renderer = create(element);
  });
  return renderer!;
}

function response(
  props: Partial<React.ComponentProps<typeof StreamingTurnResponse>> = {},
) {
  return (
    <StreamingTurnResponse
      turnId="t"
      familiarName="Nova"
      model={model()}
      density="full"
      {...props}
    />
  );
}

function buttons(renderer: ReactTestRenderer, ariaLabel?: string): ReactTestInstance[] {
  return renderer.root.findAll(
    (node) =>
      node.type === "button" &&
      (ariaLabel === undefined || node.props["aria-label"] === ariaLabel),
  );
}

describe("StreamingTurnResponse", () => {
  it("keeps committed block identity when the active block changes and renders one live caret", async () => {
    const renderer = await render(response());
    const before = renderer.root.findByProps({ "data-stream-block-id": "t:0-5" });

    await act(async () => {
      renderer.update(
        response({
          model: model({
            activeBlock: {
              id: "t:6-14",
              kind: "markdown",
              source: "More words",
              renderMode: "markdown",
            },
          }),
        }),
      );
    });

    expect(renderer.root.findByProps({ "data-stream-block-id": "t:0-5" })).toBe(before);
    expect(renderer.root.findAllByProps({ "data-stream-caret": true })).toHaveLength(1);
  });

  it("keeps unsafe live markdown as plain React text outside the Markdown parser", async () => {
    const unsafeSource = "<script>alert('no')</script>\n| incomplete";
    const renderer = await render(
      response({
        model: model({
          activeBlock: {
            id: "t:unsafe",
            kind: "markdown",
            source: unsafeSource,
            renderMode: "plain",
          },
        }),
      }),
    );

    const active = renderer.root.findByProps({ "data-stream-block-id": "t:unsafe" });
    expect(active.props.className).toContain("whitespace-pre-wrap");
    expect(active.findAllByProps({ "data-progressive-markdown": true })).toHaveLength(0);
    expect(active.children).toContain(unsafeSource);
    expect(active.findAllByProps({ "data-stream-caret": true })).toHaveLength(1);
  });

  it("renders Results only when nonempty and names every row with its state word", async () => {
    const empty = await render(response());
    expect(empty.root.findAllByProps({ "data-turn-results": true })).toHaveLength(0);

    const results = [
      { id: "queued", label: "Queued check", state: "pending", source: "familiar" },
      { id: "running", label: "Focused tests", state: "running", source: "verified-event" },
      { id: "passed", label: "Typecheck", state: "passed", source: "verified-event" },
      { id: "attention", label: "Visual check", state: "attention", source: "familiar" },
      { id: "failed", label: "Production build", state: "failed", source: "verified-event" },
    ] as const;
    const renderer = await render(response({ model: model({ results: [...results] }) }));

    expect(renderer.root.findAllByProps({ "data-turn-results": true })).toHaveLength(1);
    for (const [label, word] of [
      ["Queued check", "pending"],
      ["Focused tests", "running"],
      ["Typecheck", "passed"],
      ["Visual check", "needs attention"],
      ["Production build", "failed"],
    ]) {
      expect(renderer.root.findByProps({ "aria-label": `${label} — ${word}` })).toBeTruthy();
    }
  });

  it("starts settled activity collapsed and preserves the user's disclosure choice", async () => {
    const renderer = await render(
      response({
        model: model({ status: "complete", activeBlock: null }),
        activityDetails: <div>Activity detail</div>,
      }),
    );
    let disclosure = renderer.root.findByProps({ "data-turn-activity": true });
    expect(disclosure.props.open).toBeUndefined();
    expect(disclosure.findByType("summary").children.join("")).toBe("View activity · 1 update");

    await act(async () => {
      disclosure.props.onToggle({ currentTarget: { open: true } });
    });
    expect(renderer.root.findByProps({ "data-turn-activity": true }).props.open).toBe(true);

    const secondActivity = {
      id: "progress:2",
      label: "Reviewing the final changes…",
      state: "complete" as const,
      source: "progress" as const,
    };
    await act(async () => {
      renderer.update(
        response({
          model: model({
            status: "complete",
            activeBlock: null,
            activity: [firstActivity, secondActivity],
            currentActivity: secondActivity,
          }),
          activityDetails: <div>Updated activity detail</div>,
        }),
      );
    });

    disclosure = renderer.root.findByProps({ "data-turn-activity": true });
    expect(disclosure.props.open).toBe(true);
    expect(disclosure.findByType("summary").children.join("")).toBe("View activity · 2 updates");
  });

  it("closes on the first completion transition when the disclosure was untouched", async () => {
    const renderer = await render(
      response({
        model: model({ status: "working" }),
        activityDetails: <div>Activity detail</div>,
      }),
    );
    expect(renderer.root.findByProps({ "data-turn-activity": true }).props.open).toBe(true);

    await act(async () => {
      renderer.update(
        response({
          model: model({ status: "complete", activeBlock: null }),
          activityDetails: <div>Activity detail</div>,
        }),
      );
    });

    expect(renderer.root.findByProps({ "data-turn-activity": true }).props.open).toBeUndefined();
  });

  it("starts compact activity collapsed while working", async () => {
    const renderer = await render(
      response({
        density: "compact",
        model: model({ status: "working" }),
        activityDetails: <div>Activity detail</div>,
      }),
    );

    expect(renderer.root.findByProps({ "data-turn-activity": true }).props.open).toBeUndefined();
  });

  it("gates Stop, streaming Copy, Continue, and Retry by lifecycle and capability", async () => {
    const live = await render(
      response({
        onStop: vi.fn(),
        onCopyCompleted: vi.fn(),
      }),
    );
    expect(buttons(live, "Stop response")).toHaveLength(1);
    expect(buttons(live, "Copy completed text")).toHaveLength(1);
    expect(buttons(live, "Continue response")).toHaveLength(0);
    expect(buttons(live, "Retry response")).toHaveLength(0);

    const liveWithoutCallbacks = await render(response({ onStop: undefined, onCopyCompleted: undefined }));
    expect(buttons(liveWithoutCallbacks)).toHaveLength(0);

    const completed = await render(
      response({
        model: model({ status: "complete", activeBlock: null }),
        onStop: vi.fn(),
        onCopyCompleted: vi.fn(),
        canContinue: true,
        onContinue: vi.fn(),
        onRetry: vi.fn(),
      }),
    );
    expect(buttons(completed)).toHaveLength(0);

    const interruptedWithoutCapability = await render(
      response({
        model: model({ status: "interrupted", activeBlock: null }),
        canContinue: false,
        onContinue: vi.fn(),
      }),
    );
    expect(buttons(interruptedWithoutCapability, "Continue response")).toHaveLength(0);

    const interrupted = await render(
      response({
        model: model({ status: "interrupted", activeBlock: null }),
        canContinue: true,
        onContinue: vi.fn(),
      }),
    );
    expect(buttons(interrupted, "Continue response")).toHaveLength(1);

    const failedWithoutHandler = await render(
      response({ model: model({ status: "failed", activeBlock: null }) }),
    );
    expect(buttons(failedWithoutHandler, "Retry response")).toHaveLength(0);

    const failed = await render(
      response({
        model: model({ status: "failed", activeBlock: null }),
        onRetry: vi.fn(),
      }),
    );
    expect(buttons(failed, "Retry response")).toHaveLength(1);

    for (const button of [
      ...buttons(live),
      ...buttons(interrupted),
      ...buttons(failed),
    ]) {
      expect(button.props.className).toContain("focus-ring");
    }
  });

  it("distinguishes failed and interrupted state copy from completed responses", async () => {
    const failed = await render(
      response({ model: model({ status: "failed", activeBlock: null }) }),
    );
    expect(JSON.stringify(failed.toJSON())).toContain("Response failed");
    expect(JSON.stringify(failed.toJSON())).not.toContain("Response stopped");

    const interrupted = await render(
      response({ model: model({ status: "interrupted", activeBlock: null }) }),
    );
    expect(JSON.stringify(interrupted.toJSON())).toContain("Response stopped");
    expect(JSON.stringify(interrupted.toJSON())).not.toContain("Response failed");

    const completed = await render(
      response({ model: model({ status: "complete", activeBlock: null }) }),
    );
    expect(completed.root.findAllByProps({ "data-turn-state": true })).toHaveLength(0);
    expect(JSON.stringify(completed.toJSON())).not.toContain("Response failed");
    expect(JSON.stringify(completed.toJSON())).not.toContain("Response stopped");
  });

  it("uses the supplied familiar name with working and responding phase copy", async () => {
    const working = await render(
      response({ familiarName: "Sage", model: model({ status: "working" }) }),
    );
    expect(JSON.stringify(working.toJSON())).toContain("Sage is working");

    const answering = await render(
      response({ familiarName: "Echo", model: model({ status: "answering" }) }),
    );
    expect(JSON.stringify(answering.toJSON())).toContain("Echo is responding");
  });

  it("renders one current activity line before prose, results, state, supplementary content, and disclosure", async () => {
    const renderer = await render(
      response({
        model: model({
          results: [
            {
              id: "tests",
              label: "Focused tests",
              state: "running",
              source: "verified-event",
            },
          ],
        }),
        supplementaryContent: <aside data-supplementary={true}>Supplementary</aside>,
        activityDetails: <div>Activity detail</div>,
      }),
    );

    expect(renderer.root.findAllByProps({ "data-turn-current-activity": true })).toHaveLength(1);
    expect(
      renderer.root.findByProps({ "data-turn-current-activity": true }).children.join(""),
    ).toBe("Running focused tests…");

    const root = renderer.toJSON();
    const directChildren = root.children.filter((child) => typeof child !== "string");
    expect(
      directChildren.map(
        (child) =>
          child.props.className ??
          (child.props["data-supplementary"] ? "supplementary" : undefined),
      ),
    ).toEqual([
      "streaming-turn-current",
      "streaming-turn-prose",
      "streaming-turn-results",
      "supplementary",
      "streaming-turn-activity",
    ]);
  });
});
