import assert from "node:assert/strict";
import {
  clearPendingCodeGithubOpen,
  enqueuePendingCodeGithubOpen,
  getPendingCodeGithubOpen,
  subscribePendingCodeGithubOpen,
} from "./pending-code-github.ts";

clearPendingCodeGithubOpen();

let notifications = 0;
const unsubscribe = subscribePendingCodeGithubOpen(() => {
  notifications += 1;
});

const request = {
  tab: "issues" as const,
  target: {
    repo: "OpenCoven/coven-cave",
    number: 98,
    kind: "issue" as const,
    url: "https://github.com/OpenCoven/coven-cave/issues/98",
  },
  nonce: 123,
};

enqueuePendingCodeGithubOpen(request);
assert.deepEqual(getPendingCodeGithubOpen(), request, "the latest GitHub Room open is retained");
assert.equal(notifications, 1, "enqueue notifies Room subscribers");

clearPendingCodeGithubOpen();
assert.equal(getPendingCodeGithubOpen(), null, "clear consumes the pending Room open");
assert.equal(notifications, 2, "clear notifies Room subscribers");

unsubscribe();
enqueuePendingCodeGithubOpen({ tab: "prs", nonce: 456 });
assert.equal(notifications, 2, "unsubscribed listeners are not notified");
clearPendingCodeGithubOpen();

console.log("pending-code-github.test.ts: ok");
