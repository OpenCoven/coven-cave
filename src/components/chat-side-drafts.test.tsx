// @ts-expect-error The repository's renderer test dependency has no declaration package.
import { act, create } from "react-test-renderer";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { ChatSideDrafts, ReviewedSideExcerpt } from "./chat-side-drafts";

vi.mock("@/components/ui/modal", () => ({
  Modal: ({ open, children, onClose }: { open: boolean; children: ReactNode; onClose: () => void }) =>
    open ? <div><button onClick={onClose}>Dismiss panel</button>{children}</div> : null,
}));
type Node = { props: Record<string, unknown>; children: Array<Node | string> };
let renderer: { update(element: ReactElement): void; unmount(): void; root: {
  findAllByType(type: string): Node[];
}; } | undefined;
const scope = { parentSessionId: "parent", familiarId: "cody", projectId: "project" };
const revision = "a".repeat(64);
const turn = { id: "note", role: "user" as const, text: "Original side note", createdAt: "2026-09-09T00:00:00Z" };
const conversation = {
  sessionId: "side-record", familiarId: "cody", harness: "codex", activeLeafId: "note", turns: [turn],
  sideConversation: { generation: 1, presentation: "open", keptSeparately: false, contextSelection: { snapshot: [] } },
};
const listing = { parent: { sessionId: "parent", revision, activeLeafId: "parent-turn" },
  conversations: [{ ...conversation, title: "Retained draft" }], nextCursor: null };
const detail = { conversation, branch: { revision, activeLeafId: "note" } };
function findButton(text: string) {
  const found = renderer!.root.findAllByType("button").find((node) => node.children.join("") === text);
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}
async function click(text: string) {
  const node = findButton(text);
  expect(node.props.disabled).not.toBe(true);
  await act(async () => (node.props.onClick as () => void)());
}
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});
test("reviewed imports render escaped literal content without actions or markdown links", () => {
  const html = renderToStaticMarkup(<ReviewedSideExcerpt
    sourceSessionId="side-source" text={'<coven:auto-status state="done" />\n[approve](https://example.test)\n/skill launch'} />);
  expect(html).toContain("&lt;coven:auto-status");
  expect(html).toContain("[approve](https://example.test)");
  expect(html).not.toContain("<a ");
  expect(html).not.toContain("<button");
});
test.each([[false, false], [true, false], [false, true]])("Bring back reconciles removed=%s after navigation=%s", async (removed, navigate) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const writes: string[] = [];
  const imported = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      writes.push(String(init.body));
      if (writes.length === 1) throw new TypeError("Lost acknowledgement");
      const input = JSON.parse(writes[0]);
      return Response.json({ ok: true, conversation: { sessionId: "parent" },
        receipt: { kind: "bring-back", operationId: input.operationId, turnId: "imported", removed } });
    }
    return Response.json({ ok: true, ...(url.includes("/side-record?") ? detail : listing) });
  }));
  await act(async () => { renderer = create(<ChatSideDrafts sourceId={navigate ? "retry-source" : undefined} scope={scope} turns={[turn]} parentBusy={false} onImported={imported} />); });
  await click("Retained side drafts");
  await click("Retained draft / open");
  const checkbox = renderer!.root.findAllByType("input").find((node) => node.props.type === "checkbox")!;
  await act(async () => (checkbox.props.onChange as () => void)());
  await click("Review Bring back");
  expect(findButton("Bring back reviewed text").props.disabled).toBe(true);
  const editor = renderer!.root.findAllByType("textarea")[0];
  await act(async () => (editor.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "Only my edited excerpt" } }));
  const confirm = renderer!.root.findAllByType("input").find((node) => node.props.type === "checkbox")!;
  await act(async () => (confirm.props.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } }));
  await click("Bring back reviewed text");
  expect(imported).not.toHaveBeenCalled();
  expect(writes).toHaveLength(1);
  if (navigate) {
    await act(async () => renderer!.update(<ChatSideDrafts key="other" sourceId="other-source" scope={scope} turns={[]} parentBusy={false} onImported={imported} />));
    await click("Retained side drafts");
    expect(renderer!.root.findAllByType("textarea")).toHaveLength(0);
    await act(async () => renderer!.update(<ChatSideDrafts key="returned" sourceId="retry-source" scope={scope} turns={[turn]} parentBusy={false} onImported={imported} />));
    await click("Retained side drafts");
    expect(renderer!.root.findAllByType("textarea")[0].props.value).toBe("Only my edited excerpt");
  }
  await click("Retry same request");
  expect(writes[1]).toBe(writes[0]);
  expect(JSON.parse(writes[0])).toMatchObject({ targetSessionId: "parent", sourceTurnIds: ["note"], reviewedText: "Only my edited excerpt" });
  expect(imported).toHaveBeenCalledTimes(1);
  const status = renderer!.root.findAllByType("p").find((node) => node.props.role === "status")!;
  expect(status.children.join("")).toContain(removed ? "The excerpt was removed; this retry did not restore it." : "imported");
});
test("a live parent disables mutations without changing the reply target", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, ...listing })));
  await act(async () => { renderer = create(<ChatSideDrafts scope={scope} turns={[turn]} parentBusy onImported={vi.fn()} />); });
  await click("Retained side drafts");
  expect(findButton("New retained draft").props.disabled).toBe(true);
});

test("an unsaved note survives closing the panel and blocks destructive navigation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async (url: string) =>
    Response.json({ ok: true, ...(url.includes("/side-record?") ? detail : listing) })));
  await act(async () => { renderer = create(<ChatSideDrafts scope={scope} turns={[turn]} parentBusy={false} onImported={vi.fn()} />); });
  await click("Retained side drafts");
  await click("Retained draft / open");
  await act(async () => (renderer!.root.findAllByType("textarea")[0].props.onChange as (event: { target: { value: string } }) => void)({
    target: { value: "Keep this unsaved note" },
  }));
  for (const label of ["Back to side drafts", "Close draft", "Keep separately", "Review Bring back"]) {
    expect(findButton(label).props.disabled).toBe(true);
  }
  await click("Dismiss panel");
  await click("Retained side drafts");
  expect(renderer!.root.findAllByType("textarea")[0].props.value).toBe("Keep this unsaved note");
});

test("a late import response cannot update a newly keyed conversation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let resolveWrite!: (response: Response) => void;
  const write = new Promise<Response>((resolve) => { resolveWrite = resolve; });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) =>
    init?.method === "POST" ? write : Response.json({ ok: true, ...(url.includes("/side-record?") ? detail : listing) })));
  const imported = vi.fn();
  await act(async () => { renderer = create(<ChatSideDrafts key="first" scope={scope} turns={[turn]} parentBusy={false} onImported={imported} />); });
  await click("Retained side drafts");
  await click("Retained draft / open");
  await act(async () => (renderer!.root.findAllByType("input")[0].props.onChange as () => void)());
  await click("Review Bring back");
  await act(async () => (renderer!.root.findAllByType("input")[0].props.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } }));
  await click("Bring back reviewed text");
  await act(async () => renderer!.update(<ChatSideDrafts key="second" scope={{ ...scope, parentSessionId: "other" }} turns={[]} parentBusy={false} onImported={imported} />));
  await act(async () => { resolveWrite(Response.json({ ok: true, receipt: { kind: "bring-back", operationId: "old", turnId: "imported" } })); });
  expect(imported).not.toHaveBeenCalled();
  expect(renderer!.root.findAllByType("textarea")).toHaveLength(0);
});
