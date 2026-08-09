// @ts-nocheck — react-test-renderer ships no types; matches the convention in
// chat-title-sparkle-behavior.test.tsx and workspace-canonical-memory-navigation-behavior.test.tsx.
//
// Behavioral companion to right-chat-panel.test.ts. That file pins the source
// contract with fast text assertions; this file actually mounts the panel
// (ChatRouter mocked to a thin imperative-handle stub, so we exercise
// RightChatPanel's own session-selection logic in isolation) to prove the
// cave-rl980 Task 4 review fixes behave, not just that certain substrings
// exist in source:
//   1. a promotion race never misclassifies a brand-new session as deleted.
//   1b. a confirmed archive/delete (onSessionsChanged/onSessionsDeleted then
//      a null) retains the prior selection until the roster confirms
//      removal; an explicit New chat still clears instantly; an ordinary
//      back with no removal mutation (e.g. a transcript-load-failure "Back
//      to sessions") clears the stale selection immediately even though the
//      session remains eligible; and a discarded pre-roster promoted/voice
//      session — which reports the same onSessionsChanged-then-null shape as
//      a confirmed removal, but was never observed in the eligible roster —
//      clears instead of leaving a permanent ghost.
//   2. a transient roster error keeps an already-resolved ChatRouter mounted,
//      and never marks a not-yet-mounted ("null") router resolved.
//   3. every loading/error/chooser state exposes a working Close action.
//   4. the familiar chooser only offers the filtered, resolved roster.
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const router = vi.hoisted(() => ({
  calls: {
    openSession: [] as unknown[][],
    newChat: [] as unknown[][],
  },
  latestProps: null as Record<string, unknown> | null,
  reset() {
    this.calls.openSession = [];
    this.calls.newChat = [];
    this.latestProps = null;
  },
}));

// A thin stand-in for the real (982-line) ChatRouter: exposes the same
// imperative handle shape, records every openSession/newChat call, and hands
// the test direct access to the latest onActiveSessionChange callback so it
// can simulate what the real router reports (promotions, organic nulls)
// without re-implementing its internal view state machine. This suite is
// about RightChatPanel's own session-selection contract, not ChatRouter's.
vi.mock("@/components/chat-router", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  const ChatRouter = forwardRef(function MockChatRouter(props: Record<string, unknown>, ref: unknown) {
    router.latestProps = props;
    useImperativeHandle(ref, () => ({
      goToList: () => {},
      newChat: (...args: unknown[]) => {
        router.calls.newChat.push(args);
      },
      openSession: (...args: unknown[]) => {
        router.calls.openSession.push(args);
      },
      openSessionInSplit: () => {},
      currentSessionId: () => null,
      clearTranscript: () => {},
      runSlash: () => {},
    }));
    return null;
  });
  return { ChatRouter };
});

vi.mock("@/components/familiar-avatar", () => ({
  FamiliarAvatar: () => null,
}));

vi.mock("@/components/ui/live-region", () => ({
  useAnnouncer: () => ({ announce: vi.fn() }),
}));

const archivedIds = vi.hoisted(() => new Set<string>());
// A stand-in for the real resolver: filters out "archived" familiars exactly
// like useResolvedFamiliars does with includeArchived defaulting to false,
// without needing the real hook's overrides/images/order dependencies.
vi.mock("@/lib/familiar-resolve", () => ({
  useResolvedFamiliars: (familiars: Array<{ id: string; display_name: string }>) =>
    familiars.filter((familiar) => !archivedIds.has(familiar.id)).map((familiar) => ({ ...familiar })),
}));

import { Button } from "@/components/ui/button";
import { ChatRouter as MockChatRouter } from "@/components/chat-router";
import { RightChatPanel } from "./right-chat-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function familiar(id: string, display_name = id) {
  return { id, display_name, role: "familiar" };
}

function sessionRow(
  id: string,
  overrides: { familiarId: string; created_at: string; updated_at: string } & Record<string, unknown>,
) {
  return {
    id,
    project_root: "/work/right-chat",
    harness: "codex",
    title: id,
    status: "completed",
    exit_code: null,
    archived_at: null,
    attention: { state: "none", since: null, reason: null },
    origin: "chat",
    hasLocalConversation: false,
    ...overrides,
  };
}

function baseProps(overrides: Record<string, unknown> = {}) {
  const cody = familiar("cody", "Cody");
  return {
    open: true,
    familiars: [cody],
    activeFamiliar: cody,
    sessions: [],
    sessionsLoaded: true,
    sessionsError: false,
    familiarsLoaded: true,
    familiarsError: null as string | null,
    daemonRunning: true,
    onClose: vi.fn(),
    onSetActiveFamiliar: vi.fn(),
    onRetryFamiliars: vi.fn(),
    onRetrySessions: vi.fn(),
    onSessionStarted: vi.fn(),
    onSessionsChanged: vi.fn(),
    onSessionsDeleted: vi.fn(),
    onSlashFromChat: vi.fn(),
    onOpenOnboarding: vi.fn(),
    onOpenTask: vi.fn(),
    onOpenUrl: vi.fn(),
    ...overrides,
  };
}

async function renderPanel(props: Record<string, unknown>) {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<RightChatPanel {...(props as never)} />);
  });
  return renderer;
}

async function update(renderer: ReactTestRenderer, props: Record<string, unknown>) {
  await act(async () => {
    renderer.update(<RightChatPanel {...(props as never)} />);
  });
}

function sessionIdAttr(renderer: ReactTestRenderer): string | null {
  return renderer.root.findByType("aside" as never).props["data-session-id"] ?? null;
}

function findByAria(renderer: ReactTestRenderer, label: string) {
  return renderer.root.find((node) => node.type === "button" && node.props["aria-label"] === label);
}

beforeEach(() => {
  router.reset();
});

afterEach(() => {
  archivedIds.clear();
});

test("initial resolve opens the active familiar's newest eligible session", async () => {
  const cody = familiar("cody", "Cody");
  const sessions = [
    sessionRow("cody-older", { familiarId: "cody", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" }),
    sessionRow("cody-newer", { familiarId: "cody", created_at: "2026-01-05T00:00:00.000Z", updated_at: "2026-01-05T00:00:00.000Z" }),
  ];
  const renderer = await renderPanel(baseProps({ activeFamiliar: cody, familiars: [cody], sessions }));

  expect(router.calls.openSession.at(-1)?.[0]).toBe("cody-newer");
  expect(sessionIdAttr(renderer)).toBe("cody-newer");
});

describe("promotion race (fix 1: a newly promoted session is never misclassified as deleted)", () => {
  test("a promoted session id absent from the sessions prop is retained, not replaced, until the roster refresh", async () => {
    const cody = familiar("cody", "Cody");
    const older = sessionRow("cody-old", { familiarId: "cody", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" });
    let props = baseProps({ activeFamiliar: cody, familiars: [cody], sessions: [older] });
    const renderer = await renderPanel(props);
    expect(sessionIdAttr(renderer)).toBe("cody-old");

    // ChatRouter promotes a brand-new session the `sessions` roster prop
    // hasn't been refetched to include yet.
    await act(async () => {
      (router.latestProps!.onActiveSessionChange as (id: string | null) => void)("cody-promoted");
    });
    expect(sessionIdAttr(renderer)).toBe("cody-promoted");
    const callsSoFar = router.calls.openSession.length + router.calls.newChat.length;

    // Re-render with the *same*, still-stale roster — must not be treated as
    // a deletion (no extra openSession/newChat, selection unchanged).
    await update(renderer, props);
    expect(router.calls.openSession.length + router.calls.newChat.length).toBe(callsSoFar);
    expect(sessionIdAttr(renderer)).toBe("cody-promoted");

    // Roster refreshes to include the promoted session: still no extra
    // reconciliation call, since it is now legitimately eligible.
    props = { ...props, sessions: [older, sessionRow("cody-promoted", { familiarId: "cody", created_at: "2026-01-02T00:00:00.000Z", updated_at: "2026-01-02T00:00:00.000Z" })] };
    await update(renderer, props);
    expect(router.calls.openSession.length + router.calls.newChat.length).toBe(callsSoFar);
    expect(sessionIdAttr(renderer)).toBe("cody-promoted");

    // Only *after* having been observed eligible does a genuine removal
    // (e.g. deleted) correctly fall back to the remaining session.
    props = { ...props, sessions: [older] };
    await update(renderer, props);
    expect(sessionIdAttr(renderer)).toBe("cody-old");
    expect(router.calls.openSession.at(-1)?.[0]).toBe("cody-old");
  });
});

describe("confirmed removal vs ordinary null (fix 1 follow-up: archive/delete retain, ordinary back/discard clear)", () => {
  test("a confirmed archive (onSessionsChanged then null) retains the current selection, then resolves to the familiar's next session once the roster confirms removal", async () => {
    const cody = familiar("cody", "Cody");
    const older = sessionRow("cody-older", { familiarId: "cody", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" });
    const newer = sessionRow("cody-newer", { familiarId: "cody", created_at: "2026-01-05T00:00:00.000Z", updated_at: "2026-01-05T00:00:00.000Z" });
    let props = baseProps({ activeFamiliar: cody, familiars: [cody], sessions: [older, newer] });
    const renderer = await renderPanel(props);
    expect(sessionIdAttr(renderer)).toBe("cody-newer");

    // Simulates ChatView's archiveChat: onSessionsChanged() then (via
    // ChatRouter's onBack) a null — synchronously, same as the real order.
    await act(async () => {
      (router.latestProps!.onSessionsChanged as () => void)();
      (router.latestProps!.onActiveSessionChange as (id: string | null) => void)(null);
    });
    expect(sessionIdAttr(renderer)).toBe("cody-newer"); // retained, not cleared
    expect(router.calls.newChat.length).toBe(0);
    expect(props.onSessionsChanged).toHaveBeenCalledTimes(1); // wrapper still forwards it

    // Roster refresh confirms cody-newer is actually gone.
    props = { ...props, sessions: [older] };
    await update(renderer, props);
    expect(sessionIdAttr(renderer)).toBe("cody-older");
    expect(router.calls.openSession.at(-1)?.[0]).toBe("cody-older");
  });

  test("a confirmed delete (onSessionsDeleted then null) resolves to a blank familiar-bound compose when no eligible session remains", async () => {
    const cody = familiar("cody", "Cody");
    const only = sessionRow("cody-only", { familiarId: "cody", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" });
    let props = baseProps({ activeFamiliar: cody, familiars: [cody], sessions: [only] });
    const renderer = await renderPanel(props);
    expect(sessionIdAttr(renderer)).toBe("cody-only");

    // Simulates ChatView's deleteChat: onSessionsDeleted([id]) then (via
    // ChatRouter's onBack) a null — synchronously, same as the real order.
    await act(async () => {
      (router.latestProps!.onSessionsDeleted as (ids: readonly string[]) => void)(["cody-only"]);
      (router.latestProps!.onActiveSessionChange as (id: string | null) => void)(null);
    });
    expect(sessionIdAttr(renderer)).toBe("cody-only"); // retained until the roster confirms it
    expect(props.onSessionsDeleted).toHaveBeenCalledWith(["cody-only"]); // wrapper still forwards it

    props = { ...props, sessions: [] };
    await update(renderer, props);
    expect(sessionIdAttr(renderer)).toBe("new");
    expect(router.calls.newChat.at(-1)).toEqual([undefined, undefined, "cody"]);
  });

  test("an explicit New chat click still clears the selection immediately, unaffected by null retention", async () => {
    const cody = familiar("cody", "Cody");
    const only = sessionRow("cody-only", { familiarId: "cody", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" });
    const props = baseProps({ activeFamiliar: cody, familiars: [cody], sessions: [only] });
    const renderer = await renderPanel(props);
    expect(sessionIdAttr(renderer)).toBe("cody-only");

    const newChatButton = findByAria(renderer, "New Chat panel chat");
    await act(async () => {
      newChatButton.props.onClick();
    });
    expect(sessionIdAttr(renderer)).toBe("new");
    expect(router.calls.newChat.at(-1)).toEqual([undefined, undefined, "cody"]);

    // The router's own later echo of this exact transition must not disturb
    // the already-cleared selection.
    await act(async () => {
      (router.latestProps!.onActiveSessionChange as (id: string | null) => void)(null);
    });
    expect(sessionIdAttr(renderer)).toBe("new");
  });

  test("an ordinary back with no removal mutation (e.g. 'Back to sessions' after a transcript load failure) clears the stale header immediately, even though the session remains eligible", async () => {
    const cody = familiar("cody", "Cody");
    const sessions = [sessionRow("cody-1", { familiarId: "cody", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" })];
    const props = baseProps({ activeFamiliar: cody, familiars: [cody], sessions });
    const renderer = await renderPanel(props);
    expect(sessionIdAttr(renderer)).toBe("cody-1");

    // ChatRouter's onBack fires with no preceding onSessionsChanged/
    // onSessionsDeleted call — exactly what "Back to sessions" on a
    // ChatHistoryNotice transcript-load failure does. cody-1 is still fully
    // present in `sessions`: nothing was archived or deleted.
    await act(async () => {
      (router.latestProps!.onActiveSessionChange as (id: string | null) => void)(null);
    });

    expect(sessionIdAttr(renderer)).toBe("new"); // cleared immediately, not stuck on cody-1
    expect(props.onSessionsChanged).not.toHaveBeenCalled();
    expect(props.onSessionsDeleted).not.toHaveBeenCalled();
    const openSessionCallsSoFar = router.calls.openSession.length; // includes the legitimate initial-resolve open

    // The session's continued eligibility must never resurrect it: a stale
    // roster re-render (unchanged sessions) must not reopen cody-1.
    await update(renderer, props);
    expect(sessionIdAttr(renderer)).toBe("new");
    expect(router.calls.openSession.length).toBe(openSessionCallsSoFar);
  });

  test("a discarded pre-roster promoted/voice session clears instead of leaving a permanent ghost", async () => {
    const cody = familiar("cody", "Cody");
    // No eligible session at all: initial resolution opens a blank compose.
    let props = baseProps({ activeFamiliar: cody, familiars: [cody], sessions: [] });
    const renderer = await renderPanel(props);
    expect(sessionIdAttr(renderer)).toBe("new");
    expect(router.calls.newChat.at(-1)).toEqual([undefined, undefined, "cody"]);

    // ChatRouter's onVoiceSessionCreated promotes null -> a brand-new session
    // id the `sessions` roster prop has NOT been refetched to include yet.
    await act(async () => {
      (router.latestProps!.onActiveSessionChange as (id: string | null) => void)("cody-voice-ghost");
    });
    expect(sessionIdAttr(renderer)).toBe("cody-voice-ghost");

    // The call ends with nothing said: discardVoiceSessionIfEmpty deletes the
    // session server-side, refreshes the list (onSessionsChanged), and only
    // THEN reports onVoiceSessionDiscarded — the exact same onSessionsChanged
    // -> null order a confirmed archive/delete uses. Unlike those, this id
    // was NEVER observed in the eligible roster (sessions stays empty: the
    // session never really existed from the roster's point of view), so it
    // must clear immediately rather than retain — retaining would leave a
    // permanent ghost, since the observed-gated reconcile effect could never
    // confirm removal of an id the roster never listed to begin with.
    await act(async () => {
      (router.latestProps!.onSessionsChanged as () => void)();
      (router.latestProps!.onActiveSessionChange as (id: string | null) => void)(null);
    });
    expect(sessionIdAttr(renderer)).toBe("new"); // cleared, not stuck on cody-voice-ghost

    // Prove there's no lingering ghost: further renders with the same
    // (still empty) roster must never resurrect or reconcile toward it.
    await update(renderer, props);
    expect(sessionIdAttr(renderer)).toBe("new");
    expect(router.calls.openSession.some((call) => call[0] === "cody-voice-ghost")).toBe(false);
  });
});

describe("transient roster errors keep a resolved router mounted (fix 2)", () => {
  test("a transient sessions error keeps an already-resolved ChatRouter mounted and offers an inline retry", async () => {
    const cody = familiar("cody", "Cody");
    const sessions = [sessionRow("cody-1", { familiarId: "cody", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" })];
    let props = baseProps({ activeFamiliar: cody, familiars: [cody], sessions });
    const renderer = await renderPanel(props);
    expect(renderer.root.findAllByType(MockChatRouter)).toHaveLength(1);
    expect(sessionIdAttr(renderer)).toBe("cody-1");

    props = { ...props, sessionsError: true };
    await update(renderer, props);

    expect(renderer.root.findAllByType(MockChatRouter)).toHaveLength(1); // still mounted
    expect(sessionIdAttr(renderer)).toBe("cody-1"); // selection undisturbed
    expect(findByAria(renderer, "Close Chat panel")).toBeTruthy();
    const retryButtons = renderer.root
      .findAllByType(Button)
      .filter((node) => node.props.children === "Retry" && node.props.onClick === props.onRetrySessions);
    expect(retryButtons.length).toBeGreaterThan(0);

    props = { ...props, sessionsError: false };
    await update(renderer, props);
    expect(renderer.root.findAllByType(MockChatRouter)).toHaveLength(1);
  });

  test("a transient familiars error keeps an already-resolved ChatRouter mounted and offers an inline retry", async () => {
    const cody = familiar("cody", "Cody");
    const sessions = [sessionRow("cody-1", { familiarId: "cody", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" })];
    let props = baseProps({ activeFamiliar: cody, familiars: [cody], sessions });
    const renderer = await renderPanel(props);
    expect(renderer.root.findAllByType(MockChatRouter)).toHaveLength(1);

    props = { ...props, familiarsError: "network blip" };
    await update(renderer, props);

    expect(renderer.root.findAllByType(MockChatRouter)).toHaveLength(1); // still mounted
    expect(sessionIdAttr(renderer)).toBe("cody-1");
    const retryButtons = renderer.root
      .findAllByType(Button)
      .filter((node) => node.props.children === "Retry" && node.props.onClick === props.onRetryFamiliars);
    expect(retryButtons.length).toBeGreaterThan(0);
  });

  test("a familiars error before first resolution blocks rendering and never marks a null router resolved", async () => {
    const cody = familiar("cody", "Cody");
    const sessions = [sessionRow("cody-1", { familiarId: "cody", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" })];
    let props = baseProps({ activeFamiliar: cody, familiars: [cody], sessions, familiarsError: "network down" });
    const renderer = await renderPanel(props);

    expect(renderer.root.findAllByType(MockChatRouter)).toHaveLength(0);
    expect(router.calls.openSession).toHaveLength(0);
    expect(router.calls.newChat).toHaveLength(0);
    expect(findByAria(renderer, "Close Chat panel")).toBeTruthy();

    // Clearing the error must trigger the real first resolution — it must
    // NOT have been silently marked resolved while the router was null.
    props = { ...props, familiarsError: null };
    await update(renderer, props);
    expect(renderer.root.findAllByType(MockChatRouter)).toHaveLength(1);
    expect(router.calls.openSession.at(-1)?.[0]).toBe("cody-1");
  });
});

describe("every loading/error/chooser state exposes a discoverable Close action (fix 3)", () => {
  test("loading", async () => {
    const onClose = vi.fn();
    const renderer = await renderPanel(baseProps({ familiarsLoaded: false, onClose }));
    await act(async () => {
      findByAria(renderer, "Close Chat panel").props.onClick();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("familiars error", async () => {
    const onClose = vi.fn();
    const renderer = await renderPanel(baseProps({ familiarsError: "boom", onClose }));
    await act(async () => {
      findByAria(renderer, "Close Chat panel").props.onClick();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("no active familiar chooser", async () => {
    const onClose = vi.fn();
    const renderer = await renderPanel(baseProps({ activeFamiliar: null, onClose }));
    await act(async () => {
      findByAria(renderer, "Close Chat panel").props.onClick();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("sessions error before first resolution", async () => {
    const onClose = vi.fn();
    const renderer = await renderPanel(baseProps({ sessionsError: true, onClose }));
    await act(async () => {
      findByAria(renderer, "Close Chat panel").props.onClick();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("fully resolved chat", async () => {
    const onClose = vi.fn();
    const cody = familiar("cody", "Cody");
    const sessions = [sessionRow("cody-1", { familiarId: "cody", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" })];
    const renderer = await renderPanel(baseProps({ activeFamiliar: cody, familiars: [cody], sessions, onClose }));
    await act(async () => {
      findByAria(renderer, "Close Chat panel").props.onClick();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("the familiar chooser uses the filtered resolved roster (fix 4)", () => {
  test("an archived/hidden familiar is absent from the chooser and cannot be selected", async () => {
    const cody = familiar("cody", "Cody");
    const nova = familiar("nova", "Nova");
    archivedIds.add("nova");
    const onSetActiveFamiliar = vi.fn();
    const renderer = await renderPanel(
      baseProps({ activeFamiliar: null, familiars: [cody, nova], onSetActiveFamiliar }),
    );

    // Button renders a spinner <span> alongside its text children, so only
    // the string entries make up the visible label.
    const buttonText = (node: { children: unknown[] }) =>
      node.children.filter((child): child is string => typeof child === "string").join("");
    const chooserButtons = renderer.root.findAll(
      (node) => node.type === "button" && node.props["aria-label"] !== "Close Chat panel",
    );
    const visibleNames = chooserButtons.map(buttonText);
    expect(visibleNames).toContain("Cody");
    expect(visibleNames).not.toContain("Nova");

    const codyButton = renderer.root.find(
      (node) => node.type === "button" && buttonText(node) === "Cody",
    );
    await act(async () => {
      codyButton.props.onClick();
    });
    expect(onSetActiveFamiliar).toHaveBeenCalledWith("cody");
  });
});
