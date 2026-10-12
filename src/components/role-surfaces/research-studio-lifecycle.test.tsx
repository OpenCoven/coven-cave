// @ts-nocheck — react-test-renderer has no declarations in this repository.
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const api = vi.hoisted(() => ({ poll: null, list: vi.fn(), create: vi.fn(), cancel: vi.fn(), remove: vi.fn(), readiness: vi.fn(), announce: vi.fn() }));
vi.mock("@/lib/research-generations", async (load) => ({
  ...await load(), listResearchGenerations: api.list,
  createResearchGeneration: api.create, cancelResearchGeneration: api.cancel, removeResearchGeneration: api.remove, getResearchGenerationReadiness: api.readiness,
}));
vi.mock("@/lib/use-pausable-poll", () => ({ usePausablePoll: (callback, interval) => { if (interval === 1500) api.poll = callback; } }));
vi.mock("@/components/ui/live-region", () => ({ useAnnouncer: () => ({ announce: api.announce }) }));
vi.mock("@/components/ui/relative-time", () => ({ RelativeTime: () => null }));
vi.mock("./research-studio-modals", () => ({
  GenerationConfigModal: (props) => <div data-config={props.kind}><button data-create onClick={props.onSubmit}>Create</button><button data-close onClick={props.onClose}>Close</button></div>,
  GenerationReviewModal: () => <div data-review />,
  GenerationViewerModal: () => null, MarkdownEditorModal: () => null, StudioMermaidDiagram: () => null,
  generationStatusText: (generation) => generation.status,
  generationTitle: (generation) => generation.sourceTitle,
  missionHasMarkdownArtifact: () => true,
  studioMetaForKind: (kind) => ({ label: kind, glyph: "", format: kind, blurb: "", tags: [] }),
  useCopyFlash: () => ({ flash: null, copy: () => {} }),
}));

import { ResearchTabStudio } from "./research-tab-studio";

let tree;
function studio(familiarId) {
  return <ResearchTabStudio context={{ activeFamiliar: { id: familiarId } }}
    research={{ missions: [{ id: `mission-${familiarId}`, title: `Research ${familiarId}` }] }} onNavigate={() => {}} />;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.list.mockReset().mockResolvedValue({ ok: true, generations: [] });
  api.readiness.mockReset().mockResolvedValue({ ok: false });
  api.create.mockReset(); api.cancel.mockReset(); api.remove.mockReset(); api.announce.mockClear();
});
afterEach(() => { act(() => tree?.unmount()); vi.unstubAllGlobals(); });

test("switching familiar clears Studio configuration and ignores a late creation response", async () => {
  let resolve;
  api.create.mockImplementation(() => new Promise(done => { resolve = done; }));
  await act(async () => { tree = create(studio("alpha")); });
  act(() => tree.root.findByProps({ "data-kind": "blog" }).props.onClick());
  await act(async () => { void tree.root.findByProps({ "data-create": true }).props.onClick(); });
  expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ familiarId: "alpha", sourceMissionId: "mission-alpha" }));

  await act(async () => tree.update(studio("beta")));
  expect(tree.root.findAllByProps({ "data-config": "blog" })).toHaveLength(0);
  await act(async () => resolve({ ok: true, generation: {
    id: "alpha-result", familiarId: "alpha", kind: "blog", sourceTitle: "Alpha draft",
    sourceMissionId: "mission-alpha", status: "ready", createdAt: "2026-10-11T12:00:00.000Z",
    content: { kind: "blog", title: "Alpha draft", markdown: "Alpha research" },
  } }));
  expect(tree.root.findAllByProps({ "data-generation-id": "alpha-result" })).toHaveLength(0);
  expect(api.announce).not.toHaveBeenCalled();
});

function draft(id = "new-result") {
  return { id, familiarId: "alpha", kind: "blog", sourceTitle: id,
    sourceMissionId: "mission-alpha", status: "ready", createdAt: "2026-10-11T12:00:00.000Z",
    content: { kind: "blog", title: id, markdown: "Research" } };
}

test("a stale list cannot erase a created draft and triggers an authoritative refresh", async () => {
  let resolveList;
  api.list.mockImplementationOnce(() => new Promise(done => { resolveList = done; }));
  api.create.mockResolvedValue({ ok: true, generation: draft() });
  api.list.mockResolvedValue({ ok: true, generations: [draft(), draft("existing-result")] });
  await act(async () => { tree = create(studio("alpha")); });
  act(() => tree.root.findByProps({ "data-kind": "blog" }).props.onClick());
  await act(async () => { await tree.root.findByProps({ "data-create": true }).props.onClick(); });
  await act(async () => resolveList({ ok: true, generations: [] }));
  expect(tree.root.findAllByProps({ "data-generation-id": "new-result" })).toHaveLength(1);
  expect(tree.root.findAllByProps({ "data-generation-id": "existing-result" })).toHaveLength(1);
  expect(api.list).toHaveBeenCalledTimes(2);
});

test("a creation finishing after the dialog is replaced preserves the new dialog", async () => {
  let resolveCreate;
  api.create.mockImplementation(() => new Promise(done => { resolveCreate = done; }));
  await act(async () => { tree = create(studio("alpha")); });
  act(() => tree.root.findByProps({ "data-kind": "blog" }).props.onClick());
  await act(async () => { void tree.root.findByProps({ "data-create": true }).props.onClick(); });
  act(() => tree.root.findByProps({ "data-close": true }).props.onClick());
  act(() => tree.root.findByProps({ "data-kind": "thread" }).props.onClick());
  await act(async () => resolveCreate({ ok: true, generation: draft() }));
  expect(tree.root.findAllByProps({ "data-config": "thread" })).toHaveLength(1);
  expect(tree.root.findAllByProps({ "data-generation-id": "new-result" })).toHaveLength(1);
});

test("readiness failure offers a retry instead of leaving media loading forever", async () => {
  api.readiness.mockResolvedValue({ ok: false, error: "Provider check unavailable" });
  await act(async () => { tree = create(studio("alpha")); });
  expect(JSON.stringify(tree.toJSON())).toContain("Provider check unavailable");
  const retry = tree.root.findByProps({ "aria-label": "Retry media readiness" });
  await act(async () => { await retry.props.onClick(); });
  expect(api.readiness).toHaveBeenCalledTimes(2);
});

test("a late media retry cannot replace a newly opened viewer", async () => {
  const failed = { ...draft("failed-media"), kind: "podcast", status: "failed", content: { kind: "podcast", script: [] } };
  api.list.mockResolvedValue({ ok: true, generations: [failed, draft("blog")] });
  let resolveCreate;
  api.create.mockImplementation(() => new Promise(done => { resolveCreate = done; }));
  await act(async () => { tree = create(studio("alpha")); });
  const row = tree.root.findByProps({ "data-generation-id": "failed-media" });
  const retry = row.findAllByType("button").find(node => node.children.join("") === "Retry");
  await act(async () => { void retry.props.onClick(); });
  const blog = tree.root.findByProps({ "data-generation-id": "blog" });
  act(() => blog.findByProps({ className: "research-studio-row__title" }).props.onClick());
  await act(async () => resolveCreate({ ok: true, generation: { ...failed, id: "retried-media", status: "draft" } }));
  expect(tree.root.findAllByProps({ "data-review": true })).toHaveLength(0);
  expect(tree.root.findAllByProps({ "data-generation-id": "retried-media" })).toHaveLength(1);
});

test("repeated cancellation while pending sends one mutation", async () => {
  const queued = { ...draft(), kind: "podcast", status: "queued", content: { kind: "podcast", script: [] } };
  api.list.mockResolvedValue({ ok: true, generations: [queued] });
  let resolveCancel;
  api.cancel.mockImplementation(() => new Promise(done => { resolveCancel = done; }));
  await act(async () => { tree = create(studio("alpha")); });
  const cancel = tree.root.findAllByType("button").find(node => node.children.join("") === "Cancel");
  await act(async () => { void cancel.props.onClick(); void cancel.props.onClick(); });
  expect(api.cancel).toHaveBeenCalledTimes(1);
  await act(async () => resolveCancel({ ok: true, generation: { ...queued, status: "cancelled" } }));
});
test("repeated removal while pending sends one mutation", async () => {
  api.list.mockResolvedValue({ ok: true, generations: [draft()] });
  let resolveRemove;
  api.remove.mockImplementation(() => new Promise(done => { resolveRemove = done; }));
  await act(async () => { tree = create(studio("alpha")); });
  act(() => tree.root.findAllByType("button").find(node => node.children.join("") === "✕ Remove").props.onClick());
  const remove = tree.root.findAllByType("button").find(node => node.children.join("") === "Remove");
  await act(async () => { void remove.props.onClick(); void remove.props.onClick(); });
  expect(api.remove).toHaveBeenCalledTimes(1);
  await act(async () => resolveRemove({ ok: true }));
  expect(tree.root.findAllByProps({ "data-generation-id": "new-result" })).toHaveLength(0);
});

test("removing the last generation of a selected kind keeps the active filter visible", async () => {
  const thread = { ...draft("thread-result"), kind: "thread", content: { kind: "thread", posts: [] } };
  api.list.mockResolvedValue({ ok: true, generations: [draft(), thread] });
  api.remove.mockResolvedValue({ ok: true });
  await act(async () => { tree = create(studio("alpha")); });
  const filters = () => tree.root.findByProps({ "aria-label": "Filter generations by kind" });
  act(() => filters().findAllByType("button").find(node => node.children[0] === "blog").props.onClick());
  const row = tree.root.findByProps({ "data-generation-id": "new-result" });
  act(() => row.findAllByType("button").find(node => node.children.join("") === "✕ Remove").props.onClick());
  await act(async () => row.findAllByType("button").find(node => node.children.join("") === "Remove").props.onClick());

  const active = filters().findAllByType("button").find(node => node.props["aria-pressed"]);
  expect(active).toBeDefined();
  expect(active.children[0]).toBe("blog");
  expect(active.findByType("span").children).toEqual(["0"]);
  expect(tree.root.findAllByProps({ "data-generation-id": "thread-result" })).toHaveLength(0);
  act(() => filters().findAllByType("button").find(node => node.children[0] === "All ").props.onClick());
  expect(tree.root.findAllByProps({ "data-generation-id": "thread-result" })).toHaveLength(1);
});

test("a late retry response cannot restore a generation already removed after polling", async () => {
  const failed = { ...draft("failed"), kind: "podcast", status: "failed", content: { kind: "podcast", script: [] } };
  const active = { ...failed, id: "active", status: "queued" };
  const retried = { ...failed, id: "retried", status: "draft" };
  api.list.mockResolvedValue({ ok: true, generations: [failed, active] });
  let resolveCreate;
  api.create.mockImplementation(() => new Promise(done => { resolveCreate = done; }));
  api.remove.mockResolvedValue({ ok: true });
  await act(async () => { tree = create(studio("alpha")); });
  const retry = tree.root.findByProps({ "data-generation-id": "failed" }).findAllByType("button").find(node => node.children.join("") === "Retry");
  await act(async () => { void retry.props.onClick(); });
  api.list.mockResolvedValue({ ok: true, generations: [failed, active, retried] });
  await act(async () => api.poll());
  const row = tree.root.findByProps({ "data-generation-id": "retried" });
  act(() => row.findAllByType("button").find(node => node.children.join("") === "✕ Remove").props.onClick());
  await act(async () => row.findAllByType("button").find(node => node.children.join("") === "Remove").props.onClick());
  expect(tree.root.findAllByProps({ "data-generation-id": "retried" })).toHaveLength(0);
  api.announce.mockClear();
  await act(async () => resolveCreate({ ok: true, generation: retried }));
  expect(tree.root.findAllByProps({ "data-generation-id": "retried" })).toHaveLength(0);
  expect(tree.root.findAllByProps({ "data-review": true })).toHaveLength(0);
  expect(api.announce).not.toHaveBeenCalled();
});
