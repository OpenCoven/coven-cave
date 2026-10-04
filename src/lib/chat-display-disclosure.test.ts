import assert from "node:assert/strict";
import { ToolCallTracker, toPersistedTools, flattenToolResultContent } from "./chat-tool-events.ts";
import { projectDisplayId, projectDisplayText, projectProgressDetails } from "./server/chat-display-projection.ts";
import { ReasoningBlockTracker, projectReasoningText } from "./server/chat-reasoning-projection.ts";

const context = { runId: "11111111-2222-4333-8444-555555555555", harness: "codex", version: "0.145.0", protocol: "codex-jsonl-v1" };
const signedUrl = "https://files.example.com/report?X-Amz-Signature=private-signed-value&X-Amz-Credential=private-account-value";
const privateName = "lookup person@example.com token=private-name-value";
const privateId = "call token=private-id-value";
const tracker = new ToolCallTracker(() => 100, "", context);
const start = tracker.envelopeToolUse(privateId, privateName, JSON.stringify({ query: "person@example.com", url: signedUrl }));
assert.ok(start);
assert.doesNotMatch(JSON.stringify(start), /person@example|private-(name|id|signed|account)-value/,
  "names, IDs and arguments are projected before the first event");
const progress = tracker.envelopeToolProgress(privateId, "password=");
const partial = tracker.envelopeToolProgress(privateId, "PRIVATE_SPLIT_VALUE");
assert.equal(progress?.output, undefined);
assert.equal(partial?.output, undefined, "progress without a complete-unit contract has metadata only");
const end = tracker.envelopeToolResult(privateId, `Safe result. ${signedUrl} person@example.com`, false);
assert.equal(end?.id, start.id, "private native IDs still correlate calls");
assert.doesNotMatch(JSON.stringify([end, tracker.snapshot(), toPersistedTools(tracker.snapshot(), 0)]), /person@example|private-.*-value|PRIVATE_SPLIT/);
assert.match(end!.output!, /Safe result/);
const hooks = new ToolCallTracker(() => 100, "", context);
const hook = hooks.hookStart(privateName, "safe.ts");
assert.doesNotMatch(JSON.stringify(hook), /person@example|private-name-value/);
assert.equal(hooks.hookEnd(privateName, "done", false).id, hook.id);
const summaries = new ReasoningBlockTracker(() => context, "22222222-2222-4333-8444-555555555555", () => 100);
const summary = summaries.observe(privateId, "running");
assert.doesNotMatch(JSON.stringify(summary), /private-id-value/);
assert.equal(summaries.settle()[0]?.id, summary?.id, "settlement retains the projected summary identity");
assert.doesNotMatch(projectReasoningText(`Review ${signedUrl}`, "provider-summary")!, /private-(signed|account)-value/);
assert.equal(flattenToolResultContent([{ type: "reasoning", text: "OPAQUE_SENTINEL", signature: "SIGNATURE_SENTINEL" }]), undefined,
  "unknown/opaque result blocks cannot fall back to raw JSON");
assert.equal(projectDisplayText("UNKNOWN_SENTINEL"), undefined);
assert.equal(projectDisplayText("UNKNOWN_SENTINEL", { classification: "tool-output", complete: "true" as never }), undefined);
assert.equal(projectDisplayText("FRAGMENT_SENTINEL", { classification: "tool-output", complete: false }), undefined);
assert.equal(projectDisplayText("UNKNOWN_SENTINEL", { classification: "future-policy" as never, complete: true }), undefined);
assert.equal(projectDisplayText("safe.ts", { classification: "tool-output", complete: true }), "safe.ts");
assert.doesNotMatch(projectDisplayText('Read /file?sig=RELATIVE_SIGNED_SENTINEL', { classification: "tool-output", complete: true })!, /RELATIVE_SIGNED/);
assert.doesNotMatch(projectDisplayText(JSON.stringify({ text: "Safe", _meta: "PRIVATE_META_SENTINEL", signature: "SIGNATURE_SENTINEL", encrypted_content: "OPAQUE_SENTINEL" }), { classification: "tool-output", complete: true })!, /PRIVATE_META|SIGNATURE_SENTINEL|OPAQUE_SENTINEL/);
assert.doesNotMatch(projectDisplayText('{"email":"person\\u0040example.com"}', { classification: "tool-input", complete: true })!, /person|example.com/);
assert.notEqual(projectDisplayId(projectDisplayId(privateId)), projectDisplayId(privateId), "native callers cannot collide with the reserved hash namespace");
assert.notEqual(projectDisplayId("token=first"), projectDisplayId("token=second"), "redaction cannot merge different native calls");
const parallel = new ToolCallTracker();
const first = parallel.envelopeToolUse("first", "token=one", "private input one");
const second = parallel.envelopeToolUse("second", "token=two", "private input two");
assert.equal(first?.name, second?.name);
assert.equal(parallel.hookStart("token=two", "private input two").id, second?.id);
assert.equal(parallel.hookStart("token=one", "private input one").id, first?.id);
const diagnostic = projectProgressDetails({ id: privateId, label: privateName, detail: `Failure ${signedUrl}` });
assert.doesNotMatch(JSON.stringify(diagnostic), /person@example|private-(name|id|signed|account)-value/);
assert.equal(projectProgressDetails({ id: "diagnostic", label: "x".repeat(256 * 1024 + 1) }).label, "Activity details unavailable.");
assert.equal(projectDisplayText({ classification: "tool-output", complete: true, text: "FORGED_POLICY_SENTINEL" } as unknown), undefined);
for (const separator of ["&amp;", "&#38;", "&#x26;", "&amp;amp;"]) {
  assert.equal(projectDisplayText(`https://example.com/?file=report${separator}Signature=HTML_SIGNED_SENTINEL`, { classification: "tool-output", complete: true }), "[redacted signed URL]");
}
console.log("chat-display-disclosure: passed");
