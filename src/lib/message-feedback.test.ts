// @ts-nocheck
import assert from "node:assert/strict";
const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true,
};
const { getFeedback, setFeedback } = await import("./message-feedback.ts");
assert.equal(getFeedback("m1"), null, "no feedback by default");
setFeedback("m1", "up");
assert.equal(getFeedback("m1"), "up", "thumbs-up persisted");
setFeedback("m1", "up");
assert.equal(getFeedback("m1"), null, "re-applying same vote clears it (toggle)");
setFeedback("m1", "down");
assert.equal(getFeedback("m1"), "down", "switching vote overwrites");
// The analytics mirror stamps the voted message's thread id.
{
  const { recordFeedbackAnalytics } = await import("./message-feedback.ts");
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return Promise.resolve(new Response("{}")); };
  recordFeedbackAnalytics("m9", "down", false, { familiarId: "nova", sessionId: "thread-1" });
  recordFeedbackAnalytics("m9", "down", false, { familiarId: "nova", sessionId: "thread-1" }, "incomplete");
  globalThis.fetch = realFetch;
  assert.equal(sent.length, 2);
  assert.equal(sent[0].body.reason, undefined, "no reason unless chosen");
  assert.equal(sent[1].body.reason, "incomplete", "the chosen reason is sent");
  assert.equal(sent[0].url, "/api/feedback/message");
  assert.equal(sent[0].body.sessionId, "thread-1", "vote carries its thread id");
  assert.equal(sent[0].body.familiarId, "nova");
}
console.log("message-feedback ok");
