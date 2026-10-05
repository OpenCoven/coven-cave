import assert from "node:assert/strict";
import test from "node:test";
import { ESLint } from "eslint";

const eslint = new ESLint();
for (const filePath of ["src/lib/chat/history-load.ts", "src/lib/chat/history-sources.ts"]) {
  test(`${filePath} rejects UI, server, runtime, Node and dynamic imports`, async () => {
    for (const name of ["react", "next/dynamic", "node:fs", "@/components/chat-view", "../../components/chat-view.tsx", "@/lib/server/chat-run", "../server/chat-run.ts", "../harness-adapters.ts"]) {
      const [result] = await eslint.lintText(`import x from ${JSON.stringify(name)};`, { filePath });
      assert.ok(result.messages.some(m => m.ruleId === "no-restricted-imports"), name);
    }
    const [dynamic] = await eslint.lintText('const load = () => import("../server/chat-run.ts");', { filePath });
    assert.ok(dynamic.messages.some(m => m.ruleId === "no-restricted-syntax"));
  });
}

test("coordinator and adapter accept their declared static dependencies only", async () => {
  for (const [filePath, names] of [
    ["src/lib/chat/history-load.ts", ["../chat-turn-state.ts", "../chat-transcript-load.ts", "../conversation-revision.ts", "../workflow-step-progress.ts"]],
    ["src/lib/chat/history-sources.ts", ["../conversation-cache.ts", "../offline-cache.ts", "../chat-turn-state.ts", "./history-load.ts"]],
  ]) {
    const [result] = await eslint.lintText(names.map(name => `import ${JSON.stringify(name)};`).join("\n"), { filePath });
    assert.deepEqual(result.messages, []);
  }
  const [authorityLeak] = await eslint.lintText('import x from "../conversation-cache.ts";', { filePath: "src/lib/chat/history-load.ts" });
  assert.ok(authorityLeak.messages.some(m => m.ruleId === "no-restricted-imports"), "coordinator cannot bypass the transport adapter");
});
