// @ts-nocheck — react-test-renderer has no declarations in this repository.
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const calls = vi.hoisted(() => ({ announce: vi.fn(), copy: vi.fn(async () => true) }));
vi.mock("@/lib/use-focus-trap", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/use-focus-trap")>()),
  useFocusTrap: () => {},
}));
vi.mock("@/components/ui/live-region", () => ({ useAnnouncer: () => ({ announce: calls.announce }) }));
vi.mock("@/components/message-bubble", () => ({ MarkdownBlock: ({ text }) => <div>{text}</div> }));
vi.mock("@/components/ui/relative-time", () => ({ RelativeTime: () => null }));
vi.mock("@/lib/clipboard", () => ({ copyText: calls.copy }));
vi.mock("@/lib/research-media-client", () => ({ useResearchMediaUrl: () => ({ url: null, status: "idle" }) }));
vi.mock("@/components/ui/authed-image", () => ({ AuthedImage: () => null }));
vi.mock("@/lib/authed-image", () => ({ useAuthedImageState: () => ({ url: null, status: "error" }) }));
import { GenerationReviewModal, GenerationViewerModal, MarkdownEditorModal, downloadGenerationMarkdown, generationContentToMarkdown } from "./research-studio-modals";
let tree;
const scene = { id: "scene-1", title: "Visible scene title", bullets: ["Visible slide bullet"], narration: "Spoken narration" };
const generation = (kind, content) => ({ id: "gen-1", familiarId: "researcher", sourceTitle: "Research", sourceMissionId: "mission-1", status: "ready", createdAt: "2026-10-11T12:00:00.000Z", kind, content });
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); calls.announce.mockClear(); });
afterEach(() => { act(() => tree?.unmount()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
for (const kind of ["short-video", "long-video"]) {
  test(`${kind} review shows every visual and spoken field before approval`, () => {
    const content = kind === "short-video" ? { kind, storyboard: [scene] } : { kind, chapters: [{ id: "chapter", title: "Chapter", scenes: [scene] }] };
    act(() => { tree = create(<GenerationReviewModal generation={generation(kind, content)} rendering={false} error={null} onRender={() => {}} onClose={() => {}} />); });
    const output = JSON.stringify(tree.toJSON());
    for (const text of [scene.title, scene.bullets[0], scene.narration]) expect(output).toContain(text);
  });
}
test("failed infographic export is visible, announced, and retryable", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));
  act(() => { tree = create(<GenerationViewerModal generation={generation("infographic", { kind: "infographic", stats: [{ value: "42%", context: "A finding" }] })} onClose={() => {}} />); });
  const button = () => tree.root.findAllByType("button").find(node => node.children.join("").includes("Download .png"));
  await act(async () => { await button().props.onClick(); });
  expect(JSON.stringify(tree.toJSON())).toContain("Download failed");
  expect(calls.announce).toHaveBeenCalledWith(expect.stringContaining("Download failed"), "assertive");
  expect(button().props.disabled).toBe(false);
});

const formats = [
  { kind: "diagram", mermaid: "graph TD; A-->B" },
  { kind: "blog", title: "Blog title", markdown: "# Cited research" },
  { kind: "slides", slides: [{ title: "First slide", bullets: ["First finding"] }, { title: "Second slide", bullets: ["Second finding"] }] },
  { kind: "infographic", stats: [{ value: "42%", context: "Cited finding" }] },
  { kind: "thread", posts: [{ pre: "1/2", text: "First post" }, { pre: "2/2", text: "Second post" }] },
  { kind: "podcast", script: [{ id: "segment", speaker: "host", text: "Cited narration" }] },
  { kind: "short-video", storyboard: [scene] },
  { kind: "long-video", chapters: [{ id: "chapter", title: "Chapter", scenes: [scene] }] },
];
for (const content of formats) {
  test(`${content.kind} exports its actual content as Markdown`, async () => {
    const record = generation(content.kind, content);
    const anchor = { click: vi.fn(), remove: vi.fn(), href: "", download: "" };
    vi.stubGlobal("document", { createElement: () => anchor, body: { appendChild: vi.fn() } });
    let blob;
    vi.spyOn(URL, "createObjectURL").mockImplementation(value => { blob = value; return "blob:export"; });
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    downloadGenerationMarkdown(record);
    expect(await blob.text()).toBe(generationContentToMarkdown(record));
    expect(await blob.text()).not.toBe("");
    expect(anchor.download).toBe(`${content.kind}-research.md`);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("blob:export");
  });
}
test("slides navigate forwards, backwards and by thumbnail", () => {
  act(() => { tree = create(<GenerationViewerModal generation={generation("slides", formats[2])} onClose={() => {}} />); });
  const title = () => tree.root.findByProps({ className: "research-studio-viewer__slide-title" }).children.join("");
  expect(title()).toBe("First slide");
  act(() => tree.root.findByProps({ "aria-label": "Next slide" }).props.onClick());
  expect(title()).toBe("Second slide");
  act(() => tree.root.findByProps({ "aria-label": "Previous slide" }).props.onClick());
  expect(title()).toBe("First slide");
  act(() => tree.root.findByProps({ "aria-label": "Slide 2: Second slide" }).props.onClick());
  expect(title()).toBe("Second slide");
});
test("blog editing preserves the live copy across rich preview and clipboard", async () => {
  act(() => { tree = create(<MarkdownEditorModal generation={generation("blog", formats[1])} onClose={() => {}} />); });
  act(() => tree.root.findByProps({ "aria-label": "Draft markdown" }).props.onChange({ target: { value: "# Edited research" } }));
  act(() => tree.root.findAllByType("button").find(node => node.children.join("") === "Rich preview").props.onClick());
  expect(JSON.stringify(tree.toJSON())).toContain("# Edited research");
  await act(async () => tree.root.findAllByType("button").find(node => node.children.join("").includes("Copy updated draft")).props.onClick());
  expect(calls.copy).toHaveBeenCalledWith("# Edited research");
});
test("thread copies the selected post without adding other posts", async () => {
  act(() => { tree = create(<GenerationViewerModal generation={generation("thread", formats[4])} onClose={() => {}} />); });
  const posts = tree.root.findAllByProps({ className: "research-studio-viewer__point" });
  await act(async () => posts[1].findByType("button").props.onClick());
  expect(calls.copy).toHaveBeenCalledWith("Second post");
});

test("closing the local editor restores its opener in the parked viewer", () => {
  const focus = vi.fn();
  const record = generation("blog", formats[1]);
  const stack = editing => <section>
    {/* Closed config/review slots exercise keyed sibling reconciliation. */}
    {null}
    <GenerationViewerModal key={`viewer:${record.id}`} generation={record} active={!editing} onOpenEditor={() => {}} onClose={() => {}} />
    {editing ? <MarkdownEditorModal key={`editor:${record.id}`} generation={record} onClose={() => {}} /> : null}
  </section>;
  act(() => { tree = create(stack(false), { createNodeMock: () => ({ focus }) }); });
  expect(focus).not.toHaveBeenCalled();
  act(() => tree.update(stack(true)));
  expect(focus).not.toHaveBeenCalled();
  act(() => tree.update(stack(false)));
  expect(focus).toHaveBeenCalledOnce();
});
