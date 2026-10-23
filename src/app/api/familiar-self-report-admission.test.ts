import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  owner: undefined as string | undefined,
  mapping: undefined as string | undefined,
  archive: vi.fn(async () => null),
  archiveReview: vi.fn(async () => null),
}));
vi.mock("@/lib/cave-config", () => ({
  loadConfig: async () => ({}),
  loadState: async () => ({ sessionFamiliar: { thread: state.mapping } }),
  autoArchiveReflectedSessionLocal: state.archive,
  autoArchiveReviewRunLocal: state.archiveReview,
}));
vi.mock("@/lib/cave-conversations", () => ({
  loadConversation: async () => state.owner ? { familiarId: state.owner, updatedAt: "2026-10-20T00:00:00Z" } : null,
}));
vi.mock("@/lib/coven-daemon", () => ({ callDaemon: async () => ({ ok: false }) }));
vi.mock("@/lib/task-archive-nudge-emit", () => ({ resolveArchiveNudges: vi.fn() }));

import { POST } from "./familiars/[id]/self-report/route";
import { GET } from "./familiars/[id]/self-reports/[sessionId]/route";
import { runAutoReflectionIfMissing } from "@/lib/auto-thread-reflection";
import { listSelfReports, listMetricSnapshots } from "@/lib/server/familiar-self-reports";

const payload = JSON.stringify({
  overallConfidence: 80, toolReliability: { score: 80 }, contextPressure: "adequate",
  memoryRecallScore: 80, fileLocatabilityScore: 80,
});
let root: string;
const previousHome = process.env.COVEN_HOME;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "cave-report-admission-"));
  process.env.COVEN_HOME = root;
  state.owner = undefined;
  state.mapping = undefined;
  vi.clearAllMocks();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  if (previousHome === undefined) delete process.env.COVEN_HOME;
  else process.env.COVEN_HOME = previousHome;
  await rm(root, { recursive: true, force: true });
});
function post(trigger = "auto") {
  return POST(new Request("http://localhost/api/familiars/cody/self-report", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "thread", reviewSessionId: "review", trigger, payload }),
  }), { params: Promise.resolve({ id: "cody" }) });
}

describe("self-report route admission", () => {
  it("the client precheck skips generation after the real route persists a report", async () => {
    state.owner = "cody";
    vi.stubGlobal("fetch", async (url: string) => {
      expect(url).toBe("/api/familiars/cody/self-reports/thread");
      return GET(new Request(`http://localhost${url}`), {
        params: Promise.resolve({ id: "cody", sessionId: "thread" }),
      });
    });
    let generations = 0;
    const generateAndPersist = async () => {
      generations += 1;
      const response = await post();
      expect(response.status).toBe(200);
    };
    await runAutoReflectionIfMissing("cody", "thread", generateAndPersist);
    await runAutoReflectionIfMissing("cody", "thread", generateAndPersist);
    expect(generations).toBe(1);
    expect((await listSelfReports("cody", {})).total).toBe(1);
    expect(state.archive).toHaveBeenCalledTimes(1);
  });

  it.each([
    [undefined, undefined], ["other", undefined], [undefined, "other"], ["other", "cody"],
  ])("rejects local owner %s and mapping %s before writes or archives", async (owner, mapping) => {
    state.owner = owner;
    state.mapping = mapping;
    const response = await post();
    expect(response.status).toBe(403);
    expect((await listSelfReports("cody", {})).total).toBe(0);
    expect((await listMetricSnapshots("cody")).total).toBe(0);
    expect(state.archive).not.toHaveBeenCalled();
    expect(state.archiveReview).not.toHaveBeenCalled();
  });

  it.each([["cody", undefined], [undefined, "cody"], ["cody", "other"]])(
    "accepts authoritative owner %s and mapping %s", async (owner, mapping) => {
      state.owner = owner;
      state.mapping = mapping;
      const response = await post();
      expect(response.status).toBe(200);
      expect((await response.json()).ok).toBe(true);
      expect((await listSelfReports("cody", {})).total).toBe(1);
    },
  );

  it("rejects concurrent and sequential automatic duplicates before archive, preserving manual repeats", async () => {
    state.owner = "cody";
    const responses = await Promise.all([post(), post()]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const duplicate = responses.find((response) => response.status === 409)!;
    expect(await duplicate.json()).toEqual({ ok: false, error: "duplicate_auto_report" });
    expect(state.archive).toHaveBeenCalledTimes(1);
    expect(state.archiveReview).toHaveBeenCalledTimes(1);
    expect((await post()).status).toBe(409);
    expect(state.archive).toHaveBeenCalledTimes(1);
    expect(state.archiveReview).toHaveBeenCalledTimes(1);
    expect((await post("manual")).status).toBe(200);
    expect((await post("manual")).status).toBe(200);
    expect((await listSelfReports("cody", {})).total).toBe(3);
  });
});
