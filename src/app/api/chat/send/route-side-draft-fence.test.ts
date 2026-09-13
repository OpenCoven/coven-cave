import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

const home = path.resolve(".validation", `side-send-fence-${process.pid}`);
await mkdir(home, { recursive: true });
process.env.COVEN_HOME = home;
process.env.COVEN_CAVE_HOME = path.join(home, "cave");
const { POST, postChatForGeneration } = await import("./route.ts");
const { deleteConversation, conversationDeletionFence } = await import("../../../../lib/cave-conversations.ts");
const request = (sessionId: unknown) => new Request("http://localhost/api/chat/send", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ sessionId, startNewConversation: true, familiarId: "cody", prompt: "Do not execute" }),
});
try {
  const id = `side-${"a".repeat(64)}`;
  for (const response of [await POST(request(id)), await postChatForGeneration(request(id), "enhance")]) {
    assert.equal(response.status, 422);
    assert.equal((await response.json()).code, "side_execution_unavailable");
  }
  await deleteConversation("deleted-parent", { permanent: true });
  assert.ok(await conversationDeletionFence("deleted-parent"));
  const deleted = await POST(request("deleted-parent"));
  assert.equal(deleted.status, 410);
  assert.equal((await deleted.json()).code, "conversation_deleted");
  assert.equal((await POST(request({ id: "invalid" }))).status, 400);
  const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function postChat(");
  const gate = source.indexOf("await assertOrdinaryConversationSendAllowed(body.sessionId)", start);
  assert.ok(gate > start);
  assert.ok(gate < source.indexOf("await persistChatAttachments(", start));
  assert.ok(gate < source.indexOf("const config = await loadConfig()", start));
  console.log("side-send-fence: side and deleted IDs reject before persistence, offline queue, or execution");
} finally {
  await rm(home, { recursive: true, force: true });
}
