// @ts-nocheck
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useAttachmentStaging } from "./use-attachment-staging";
import { fileToAttachment } from "./chat-attachments";
import { HomeAttachmentDraftProvider, useHomeAttachmentDraft } from "@/components/home/home-attachment-draft";
import { LiveRegionProvider } from "@/components/ui/live-region";
vi.mock("@/lib/chat-attachments", async (original) => ({
  ...await original(), fileToAttachment: vi.fn(),
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let renderer;
let staging;
function Probe() { staging = useAttachmentStaging(); return null; }
const file = (name) => new File(["evidence"], name, { type: "text/plain" });
const captured = (f) => ({ id: f.name, name: f.name, type: f.type, text: "evidence", size: f.size });
const image = (name) => new File(["image"], name, { type: "image/png" });
beforeEach(async () => {
  vi.stubGlobal("window", new EventTarget());
  vi.mocked(fileToAttachment).mockReset().mockImplementation(async (f) => captured(f));
  await act(async () => { renderer = create(createElement(Probe)); });
});
afterEach(async () => { await act(async () => renderer.unmount()); vi.unstubAllGlobals(); });
test("one unreadable file does not discard readable siblings or escape as an unhandled rejection", async () => {
  vi.mocked(fileToAttachment).mockImplementation(async (f) => {
    if (f.name === "bad.txt") throw new Error("file read failed");
    return captured(f);
  });
  await act(async () => staging.addFiles([file("good.txt"), file("bad.txt")]));
  expect(staging.attachments.map(f => f.name)).toEqual(["good.txt"]);
  expect(staging.notice).toMatch(/bad.txt.*couldn.t be read/i);
  expect(staging.isReading).toBe(false);
});
test("oversized files without a payload are not staged as successfully attached", async () => {
  vi.mocked(fileToAttachment).mockResolvedValue({ id: "large", name: "large.png", size: 6000000, truncated: true });
  await act(async () => staging.addFiles([file("large.png")]));
  expect(staging.attachments).toEqual([]);
  expect(staging.notice).toMatch(/large.png.*too large/i);
});
test("overlapping reads reserve slots so the ten-file limit cannot be exceeded", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  vi.mocked(fileToAttachment).mockImplementation(async f => { await gate; return captured(f); });
  let first, second;
  await act(async () => {
    first = staging.addFiles(Array.from({ length: 9 }, (_, i) => file(`first-${i}.txt`)));
    second = staging.addFiles(Array.from({ length: 9 }, (_, i) => file(`second-${i}.txt`)));
  });
  expect(staging.isReading).toBe(true);
  expect(fileToAttachment).toHaveBeenCalledTimes(10);
  await act(async () => { release(); await Promise.all([first, second]); });
  expect(staging.attachments).toHaveLength(10);
  expect(staging.notice).toMatch(/10 other files/);
});
test("fifty images can stage while non-image files remain capped at ten", async () => {
  await act(async () => staging.addFiles(Array.from({ length: 51 }, (_, i) => image(`image-${i}.png`))));
  expect(staging.attachments).toHaveLength(50);
  expect(staging.notice).toMatch(/50 images/);
  await act(async () => staging.clearAttachments());
  await act(async () => staging.addFiles(Array.from({ length: 11 }, (_, i) => file(`file-${i}.txt`))));
  expect(staging.attachments).toHaveLength(10);
  await act(async () => staging.addFiles(Array.from({ length: 40 }, (_, i) => image(`mixed-${i}.png`))));
  expect(staging.attachments).toHaveLength(50);
});
test("clearing staging invalidates outstanding reads without resurrecting old attachments", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  vi.mocked(fileToAttachment).mockImplementation(async f => { await gate; return captured(f); });
  let pending;
  await act(async () => { pending = staging.addFiles([file("old.txt")]); });
  await act(async () => staging.clearAttachments());
  await act(async () => { release(); await pending; });
  expect(staging.attachments).toEqual([]);
  expect(staging.isReading).toBe(false);
});


function DraftProbe() { staging = useHomeAttachmentDraft(); return null; }
const draftTree = (visible = true) => createElement(LiveRegionProvider, null,
  createElement(HomeAttachmentDraftProvider, null, visible ? createElement(DraftProbe) : null));
async function mountDraft() {
  await act(async () => { renderer.unmount(); renderer = create(draftTree()); });
}
for (const finishAway of [true, false]) {
  test(`a document-owned pending read survives its Home consumer leaving and finishing ${finishAway ? "away" : "after returning"}`, async () => {
    await mountDraft();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    vi.mocked(fileToAttachment).mockImplementation(async f => { await gate; return captured(f); });
    let pending;
    await act(async () => { pending = staging.addFiles([file("pending.txt")]); });
    expect(staging.isReading).toBe(true);
    await act(async () => renderer.update(draftTree(false)));
    if (finishAway) await act(async () => { release(); await pending; });
    await act(async () => renderer.update(draftTree()));
    if (!finishAway) {
      expect(staging.isReading).toBe(true);
      await act(async () => { release(); await pending; });
    }
    expect(staging.attachments.map(({ name, text }) => ({ name, text }))).toEqual([{ name: "pending.txt", text: "evidence" }]);
    expect(staging.isReading).toBe(false);
  });
}
test("document draft retains staged bytes but a new document cannot inherit them", async () => {
  await mountDraft();
  await act(async () => staging.addFiles([file("first.txt"), file("second.txt")]));
  const bytes = staging.attachments;
  await act(async () => renderer.update(draftTree(false)));
  await act(async () => renderer.update(draftTree()));
  expect(staging.attachments).toEqual(bytes);
  await act(async () => staging.removeAttachment("first.txt"));
  await act(async () => renderer.update(draftTree(false)));
  await act(async () => renderer.update(draftTree()));
  expect(staging.attachments.map(f => f.name)).toEqual(["second.txt"]);
  await mountDraft();
  expect(staging.attachments).toEqual([]);
});
test("clearing the document draft while Home is away invalidates late reads", async () => {
  await mountDraft();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  vi.mocked(fileToAttachment).mockImplementation(async f => { await gate; return captured(f); });
  let pending;
  await act(async () => { pending = staging.addFiles([file("old.txt")]); });
  await act(async () => renderer.update(draftTree(false)));
  await act(async () => { staging.clearAttachments(); release(); await pending; });
  await act(async () => renderer.update(draftTree()));
  expect(staging.attachments).toEqual([]);
  expect(staging.isReading).toBe(false);
});
test("resetting the drop target removes transient drag state without clearing draft bytes", async () => {
  await mountDraft();
  await act(async () => staging.addFiles([file("keep.txt")]));
  await act(async () => staging.dropHandlers.onDragEnter({ dataTransfer: { types: ["Files"] }, preventDefault() {} }));
  expect(staging.dropActive).toBe(true);
  await act(async () => staging.resetDropTarget());
  expect(staging.dropActive).toBe(false);
  expect(staging.attachments[0].name).toBe("keep.txt");
});
test("unsaved or pending document files guard unload until explicitly cleared", async () => {
  await mountDraft();
  const unload = () => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  expect(unload()).toBe(false);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  vi.mocked(fileToAttachment).mockImplementation(async f => { await gate; return captured(f); });
  let pending;
  await act(async () => { pending = staging.addFiles([file("pending.txt")]); });
  expect(unload()).toBe(true);
  await act(async () => { release(); await pending; });
  expect(unload()).toBe(true);
  await act(async () => renderer.update(draftTree(false)));
  expect(unload()).toBe(true);
  await act(async () => staging.clearAttachments());
  expect(unload()).toBe(false);
});
