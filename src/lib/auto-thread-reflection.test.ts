import { afterEach, expect, it, vi } from "vitest";
import { runAutoReflectionIfMissing } from "./auto-thread-reflection";

afterEach(() => vi.unstubAllGlobals());
it("skips paid generation when the exact persisted session report exists", async () => {
  const fetchReport = vi.fn(async () => Response.json({ ok: true, report: { sessionId: "thread" } }));
  vi.stubGlobal("fetch", fetchReport);
  const generate = vi.fn(async () => {});
  await runAutoReflectionIfMissing("cody", "thread", generate);
  expect(fetchReport).toHaveBeenCalledWith("/api/familiars/cody/self-reports/thread");
  expect(generate).not.toHaveBeenCalled();
});
it.each([404, 403, 500])("allows best-effort generation after lookup status %s", async (status) => {
  const order: string[] = [];
  vi.stubGlobal("fetch", async () => { order.push("lookup"); return Response.json({ ok: false }, { status }); });
  await runAutoReflectionIfMissing("cody", "thread", async () => { order.push("generate"); });
  expect(order).toEqual(["lookup", "generate"]);
});
it("continues after lookup transport failure but does not retry failed generation", async () => {
  vi.stubGlobal("fetch", async () => { throw new Error("offline"); });
  const generate = vi.fn(async () => { throw new Error("generation failed"); });
  await expect(runAutoReflectionIfMissing("cody", "thread", generate)).rejects.toThrow("generation failed");
  expect(generate).toHaveBeenCalledTimes(1);
});
it("does not mistake a malformed successful lookup for a persisted report", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ ok: true }));
  const generate = vi.fn(async () => {});
  await runAutoReflectionIfMissing("cody", "thread", generate);
  expect(generate).toHaveBeenCalledTimes(1);
});

it.each([
  () => Response.json({ ok: true, report: { sessionId: "different-thread" } }),
  () => new Response("broken-json", { status: 200 }),
])("does not skip generation for a different session or invalid JSON", async (response) => {
  vi.stubGlobal("fetch", async () => response());
  const generate = vi.fn(async () => {});
  await runAutoReflectionIfMissing("cody", "thread", generate);
  expect(generate).toHaveBeenCalledTimes(1);
});
