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
//   1b. a confirmed archive/delete/discard (ChatView's own narrow
//      onSessionRemoved signal, then a null) retains the prior selection
//      until the roster confirms removal; an explicit New chat still clears
//      instantly; an ordinary back with no removal signal (e.g. a
//      transcript-load-failure "Back to sessions") clears the stale
//      selection immediately even though the session remains eligible; a
//      discarded pre-roster promoted/voice session — which reports the same
//      onSessionRemoved-then-null shape as a confirmed removal, but was
//      never observed in the eligible roster — clears instead of leaving a
//      permanent ghost; and a generic, non-removal onSessionsChanged (a
//      refresh unrelated to this session, e.g. a canonical-session
//      reconcile) followed by an ordinary null must still clear — never
//      retain — since onSessionsChanged is no longer treated as a removal
//      signal on its own.
//   2. a familiar change is tracked even while the panel is closed: a closed
//      A -> B -> A sequence re-resolves A, and reopening finds the header and
//      the router already agreeing, with no extra resolution needed.
//   3. an open familiar switch issues exactly one imperative openSession/
//      newChat call — never a second one caused by the outgoing familiar's
//      stale selection being compared against the new familiar's roster.
//   4. a transient roster error keeps an already-resolved ChatRouter mounted,
//      and never marks a not-yet-mounted ("null") router resolved.
//   5. every loading/error/chooser state exposes a working Close action.
//   6. the familiar chooser only offers the filtered, resolved roster.
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

function threadSwitcher(renderer: ReactTestRenderer) {
  return renderer.root.findByType("select" as never);
}

/** The header's own rendered title span (`<span title={title}>{title}</span>`
 *  inside `.right-chat__identity`) — the "header" half of "T remains
 *  active/header" (cave-rl980 Task 4 final review tests below), distinct
 *  from `sessionIdAttr`'s router-selection check. */
function headerTitle(renderer: ReactTestRenderer): string {
  const node = renderer.root.find(
    (n) => n.type === "span" && typeof n.props.title === "string",
  );
  return node.props.children as string;
}

/** Controllable stand-in for an in-flight archive/delete/discard request:
 *  nothing below runs until the test calls `settle()`, so "begin removal on
 *  S, switch to T, then resolve" is an explicit, deterministic sequence
 *  instead of a timing assumption. */
function deferred<T = void>() {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
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
  test("a confirmed archive (onSessionsChanged, then onSessionRemoved, then null) retains the current selection, then resolves to the familiar's next session once the roster confirms removal", async () => {
    const cody = familiar("cody", "Cody");
    const older = sessionRow("cody-older", { familiarId: "cody", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" });
    const newer = sessionRow("cody-newer", { familiarId: "cody", created_at: "2026-01-05T00:00:00.000Z", updated_at: "2026-01-05T00:00:00.000Z" });
    let props = baseProps({ activeFamiliar: cody, familiars: [cody], sessions: [older, newer] });
    const renderer = await renderPanel(props);
    expect(sessionIdAttr(renderer)).toBe("cody-newer");

    // Simulates ChatView's archiveChat: onSessionsChanged(), then the narrow
    // onSessionRemoved("archived") signal, then (via ChatRouter's onBack) a
    // null — synchronously, same as the real order. Retention is armed by
    // onSessionRemoved, not by onSessionsChanged firing.
    await act(async () => {
      (router.latestProps!.onSessionsChanged as () => void)();
      (router.latestProps!.onSessionRemoved as (id: string, reason: string) => void)("cody-newer", "archived");
      (router.latestProps!.onActiveSessionChange as (id: string | null) => void)(null);
    });
    expect(sessionIdAttr(renderer)).toBe("cody-newer"); // retained, not cleared
    expect(router.calls.newChat.length).toBe(0);
    expect(props.onSessionsChanged).toHaveBeenCalledTimes(1); // forwarded unchanged to the real consumer

    // Roster refresh confirms cody-newer is actually gone.
    props = { ...props, sessions: [older] };
    await update(renderer, props);
    expect(sessionIdAttr(renderer)).toBe("cody-older");
    expect(router.calls.openSession.at(-1)?.[0]).toBe("cody-older");
  });

  test("a confirmed delete (onSessionsDeleted, then onSessionRemoved, then null) resolves to a blank familiar-bound compose when no eligible session remains", async () => {
    const cody = familiar("cody", "Cody");
    const only = sessionRow("cody-only", { familiarId: "cody", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" });
    let props = baseProps({ activeFamiliar: cody, familiars: [cody], sessions: [only] });
    const renderer = await renderPanel(props);
    expect(sessionIdAttr(renderer)).toBe("cody-only");

    // Simulates ChatView's deleteChat: onSessionsDeleted([id]), then the
    // narrow onSessionRemoved("deleted") signal, then (via ChatRouter's
    // onBack) a null — synchronously, same as the real order.
    await act(async () => {
      (router.latestProps!.onSessionsDeleted as (ids: readonly string[]) => void)(["cody-only"]);
      (router.latestProps!.onSessionRemoved as (id: string, reason: string) => void)("cody-only", "deleted");
      (router.latestProps!.onActiveSessionChange as (id: string | null) => void)(null);
    });
    expect(sessionIdAttr(renderer)).toBe("cody-only"); // retained until the roster confirms it
    expect(props.onSessionsDeleted).toHaveBeenCalledWith(["cody-only"]); // forwarded unchanged to the real consumer

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

  test("an ordinary back with no removal signal (e.g. 'Back to sessions' after a transcript load failure) clears the stale header immediately, even though the session remains eligible", async () => {
    const cody = familiar("cody", "Cody");
    const sessions = [sessionRow("cody-1", { familiarId: "cody", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" })];
    const props = baseProps({ activeFamiliar: cody, familiars: [cody], sessions });
    const renderer = await renderPanel(props);
    expect(sessionIdAttr(renderer)).toBe("cody-1");

    // ChatRouter's onBack fires with no preceding onSessionsChanged/
    // onSessionsDeleted/onSessionRemoved call — exactly what "Back to
    // sessions" on a ChatHistoryNotice transcript-load failure does. cody-1
    // is still fully present in `sessions`: nothing was archived or deleted.
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

  test("a non-removal onSessionsChanged (e.g. an unrelated canonical-session refresh) followed by an ordinary null clears the selection instead of retaining it", async () => {
    const cody = familiar("cody", "Cody");
    const sessions = [sessionRow("cody-1", { familiarId: "cody", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" })];
    const props = baseProps({ activeFamiliar: cody, familiars: [cody], sessions });
    const renderer = await renderPanel(props);
    expect(sessionIdAttr(renderer)).toBe("cody-1");

    // onSessionsChanged fires for plenty of reasons that have nothing to do
    // with THIS session's removal — a live-generation stream settling, a
    // Board handoff refresh, a *different* thread auto-archiving on
    // reflection. It must never be treated as a removal signal on its own:
    // only the dedicated onSessionRemoved callback may arm retention. So an
    // ordinary null (no onSessionRemoved) that merely happens to follow one
    // must still clear immediately, exactly like the no-signal-at-all case
    // above.
    await act(async () => {
      (router.latestProps!.onSessionsChanged as () => void)();
      (router.latestProps!.onActiveSessionChange as (id: string | null) => void)(null);
    });

    expect(sessionIdAttr(renderer)).toBe("new"); // cleared, not retained
    expect(props.onSessionsChanged).toHaveBeenCalledTimes(1); // still forwarded to the real consumer
    const openSessionCallsSoFar = router.calls.openSession.length;

    // No lingering retention: a stale roster re-render must not reopen cody-1.
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
    // session server-side, refreshes the list (onSessionsChanged), reports
    // the narrow onSessionRemoved("discarded") signal, and only THEN reports
    // onVoiceSessionDiscarded (surfaced here as the resulting null) — the
    // same order a confirmed archive/delete uses. Unlike those, this id was
    // NEVER observed in the eligible roster (sessions stays empty: the
    // session never really existed from the roster's point of view), so
    // handleSessionRemoved's own observed-gate refuses to arm retention at
    // all, and it must clear immediately rather than retain — retaining
    // would leave a permanent ghost, since the reconcile branch could never
    // confirm removal of an id the roster never listed to begin with.
    await act(async () => {
      (router.latestProps!.onSessionsChanged as () => void)();
      (router.latestProps!.onSessionRemoved as (id: string, reason: string) => void)("cody-voice-ghost", "discarded");
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

describe("async removal race: a stale archive/delete/discard completion after switching away must never clobber the newer selection (cave-rl980 Task 4 final review)", () => {
  // ChatView's archiveChat/deleteChat/setChatArchived/discardVoiceSessionIfEmpty
  // are all async: the specific onSessionRemoved/onActiveSessionChange
  // instances they retain are whichever ones were current when the request
  // BEGAN, frozen even if the user switches to a different thread or
  // familiar before the request settles. handleSessionRemoved must consult
  // the LIVE current selection (currentSelectionRef), not those frozen
  // values — each test below captures the stale callbacks BEFORE switching,
  // then only invokes them once a controllable promise (standing in for the
  // real fetch) is manually settled AFTER the switch, so the ordering is
  // explicit rather than assumed.
  test("thread switch: an archive begun on S, then a switch to T before the PATCH settles, leaves T active in both the router selection and the header once the stale completion arrives", async () => {
    const cody = familiar("cody", "Cody");
    const s = sessionRow("cody-s", { familiarId: "cody", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" });
    const t = sessionRow("cody-t", { familiarId: "cody", created_at: "2026-01-05T00:00:00.000Z", updated_at: "2026-01-05T00:00:00.000Z" });
    const props = baseProps({ activeFamiliar: cody, familiars: [cody], sessions: [s, t] });
    const renderer = await renderPanel(props);
    expect(sessionIdAttr(renderer)).toBe("cody-t"); // newest-first initial resolve

    // Park the panel on S — the session the archive below targets.
    await act(async () => {
      (router.latestProps!.onActiveSessionChange as (id: string | null) => void)("cody-s");
    });
    expect(sessionIdAttr(renderer)).toBe("cody-s");
    expect(headerTitle(renderer)).toBe("cody-s");

    // Capture the exact onSessionRemoved instance ChatView's in-flight
    // archiveChat(S) would retain right now — this is the object identity
    // check that matters: a fresh (bug-fixed) call to router.latestProps
    // after the switch below would read a DIFFERENT closure, but the real
    // archiveChat call only ever holds the one it captured at its own start.
    const staleOnSessionRemoved = router.latestProps!.onSessionRemoved as (id: string, reason: string) => void;
    const archivePatch = deferred<void>();

    // The user switches to a different thread (T) under the SAME familiar
    // while the archive of S is still in flight — the thread switcher
    // bypasses handleSessionRemoved entirely, exactly like a real manual
    // pick (see the "explicit New chat" test above for the same bypass).
    await act(async () => {
      threadSwitcher(renderer).props.onChange({ currentTarget: { value: "cody-t" } });
    });
    expect(sessionIdAttr(renderer)).toBe("cody-t");
    expect(headerTitle(renderer)).toBe("cody-t");

    // The archive's PATCH settles now — late, after the user already left S
    // — and fires the same onSessionRemoved(id, reason) archiveChat always
    // fires on success, via the closure captured before the switch.
    await act(async () => {
      archivePatch.settle();
      await archivePatch.promise;
      staleOnSessionRemoved("cody-s", "archived");
    });

    // T must remain exactly where the user left it — both the router
    // selection and the rendered header — untouched by S's now-irrelevant
    // completion.
    expect(sessionIdAttr(renderer)).toBe("cody-t");
    expect(headerTitle(renderer)).toBe("cody-t");

    // No stale reconciliation: the stale signal must not have left
    // pendingRemovalRef incorrectly armed for T. Proven by a LATER, entirely
    // unrelated ordinary null (T's own "Back to sessions" after a
    // transcript-load failure, say) — an incorrect arm would retain T
    // through the reconcile branch instead of clearing immediately, exactly
    // like the "ordinary back" test above.
    await act(async () => {
      (router.latestProps!.onActiveSessionChange as (id: string | null) => void)(null);
    });
    expect(sessionIdAttr(renderer)).toBe("new");
  });

  test("familiar switch: an archive begun on S, then a switch to a different familiar's thread T before the PATCH settles, leaves T active once the stale completion arrives", async () => {
    const cody = familiar("cody", "Cody");
    const nova = familiar("nova", "Nova");
    const codySession = sessionRow("cody-s", { familiarId: "cody", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" });
    const novaSession = sessionRow("nova-t", { familiarId: "nova", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" });
    let props = baseProps({ activeFamiliar: cody, familiars: [cody, nova], sessions: [codySession, novaSession] });
    const renderer = await renderPanel(props);
    expect(sessionIdAttr(renderer)).toBe("cody-s");
    expect(headerTitle(renderer)).toBe("cody-s");

    const staleOnSessionRemoved = router.latestProps!.onSessionRemoved as (id: string, reason: string) => void;
    const archivePatch = deferred<void>();

    // The user switches to a DIFFERENT familiar (nova) while cody's S is
    // still being archived — a real familiar switch, driven the same way
    // the app drives it: the activeFamiliar prop changes from outside.
    props = { ...props, activeFamiliar: nova };
    await update(renderer, props);
    expect(sessionIdAttr(renderer)).toBe("nova-t");
    expect(headerTitle(renderer)).toBe("nova-t");

    await act(async () => {
      archivePatch.settle();
      await archivePatch.promise;
      staleOnSessionRemoved("cody-s", "archived");
    });

    // nova/T must remain exactly where the user left it.
    expect(sessionIdAttr(renderer)).toBe("nova-t");
    expect(headerTitle(renderer)).toBe("nova-t");

    // No stale reconciliation leaking into nova's own state: an unrelated
    // ordinary null on nova/T must still clear immediately.
    await act(async () => {
      (router.latestProps!.onActiveSessionChange as (id: string | null) => void)(null);
    });
    expect(sessionIdAttr(renderer)).toBe("new");
  });

  test("a stale archive completion for the session that IS still selected still correctly retains it — the ref check is not a blanket refusal", async () => {
    const cody = familiar("cody", "Cody");
    const older = sessionRow("cody-older", { familiarId: "cody", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" });
    const s = sessionRow("cody-s", { familiarId: "cody", created_at: "2026-01-05T00:00:00.000Z", updated_at: "2026-01-05T00:00:00.000Z" });
    let props = baseProps({ activeFamiliar: cody, familiars: [cody], sessions: [older, s] });
    const renderer = await renderPanel(props);
    expect(sessionIdAttr(renderer)).toBe("cody-s");

    const staleOnSessionRemoved = router.latestProps!.onSessionRemoved as (id: string, reason: string) => void;
    const archivePatch = deferred<void>();

    // No switch this time — the panel is still on cody-s when the archive
    // settles, exactly like the existing non-deferred archive test above.
    await act(async () => {
      archivePatch.settle();
      await archivePatch.promise;
      staleOnSessionRemoved("cody-s", "archived");
      (router.latestProps!.onActiveSessionChange as (id: string | null) => void)(null);
    });
    expect(sessionIdAttr(renderer)).toBe("cody-s"); // retained, not cleared

    props = { ...props, sessions: [older] };
    await update(renderer, props);
    expect(sessionIdAttr(renderer)).toBe("cody-older");
  });
});

describe("familiar transitions are tracked deterministically even while the panel is closed (fix 2)", () => {
  test("a closed A -> B -> A familiar sequence re-resolves A and leaves the header and router already agreeing by the time the panel reopens", async () => {
    const cody = familiar("cody", "Cody");
    const nova = familiar("nova", "Nova");
    const codySession = sessionRow("cody-1", { familiarId: "cody", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" });
    const novaSession = sessionRow("nova-1", { familiarId: "nova", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" });
    let props = baseProps({ activeFamiliar: cody, familiars: [cody, nova], sessions: [codySession, novaSession] });
    const renderer = await renderPanel(props);
    expect(sessionIdAttr(renderer)).toBe("cody-1");

    // Close the panel — ChatRouter/ChatView stay mounted underneath as a
    // persistent controller (per the design doc); only visibility changes.
    props = { ...props, open: false };
    await update(renderer, props);
    expect(sessionIdAttr(renderer)).toBe("cody-1"); // closing alone changes nothing

    // The active familiar changes twice while the panel is hidden.
    props = { ...props, activeFamiliar: nova };
    await update(renderer, props);
    expect(sessionIdAttr(renderer)).toBe("nova-1"); // tracked even while closed
    expect(router.calls.openSession.at(-1)?.[0]).toBe("nova-1");

    props = { ...props, activeFamiliar: cody };
    await update(renderer, props);
    expect(sessionIdAttr(renderer)).toBe("cody-1"); // re-resolved back to cody, still closed
    expect(router.calls.openSession.at(-1)?.[0]).toBe("cody-1");

    // Reopen: the header and the router must already agree — no desync, and
    // no extra resolution call is needed just to reveal the panel.
    const callsBeforeReopen = router.calls.openSession.length + router.calls.newChat.length;
    props = { ...props, open: true };
    await update(renderer, props);
    expect(sessionIdAttr(renderer)).toBe("cody-1");
    expect(router.calls.openSession.length + router.calls.newChat.length).toBe(callsBeforeReopen);
  });
});

describe("familiar transitions issue exactly one imperative action (fix 3: no double resolution from stale selection)", () => {
  test("an open A -> B familiar switch issues exactly one resolution call, never a second one from the outgoing familiar's stale selection", async () => {
    const cody = familiar("cody", "Cody");
    const nova = familiar("nova", "Nova");
    const codySession = sessionRow("cody-1", { familiarId: "cody", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" });
    const novaSession = sessionRow("nova-1", { familiarId: "nova", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" });
    let props = baseProps({ activeFamiliar: cody, familiars: [cody, nova], sessions: [codySession, novaSession] });
    const renderer = await renderPanel(props);
    expect(sessionIdAttr(renderer)).toBe("cody-1");
    const callsBefore = router.calls.openSession.length + router.calls.newChat.length;

    props = { ...props, activeFamiliar: nova };
    await update(renderer, props);

    expect(sessionIdAttr(renderer)).toBe("nova-1");
    // Exactly one imperative action for this transition. cody-1 (the
    // outgoing familiar's now-stale selection) is never eligible for nova's
    // roster and was already observed under cody — precisely the shape that
    // would cause a second, redundant reconcile call if resolution were
    // split across two separate effects instead of one.
    expect(router.calls.openSession.length + router.calls.newChat.length).toBe(callsBefore + 1);
  });

  test("an open A -> B switch to a familiar with no eligible session issues exactly one newChat call", async () => {
    const cody = familiar("cody", "Cody");
    const nova = familiar("nova", "Nova");
    const codySession = sessionRow("cody-1", { familiarId: "cody", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" });
    let props = baseProps({ activeFamiliar: cody, familiars: [cody, nova], sessions: [codySession] });
    const renderer = await renderPanel(props);
    expect(sessionIdAttr(renderer)).toBe("cody-1");
    const callsBefore = router.calls.openSession.length + router.calls.newChat.length;

    props = { ...props, activeFamiliar: nova };
    await update(renderer, props);

    expect(sessionIdAttr(renderer)).toBe("new");
    expect(router.calls.newChat.at(-1)).toEqual([undefined, undefined, "nova"]);
    expect(router.calls.openSession.length + router.calls.newChat.length).toBe(callsBefore + 1);
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
