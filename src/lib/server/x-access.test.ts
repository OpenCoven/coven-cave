import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { XApiError } from "../x-api.ts";

const moduleUrl = new URL("./x-access.ts", import.meta.url);
assert.ok(existsSync(moduleUrl), "x-access.ts must exist");
const { createXAccess } = await import("./x-access.ts");

function caveConfig(
  familiars: Record<string, Record<string, unknown>> = {},
  defaults: Record<string, unknown> = {},
) {
  return {
    defaults: { harness: "codex", model: "openai/gpt-5.6-sol", ...defaults },
    familiars,
  };
}

function credentials(overrides: Record<string, unknown> = {}) {
  return {
    getAccessToken: async () => "access-token",
    forceRefresh: async () => "refreshed-token",
    ...overrides,
  };
}

test("missing familiar X grants resolve to capability-disabled", async () => {
  const access = createXAccess({
    loadConfig: async () => caveConfig(),
    credentials: credentials(),
  });

  await assert.rejects(
    access.requireXCapability("nova", "research"),
    (error) => error instanceof XApiError && error.code === "capability-disabled",
  );
  await assert.rejects(
    access.requireXCapability("nova", "publish"),
    (error) => error instanceof XApiError && error.code === "capability-disabled",
  );
});

test("app defaults never grant familiar X access", async () => {
  const access = createXAccess({
    loadConfig: async () => caveConfig({}, {
      xResearchEnabled: true,
      xPublishEnabled: true,
    }),
    credentials: credentials(),
  });

  await assert.rejects(
    access.requireXCapability("nova", "research"),
    (error) => error instanceof XApiError && error.code === "capability-disabled",
  );
  await assert.rejects(
    access.requireXCapability("nova", "publish"),
    (error) => error instanceof XApiError && error.code === "capability-disabled",
  );
});

test("only the exact familiar config entry grants each independent capability", async () => {
  const access = createXAccess({
    loadConfig: async () => caveConfig({
      nova: { xResearchEnabled: true },
      wren: { xPublishEnabled: true },
      sage: { xResearchEnabled: "true", xPublishEnabled: 1 },
    }),
    credentials: credentials(),
  });

  await access.requireXCapability("nova", "research");
  await access.requireXCapability("wren", "publish");
  await assert.rejects(
    access.requireXCapability("nova", "publish"),
    (error) => error instanceof XApiError && error.code === "capability-disabled",
  );
  await assert.rejects(
    access.requireXCapability("wren", "research"),
    (error) => error instanceof XApiError && error.code === "capability-disabled",
  );
  await assert.rejects(
    access.requireXCapability("sage", "research"),
    (error) => error instanceof XApiError && error.code === "capability-disabled",
  );
});

test("invalid familiar IDs fail before config access", async () => {
  let configReads = 0;
  const access = createXAccess({
    loadConfig: async () => {
      configReads += 1;
      return caveConfig();
    },
    credentials: credentials(),
  });

  await assert.rejects(
    access.requireXCapability("../nova", "research"),
    (error) => error instanceof XApiError && error.code === "invalid-request",
  );
  assert.equal(configReads, 0);
});

test("authenticated reads refresh and retry exactly once after a 401", async () => {
  let refreshes = 0;
  const tokens: string[] = [];
  const access = createXAccess({
    loadConfig: async () => caveConfig({ nova: { xResearchEnabled: true } }),
    credentials: credentials({
      getAccessToken: async () => "stale-token",
      forceRefresh: async () => {
        refreshes += 1;
        return "fresh-token";
      },
    }),
  });

  const result = await access.withXAuthenticatedRead(
    "nova",
    ["tweet.read"],
    async (token) => {
      tokens.push(token);
      if (token === "stale-token") {
        throw new XApiError("unauthorized", "X authorization is required", { status: 401 });
      }
      return "ok";
    },
  );

  assert.equal(result, "ok");
  assert.deepEqual(tokens, ["stale-token", "fresh-token"]);
  assert.equal(refreshes, 1);
});

test("authenticated reads do not refresh a second 401", async () => {
  let calls = 0;
  let refreshes = 0;
  const access = createXAccess({
    loadConfig: async () => caveConfig({ nova: { xResearchEnabled: true } }),
    credentials: credentials({
      forceRefresh: async () => {
        refreshes += 1;
        return "fresh-token";
      },
    }),
  });

  await assert.rejects(
    access.withXAuthenticatedRead("nova", ["tweet.read"], async () => {
      calls += 1;
      throw new XApiError("unauthorized", "X authorization is required", { status: 401 });
    }),
    (error) => error instanceof XApiError && error.code === "unauthorized",
  );
  assert.equal(calls, 2);
  assert.equal(refreshes, 1);
});

test("write preflight refreshes before dispatch and never retries a dispatched write", async () => {
  let dispatches = 0;
  let refreshWindow: number | undefined;
  const access = createXAccess({
    loadConfig: async () => caveConfig({ nova: { xPublishEnabled: true } }),
    credentials: credentials({
      getAccessToken: async (
        _scopes: string[],
        options?: { refreshIfExpiringWithinMs?: number },
      ) => {
        refreshWindow = options?.refreshIfExpiringWithinMs;
        return "write-token";
      },
      forceRefresh: async () => {
        throw new Error("write dispatch must never use post-dispatch refresh");
      },
    }),
  });

  await assert.rejects(
    access.withXWritePreflight("nova", ["tweet.write"], async (token) => {
      dispatches += 1;
      assert.equal(token, "write-token");
      throw new XApiError("unauthorized", "X authorization is required", {
        status: 401,
        dispatched: true,
      });
    }),
    (error) => error instanceof XApiError
      && error.code === "unauthorized"
      && error.dispatched,
  );
  assert.equal(dispatches, 1);
  assert.equal(refreshWindow, 5 * 60 * 1000);
});

test("safe response conversion exposes only sanitized X errors", async () => {
  const access = createXAccess({
    loadConfig: async () => caveConfig(),
    credentials: credentials(),
  });

  const denied = access.toXErrorResponse(
    new XApiError("capability-disabled", "Enable X research for this familiar"),
  );
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), {
    ok: false,
    code: "capability-disabled",
    error: "Enable X research for this familiar",
  });

  const internal = access.toXErrorResponse(new Error("secret details"));
  assert.equal(internal.status, 500);
  assert.deepEqual(await internal.json(), {
    ok: false,
    code: "internal",
    error: "X request could not be completed",
  });
});
