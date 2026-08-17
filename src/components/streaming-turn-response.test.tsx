// @ts-nocheck — react-test-renderer ships no types; matches the repository convention.
import { Children, isValidElement, type ReactNode } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { shouldUseEmptySuccessfulFallback, type MeaningfulAssistantOutputInput } from "@/lib/chat-assistant-output";
import type { ChatResponseMetadata } from "@/lib/chat-response-metadata";
import { partitionStreamingMarkdown } from "@/lib/streaming-markdown-blocks";
import type { StreamingTurnViewModel } from "@/lib/streaming-turn-view-model";
import { OverflowMenu } from "./ui/overflow-menu";
import { MessageBubble, ProgressiveMarkdownBlock } from "./message-bubble";
import { StreamingMarkdownBlocks } from "./streaming-markdown-blocks";
import { StreamingTurnResponse } from "./streaming-turn-response";

const markdownRenderer = vi.hoisted(() => ({
  blocked: false,
  renderAsync: vi.fn((blocks: unknown[]) => {
    if (markdownRenderer.blocked) return new Promise<string>(() => {});
    const text = blocks
      .flatMap((block) => {
        if (!block || typeof block !== "object" || !("content" in block)) return [];
        const content = (block as { content?: Array<{ text?: string }> }).content;
        return content?.map((span) => span.text ?? "") ?? [];
      })
      .join("");
    return Promise.resolve(`<div class="cm-preview"><p>${text}</p></div>`);
  }),
}));

const clipboard = vi.hoisted(() => ({
  copyText: vi.fn(async () => true),
}));

const markdownDomWiring = vi.hoisted(() => ({
  calls: [] as Array<[string | null, ((url: string) => void) | undefined]>,
}));

const responseDecorator = vi.hoisted(() => ({
  decorate: vi.fn((html: string) =>
    html.replace(
      "[DONE]",
      '<span class="cave-response-status" aria-label="Status: done">[DONE]</span>',
    ),
  ),
}));

vi.mock("@/lib/markdown-preview", () => ({
  loadMarkdownPreview: async () => ({ renderAsync: markdownRenderer.renderAsync }),
}));

vi.mock("@/lib/html-sanitize", () => ({
  sanitizeHtml: (html: string) => html,
}));

vi.mock("@/lib/response-status-tokens", () => ({
  decorateResponseHtml: responseDecorator.decorate,
}));

vi.mock("@/lib/clipboard", () => ({
  copyText: clipboard.copyText,
}));

vi.mock("./message-dom-wiring", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./message-dom-wiring")>();
  return {
    ...actual,
    useWireCopyButtons: (
      html: string | null,
      onOpenUrl?: (url: string) => void,
    ) => {
      markdownDomWiring.calls.push([html, onOpenUrl]);
      return { current: null };
    },
  };
});

vi.mock("@/components/ui/citation", () => ({
  InlineCitationPreviews: ({
    citations,
  }: {
    citations: Array<{ title: string; url?: string }>;
  }) => (
    <span
      data-inline-citations={citations.length}
      data-citation-title={citations[0]?.title}
      data-citation-url={citations[0]?.url}
    />
  ),
}));

vi.mock("next/dynamic", () => ({
  default: () =>
    function MockDynamicMessageReader({ text }: { text: string }) {
      return <div data-message-reader={true} data-reader-text={text} />;
    },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  markdownRenderer.blocked = false;
  markdownRenderer.renderAsync.mockClear();
  clipboard.copyText.mockClear();
  markdownDomWiring.calls.length = 0;
  responseDecorator.decorate.mockClear();
});

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

function chatSurfaceResponse(
  options: {
    content?: string;
    model?: StreamingTurnViewModel;
    proseContent?: ReactNode;
    supplementaryContent?: ReactNode;
    activityDetails?: ReactNode;
    responseMetadata?: ChatResponseMetadata;
    guard?: Partial<MeaningfulAssistantOutputInput>;
  } = {},
) {
  const surfaceModel = options.model ?? model({ status: "complete", activeBlock: null, emptySuccessful: true, committedText: "" });
  const showEmptySuccessfulFallback = shouldUseEmptySuccessfulFallback({
    emptySuccessful: surfaceModel.emptySuccessful,
    visibleProse: options.guard?.visibleProse ?? options.content ?? "",
    hasRichBlocks: options.guard?.hasRichBlocks ?? false,
    resultCount: options.guard?.resultCount ?? surfaceModel.results.length,
    attachmentCount: options.guard?.attachmentCount ?? 0,
    skillUpdateCount: options.guard?.skillUpdateCount ?? 0,
    hasAutoStatusUpdate: options.guard?.hasAutoStatusUpdate ?? false,
    editCardCount: options.guard?.editCardCount ?? 0,
    followUpCount: options.guard?.followUpCount ?? 0,
    hasAttentionRequest: options.guard?.hasAttentionRequest ?? Boolean(options.responseMetadata?.attentionRequest),
  });

  return (
    <MessageBubble
      role="assistant"
      content={options.content ?? ""}
      isError={showEmptySuccessfulFallback}
      assistantBody={
        showEmptySuccessfulFallback ? (
          <>
            {options.supplementaryContent}
            {options.activityDetails}
          </>
        ) : (
          <StreamingTurnResponse
            turnId="t"
            familiarName="Nova"
            model={surfaceModel}
            density="full"
            proseContent={options.proseContent}
            supplementaryContent={options.supplementaryContent}
            activityDetails={options.activityDetails}
          />
        )
      }
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

function textContent(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : textContent(child)))
    .join("");
}

function routineResponseMetadata(
  overrides: Partial<ChatResponseMetadata> = {},
): ChatResponseMetadata {
  return {
    familiarId: "nova",
    harness: "openclaw",
    model: "anthropic/claude-sonnet-4-6",
    runtime: "local:/Users/buns/Documents/GitHub/OpenCoven/coven-cave",
    requestedModel: "anthropic/claude-sonnet-4-6",
    desiredModel: "anthropic/claude-sonnet-4-6",
    confirmedModel: "anthropic/claude-sonnet-4-6",
    modelSource: "runtime-default",
    requestedControls: { reasoning: "medium" },
    forwardedControls: { reasoning: "medium" },
    appliedControls: { reasoning: "medium" },
    ...overrides,
  };
}

function renderedMarkdown(node: ReactTestInstance): string {
  return node
    .findAll((child) => child.props.dangerouslySetInnerHTML !== undefined)
    .map((child) => child.props.dangerouslySetInnerHTML.__html)
    .join("");
}

async function flushMarkdown(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
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

  it("does not rerender an unchanged committed block when fresh partitions update the active block", async () => {
    markdownRenderer.blocked = true;
    const renderer = await render(response());
    markdownDomWiring.calls.length = 0;

    await act(async () => {
      renderer.update(
        response({
          model: model({
            committedBlocks: [
              {
                id: "t:0-5",
                kind: "markdown",
                source: "Done\n\n",
                renderMode: "markdown",
              },
            ],
            activeBlock: {
              id: "t:6-15",
              kind: "markdown",
              source: "More words",
              renderMode: "markdown",
            },
          }),
        }),
      );
    });

    expect(markdownDomWiring.calls).toHaveLength(1);
  });

  it("rerenders each list item once for value changes and the live-to-committed transition", async () => {
    markdownRenderer.blocked = true;
    const activeList = {
      id: "t:0-list",
      kind: "list" as const,
      ordered: false,
      committedItems: [{ id: "t:0-item-0", source: "- one\n" }],
      activeItem: { id: "t:0-item-1", source: "- two" },
      source: "- one\n- two",
    };
    const renderer = await render(
      response({
        model: model({
          committedBlocks: [],
          activeBlock: activeList,
          committedText: "- one\n",
        }),
      }),
    );
    markdownDomWiring.calls.length = 0;

    const updatedList = {
      ...activeList,
      activeItem: { ...activeList.activeItem, source: "- two updated" },
      source: "- one\n- two updated",
    };
    await act(async () => {
      renderer.update(
        response({
          model: model({
            committedBlocks: [],
            activeBlock: updatedList,
            committedText: "- one\n",
          }),
        }),
      );
    });
    expect(markdownDomWiring.calls).toHaveLength(2);

    markdownDomWiring.calls.length = 0;
    const committedList = {
      ...updatedList,
      committedItems: [
        ...updatedList.committedItems,
        { id: updatedList.activeItem.id, source: "- two updated" },
      ],
      activeItem: undefined,
    };
    await act(async () => {
      renderer.update(
        response({
          model: model({
            status: "complete",
            committedBlocks: [committedList],
            activeBlock: null,
            committedText: updatedList.source,
          }),
        }),
      );
    });

    expect(markdownDomWiring.calls).toHaveLength(2);
    expect(renderer.root.findAllByProps({ "data-stream-caret": true })).toHaveLength(0);

    markdownDomWiring.calls.length = 0;
    await act(async () => {
      renderer.update(
        response({
          model: model({
            status: "complete",
            committedBlocks: [{
              ...committedList,
              committedItems: committedList.committedItems.map((item) => ({ ...item })),
            }],
            activeBlock: null,
            committedText: updatedList.source,
          }),
        }),
      );
    });
    expect(markdownDomWiring.calls).toHaveLength(0);
  });

  it("keeps an active list and item host mounted when the item settles", async () => {
    markdownRenderer.blocked = true;
    const activeList = {
      id: "t:0-list",
      kind: "list" as const,
      ordered: false,
      committedItems: [{ id: "t:0-item-0", source: "- one\n" }],
      activeItem: { id: "t:0-item-1", source: "- two" },
      source: "- one\n- two",
    };
    const renderer = await render(
      response({
        model: model({
          committedBlocks: [],
          activeBlock: activeList,
          committedText: "- one\n",
        }),
      }),
    );
    const listBefore = renderer.root.findByProps({ "data-stream-block-id": activeList.id });
    const itemBefore = renderer.root.findByProps({
      "data-stream-list-item-id": activeList.activeItem.id,
    });

    await act(async () => {
      renderer.update(
        response({
          model: model({
            status: "complete",
            committedBlocks: [
              {
                ...activeList,
                committedItems: [
                  ...activeList.committedItems,
                  { id: activeList.activeItem.id, source: "- two\n" },
                ],
                activeItem: undefined,
                source: "- one\n- two\n",
              },
            ],
            activeBlock: null,
            committedText: "- one\n- two\n",
          }),
        }),
      );
    });

    const listAfter = renderer.root.findByProps({ "data-stream-block-id": activeList.id });
    const itemAfter = renderer.root.findByProps({
      "data-stream-list-item-id": activeList.activeItem.id,
    });
    expect(listAfter).toBe(listBefore);
    expect(itemAfter).toBe(itemBefore);
    expect(textContent(itemAfter)).toBe("two");
  });

  it("removes the marker and trailing separator from committed list-item text", async () => {
    markdownRenderer.blocked = true;
    const renderer = await render(
      response({
        model: model({
          status: "complete",
          committedBlocks: [
            {
              id: "t:0-list",
              kind: "list",
              ordered: false,
              committedItems: [{ id: "t:0-item-0", source: "- committed item\n" }],
              source: "- committed item\n",
            },
          ],
          activeBlock: null,
          committedText: "- committed item\n",
        }),
      }),
    );

    expect(
      textContent(
        renderer.root.findByProps({ "data-stream-list-item-id": "t:0-item-0" }),
      ),
    ).toBe("committed item");
  });

  it("preserves checked and unchecked task-list semantics for committed and active items", async () => {
    markdownRenderer.blocked = true;
    const renderer = await render(
      response({
        model: model({
          committedBlocks: [],
          activeBlock: {
            id: "t:0-list",
            kind: "list",
            ordered: false,
            committedItems: [{ id: "t:0-item-0", source: "- [x] done\n" }],
            activeItem: { id: "t:0-item-1", source: "- [ ] todo" },
            source: "- [x] done\n- [ ] todo",
          },
          committedText: "- [x] done\n",
        }),
      }),
    );

    const checked = renderer.root.findByProps({
      "data-stream-list-item-id": "t:0-item-0",
    });
    const unchecked = renderer.root.findByProps({
      "data-stream-list-item-id": "t:0-item-1",
    });
    const checkedInput = checked.findByType("input");
    const uncheckedInput = unchecked.findByType("input");

    expect(checked.props.className).toContain("task-list-item");
    expect(checkedInput.props).toMatchObject({
      type: "checkbox",
      checked: true,
      disabled: true,
      "aria-label": "Completed task: done",
    });
    expect(uncheckedInput.props).toMatchObject({
      type: "checkbox",
      checked: false,
      disabled: true,
      "aria-label": "Incomplete task: todo",
    });
    expect(textContent(checked)).toBe("done");
    expect(textContent(unchecked)).toBe("todo");
    expect(checked.findAllByType("ul")).toHaveLength(0);
    expect(unchecked.findAllByType("ul")).toHaveLength(0);
  });

  it("uses the real progressive Markdown path to gate fallback and rendered cursors", async () => {
    markdownRenderer.blocked = true;
    const fallback = await render(
      <div>
        <div data-caret-case="fallback-default">
          <ProgressiveMarkdownBlock text="Fallback default" pending />
        </div>
        <div data-caret-case="fallback-suppressed">
          <ProgressiveMarkdownBlock text="Fallback suppressed" pending showCaret={false} />
        </div>
      </div>,
    );
    expect(
      textContent(fallback.root.findByProps({ "data-caret-case": "fallback-default" })),
    ).toBe("Fallback default▌");
    expect(
      textContent(fallback.root.findByProps({ "data-caret-case": "fallback-suppressed" })),
    ).toBe("Fallback suppressed");

    markdownRenderer.blocked = false;
    const rendered = await render(
      <div>
        <div data-caret-case="rendered-default">
          <ProgressiveMarkdownBlock text="Rendered default" pending />
        </div>
        <div data-caret-case="rendered-suppressed">
          <ProgressiveMarkdownBlock text="Rendered suppressed" pending showCaret={false} />
        </div>
      </div>,
    );
    await flushMarkdown();

    expect(
      rendered.root
        .findByProps({ "data-caret-case": "rendered-default" })
        .findAllByProps({ "aria-label": "Familiar is writing" }),
    ).toHaveLength(1);
    expect(
      rendered.root
        .findByProps({ "data-caret-case": "rendered-suppressed" })
        .findAllByProps({ "aria-label": "Familiar is writing" }),
    ).toHaveLength(0);
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

  it("preserves an explicit user disclosure choice across working to complete", async () => {
    const renderer = await render(
      response({
        model: model({ status: "working" }),
        activityDetails: <div>Activity detail</div>,
      }),
    );
    let disclosure = renderer.root.findByProps({ "data-turn-activity": true });
    expect(disclosure.props.open).toBe(true);
    expect(disclosure.findByType("summary").children.join("")).toBe("View activity · 1 update");

    await act(async () => {
      disclosure.findByType("summary").props.onClick();
      disclosure.props.onToggle({ currentTarget: { open: false } });
    });
    expect(renderer.root.findByProps({ "data-turn-activity": true }).props.open).toBeUndefined();

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
    expect(disclosure.props.open).toBeUndefined();
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

  it("renders ordered rich prose once before Results instead of the raw fallback source", async () => {
    const rawSource = [
      "Opening prose",
      '<coven:github kind="issue" repo="OpenCoven/coven-cave" number="42" />',
      "Middle prose",
      "```coven-spec",
      "raw-spec-source-should-not-render",
      "```",
      "Closing prose",
    ].join("\n");
    const orderedProse = [
      <ProgressiveMarkdownBlock key="opening" text="Opening prose" />,
      <div key="github" className="my-2" data-ordered-step="github-card">
        GitHub card
      </div>,
      <ProgressiveMarkdownBlock key="middle" text="Middle prose" />,
      <div key="spec" className="my-2" data-ordered-step="spec-card">
        Spec card
      </div>,
      <ProgressiveMarkdownBlock key="closing" text="Closing prose" />,
    ];
    const settledModel = model({
      status: "complete",
      committedBlocks: [{
        id: "t:raw",
        kind: "markdown",
        source: rawSource,
        renderMode: "markdown",
      }],
      activeBlock: null,
      committedText: rawSource,
      results: [{
        id: "tests",
        label: "Focused tests",
        state: "passed",
        source: "verified-event",
      }],
    });
    const renderer = await render(
      <MessageBubble
        role="assistant"
        content={rawSource}
        assistantBody={
          <StreamingTurnResponse
            turnId="t"
            familiarName="Nova"
            model={settledModel}
            density="full"
            proseContent={orderedProse}
          />
        }
      />,
    );
    await flushMarkdown();

    expect(renderer.root.findAllByType(StreamingMarkdownBlocks)).toHaveLength(0);
    const serialized = JSON.stringify(renderer.toJSON());
    const orderedTokens = [
      "Opening prose",
      "GitHub card",
      "Middle prose",
      "Spec card",
      "Closing prose",
    ];
    for (const token of orderedTokens) {
      expect(serialized.split(token)).toHaveLength(2);
    }
    for (let index = 1; index < orderedTokens.length; index += 1) {
      expect(serialized.indexOf(orderedTokens[index - 1])).toBeLessThan(
        serialized.indexOf(orderedTokens[index]),
      );
    }
    expect(serialized).not.toContain("raw-spec-source-should-not-render");
    expect(serialized.indexOf("Closing prose")).toBeLessThan(
      serialized.indexOf("streaming-turn-results"),
    );
  });

  it("keeps StreamingMarkdownBlocks when no ordered prose override is supplied", async () => {
    const renderer = await render(
      response({ model: model({ status: "complete", activeBlock: null }) }),
    );

    expect(renderer.root.findAllByType(StreamingMarkdownBlocks)).toHaveLength(1);
  });

  it("lets assistantBody replace only prose while preserving MessageBubble sources and actions", async () => {
    const content = "Original **answer** for copy and reader";
    const onRegenerate = vi.fn();
    const renderer = await render(
      <MessageBubble
        role="assistant"
        content={content}
        assistantBody={<section data-assistant-body={true}>Projected assistant body</section>}
        onRegenerate={onRegenerate}
      />,
    );
    const body = renderer.root.find(
      (node) => node.props.className === "cave-response-body",
    );
    expect(body.findAllByProps({ "data-assistant-body": true })).toHaveLength(1);
    expect(textContent(body)).toBe("Projected assistant body");

    const actions = renderer.root.findByProps({
      role: "group",
      "aria-label": "Response actions",
    });
    expect(actions.findAllByProps({ "aria-label": "Retry response" })).toHaveLength(1);
    expect(actions.findAll((node) => node.type === "button" && node.props["aria-expanded"] === true)).toHaveLength(1);
    expect(
      actions.findAll(
        (node) =>
          node.type === "button" && node.props["aria-label"] === "More response actions",
      ),
    ).toHaveLength(1);
    const copyButton = actions
      .findAllByType("button")
      .find((button) => textContent(button) === "Copy");
    expect(copyButton).toBeTruthy();
    await act(async () => {
      await copyButton!.props.onClick();
    });
    expect(clipboard.copyText).toHaveBeenCalledWith(content);

    const overflow = renderer.root.findByType(OverflowMenu);
    const openReader = Children.toArray(overflow.props.children).find(
      (child) => isValidElement(child) && child.props.children === "Open reader",
    );
    expect(openReader).toBeTruthy();
    await act(async () => {
      openReader!.props.onSelect();
    });
    expect(renderer.root.findByProps({ "data-message-reader": true }).props).toMatchObject({
      "data-reader-text": content,
    });

    const segmented = await render(
      <MessageBubble
        role="assistant"
        content="Segment prose"
        segments={[
          { kind: "text", text: "Segment prose" },
          {
            kind: "block",
            key: "settled-action",
            node: <aside data-segment-block={true}>Settled action</aside>,
          },
        ]}
      />,
    );
    await flushMarkdown();
    const segmentedBody = segmented.root.find(
      (node) => node.props.className === "cave-response-body",
    );
    expect(renderedMarkdown(segmentedBody)).toContain("Segment prose");
    expect(segmentedBody.findAllByProps({ "data-segment-block": true })).toHaveLength(1);

    const legacy = await render(
      <MessageBubble role="assistant" content="Legacy Markdown body" />,
    );
    await flushMarkdown();
    const legacyBody = legacy.root.find(
      (node) => node.props.className === "cave-response-body",
    );
    expect(renderedMarkdown(legacyBody)).toContain("Legacy Markdown body");
  });

  it("keeps the shared response for settled card-only turns instead of showing Response interrupted", async () => {
    const renderer = await render(chatSurfaceResponse({
      proseContent: <div data-shared-card={true}>GitHub card only</div>,
      guard: { hasRichBlocks: true },
    }));

    expect(renderer.root.findAllByType(StreamingTurnResponse)).toHaveLength(1);
    expect(renderer.root.findAllByProps({ "data-shared-card": true })).toHaveLength(1);
    expect(JSON.stringify(renderer.toJSON())).not.toContain("Response interrupted");
  });

  it("keeps the shared response for settled result-only turns instead of showing Response interrupted", async () => {
    const renderer = await render(chatSurfaceResponse({
      model: model({
        status: "complete",
        activeBlock: null,
        committedText: "",
        emptySuccessful: true,
        results: [{
          id: "tests",
          label: "Focused tests",
          state: "passed",
          source: "verified-event",
        }],
      }),
      guard: { resultCount: 1 },
    }));

    expect(renderer.root.findAllByType(StreamingTurnResponse)).toHaveLength(1);
    expect(renderer.root.findAllByProps({ "data-turn-results": true })).toHaveLength(1);
    expect(textContent(renderer.root)).toContain("Focused tests");
    expect(JSON.stringify(renderer.toJSON())).not.toContain("Response interrupted");
  });

  it("keeps the shared response for settled attachment-only turns instead of showing Response interrupted", async () => {
    const renderer = await render(chatSurfaceResponse({
      supplementaryContent: <div data-attachment-output={true}>Attachment list</div>,
      guard: { attachmentCount: 1 },
    }));

    expect(renderer.root.findAllByType(StreamingTurnResponse)).toHaveLength(1);
    expect(renderer.root.findAllByProps({ "data-attachment-output": true })).toHaveLength(1);
    expect(JSON.stringify(renderer.toJSON())).not.toContain("Response interrupted");
  });

  it("keeps the shared response for restored durable attention-only turns instead of showing Response interrupted", async () => {
    const renderer = await render(chatSurfaceResponse({
      responseMetadata: routineResponseMetadata({
        attentionRequest: {
          sessionId: "session-1",
          turnId: "turn-1",
          requestedAt: "2026-08-17T13:00:00.000Z",
          reason: "approval",
        },
      }),
      supplementaryContent: <div data-durable-attention={true}>Awaiting approval</div>,
    }));

    expect(renderer.root.findAllByType(StreamingTurnResponse)).toHaveLength(1);
    expect(renderer.root.findAllByProps({ "data-durable-attention": true })).toHaveLength(1);
    expect(JSON.stringify(renderer.toJSON())).not.toContain("Response interrupted");
  });

  it("preserves the explicit empty-success fallback for truly empty completed turns with routine response metadata", async () => {
    const renderer = await render(chatSurfaceResponse({
      responseMetadata: routineResponseMetadata(),
      supplementaryContent: <div data-routine-metadata={true}>Effective model: sonnet-4-6</div>,
    }));

    expect(renderer.root.findAllByType(StreamingTurnResponse)).toHaveLength(0);
    expect(renderer.root.findAllByProps({ "data-routine-metadata": true })).toHaveLength(1);
    expect(textContent(renderer.root)).toContain("Response interrupted");
  });

  it("preserves the explicit empty-success fallback for truly empty settled turns", async () => {
    const renderer = await render(chatSurfaceResponse());

    expect(renderer.root.findAllByType(StreamingTurnResponse)).toHaveLength(0);
    expect(textContent(renderer.root)).toContain("Response interrupted");
  });

  it("inherits assistant Markdown URL, citation, and response-decoration integrations", async () => {
    const onOpenUrl = vi.fn();
    const content = [
      "Read [the guide](https://example.com/guide), then [DONE][^source].",
      "",
      '[^source]: https://example.com/source "Source title" — Preview excerpt',
    ].join("\n");
    const renderer = await render(
      <div>
        <div data-render-case="fallback">
          <MessageBubble role="assistant" content={content} pending onOpenUrl={onOpenUrl} />
        </div>
        <div data-render-case="assistant-body">
          <MessageBubble
            role="assistant"
            content={content}
            pending
            onOpenUrl={onOpenUrl}
            assistantBody={<ProgressiveMarkdownBlock text={content} pending />}
          />
        </div>
      </div>,
    );
    await flushMarkdown();

    const fallback = renderer.root.findByProps({ "data-render-case": "fallback" });
    const assistantBody = renderer.root.findByProps({ "data-render-case": "assistant-body" });
    expect(renderedMarkdown(assistantBody)).toBe(renderedMarkdown(fallback));
    expect(renderedMarkdown(assistantBody)).toContain('aria-label="Status: done"');
    expect(renderedMarkdown(assistantBody)).not.toContain("[^source]");
    expect(renderedMarkdown(assistantBody)).not.toContain("https://example.com/source");
    expect(JSON.stringify(markdownRenderer.renderAsync.mock.calls)).toContain("#cite-1");

    const citation = assistantBody.findByProps({ "data-inline-citations": 1 });
    expect(citation.props).toMatchObject({
      "data-citation-title": "Source title",
      "data-citation-url": "https://example.com/source",
    });

    const inheritedOpenUrl = markdownDomWiring.calls
      .map(([, handler]) => handler)
      .find((handler) => handler === onOpenUrl);
    expect(inheritedOpenUrl).toBe(onOpenUrl);
    inheritedOpenUrl!("https://example.com/guide");
    expect(onOpenUrl).toHaveBeenCalledWith("https://example.com/guide");
  });

  it("omits settled citation-only blocks while keeping citation previews on the prose block", async () => {
    const content = [
      "Read [the guide](https://example.com/guide), then [DONE][^source].",
      "",
      '[^source]: https://example.com/source "Source title" — Preview excerpt',
    ].join("\n");
    const partition = partitionStreamingMarkdown(content, { turnId: "t", settled: true });
    const citationOnlyBlockId = partition.committedBlocks.at(-1)?.id;

    expect(partition.committedBlocks).toHaveLength(2);
    expect(citationOnlyBlockId).toBeTruthy();

    const renderer = await render(
      <MessageBubble
        role="assistant"
        content={content}
        assistantBody={
          <StreamingMarkdownBlocks
            committedBlocks={partition.committedBlocks}
            activeBlock={partition.activeBlock}
            live={false}
          />
        }
      />,
    );
    await flushMarkdown();

    expect(textContent(renderer.root)).not.toContain("Rendering response");
    expect(renderedMarkdown(renderer.root)).toContain('aria-label="Status: done"');
    expect(renderedMarkdown(renderer.root)).not.toContain("[^source]");
    expect(renderedMarkdown(renderer.root)).not.toContain("https://example.com/source");
    expect(renderer.root.findAllByProps({ "data-inline-citations": 1 })).toHaveLength(1);
    expect(renderer.root.findByProps({ "data-inline-citations": 1 }).props).toMatchObject({
      "data-citation-title": "Source title",
      "data-citation-url": "https://example.com/source",
    });

    const citationOnlyBlock = renderer.root.findByProps({
      "data-stream-block-id": citationOnlyBlockId,
    });
    expect(renderedMarkdown(citationOnlyBlock)).toBe("");
    expect(textContent(citationOnlyBlock)).toBe("");
  });

  it("lets explicit ProgressiveMarkdownBlock props override assistant context", async () => {
    const inheritedOpenUrl = vi.fn();
    const explicitOpenUrl = vi.fn();
    const renderer = await render(
      <MessageBubble
        role="assistant"
        content={'Context[^source]\n\n[^source]: https://example.com/source "Context source"'}
        onOpenUrl={inheritedOpenUrl}
        assistantBody={
          <ProgressiveMarkdownBlock
            text="Explicit [DONE]"
            onOpenUrl={explicitOpenUrl}
            citations={[]}
            decorateResponse={false}
          />
        }
      />,
    );
    await flushMarkdown();

    expect(renderedMarkdown(renderer.root)).toContain("[DONE]");
    expect(renderedMarkdown(renderer.root)).not.toContain("Status: done");
    expect(renderer.root.findAllByProps({ "data-inline-citations": 0 })).toHaveLength(1);
    const handler = markdownDomWiring.calls
      .map(([, candidate]) => candidate)
      .find((candidate) => candidate === explicitOpenUrl);
    expect(handler).toBe(explicitOpenUrl);
    expect(responseDecorator.decorate).not.toHaveBeenCalled();
  });
});
