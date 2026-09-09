// @ts-nocheck
import { createElement, useState } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePromptEnhance } from "./use-prompt-enhance";
import { prepareChatPromptEnhancement, applyChatPromptEnhancement } from "./chat-prompt-enhance";

const { announce } = vi.hoisted(() => ({ announce: vi.fn() }));
vi.mock("@/components/ui/live-region", () => ({
  useAnnouncer: () => ({ announce }),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ORIGINAL = "Review the attached handoff and implement the worthwhile improvements.";
const ENHANCED = "Review the handoff against the current code, implement in-scope improvements, and verify them.";
const FIRST_TOKEN_BUDGET_MS = 30_000;
const GENERATION_BUDGET_MS = 120_000;
const PROJECT_ROOT = "/Users/example/Documents/GitHub/OpenCoven";
const PROJECT_CONTEXT = { activeProject: { name: "OpenCoven", root: PROJECT_ROOT } };

describe("prompt enhancement generation", () => {
  let renderer;
  let current;
  let editDraft;
  let streams;
  let fetchMock;

  function Probe({ context = null, overrideDraft = null }) {
    const [draft, setDraft] = useState(overrideDraft === null ? ORIGINAL : `/improve ${ORIGINAL}`);
    editDraft = setDraft;
    const enhance = usePromptEnhance({
      draft,
      setDraft,
      familiarId: "cody",
      mode: "code",
      context,
    });
    current = { draft, ...enhance };
    return createElement("button", { onClick: () => {
      if (overrideDraft !== null) {
        setDraft(overrideDraft);
        enhance.enhance("auto", overrideDraft);
      } else enhance.enhance();
    } }, "Enhance prompt");
  }

  beforeEach(() => {
    vi.useFakeTimers();
    announce.mockClear();
    streams = [];
    fetchMock = vi.fn(async (url, init) => {
      if (url === "/api/chat/stop") return Response.json({ ok: true });
      expect(url).toBe("/api/chat/generate/enhance");
      const body = new ReadableStream({
        start(controller) {
          const stream = {
            request: JSON.parse(init.body),
            signal: init.signal,
            frame: (frame) => controller.enqueue(
              new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`),
            ),
            close: () => controller.close(),
          };
          streams.push(stream);
          init.signal.addEventListener("abort", () => {
            controller.error(new DOMException("Aborted", "AbortError"));
          }, { once: true });
        },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    if (renderer) await act(async () => renderer.unmount());
    renderer = null;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function begin(context = null) {
    await act(async () => {
      renderer = create(createElement(Probe, { context }));
    });
    await act(async () => renderer.root.findByType("button").props.onClick());
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(streams).toHaveLength(1);
    expect(streams[0].request).toMatchObject({
      familiarId: "cody",
      permissionMode: "read",
      reasoningEffort: "low",
      responseSpeed: "fast",
    });
  }

  async function finish(stream = streams.at(-1), text = `<enhanced>${ENHANCED}</enhanced>`) {
    await act(async () => {
      stream.frame({ kind: "assistant_chunk", text });
      stream.frame({ kind: "done", sessionId: "enhancement-fixture" });
      stream.close();
    });
  }

  const stopRequests = () => fetchMock.mock.calls.filter(([url]) => url === "/api/chat/stop");

  it("keeps a changed alias and uses the original prefix only after explicit Apply", async () => {
    function CommandProbe() {
      const [draft, setDraft] = useState(`/img ${ORIGINAL}`);
      editDraft = setDraft;
      const prepared = prepareChatPromptEnhancement(draft, false);
      const enhance = usePromptEnhance({
        draft, sourceDraft: prepared.draft, setDraft, familiarId: "cody",
        mode: prepared.mode, context: null,
        transformEnhanced: (text) => applyChatPromptEnhancement(prepared, text),
      });
      current = { draft, ...enhance };
      return createElement("button", { onClick: () => enhance.enhance() }, "Enhance");
    }
    await act(async () => { renderer = create(createElement(CommandProbe)); });
    await act(async () => renderer.root.findByType("button").props.onClick());
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(streams).toHaveLength(1);
    await act(async () => editDraft(`/image ${ORIGINAL}`));
    await finish();
    expect(current.state.phase).toBe("suggested");
    expect(current.draft).toBe(`/image ${ORIGINAL}`);
    await act(async () => current.apply());
    expect(current.draft).toBe(`/img ${ENHANCED}`);
    await act(async () => current.revert());
    expect(current.draft).toBe(`/image ${ORIGINAL}`);
  });


  it("does not auto-apply, and reattaches the original prefix, when the slash command is deleted mid-run", async () => {
    // Regression for PRRT_kwDOSsT04M6gfvmL: the reviewer's exact scenario was
    // starting `/research foo` then deleting `/research ` while the stream
    // runs. Removing the command also changes `prepared.mode` (research ->
    // chat), which the existing context-fingerprint guard (see "discards
    // generation when the selected context changes" above) already treats as
    // a fingerprint change and cancels outright -- so the run is discarded,
    // never silently auto-applied with a lost prefix.
    function CommandProbe() {
      const [draft, setDraft] = useState(`/research ${ORIGINAL}`);
      editDraft = setDraft;
      const prepared = prepareChatPromptEnhancement(draft, false);
      const enhance = usePromptEnhance({
        draft, sourceDraft: prepared.draft, setDraft, familiarId: "cody",
        mode: prepared.mode, context: null,
        transformEnhanced: (text) => applyChatPromptEnhancement(prepared, text),
      });
      current = { draft, ...enhance };
      return createElement("button", { onClick: () => enhance.enhance() }, "Enhance");
    }
    await act(async () => { renderer = create(createElement(CommandProbe)); });
    await act(async () => renderer.root.findByType("button").props.onClick());
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(streams).toHaveLength(1);
    // The user deletes the whole "/research " prefix while the stream runs.
    await act(async () => editDraft(ORIGINAL));
    expect(current.state.phase).toBe("idle");
    expect(current.draft).toBe(ORIGINAL);
    expect(streams[0].signal.aborted).toBe(true);
    expect(stopRequests()).toHaveLength(1);
    // A fresh Enhance on the now-plain draft starts its own clean run rather
    // than resurrecting the discarded `/research` request.
    await act(async () => renderer.root.findByType("button").props.onClick());
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(streams).toHaveLength(2);
    await finish(streams[1]);
    expect(current.state).toMatchObject({ phase: "applied", original: ORIGINAL });
    expect(current.draft).toBe(ENHANCED);
    await act(async () => current.revert());
    expect(current.draft).toBe(ORIGINAL);
  });

  it("auto-applies an override queued with the composer edit in the same event", async () => {
    await act(async () => {
      renderer = create(createElement(Probe, { overrideDraft: ORIGINAL }));
    });
    await act(async () => renderer.root.findByType("button").props.onClick());
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(current.draft).toBe(ORIGINAL);
    expect(streams).toHaveLength(1);
    await finish();
    expect(current.state).toMatchObject({ phase: "applied", original: ORIGINAL });
    expect(current.draft).toBe(ENHANCED);
    await act(async () => current.revert());
    expect(current.draft).toBe(ORIGINAL);
  });

  it("keeps a healthy 19-second cold start alive and applies the model rewrite", async () => {
    await begin();
    // The reported run completed in 18,591 ms but was cancelled by the 8 s cutoff.
    await act(async () => vi.advanceTimersByTimeAsync(18_591));
    expect(stopRequests()).toHaveLength(0);
    expect(streams[0].signal.aborted).toBe(false);
    expect(current.state.phase).toBe("loading");
    await finish();
    expect(current.state).toMatchObject({ phase: "applied", original: ORIGINAL, offline: false });
    expect(current.draft).toBe(ENHANCED);
    await act(async () => current.revert());
    expect(current.draft).toBe(ORIGINAL);
    await act(async () => vi.advanceTimersByTimeAsync(GENERATION_BUDGET_MS));
    expect(stopRequests()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the labelled offline fallback only after the startup budget expires", async () => {
    await begin();
    await act(async () => vi.advanceTimersByTimeAsync(FIRST_TOKEN_BUDGET_MS - 1));
    expect(current.state.phase).toBe("loading");
    expect(stopRequests()).toHaveLength(0);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(current.state).toMatchObject({ phase: "applied", offline: true, original: ORIGINAL });
    expect(current.draft).toContain(ORIGINAL);
    expect(announce).toHaveBeenCalledWith("Prompt enhanced offline.", "polite");
    expect(stopRequests()).toHaveLength(1);
    expect(JSON.parse(stopRequests()[0][1].body).runId).toBe(streams[0].request.runId);
    expect(streams[0].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds a stream that starts but never finishes", async () => {
    await begin();
    await act(async () => {
      streams[0].frame({ kind: "assistant_chunk", text: "<enhanced>Review" });
    });
    await act(async () => vi.advanceTimersByTimeAsync(GENERATION_BUDGET_MS - 1));
    expect(current.state.phase).toBe("loading");
    expect(stopRequests()).toHaveLength(0);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(current.state).toMatchObject({ phase: "applied", offline: true });
    expect(stopRequests()).toHaveLength(1);
    expect(streams[0].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves edits made while a slow rewrite is pending", async () => {
    await begin();
    await act(async () => vi.advanceTimersByTimeAsync(18_591));
    await act(async () => editDraft("Keep my new constraint."));
    await finish();
    expect(current.draft).toBe("Keep my new constraint.");
    expect(current.state).toMatchObject({ phase: "suggested", enhanced: ENHANCED, offline: false });
    await act(async () => current.apply());
    expect(current.draft).toBe(ENHANCED);
    await act(async () => current.revert());
    expect(current.draft).toBe("Keep my new constraint.");
  });

  it("applies a rewrite that retains the composer project path", async () => {
    await begin(PROJECT_CONTEXT);
    const enhanced = `Use \`${PROJECT_ROOT}\` as project context. ${ENHANCED}`;
    await finish(streams[0], `<enhanced>${enhanced}</enhanced>`);
    expect(current.state).toMatchObject({ phase: "applied", offline: false });
    expect(current.draft).toBe(enhanced);
  });

  it("can use the offline fallback with a long project path", async () => {
    await begin(PROJECT_CONTEXT);
    await act(async () => vi.advanceTimersByTimeAsync(FIRST_TOKEN_BUDGET_MS));
    expect(current.state).toMatchObject({ phase: "applied", offline: true });
    expect(current.draft).toContain(PROJECT_ROOT);
    expect(current.draft).toContain(ORIGINAL);
  });

  it("uses the current selected file paths when parsing a new generation", async () => {
    await begin({ selectedFiles: [`${PROJECT_ROOT}/before.ts`] });
    await act(async () => current.cancel());
    const selectedFile = `${PROJECT_ROOT}/src/components/composer.tsx`;
    await act(async () => {
      renderer.update(createElement(Probe, { context: { selectedFiles: [selectedFile] } }));
    });
    await act(async () => renderer.root.findByType("button").props.onClick());
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(streams).toHaveLength(2);
    const enhanced = `Review \`${selectedFile}\`. ${ENHANCED}`;
    await finish(streams[1], `<enhanced>${enhanced}</enhanced>`);
    expect(current.state).toMatchObject({ phase: "applied", offline: false });
    expect(current.draft).toBe(enhanced);
  });

  it("cancels when switching between long project paths", async () => {
    await begin(PROJECT_CONTEXT);
    await act(async () => {
      renderer.update(createElement(Probe, {
        context: { activeProject: { name: "OpenCoven", root: `${PROJECT_ROOT}/other` } },
      }));
    });
    expect(streams[0].signal.aborted).toBe(true);
    expect(current.state.phase).toBe("idle");
    expect(current.draft).toBe(ORIGINAL);
  });

  it("does not treat empty assistant chunks as a first token", async () => {
    await begin();
    await act(async () => streams[0].frame({ kind: "assistant_chunk", text: "" }));
    await act(async () => vi.advanceTimersByTimeAsync(FIRST_TOKEN_BUDGET_MS));
    expect(current.state).toMatchObject({ phase: "applied", offline: true });
    expect(stopRequests()).toHaveLength(1);
  });

  it("cancels immediately without applying a fallback or leaving timers", async () => {
    await begin();
    await act(async () => current.cancel());
    expect(current.state.phase).toBe("idle");
    expect(current.draft).toBe(ORIGINAL);
    expect(stopRequests()).toHaveLength(1);
    expect(streams[0].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("discards generation when the selected context changes", async () => {
    await begin({ selectedFiles: ["before.ts"] });
    await act(async () => {
      renderer.update(createElement(Probe, { context: { selectedFiles: ["after.ts"] } }));
    });
    expect(current.state.phase).toBe("idle");
    expect(current.draft).toBe(ORIGINAL);
    expect(streams[0].signal.aborted).toBe(true);
    expect(stopRequests()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("still rejects malformed model output after its single retry", async () => {
    await begin();
    await finish(streams[0], "This is an answer, not a framed rewrite.");
    expect(streams).toHaveLength(2);
    await finish(streams[1], "<enhanced>Unfinished");
    expect(current.state.phase).toBe("error");
    expect(current.draft).toBe(ORIGINAL);
    expect(vi.getTimerCount()).toBe(0);
  });
});
