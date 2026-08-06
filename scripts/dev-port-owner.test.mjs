import assert from "node:assert/strict";
import { classifyPortOwner, parseArgs } from "./dev-port-owner.mjs";

// The dedicated port turns "something is already listening" from a non-question
// into a decision. The launcher used to move to the next free port, so it never
// had to know WHO held one; now it must, because attaching to our own dev server
// and refusing a stranger are opposite actions.

const jsonResponse = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
});

// Nothing listening: the ordinary case. Also covers a timeout — a socket that
// accepts without answering is not something to attach to, and reporting it free
// lets the caller's own bind produce the real, specific error.
assert.equal(
  await classifyPortOwner({
    port: 3000,
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    },
  }),
  "free",
  "a refused connection means the port is available",
);

assert.equal(
  await classifyPortOwner({
    port: 3000,
    fetchImpl: async () => jsonResponse(200, { name: "CovenCave", version: "0.2.4" }),
  }),
  "ours",
  "our own build-info identifies the dev server we should attach to",
);

assert.equal(
  await classifyPortOwner({
    port: 3000,
    fetchImpl: async () => jsonResponse(200, { name: "some-other-app" }),
  }),
  "stranger",
  "a 200 from a different app is not ours",
);

assert.equal(
  await classifyPortOwner({
    port: 3000,
    fetchImpl: async () => ({
      status: 200,
      ok: true,
      json: async () => {
        throw new SyntaxError("not json");
      },
    }),
  }),
  "stranger",
  "a 200 that is not our JSON is somebody else's server",
);

// A dev server started WITH a sidecar token (pnpm mobile:tailscale:app) answers
// 401 through src/proxy.ts. That is indistinguishable from a stranger's 401, so
// it is reported separately and the launcher refuses rather than guessing —
// attaching to a server we cannot identify is how a wrong port gets trusted.
for (const status of [401, 403]) {
  assert.equal(
    await classifyPortOwner({ port: 3000, fetchImpl: async () => jsonResponse(status, {}) }),
    "gated",
    `an access-gated ${status} cannot be identified either way`,
  );
}

assert.equal(
  await classifyPortOwner({ port: 3000, fetchImpl: async () => jsonResponse(500, {}) }),
  "stranger",
  "a server erroring on our identity route is not one to attach to",
);

// --- arg parsing -------------------------------------------------------------
const args = parseArgs(["--port", "3020", "--timeout-ms", "500"]);
assert.equal(args.get("port"), "3020");
assert.equal(args.get("timeout-ms"), "500");

console.log("dev-port-owner.test.mjs: ok");
