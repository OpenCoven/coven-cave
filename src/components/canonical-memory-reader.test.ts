import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement, type ReactElement } from "react";
// @ts-expect-error react-test-renderer does not ship declarations.
import { act, create } from "react-test-renderer";
import { CanonicalMemoryRequestError } from "../lib/canonical-memory-client.ts";
import type {
  CanonicalMemoryDetail,
  CanonicalMemoryErrorCode,
} from "../lib/canonical-memory.ts";
import {
  CanonicalMemoryReader,
  type CanonicalMemoryDetailLoader,
} from "./canonical-memory-reader.tsx";

type ReactTestInstance = {
  children: Array<string | ReactTestInstance>;
  props: {
    onClick: () => unknown;
    [key: string]: unknown;
  };
  findAllByType: (type: string) => ReactTestInstance[];
};

type ReactTestRenderer = {
  root: ReactTestInstance;
  update: (element: ReactElement) => void;
  unmount: () => void;
};

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function detail(
  id: string,
  content = `SECRET:${id}`,
  privacy: CanonicalMemoryDetail["privacy"] = {
    classification: "public",
    revealRequired: false,
    reason: "Explicit public classification.",
  },
): CanonicalMemoryDetail {
  return {
    id,
    familiarId: "charm",
    title: `Memory ${id}`,
    updatedAt: "2026-07-26T12:00:00.000Z",
    source: { kind: "familiar", label: "Charm" },
    content,
    contentFormat: "markdown",
    privacy,
    verification: {
      state: "verified",
      reason: "Signed manifest and index agree.",
    },
    attestationMetadata: { fieldCount: 4 },
    supersession: {
      supersedes: "memory-older",
      supersededBy: null,
    },
  };
}

type PendingRequest = {
  id: string;
  signal: AbortSignal;
  resolve: (value: CanonicalMemoryDetail) => void;
  reject: (error: unknown) => void;
};

function deferredLoader(): {
  requests: PendingRequest[];
  load: CanonicalMemoryDetailLoader;
} {
  const requests: PendingRequest[] = [];
  return {
    requests,
    load(id, signal) {
      return new Promise((resolve, reject) => {
        requests.push({ id, signal, resolve, reject });
      });
    },
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function mount(element: ReactElement): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(element);
    await settle();
  });
  assert.ok(renderer);
  return renderer;
}

function instanceText(node: ReactTestInstance): string {
  return node.children
    .map((child) => typeof child === "string" ? child : instanceText(child))
    .join("");
}

function renderedText(renderer: ReactTestRenderer): string {
  return instanceText(renderer.root);
}

function button(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  const match = renderer.root
    .findAllByType("button")
    .find((candidate) => instanceText(candidate).trim() === label);
  assert.ok(match, `expected button: ${label}`);
  return match;
}

function readerElement(
  props: Partial<Parameters<typeof CanonicalMemoryReader>[0]> = {},
): ReactElement {
  return createElement(CanonicalMemoryReader, {
    memoryId: "memory-one",
    localDaemonReady: true,
    onMissing: () => {},
    onRefresh: () => {},
    ...props,
  });
}

test("the default loader requests the encoded opaque ID endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    urls.push(String(input));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        entry: detail("memory/one?private#fragment"),
      }),
    } as Response;
  }) as typeof fetch;
  let renderer: ReactTestRenderer | undefined;
  try {
    renderer = await mount(
      readerElement({ memoryId: "memory/one?private#fragment" }),
    );
    assert.deepEqual(urls, [
      "/api/coven-memory/memory%2Fone%3Fprivate%23fragment",
    ]);
  } finally {
    if (renderer) await act(async () => renderer?.unmount());
    globalThis.fetch = originalFetch;
  }
});

test("ID changes and unmount abort prior detail requests", async () => {
  const deferred = deferredLoader();
  const renderer = await mount(
    readerElement({ memoryId: null, loadDetail: deferred.load }),
  );
  assert.equal(deferred.requests.length, 0, "no selected ID makes no request");

  await act(async () => {
    renderer.update(
      readerElement({ memoryId: "memory-a", loadDetail: deferred.load }),
    );
  });
  assert.equal(deferred.requests.length, 1);
  assert.equal(deferred.requests[0].id, "memory-a");
  assert.equal(deferred.requests[0].signal.aborted, false);

  await act(async () => {
    renderer.update(
      readerElement({ memoryId: "memory-b", loadDetail: deferred.load }),
    );
  });
  assert.equal(deferred.requests[0].signal.aborted, true);
  assert.equal(deferred.requests[1].id, "memory-b");
  assert.equal(deferred.requests[1].signal.aborted, false);

  await act(async () => renderer.unmount());
  assert.equal(deferred.requests[1].signal.aborted, true);
});

test("reveal is explicit, selection-bound, and reset by readiness loss", async () => {
  const renderer = await mount(
    readerElement({
      memoryId: "memory-a",
      loadDetail: async (id) => detail(id),
    }),
  );
  assert.doesNotMatch(renderedText(renderer), /SECRET:memory-a/);
  assert.match(renderedText(renderer), /Privacypublic/);
  assert.match(renderedText(renderer), /Verificationverified/);
  assert.match(renderedText(renderer), /Attestation fields4/);
  assert.match(renderedText(renderer), /Supersedesmemory-older/);

  await act(async () => {
    button(renderer, "Reveal").props.onClick();
  });
  assert.match(renderedText(renderer), /SECRET:memory-a/);

  await act(async () => {
    renderer.update(
      readerElement({
        memoryId: "memory-b",
        loadDetail: async (id) => detail(id),
      }),
    );
    await settle();
  });
  assert.doesNotMatch(renderedText(renderer), /SECRET:memory-a/);
  assert.doesNotMatch(renderedText(renderer), /SECRET:memory-b/);

  await act(async () => {
    button(renderer, "Reveal").props.onClick();
  });
  assert.match(renderedText(renderer), /SECRET:memory-b/);

  await act(async () => {
    renderer.update(
      readerElement({
        memoryId: "memory-b",
        localDaemonReady: false,
        loadDetail: async (id) => detail(id),
      }),
    );
  });
  assert.doesNotMatch(renderedText(renderer), /SECRET:memory-b/);
  assert.match(
    renderedText(renderer),
    /Switch Cave to Local daemon to read canonical memory\./,
  );
  assert.match(renderedText(renderer), /coven daemon start/);
  await act(async () => renderer.unmount());
});

test("incomplete or non-public privacy metadata fails closed", async () => {
  const cases: Array<[string, CanonicalMemoryDetail["privacy"]]> = [
    [
      "private",
      {
        classification: "private",
        revealRequired: false,
        reason: "Private classification.",
      },
    ],
    [
      "missing-classification",
      {
        classification: null,
        revealRequired: false,
        reason: "Classification missing.",
      },
    ],
    [
      "missing-reveal",
      {
        classification: "public",
        revealRequired: null,
        reason: "Reveal metadata missing.",
      },
    ],
    [
      "reveal-required",
      {
        classification: "public",
        revealRequired: true,
        reason: "Reveal is still required.",
      },
    ],
  ];

  for (const [id, privacy] of cases) {
    const renderer = await mount(
      readerElement({
        memoryId: id,
        loadDetail: async () => detail(id, `NEVER:${id}`, privacy),
      }),
    );
    assert.doesNotMatch(renderedText(renderer), new RegExp(`NEVER:${id}`));
    assert.equal(
      renderer.root
        .findAllByType("button")
        .some((candidate) => instanceText(candidate).trim() === "Reveal"),
      false,
      `${id} never offers reveal`,
    );
    assert.match(renderedText(renderer), /Content remains hidden/);
    await act(async () => renderer.unmount());
  }
});

test("missing detail returns to the list and keeps Refresh available", async () => {
  let missing = 0;
  let refreshed = 0;
  const renderer = await mount(
    readerElement({
      loadDetail: async () => {
        throw new CanonicalMemoryRequestError("memory_not_found", 404);
      },
      onMissing: () => {
        missing += 1;
      },
      onRefresh: () => {
        refreshed += 1;
      },
    }),
  );
  assert.equal(missing, 1);
  assert.match(renderedText(renderer), /Memory not found/);
  await act(async () => {
    button(renderer, "Refresh").props.onClick();
  });
  assert.equal(refreshed, 1);
  await act(async () => renderer.unmount());
});

test("Refresh retries the selected detail after refreshing shared resources", async () => {
  const events: string[] = [];
  let requests = 0;
  const renderer = await mount(
    readerElement({
      loadDetail: async (id) => {
        requests += 1;
        events.push(`detail:${requests}`);
        if (requests === 1) {
          throw new CanonicalMemoryRequestError("invalid_daemon_payload", 502);
        }
        return detail(id);
      },
      onRefresh: async () => {
        events.push("refresh");
      },
    }),
  );
  assert.equal(requests, 1);
  assert.match(renderedText(renderer), /Incompatible daemon response/);

  await act(async () => {
    await button(renderer, "Refresh").props.onClick();
    await settle();
  });

  assert.equal(requests, 2);
  assert.deepEqual(events, ["detail:1", "refresh", "detail:2"]);
  assert.doesNotMatch(renderedText(renderer), /Incompatible daemon response/);
  assert.match(renderedText(renderer), /Memory memory-one/);
  await act(async () => renderer.unmount());
});

test("only the newest mounted Refresh completion retries canonical detail", async () => {
  const refreshes: Array<() => void> = [];
  let requests = 0;
  const renderer = await mount(
    readerElement({
      loadDetail: async () => {
        requests += 1;
        throw new CanonicalMemoryRequestError("invalid_daemon_payload", 502);
      },
      onRefresh: () =>
        new Promise<void>((resolve) => {
          refreshes.push(resolve);
        }),
    }),
  );
  assert.equal(requests, 1);

  let first: Promise<unknown> | undefined;
  let second: Promise<unknown> | undefined;
  await act(async () => {
    first = button(renderer, "Refresh").props.onClick() as Promise<unknown>;
    second = button(renderer, "Refresh").props.onClick() as Promise<unknown>;
    await settle();
  });
  assert.equal(refreshes.length, 2);

  await act(async () => {
    refreshes[1]();
    await second;
    await settle();
  });
  assert.equal(requests, 2, "the newest refresh retries once");

  await act(async () => {
    refreshes[0]();
    await first;
    await settle();
  });
  assert.equal(requests, 2, "an older completion cannot retry the newer reader");

  await act(async () => renderer.unmount());
  const source = readFileSync(
    new URL("./canonical-memory-reader.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /const mountedRef = useRef\(true\)/);
  assert.match(source, /const refreshGenerationRef = useRef\(0\)/);
  assert.match(
    source,
    /generation === refreshGenerationRef\.current &&\s*mountedRef\.current/,
    "the awaited refresh write is guarded by mount and request generation",
  );
});

test("all canonical error codes render stable actionable copy", async () => {
  const expected: Record<CanonicalMemoryErrorCode, RegExp> = {
    local_access_required:
      /Canonical memory is available only from Cave on this host\./,
    local_daemon_required:
      /Switch Cave to Local daemon to read canonical memory\./,
    daemon_update_required:
      /Update Coven, restart the daemon, then retry\./,
    canonical_memory_unavailable: /coven daemon start/,
    invalid_daemon_payload: /incompatible daemon response/i,
    invalid_memory_id: /Return to the list and choose this memory again\./,
    memory_not_found: /Memory not found/,
  };

  for (const code of Object.keys(expected) as CanonicalMemoryErrorCode[]) {
    const renderer = await mount(
      readerElement({
        loadDetail: async () => {
          throw new CanonicalMemoryRequestError(
            code,
            code === "memory_not_found" ? 404 : 503,
          );
        },
      }),
    );
    assert.match(renderedText(renderer), expected[code], code);
    assert.ok(
      renderer.root.findAllByType("button").length > 0,
      `${code} includes a recovery action`,
    );
    await act(async () => renderer.unmount());
  }
});

test("canonical details expose no file or mutation controls and use no storage", async () => {
  const writes: string[] = [];
  const storage = {
    getItem: () => null,
    setItem: (key: string) => writes.push(key),
    removeItem: (key: string) => writes.push(key),
    clear: () => writes.push("clear"),
    key: () => null,
    length: 0,
  } satisfies Storage;
  const descriptors = {
    localStorage: Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
    sessionStorage: Object.getOwnPropertyDescriptor(globalThis, "sessionStorage"),
    indexedDB: Object.getOwnPropertyDescriptor(globalThis, "indexedDB"),
  };
  Object.defineProperties(globalThis, {
    localStorage: { configurable: true, value: storage },
    sessionStorage: { configurable: true, value: storage },
    indexedDB: {
      configurable: true,
      value: {
        open: () => {
          writes.push("indexedDB");
          throw new Error("canonical detail must not open IndexedDB");
        },
      },
    },
  });

  let renderer: ReactTestRenderer | undefined;
  try {
    renderer = await mount(
      readerElement({ loadDetail: async (id) => detail(id) }),
    );
    await act(async () => {
      button(renderer!, "Reveal").props.onClick();
    });
    const labels = renderer.root
      .findAllByType("button")
      .map((candidate) => instanceText(candidate))
      .join(" ");
    assert.doesNotMatch(
      labels,
      /\b(?:Edit|Delete|Archive|Copy path|Open file|Grimoire|Memories)\b/i,
    );
    assert.deepEqual(writes, []);

    const source = readFileSync(
      new URL("./canonical-memory-reader.tsx", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(
      source,
      /localStorage|sessionStorage|indexedDB|surfaceWarmCache|warmCanonicalMemory/i,
    );
  } finally {
    if (renderer) await act(async () => renderer?.unmount());
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
