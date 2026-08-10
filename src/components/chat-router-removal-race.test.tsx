// @ts-nocheck — react-test-renderer ships no types; matches the convention
// in right-chat-panel-behavior.test.tsx and chat-title-sparkle-behavior.test.tsx.
//
// Behavioral proof of the cave-rl980 Task 4 final fix at the ChatRouter
// layer: archiveChat/deleteChat/setChatArchived/discardVoiceSessionIfEmpty
// are all async, so ChatView's onBack/onVoiceSessionDiscarded can arrive
// after the router has ALREADY navigated to a different session (a thread
// switch, or a familiar switch — both just move `view.sessionId` to a
// different value from ChatRouter's point of view). Both call sites must
// only actually navigate when the router is STILL displaying the exact
// session the completion names; a stale completion for an abandoned session
// must be a silent no-op instead of clobbering whatever the user is now
// looking at.
//
// ChatView itself is mocked to a thin capturing stub (982 real lines, heavy
// fetch/dictation/voice machinery unrelated to this router-level contract) —
// this suite is about ChatRouter's OWN view-state wiring, not ChatView's
// internals. Every other ChatRouter dependency that assumes a live `window`
// (project overrides, the mobile-viewport hook, sidebar persistence) or hits
// the network (useProjects) is stubbed the same way chat-sidebar-wiring.
// behavior.test.ts already does for this codebase (vi.stubGlobal("window",
// ...) + vi.stubGlobal("fetch", ...)), since no test here mounts jsdom.
//
// "Controllable promise", not a timing sleep: each scenario below opens a
// manual resolve/reject-free Promise standing in for the in-flight PATCH/
// DELETE request, switches the router to a different session while that
// promise is still pending, and only THEN resolves it — deterministically
// proving the switch truly preceded the completion, with no reliance on
// real timers.
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const chatView = vi.hoisted(() => ({
  latestProps: null as Record<string, unknown> | null,
}));

vi.mock("@/components/chat-view", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  const ChatView = forwardRef(function MockChatView(props: Record<string, unknown>, ref: unknown) {
    chatView.latestProps = props;
    useImperativeHandle(ref, () => ({
      clearTranscript: () => {},
      runSlash: () => {},
    }));
    return null;
  });
  return { ChatView, DEFAULT_CHAT_COMPOSER_DRAFT_KEY: "cave:chat-composer-draft:v1" };
});

vi.mock("@/components/chat-list", () => ({ ChatList: () => null }));
vi.mock("@/components/chat-project-sidebar", () => ({ ChatProjectSidebar: () => null }));
vi.mock("@/components/new-chat-launch", () => ({ NewChatLaunch: () => null }));
vi.mock("@/components/familiar-chatout-codex", () => ({ FamiliarChatoutCodexSurface: () => null }));
vi.mock("@/lib/feature-flags", () => ({ caveChatoutCodex: () => false }));
vi.mock("@/lib/use-viewport", () => ({ useIsMobile: () => false, useIsCoarsePointer: () => false }));
// Stable (module-level, not freshly literal-constructed per call) return
// values throughout: several of these feed useMemo/useEffect dependency
// arrays by reference in the real hooks (useSyncExternalStore snapshots,
// SWR-cached payloads, …), and a mock returning a brand-new object/array
// literal on every call breaks that referential stability, which can drive
// an effect into a render loop instead of settling.
const noArchivedFamiliars = {};
const noProjectOverrides = {};
const noProjects = { projects: [] as never[] };
vi.mock("@/lib/use-project-overrides", () => ({ useProjectOverrides: () => noProjectOverrides }));
vi.mock("@/lib/cave-familiar-archive", () => ({ useArchivedFamiliars: () => noArchivedFamiliars }));
vi.mock("@/lib/use-projects", () => ({ useProjects: () => noProjects }));
vi.mock("@/lib/use-auto-expand-new-groups", () => ({ useAutoExpandNewGroups: () => {} }));
vi.mock("@/components/ui/live-region", () => ({ useAnnouncer: () => ({ announce: vi.fn() }) }));

import { ChatRouter, type ChatRouterHandle } from "@/components/chat-router";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function familiar(id: string, display_name = id) {
  return { id, display_name, role: "familiar" };
}

function sessionRow(id: string, familiarId: string, iso: string) {
  return {
    id,
    project_root: "/work/chat-router-removal-race",
    harness: "codex",
    title: id,
    status: "completed",
    exit_code: null,
    archived_at: null,
    created_at: iso,
    updated_at: iso,
    attention: { state: "none", since: null, reason: null },
    origin: "chat",
    hasLocalConversation: false,
    familiarId,
  };
}

/** Controllable stand-in for an in-flight PATCH/DELETE: nothing runs until
 *  the test calls `settle()`, so the ordering (begin → switch → settle) is
 *  explicit and deterministic rather than relying on microtask timing. */
function deferred<T>() {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

let renderer: ReactTestRenderer;

beforeEach(() => {
  vi.stubGlobal("window", {
    localStorage: {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    },
    location: { hash: "" },
    history: { replaceState: vi.fn(), pushState: vi.fn() },
    matchMedia: vi.fn(() => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: vi.fn(() => true),
  });
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network disabled in test"))));
  chatView.latestProps = null;
});

afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ChatRouter onBack is conditional on the removed session still being displayed (cave-rl980 Task 4 final review)", () => {
  test("thread switch: archiving S, then switching to T before the PATCH settles, never navigates T away once the stale onBack arrives", async () => {
    const cody = familiar("cody", "Cody");
    const sessionS = sessionRow("cody-s", "cody", "2026-01-01T00:00:00.000Z");
    const sessionT = sessionRow("cody-t", "cody", "2026-01-05T00:00:00.000Z");
    const ref = { current: null as ChatRouterHandle | null };

    await act(async () => {
      renderer = create(
        <ChatRouter
          ref={ref as never}
          familiar={cody}
          familiars={[cody]}
          sessions={[sessionS, sessionT]}
          onSessionsDeleted={vi.fn()}
          compact
          hideRail
          syncUrlHash={false}
          enableSplitPanes={false}
        />,
      );
    });

    await act(async () => {
      ref.current!.openSession("cody-s");
    });
    expect(ref.current!.currentSessionId()).toBe("cody-s");

    // Capture the exact onBack instance ChatView's in-flight archiveChat(S)
    // would retain right now — a controllable promise stands in for the
    // PATCH request archiveChat awaits before ever calling this.
    const staleOnBack = chatView.latestProps!.onBack as (sessionId: string | null) => void;
    const archivePatch = deferred<void>();

    // The user switches to a different thread (T) under the SAME familiar
    // while the archive of S is still in flight.
    await act(async () => {
      ref.current!.openSession("cody-t");
    });
    expect(ref.current!.currentSessionId()).toBe("cody-t");

    // The archive PATCH settles now — late, after the user already left S —
    // and fires the same onBack(sessionId) archiveChat always fires on
    // success, using the closure captured before the switch.
    await act(async () => {
      archivePatch.settle();
      await archivePatch.promise;
      staleOnBack("cody-s");
    });

    // T must remain exactly where the user left it — never clobbered back
    // to the session list by S's now-irrelevant completion.
    expect(ref.current!.currentSessionId()).toBe("cody-t");
    expect(chatView.latestProps!.sessionId).toBe("cody-t");
  });

  test("familiar switch: archiving S, then switching to a different familiar's thread T before the PATCH settles, never navigates T away", async () => {
    const cody = familiar("cody", "Cody");
    const nova = familiar("nova", "Nova");
    const sessionS = sessionRow("cody-s", "cody", "2026-01-01T00:00:00.000Z");
    const sessionT = sessionRow("nova-t", "nova", "2026-01-01T00:00:00.000Z");
    const ref = { current: null as ChatRouterHandle | null };

    await act(async () => {
      renderer = create(
        <ChatRouter
          ref={ref as never}
          familiar={cody}
          familiars={[cody, nova]}
          sessions={[sessionS, sessionT]}
          onSessionsDeleted={vi.fn()}
          compact
          hideRail
          syncUrlHash={false}
          enableSplitPanes={false}
        />,
      );
    });

    await act(async () => {
      ref.current!.openSession("cody-s");
    });
    expect(ref.current!.currentSessionId()).toBe("cody-s");

    const staleOnBack = chatView.latestProps!.onBack as (sessionId: string | null) => void;
    const archivePatch = deferred<void>();

    // The user switches to a different familiar's thread (nova/T) while the
    // archive of cody's S is still in flight — exactly what RightChatPanel's
    // familiar-resolution effect does via the same imperative openSession.
    await act(async () => {
      ref.current!.openSession("nova-t");
    });
    expect(ref.current!.currentSessionId()).toBe("nova-t");

    await act(async () => {
      archivePatch.settle();
      await archivePatch.promise;
      staleOnBack("cody-s");
    });

    expect(ref.current!.currentSessionId()).toBe("nova-t");
    expect(chatView.latestProps!.sessionId).toBe("nova-t");
  });

  test("an onBack for the session still actually showing DOES navigate to the list — the conditional guard is not a blanket no-op", async () => {
    const cody = familiar("cody", "Cody");
    const sessionS = sessionRow("cody-s", "cody", "2026-01-01T00:00:00.000Z");
    const ref = { current: null as ChatRouterHandle | null };

    await act(async () => {
      renderer = create(
        <ChatRouter
          ref={ref as never}
          familiar={cody}
          familiars={[cody]}
          sessions={[sessionS]}
          onSessionsDeleted={vi.fn()}
          compact
          hideRail
          syncUrlHash={false}
          enableSplitPanes={false}
        />,
      );
    });

    await act(async () => {
      ref.current!.openSession("cody-s");
    });
    expect(ref.current!.currentSessionId()).toBe("cody-s");

    await act(async () => {
      (chatView.latestProps!.onBack as (sessionId: string | null) => void)("cody-s");
    });

    // Still showing cody-s when its own onBack fires: this DOES clear —
    // proves the fix is a targeted equality check, not an accidental no-op.
    expect(ref.current!.currentSessionId()).toBe(null);
  });
});

describe("ChatRouter onVoiceSessionDiscarded is conditional the same way (cave-rl980 Task 4 final review)", () => {
  test("discarding a promoted voice session S, then switching to T before the DELETE settles, never yanks T back to a blank compose", async () => {
    const cody = familiar("cody", "Cody");
    const sessionS = sessionRow("cody-s", "cody", "2026-01-01T00:00:00.000Z");
    const sessionT = sessionRow("cody-t", "cody", "2026-01-05T00:00:00.000Z");
    const ref = { current: null as ChatRouterHandle | null };

    await act(async () => {
      renderer = create(
        <ChatRouter
          ref={ref as never}
          familiar={cody}
          familiars={[cody]}
          sessions={[sessionS, sessionT]}
          onSessionsDeleted={vi.fn()}
          compact
          hideRail
          syncUrlHash={false}
          enableSplitPanes={false}
        />,
      );
    });

    await act(async () => {
      ref.current!.openSession("cody-s");
    });
    expect(ref.current!.currentSessionId()).toBe("cody-s");

    // Captures the onVoiceSessionDiscarded instance the discard's in-flight
    // DELETE ?ifEmpty=1 request would retain right now.
    const staleOnVoiceSessionDiscarded =
      chatView.latestProps!.onVoiceSessionDiscarded as (sessionId: string) => void;
    const discardDelete = deferred<void>();

    // User switches threads while the discard is still in flight.
    await act(async () => {
      ref.current!.openSession("cody-t");
    });
    expect(ref.current!.currentSessionId()).toBe("cody-t");

    await act(async () => {
      discardDelete.settle();
      await discardDelete.promise;
      staleOnVoiceSessionDiscarded("cody-s");
    });

    // T must survive — never reset to a fresh blank compose by S's stale
    // discard completion.
    expect(ref.current!.currentSessionId()).toBe("cody-t");
    expect(chatView.latestProps!.sessionId).toBe("cody-t");
  });

  test("discarding S, then switching familiar to T before the DELETE settles, never yanks T back to a blank compose", async () => {
    const cody = familiar("cody", "Cody");
    const nova = familiar("nova", "Nova");
    const sessionS = sessionRow("cody-s", "cody", "2026-01-01T00:00:00.000Z");
    const sessionT = sessionRow("nova-t", "nova", "2026-01-01T00:00:00.000Z");
    const ref = { current: null as ChatRouterHandle | null };

    await act(async () => {
      renderer = create(
        <ChatRouter
          ref={ref as never}
          familiar={cody}
          familiars={[cody, nova]}
          sessions={[sessionS, sessionT]}
          onSessionsDeleted={vi.fn()}
          compact
          hideRail
          syncUrlHash={false}
          enableSplitPanes={false}
        />,
      );
    });

    await act(async () => {
      ref.current!.openSession("cody-s");
    });
    expect(ref.current!.currentSessionId()).toBe("cody-s");

    const staleOnVoiceSessionDiscarded =
      chatView.latestProps!.onVoiceSessionDiscarded as (sessionId: string) => void;
    const discardDelete = deferred<void>();

    await act(async () => {
      ref.current!.openSession("nova-t");
    });
    expect(ref.current!.currentSessionId()).toBe("nova-t");

    await act(async () => {
      discardDelete.settle();
      await discardDelete.promise;
      staleOnVoiceSessionDiscarded("cody-s");
    });

    expect(ref.current!.currentSessionId()).toBe("nova-t");
    expect(chatView.latestProps!.sessionId).toBe("nova-t");
  });

  test("an onVoiceSessionDiscarded for the session still actually showing DOES reset to a blank compose", async () => {
    const cody = familiar("cody", "Cody");
    const sessionS = sessionRow("cody-s", "cody", "2026-01-01T00:00:00.000Z");
    const ref = { current: null as ChatRouterHandle | null };

    await act(async () => {
      renderer = create(
        <ChatRouter
          ref={ref as never}
          familiar={cody}
          familiars={[cody]}
          sessions={[sessionS]}
          onSessionsDeleted={vi.fn()}
          compact
          hideRail
          syncUrlHash={false}
          enableSplitPanes={false}
        />,
      );
    });

    await act(async () => {
      ref.current!.openSession("cody-s");
    });
    expect(ref.current!.currentSessionId()).toBe("cody-s");

    await act(async () => {
      (chatView.latestProps!.onVoiceSessionDiscarded as (sessionId: string) => void)("cody-s");
    });

    expect(ref.current!.currentSessionId()).toBe(null);
    expect(chatView.latestProps!.sessionId).toBe(null);
  });
});

console.log("chat-router-removal-race.test.tsx wired");
