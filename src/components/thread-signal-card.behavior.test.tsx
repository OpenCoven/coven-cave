import { createElement } from "react";
// @ts-expect-error -- react-test-renderer has no declarations in this repository.
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import { ThreadSignalCard } from "./thread-signal-card";
import { LiveRegionProvider } from "./ui/live-region";
import type { ThreadSelfReport } from "@/lib/thread-self-report";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(() => ({ ok: true, destination: "workspace" })), failure: undefined as undefined | ((detail: { requestId: string; error: string }) => void) }));
vi.mock("@/lib/agents-new-chat", () => ({ requestAgentsNewChat: fixture.dispatch, subscribeRightChatFailures: (listener: (detail: { requestId: string; error: string }) => void) => { fixture.failure = listener; return () => { fixture.failure = undefined; }; } }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const report: ThreadSelfReport = {
  id: "report-6484", familiarId: "nova", sessionId: "synthetic-source", reportedAt: "2026-11-14T10:00:00Z",
  overallConfidence: 90, toolReliability: { score: 90, failedTools: [], unreliableTools: [] },
  contextPressure: "adequate", skillsUsed: [], skillsNeedingClarity: [], skillsNeedingAccess: [],
  capabilitiesLacking: [], capabilitiesVital: [], memoryRecallScore: 90, fileLocatabilityScore: 90,
  persistentBlockers: [{ id: "write-boundary", title: "Write boundary unavailable", category: "tooling", impact: "blocking", detail: "Synthetic runtime cannot apply scoped writes." }],
};
let renderer: ReactTestRenderer | undefined;
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); fixture.dispatch.mockClear(); });

test("an unsupported write boundary is explained before a signal thread can dispatch", async () => {
  vi.stubGlobal("window", Object.assign(new EventTarget(), { setTimeout, clearTimeout }));
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, available: false, revision: "old-runtime", error: "Claude cannot enforce project write access. Choose a compatible runtime." })));
  await act(async () => { renderer = create(createElement(LiveRegionProvider, null,
    createElement(ThreadSignalCard, { report, onViewFull() {}, onDismiss() {} }))); });
  // Open the real signal disclosure, then exercise its action if available.
  const row = renderer!.root.findAllByType("button").find((entry: { props: { className?: string } }) => entry.props.className?.includes("tsc-row-btn"));
  await act(async () => row!.props.onClick());
  const fix = renderer!.root.findAllByType("button").find((entry: { children: unknown[] }) => entry.children.some((child) => typeof child === "string" && child.startsWith("Fix in")));
  if (fix && !fix.props.disabled) await act(async () => fix.props.onClick());
  expect(fixture.dispatch).not.toHaveBeenCalled();
  expect(JSON.stringify(renderer!.toJSON())).toContain("Choose a compatible runtime");
});


test("a launch failure arriving before receipt commit remains visible and restores its action", async () => {
  vi.stubGlobal("window", Object.assign(new EventTarget(), { setTimeout, clearTimeout }));
  vi.stubGlobal("fetch", vi.fn(async (_url: string, options?: RequestInit) => {
    if (!options?.body) return Response.json({ ok: true, available: true });
    const body = JSON.parse(options.body as string);
    if (body.action === "commit") {
      fixture.failure?.({ requestId: "early-receipt", error: "Synthetic source project lookup failed" });
      return Response.json({ ok: true });
    }
    return Response.json({ ok: true, requestId: "early-receipt", accepted: ["blocker:write-boundary"] });
  }));
  await act(async () => { renderer = create(createElement(LiveRegionProvider, null,
    createElement(ThreadSignalCard, { report, onViewFull() {}, onDismiss() {} }))); });
  const primary = () => renderer!.root.findAllByType("button").find((entry: { children: unknown[] }) => entry.children.some((child) => typeof child === "string" && child.includes("critical in Build")));
  await act(async () => { primary()!.props.onClick(); });
  expect(fixture.dispatch).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(renderer!.toJSON())).toContain("Synthetic source project lookup failed");
  expect(primary()!.props.disabled).toBeFalsy();
});
