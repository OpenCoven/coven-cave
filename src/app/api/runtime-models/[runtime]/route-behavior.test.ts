// @ts-nocheck
import { beforeEach, expect, test, vi } from "vitest";
const state = vi.hoisted(() => ({ local: true, binding: { harness: "claude", runtime: { kind: "local" } }, inventory: vi.fn() }));
vi.mock("@/lib/harness-spawn-env", () => ({ warmHarnessSpawnPath: async () => {} }));
vi.mock("@/lib/cave-config", () => ({ loadConfig: async () => ({}), bindingFor: () => state.binding }));
vi.mock("@/lib/server/api-security", () => ({ rejectNonLocalRequest: () => state.local ? null : new Response(null, { status: 403 }) }));
vi.mock("@/lib/server/runtime-model-options", () => ({ listRuntimeModelInventory: state.inventory }));
import { GET } from "./route";
import { GET as getOpenCode } from "../opencode/route";
beforeEach(() => {
  state.local = true;
  state.binding = { harness: "claude", runtime: { kind: "local" } };
  state.inventory.mockReset().mockResolvedValue({ models: [] });
});
test("a Codex conversation still discovers Codex after its familiar switches to Claude", async () => {
  await GET(new Request("http://localhost/api/runtime-models/codex?familiarId=cody"), { params: Promise.resolve({ runtime: "codex" }) });
  expect(state.inventory).toHaveBeenCalledWith("codex", "cody", expect.objectContaining({ allowCliInventory: true }));
});
test("authenticated remote clients can read the local CLI's public model metadata", async () => {
  state.local = false;
  await GET(new Request("http://localhost/api/runtime-models/claude?familiarId=cody"), { params: Promise.resolve({ runtime: "claude" }) });
  expect(state.inventory).toHaveBeenCalledWith("claude", "cody", expect.objectContaining({ allowCliInventory: true, allowOpenCodeInventory: false, allowHermesInventory: false }));
});
test("an SSH binding never advertises this machine's CLI models", async () => {
  state.binding = { harness: "codex", runtime: { kind: "ssh", host: "remote", cwd: "/workspace", command: "coven" } };
  await GET(new Request("http://localhost/api/runtime-models/codex?familiarId=cody"), { params: Promise.resolve({ runtime: "codex" }) });
  expect(state.inventory).toHaveBeenCalledWith("codex", "cody", expect.objectContaining({ allowCliInventory: false }));
});

test.each(["codex", "claude", "copilot", "grok", "hermes", "opencode", "openclaw"])("%s reports SSH scope without probing local accounts", async (runtime) => {
  state.binding = { harness: runtime, runtime: { kind: "ssh", host: "remote", cwd: "/workspace", command: "coven" } };
  await GET(new Request(`http://localhost/api/runtime-models/${runtime}?familiarId=cody`), { params: Promise.resolve({ runtime }) });
  expect(state.inventory).toHaveBeenCalledWith(runtime, "cody", expect.objectContaining({ inventoryRestriction: "remote-runtime" }));
});

test("a historical SSH conversation cannot get a local catalog after rebinding locally", async () => {
  await GET(new Request("http://localhost/api/runtime-models/codex?familiarId=cody&remote=true"), { params: Promise.resolve({ runtime: "codex" }) });
  expect(state.inventory).toHaveBeenCalledWith("codex", "cody", expect.objectContaining({ inventoryRestriction: "remote-runtime", allowCliInventory: false }));
});

test("the static OpenCode route applies the same historical SSH scope", async () => {
  await getOpenCode(new Request("http://localhost/api/runtime-models/opencode?familiarId=cody&remote=true"));
  expect(state.inventory).toHaveBeenCalledWith("opencode", "cody", expect.objectContaining({ inventoryRestriction: "remote-runtime" }));
});
test("the static OpenCode route returns recovery metadata to remote clients without probing", async () => {
  state.local = false;
  const response = await getOpenCode(new Request("http://localhost/api/runtime-models/opencode?familiarId=cody"));
  expect(response.status).toBe(200);
  expect(state.inventory).toHaveBeenCalledWith("opencode", "cody", expect.objectContaining({ inventoryRestriction: "local-only", allowOpenCodeInventory: false }));
});
test("the static OpenCode route rejects malformed familiar scope", async () => {
  const response = await getOpenCode(new Request("http://localhost/api/runtime-models/opencode?familiarId=../private"));
  expect(response.status).toBe(400);
  expect(state.inventory).not.toHaveBeenCalled();
});
