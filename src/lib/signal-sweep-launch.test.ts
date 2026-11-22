import { afterEach, expect, test, vi } from "vitest";
import { checkSignalSweepAccess, launchSignalSweep } from "./signal-sweep-launch";
import type { AgentsNewChatRequest } from "./agents-new-chat";
import type { ThreadSignalReviewItem } from "./thread-self-report";
const fixture = vi.hoisted(() => ({ dispatch: vi.fn((_request: AgentsNewChatRequest, _options?: { reservedWindow: Window }) => ({ ok: true, destination: "workspace" })) }));
vi.mock("./agents-new-chat", () => ({ requestAgentsNewChat: fixture.dispatch }));
const item = { kind: "blocker" as const, sourceId: "write-boundary", severity: "critical" as const, title: "Synthetic blocker", detail: "Synthetic prerequisite" };
afterEach(() => { vi.unstubAllGlobals(); fixture.dispatch.mockClear(); });

test("failed or malformed capability checks stay unavailable", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true })));
  expect((await checkSignalSweepAccess("nova")).available).toBe(false);
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
  expect((await checkSignalSweepAccess("nova")).available).toBe(false);
});
test("a server refusal dispatches no thread", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, error: "Write boundary unavailable" }, { status: 409 })));
  expect((await launchSignalSweep("nova", [item], { destination: "right-panel" }, () => "never")).ok).toBe(false);
  expect(fixture.dispatch).not.toHaveBeenCalled();
});
test("only newly reserved signals enter the Build prompt", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, requestId: "receipt", accepted: ["blocker:write-boundary"] })));
  const other = { ...item, sourceId: "already-requested" };
  const prompt = vi.fn((accepted: readonly ThreadSignalReviewItem[]) => accepted.map((entry) => entry.sourceId).join(","));
  const result = await launchSignalSweep("nova", [item, other], { destination: "right-panel", sourceSessionId: "source" }, prompt);
  expect(result.ok).toBe(true);
  expect(prompt).toHaveBeenCalledWith([item]);
  expect(fixture.dispatch.mock.calls[0][0]).toMatchObject({ familiarId: "nova", requestId: "receipt", sourceSessionId: "source", initialPrompt: "write-boundary", initialControls: { permissionMode: "full" } });
});
test("leaving the signal before admission releases the undispatched reservation", async () => {
  const fetcher = vi.fn(async (_url: string, _options?: RequestInit) => Response.json({ ok: true, requestId: "receipt", accepted: ["blocker:write-boundary"] }));
  vi.stubGlobal("fetch", fetcher);
  const result = await launchSignalSweep("nova", [item], { destination: "right-panel" }, () => "never", false, () => false);
  expect(result.ok).toBe(false); expect(fixture.dispatch).not.toHaveBeenCalled();
  expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string)).toMatchObject({ action: "release", familiarId: "nova", requestId: "receipt" });
});
test("standalone analytics reserves a tab synchronously and closes it on refusal", async () => {
  const close = vi.fn(); const target = { close, opener: {} };
  const open = vi.fn(() => target);
  vi.stubGlobal("window", { location: { pathname: "/dashboard/familiars/nova/analytics" }, open });
  let finish!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
  const result = launchSignalSweep("nova", [item], { destination: "right-panel" }, () => "never");
  expect(open).toHaveBeenCalledTimes(1); expect(target.opener).toBe(null);
  finish(Response.json({ ok: false, error: "Already requested" }, { status: 409 }));
  expect((await result).ok).toBe(false); expect(close).toHaveBeenCalledTimes(1);
});
