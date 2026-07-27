// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import {
  clearCanonicalMemoryResources,
  readCanonicalMemoryList,
} from "../lib/canonical-memory-resources.ts";
import { canonicalMemoryLocalAccessEligible } from "../lib/canonical-memory-local-access.ts";
import { useCanonicalMemoryWarmup } from "../lib/use-canonical-memory-warmup.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function summary(id = "memory-one") {
  return {
    id,
    familiarId: "charm",
    title: "Memory one",
    updatedAt: "2026-07-26T12:00:00.000Z",
    relativeUpdatedAt: "today",
    excerpt: "A canonical memory.",
    source: { kind: "familiar", label: "Charm" },
    privacy: { classification: null, revealRequired: null },
    verification: { state: "verified" },
  };
}

function overview() {
  return {
    generatedAt: "2026-07-26T12:00:00.000Z",
    totals: {
      entries: 1,
      familiars: 1,
      verified: 1,
      needsReview: 0,
      unknown: 0,
    },
    lastUpdatedAt: "2026-07-26T12:00:00.000Z",
    capabilities: {
      detail: true,
      verification: true,
      attestationMetadata: false,
      supersessionHistory: false,
      mutations: false,
    },
    verification: {
      state: "verified",
      checkedAt: "2026-07-26T12:00:00.000Z",
      manifest: null,
      index: null,
      issues: [],
    },
  };
}

function response(url) {
  return {
    ok: true,
    status: 200,
    json: async () =>
      url === "/api/coven-memory"
        ? { ok: true, entries: [summary()] }
        : { ok: true, overview: overview() },
  };
}

function frameQueue() {
  let nextId = 1;
  const callbacks = new Map();
  return {
    request(callback) {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    cancel(id) {
      callbacks.delete(id);
    },
    runNext() {
      const entry = callbacks.entries().next().value;
      assert.ok(entry, "expected a scheduled animation frame");
      const [id, callback] = entry;
      callbacks.delete(id);
      callback(0);
    },
    get pending() {
      return callbacks.size;
    },
  };
}

function WarmupProbe({ ready }) {
  useCanonicalMemoryWarmup(ready);
  return createElement("output", null, ready ? "ready" : "not-ready");
}

function RuntimeWarmupProbe({ healthy, platform, hostname }) {
  const ready = healthy &&
    canonicalMemoryLocalAccessEligible({ platform, hostname });
  useCanonicalMemoryWarmup(ready);
  return createElement("output", null, ready ? "ready" : "not-ready");
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function installRuntime(fetchImpl) {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const frames = frameQueue();
  globalThis.window = {
    requestAnimationFrame: (callback) => frames.request(callback),
    cancelAnimationFrame: (id) => frames.cancel(id),
  };
  globalThis.fetch = fetchImpl;
  return {
    frames,
    restore() {
      clearCanonicalMemoryResources();
      globalThis.window = originalWindow;
      globalThis.fetch = originalFetch;
    },
  };
}

async function runTwoFrames(frames) {
  await act(async () => {
    frames.runNext();
  });
  await act(async () => {
    frames.runNext();
    await settle();
  });
}

test("local access eligibility uses the server's exact lower-case loopback allowlist", () => {
  for (const [platform, hostname] of [
    ["browser", "127.0.0.1"],
    ["desktop", "localhost"],
    ["desktop", "::1"],
    ["browser", "[::1]"],
  ]) {
    assert.equal(
      canonicalMemoryLocalAccessEligible({ platform, hostname }),
      true,
      `${platform} ${hostname}`,
    );
  }

  for (const [platform, hostname] of [
    ["ios", "127.0.0.1"],
    ["android", "localhost"],
    ["unknown", "localhost"],
    ["browser", "0.0.0.0"],
    ["browser", "127.0.0.2"],
    ["browser", "LOCALHOST"],
    ["browser", "localhost."],
    ["browser", "localhost.evil.test"],
    ["browser", "100.101.102.103"],
    ["desktop", "cave.example.ts.net"],
    ["desktop", null],
    ["browser", ""],
  ]) {
    assert.equal(
      canonicalMemoryLocalAccessEligible({ platform, hostname }),
      false,
      `${platform} ${hostname ?? "<missing>"}`,
    );
  }
});

test("accepted local readiness warms only list and overview after two frames", async () => {
  const urls = [];
  const runtime = installRuntime(async (url) => {
    urls.push(url);
    return response(url);
  });
  let renderer;
  try {
    await act(async () => {
      renderer = create(createElement(WarmupProbe, { ready: true }));
    });
    assert.equal(runtime.frames.pending, 1);
    assert.deepEqual(urls, []);

    await act(async () => {
      runtime.frames.runNext();
    });
    assert.equal(runtime.frames.pending, 1);
    assert.deepEqual(urls, []);

    await act(async () => {
      runtime.frames.runNext();
      await settle();
    });
    assert.deepEqual(urls.sort(), [
      "/api/coven-memory",
      "/api/coven-memory/overview",
    ]);
    assert.ok(
      urls.every((url) =>
        url === "/api/coven-memory" || url === "/api/coven-memory/overview"
      ),
      "detail is never part of warmup",
    );
  } finally {
    await act(async () => renderer?.unmount());
    runtime.restore();
  }
});

test("healthy local status stays cold on mobile, unresolved, and non-loopback runtimes", async () => {
  for (const runtimeFacts of [
    { name: "iOS", platform: "ios", hostname: "127.0.0.1" },
    { name: "Android", platform: "android", hostname: "localhost" },
    { name: "unresolved platform", platform: "unknown", hostname: "localhost" },
    {
      name: "tailnet browser",
      platform: "browser",
      hostname: "cave.example.ts.net",
    },
    { name: "LAN browser", platform: "browser", hostname: "192.168.1.20" },
    { name: "wildcard browser", platform: "browser", hostname: "0.0.0.0" },
    { name: "missing hostname", platform: "desktop", hostname: null },
  ]) {
    const urls = [];
    const runtime = installRuntime(async (url) => {
      urls.push(url);
      return response(url);
    });
    let renderer;
    try {
      await act(async () => {
        renderer = create(createElement(RuntimeWarmupProbe, {
          healthy: true,
          platform: runtimeFacts.platform,
          hostname: runtimeFacts.hostname,
        }));
        await settle();
      });
      assert.equal(
        runtime.frames.pending,
        0,
        `${runtimeFacts.name} schedules no frame`,
      );
      assert.deepEqual(
        urls,
        [],
        `${runtimeFacts.name} performs no canonical read`,
      );
    } finally {
      await act(async () => renderer?.unmount());
      runtime.restore();
    }
  }
});

test("healthy local browser and desktop loopback runtimes warm after two frames", async () => {
  for (const runtimeFacts of [
    { name: "browser localhost", platform: "browser", hostname: "localhost" },
    { name: "desktop IPv4", platform: "desktop", hostname: "127.0.0.1" },
    { name: "browser IPv6", platform: "browser", hostname: "::1" },
    { name: "desktop bracketed IPv6", platform: "desktop", hostname: "[::1]" },
  ]) {
    const urls = [];
    const runtime = installRuntime(async (url) => {
      urls.push(url);
      return response(url);
    });
    let renderer;
    try {
      await act(async () => {
        renderer = create(createElement(RuntimeWarmupProbe, {
          healthy: true,
          platform: runtimeFacts.platform,
          hostname: runtimeFacts.hostname,
        }));
      });
      await runTwoFrames(runtime.frames);
      assert.deepEqual(
        urls.sort(),
        ["/api/coven-memory", "/api/coven-memory/overview"],
        runtimeFacts.name,
      );
    } finally {
      await act(async () => renderer?.unmount());
      runtime.restore();
    }
  }
});

test("readiness loss and unmount cancel scheduled work", async () => {
  for (const transition of ["loss", "unmount"]) {
    const urls = [];
    const runtime = installRuntime(async (url) => {
      urls.push(url);
      return response(url);
    });
    let renderer;
    try {
      await act(async () => {
        renderer = create(createElement(WarmupProbe, { ready: true }));
      });
      assert.equal(runtime.frames.pending, 1);
      await act(async () => {
        if (transition === "loss") {
          renderer.update(createElement(WarmupProbe, { ready: false }));
        } else {
          renderer.unmount();
          renderer = null;
        }
      });
      assert.equal(runtime.frames.pending, 0, `${transition} cancels its pending frame`);
      assert.deepEqual(urls, [], `${transition} cannot warm after cancellation`);
    } finally {
      await act(async () => renderer?.unmount());
      runtime.restore();
    }
  }
});

test("readiness loss and unmount clear successful resources", async () => {
  for (const transition of ["loss", "unmount"]) {
    const urls = [];
    const runtime = installRuntime(async (url) => {
      urls.push(url);
      return response(url);
    });
    let renderer;
    try {
      await act(async () => {
        renderer = create(createElement(WarmupProbe, { ready: true }));
      });
      await runTwoFrames(runtime.frames);
      assert.equal(urls.length, 2);
      await readCanonicalMemoryList();
      assert.equal(urls.length, 2, "the warm result is initially shared");

      await act(async () => {
        if (transition === "loss") {
          renderer.update(createElement(WarmupProbe, { ready: false }));
        } else {
          renderer.unmount();
          renderer = null;
        }
      });
      await readCanonicalMemoryList();
      assert.equal(urls.length, 3, `${transition} forces the next list read fresh`);
    } finally {
      await act(async () => renderer?.unmount());
      runtime.restore();
    }
  }
});

test("false to true reconnect schedules and warms again", async () => {
  const urls = [];
  const runtime = installRuntime(async (url) => {
    urls.push(url);
    return response(url);
  });
  let renderer;
  try {
    await act(async () => {
      renderer = create(createElement(WarmupProbe, { ready: false }));
    });
    assert.equal(runtime.frames.pending, 0);

    await act(async () => {
      renderer.update(createElement(WarmupProbe, { ready: true }));
    });
    await runTwoFrames(runtime.frames);
    assert.equal(urls.length, 2);

    await act(async () => {
      renderer.update(createElement(WarmupProbe, { ready: false }));
    });
    assert.equal(runtime.frames.pending, 0);
    await act(async () => {
      renderer.update(createElement(WarmupProbe, { ready: true }));
    });
    await runTwoFrames(runtime.frames);
    assert.equal(urls.length, 4, "reconnect performs a fresh list and overview warm");
  } finally {
    await act(async () => renderer?.unmount());
    runtime.restore();
  }
});

test("platform resolution and later eligible reconnect rewarm without a new health result", async () => {
  const urls = [];
  const runtime = installRuntime(async (url) => {
    urls.push(url);
    return response(url);
  });
  let renderer;
  try {
    await act(async () => {
      renderer = create(createElement(RuntimeWarmupProbe, {
        healthy: true,
        platform: "unknown",
        hostname: "localhost",
      }));
    });
    assert.equal(runtime.frames.pending, 0);
    assert.deepEqual(urls, []);

    await act(async () => {
      renderer.update(createElement(RuntimeWarmupProbe, {
        healthy: true,
        platform: "desktop",
        hostname: "localhost",
      }));
    });
    await runTwoFrames(runtime.frames);
    assert.equal(urls.length, 2, "unknown to desktop enables the retained healthy status");

    await act(async () => {
      renderer.update(createElement(RuntimeWarmupProbe, {
        healthy: true,
        platform: "ios",
        hostname: "localhost",
      }));
    });
    assert.equal(runtime.frames.pending, 0);

    await act(async () => {
      renderer.update(createElement(RuntimeWarmupProbe, {
        healthy: true,
        platform: "browser",
        hostname: "localhost",
      }));
    });
    await runTwoFrames(runtime.frames);
    assert.equal(urls.length, 4, "a later eligible runtime starts a fresh warm");
  } finally {
    await act(async () => renderer?.unmount());
    runtime.restore();
  }
});

test("a failed background warm is ignored and not cached as success", async () => {
  let fail = true;
  const urls = [];
  const runtime = installRuntime(async (url) => {
    urls.push(url);
    if (fail) {
      return {
        ok: false,
        status: 503,
        json: async () => ({
          ok: false,
          code: "canonical_memory_unavailable",
          error: "private daemon diagnostic",
        }),
      };
    }
    return response(url);
  });
  let renderer;
  try {
    await act(async () => {
      renderer = create(createElement(WarmupProbe, { ready: true }));
    });
    await runTwoFrames(runtime.frames);
    assert.equal(urls.length, 2, "both independent landing warms were attempted");

    fail = false;
    await readCanonicalMemoryList();
    assert.equal(urls.length, 3, "a direct read retries the failed warm");
  } finally {
    await act(async () => renderer?.unmount());
    runtime.restore();
  }
});

test("Workspace combines accepted local health with current runtime eligibility", async () => {
  const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
  assert.match(
    workspace,
    /const \[acceptedLocalDaemonHealthy, setAcceptedLocalDaemonHealthy\] = useState\(false\);/,
    "accepted daemon health is retained independently from runtime eligibility",
  );
  assert.match(
    workspace,
    /const localDaemonReady = acceptedLocalDaemonHealthy &&\s*canonicalMemoryLocalAccessEligible\(\{[\s\S]{0,240}platform: tauriPlatform,[\s\S]{0,240}hostname:[\s\S]{0,240}\}\);[\s\S]{0,120}useCanonicalMemoryWarmup\(localDaemonReady\);/,
    "platform and hostname changes recompute effective readiness without another status poll",
  );
  assert.match(
    workspace,
    /if \(!requestGate\.isLatest\(requestId\)\) return;[\s\S]{0,900}if \(result\.kind === "running"\) \{[\s\S]{0,160}setAcceptedLocalDaemonHealthy\(result\.targetMode === "local"\);[\s\S]{0,120}\} else \{[\s\S]{0,120}setAcceptedLocalDaemonHealthy\(false\);[\s\S]{0,120}\}/,
    "only the latest accepted local-running result retains healthy state",
  );
});
