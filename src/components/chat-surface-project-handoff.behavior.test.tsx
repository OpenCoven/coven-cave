// @ts-nocheck
import { act, create } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import { ChatSurface } from "./chat-surface";
import { CHAT_OPEN_PROJECTS_EVENT, consumeProjectsTabPending, markProjectsTabPending } from "@/lib/chat-tab-events";

vi.mock("@/components/chat-router", () => ({ ChatRouter: () => <div data-chat /> }));
vi.mock("@/components/lazy-surfaces", () => ({
  ChatFamiliarView: () => null, GroupChatView: () => null,
  ProjectsView: () => <div data-projects />, WorkspaceRail: () => null,
}));
vi.mock("@/lib/use-projects", () => ({ useProjects: () => ({ projects: [], loading: false, loadedSuccessfully: true, error: null }) }));
vi.mock("@/lib/use-project-overrides", () => ({ useProjectOverrides: () => ({}) }));
vi.mock("@/lib/use-workspace-rail-controller", () => ({ useWorkspaceRailController: () => ({ rail: {}, showInline: false }) }));
vi.mock("@/lib/familiar-resolve", () => ({ useResolvedFamiliars: () => [] }));
vi.mock("@/lib/chat-debug-store", () => ({ useChatDebugSnapshot: () => ({}), requestDebugOpen: vi.fn() }));
vi.mock("@/lib/use-measured-width", () => ({ useMeasuredWidth: () => 1200 }));
vi.mock("@/components/workspace-sidebar", () => ({ SidebarChatsSection: () => null }));
vi.mock("@/components/workspace-rail-sheet", () => ({ WorkspaceRailSheet: () => null }));
vi.mock("@/components/chat-threads-sheet", () => ({ ChatThreadsSheet: () => null }));
vi.mock("@/components/chat-thread-rail", () => ({ ChatThreadRail: () => null }));
vi.mock("@/components/code-rail-reopen", () => ({ CodeRailReopen: () => null }));
vi.mock("@/components/ui/separator-handle", () => ({ SeparatorHandle: () => null }));
vi.mock("@/lib/icon", () => ({ Icon: () => null }));
vi.mock("react-resizable-panels", () => ({
  useDefaultLayout: () => ({}), Group: ({ children }) => <div>{children}</div>,
  Panel: ({ children }) => <div>{children}</div>, Separator: () => null,
}));
vi.mock("@/components/ui/tabs", () => ({ Tabs: ({ value, onChange }) => <button data-scope={value} onClick={() => onChange("conversation")}>Chats</button> }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { consumeProjectsTabPending(); vi.unstubAllGlobals(); });

test("an already-mounted Projects handoff does not reopen Projects on a later Chat mount", async () => {
  const events = new EventTarget();
  const storage = new Map();
  vi.stubGlobal("CustomEvent", class extends Event { constructor(type, options = {}) { super(type); this.detail = options.detail; } });
  vi.stubGlobal("window", {
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events), setTimeout, clearTimeout,
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  const props = { familiars: [], sessions: [], activeFamiliar: null, activeFamiliarId: null,
    selectedFamiliarIds: new Set(), daemonRunning: false, routerRef: { current: null }, pendingProjectRoot: null,
    onSetActiveFamiliar() {}, onFamiliarScopeChange() {}, onPendingChatActionHandled() {}, onSessionStarted() {},
    onSlashFromChat() {}, onOpenOnboarding() {}, onSessionsDeleted() {}, hideThreadRail: true,
  };
  let renderer;
  await act(async () => { renderer = create(<ChatSurface {...props} />); });
  await act(async () => { markProjectsTabPending(); window.dispatchEvent(new Event(CHAT_OPEN_PROJECTS_EVENT)); });
  expect(renderer.root.findAllByProps({ "data-projects": true })).toHaveLength(1);
  await act(async () => { renderer.root.findByProps({ "data-scope": "projects" }).props.onClick(); });
  await act(async () => { renderer.unmount(); });
  await act(async () => { renderer = create(<ChatSurface {...props} />); });
  expect(renderer.root.findAllByProps({ "data-projects": true })).toHaveLength(0);
  await act(async () => { renderer.unmount(); });
});
