import { Component, createElement, StrictMode, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
// @ts-expect-error The repository uses react-test-renderer without its declaration package.
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { RoleSurfaceContext } from "@/lib/role-surfaces";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let renderer: ReactTestRenderer | null = null;

beforeEach(() => { vi.resetModules(); });
afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount());
  renderer = null;
  vi.doUnmock("./researcher-surface");
});

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const context = (id: string) => ({ activeFamiliar: { id } }) as RoleSurfaceContext;

async function fixture() {
  const gate = deferred();
  const imported = vi.fn(async () => {
    await gate.promise;
    return {
      ResearcherSurface: ({ context: value }: { context: RoleSurfaceContext }) =>
        createElement("p", null, value.activeFamiliar.id),
    };
  });
  vi.doMock("./researcher-surface", imported);
  const { ResearcherSurfaceLoader } = await import("./researcher-surface-loader");
  const view = (id: string) => createElement(ResearcherSurfaceLoader, {
    context: context(id), fallback: createElement("span", null, "Loading"),
  });
  return { gate, imported, view };
}

test("loads once under StrictMode, mounts with current context, and reuses a warm module", async () => {
  const { gate, imported, view } = await fixture();
  await act(async () => { renderer = create(createElement(StrictMode, null, view("first"))); });
  expect(renderer!.toJSON()).toMatchObject({ type: "span", children: ["Loading"] });
  await act(async () => { renderer!.update(createElement(StrictMode, null, view("second"))); });
  await act(async () => { gate.resolve(); await vi.dynamicImportSettled(); });
  expect(renderer!.toJSON()).toMatchObject({ type: "p", children: ["second"] });
  expect(imported).toHaveBeenCalledTimes(1);
  await act(async () => { renderer!.unmount(); renderer = create(view("third")); });
  expect(renderer!.toJSON()).toMatchObject({ type: "p", children: ["third"] });
  expect(imported).toHaveBeenCalledTimes(1);
});

test("late load after unmount only warms the module and does not revive the old room", async () => {
  const { gate, view } = await fixture();
  await act(async () => { renderer = create(view("departed")); });
  await act(async () => { renderer!.unmount(); });
  await act(async () => { gate.resolve(); await vi.dynamicImportSettled(); });
  expect(renderer!.toJSON()).toBeNull();
  await act(async () => { renderer = create(view("current")); });
  expect(renderer!.toJSON()).toMatchObject({ type: "p", children: ["current"] });
});

test("load failures reach the room host's error boundary", async () => {
  const { gate, view } = await fixture();
  class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    render() { return this.state.failed ? createElement("p", null, "Return to Cave") : this.props.children; }
  }
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await act(async () => { renderer = create(createElement(Boundary, null, view("first"))); });
    await act(async () => { gate.reject(new Error("Chunk unavailable")); await vi.dynamicImportSettled(); });
    expect(renderer!.toJSON()).toMatchObject({ children: ["Return to Cave"] });
  } finally { errors.mockRestore(); }
});

test("server rendering keeps the fallback and does not import the browser room", async () => {
  const { imported, view } = await fixture();
  expect(renderToString(view("server"))).toBe("<span>Loading</span>");
  expect(imported).not.toHaveBeenCalled();
});
