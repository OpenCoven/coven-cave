// @ts-nocheck
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ChatRouter } from "./chat-router";
import { continuitySourceId, writeContinuityReference } from "@/lib/chat-continuity-preferences";

vi.mock("@/components/chat-view", async () => {
  const { forwardRef } = await import("react");
  return { ChatView: forwardRef(() => null), DEFAULT_CHAT_COMPOSER_DRAFT_KEY: "draft" };
});
vi.mock("@/components/chat-list", () => ({ ChatList: () => null }));
vi.mock("@/components/new-chat-launch", () => ({ NewChatLaunch: () => null }));
vi.mock("@/components/familiar-chatout-codex", () => ({ FamiliarChatoutCodexSurface: () => null }));
vi.mock("@/lib/feature-flags", () => ({ caveChatoutCodex: () => false }));
vi.mock("@/lib/use-viewport", () => ({ useIsMobile: () => false, useIsCoarsePointer: () => false }));
const empty = {};
const projects = { projects: [] };
vi.mock("@/lib/use-project-overrides", () => ({ useProjectOverrides: () => empty }));
vi.mock("@/lib/cave-familiar-archive", () => ({ useArchivedFamiliars: () => empty }));
vi.mock("@/lib/use-projects", () => ({ useProjects: () => projects }));
vi.mock("@/components/ui/live-region", () => ({ useAnnouncer: () => ({ announce: vi.fn() }) }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const nova = { id: "nova", display_name: "Nova", role: "familiar" };
const sage = { id: "sage", display_name: "Sage", role: "familiar" };
const sessions = [
  { id: "nova-exact", familiarId: "nova" },
  { id: "nova-newer", familiarId: "nova" },
  { id: "sage-exact", familiarId: "sage" },
].map((session) => ({ ...session, archived_at: null, created_at: "2026-09-09T00:00:00Z", updated_at: "2026-09-09T00:00:00Z", project_root: "", title: session.id, status: "completed", harness: "copilot", attention: { state: "none" } }));
let renderer;
let ref;
let props;

beforeEach(() => {
  const storage = new Map();
  vi.stubGlobal("window", {
    location: { origin: "http://continuity.test", hash: "" },
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    history: { replaceState() {}, pushState() {} },
  });
  for (const [familiarId, conversationId] of [["nova", "nova-exact"], ["sage", "sage-exact"]]) {
    writeContinuityReference({ sourceId: continuitySourceId("installation-a", window.location.origin), familiarId, conversationId, anchorId: null });
  }
  ref = { current: null };
  props = { ref, familiar: nova, familiars: [nova, sage], sessions, sessionsLoaded: true, continuityEnabled: true, continuitySourceId: continuitySourceId("installation-a", window.location.origin), onSessionsDeleted: vi.fn() };
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});
const mount = async () => { await act(async () => { renderer = create(<ChatRouter {...props} />); }); };
const update = async (next) => { props = { ...props, ...next }; await act(async () => renderer.update(<ChatRouter {...props} />)); };

test("opt-in returns exact familiar chats; switches do not pick newest", async () => {
  await mount();
  expect(ref.current.currentSessionId()).toBe("nova-exact");
  await update({ familiar: sage });
  expect(ref.current.currentSessionId()).toBe("sage-exact");
  await update({ familiar: nova });
  expect(ref.current.currentSessionId()).toBe("nova-exact");
});
test("default-off ignores saved returns and preserves existing blank-compose behavior", async () => {
  props.continuityEnabled = false;
  await mount();
  expect(ref.current.currentSessionId()).toBe(null);
  await act(async () => ref.current.openSession("nova-exact"));
  await update({ familiar: sage });
  expect(ref.current.currentSessionId()).toBe(null);
});
test("explicit deep links, direct open and new-chat intent beat return preferences", async () => {
  window.location.hash = "#chat-nova-newer";
  await mount();
  expect(ref.current.currentSessionId()).toBe(null);
  await act(async () => ref.current.openSession("nova-newer"));
  expect(ref.current.currentSessionId()).toBe("nova-newer");
  await act(async () => ref.current.newChat(undefined, undefined, "sage"));
  await update({ familiar: sage });
  expect(ref.current.currentSessionId()).toBe(null);
});
test("removed saved chat falls back to list without opening a sibling or later hijacking selection", async () => {
  await mount();
  await update({ familiar: sage, sessions: sessions.filter((s) => s.id !== "sage-exact") });
  expect(ref.current.currentSessionId()).toBe(null);
  await act(async () => ref.current.goToList());
  await update({ sessions });
  expect(ref.current.currentSessionId()).toBe(null);
});
test("late list arrival cannot override an explicit open while preferences hydrate", async () => {
  props.continuityReady = false;
  props.sessionsLoaded = false;
  await mount();
  await act(async () => ref.current.openSession("nova-newer"));
  await update({ continuityReady: true, sessionsLoaded: true });
  expect(ref.current.currentSessionId()).toBe("nova-newer");
});
test("a replaced installation or unavailable identity never restores the previous producer's chat", async () => {
  props.continuitySourceId = continuitySourceId("installation-b", window.location.origin);
  await mount();
  expect(ref.current.currentSessionId()).toBe(null);
  await update({ continuitySourceId: null, familiar: sage });
  expect(ref.current.currentSessionId()).toBe(null);
});
