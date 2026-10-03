// @ts-expect-error -- react-test-renderer has no bundled declarations.
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useGrimoireGraphScan } from "./use-grimoire-graph-scan";

let current: ReturnType<typeof useGrimoireGraphScan>;
let root: ReactTestRenderer | undefined;
let requests: { url: string; signal: AbortSignal; resolve: (value: Response) => void }[];
function Harness({ scope }: { scope: string[] }) {
  current = useGrimoireGraphScan(new Set(scope));
  return null;
}
function render(scope: string[]) {
  act(() => { if (root) root.update(<Harness scope={scope} />); else root = create(<Harness scope={scope} />); });
}
async function respond(index: number, owner: string, ok = true) {
  await act(async () => requests[index].resolve(new Response(JSON.stringify(ok ? {
    ok: true, nodes: [{ id: owner }], edges: [], meta: { memory: { total: 1, scanned: 1, scoped: true } },
  } : { ok: false, error: "Scan unavailable" }))));
}
beforeEach(() => {
  requests = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn((url: string, { signal }: { signal: AbortSignal }) => new Promise<Response>((resolve) => requests.push({ url, signal, resolve }))));
});
afterEach(() => { act(() => root?.unmount()); root = undefined; vi.unstubAllGlobals(); });

test("scope is sent to the server before scanning and equal scope values do not refetch", async () => {
  render(["sage", "nova"]);
  expect(requests[0].url).toBe("/api/grimoire/graph?familiarId=nova&familiarId=sage");
  await respond(0, "both");
  render(["nova", "sage"]);
  expect(requests).toHaveLength(1);
  expect(current.scan?.graph.nodes[0].id).toBe("both");
});

test("changing familiar hides old data immediately and a failed request cannot revive it", async () => {
  render(["nova"]); await respond(0, "nova");
  render(["sage"]);
  expect(requests[0].signal.aborted).toBe(true);
  expect(current.scan).toBeNull();
  expect(current.scanning).toBe(true);
  await respond(1, "sage", false);
  expect(current.scan).toBeNull();
  expect(current.scanError).toBe("Scan unavailable");
  expect(current.scanning).toBe(false);
});

test("late aborted responses cannot replace a newer familiar; retry preserves same-scope data and exposes failure", async () => {
  render(["nova"]); render(["sage"]);
  await respond(1, "sage"); await respond(0, "nova");
  expect(current.scan?.graph.nodes[0].id).toBe("sage");
  act(() => current.refreshGraph());
  expect(current.scan?.graph.nodes[0].id).toBe("sage");
  await respond(2, "sage", false);
  expect(current.scan?.graph.nodes[0].id).toBe("sage");
  expect(current.scanError).toBe("Scan unavailable");
});
