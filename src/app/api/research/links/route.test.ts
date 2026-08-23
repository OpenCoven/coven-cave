import assert from "node:assert/strict";
import { test } from "node:test";

import { savedLinkDedupeKey, type SavedLink } from "@/lib/link-organizer";
import { toSavedLinkSummary, type ResearchLinkEnrichment } from "@/lib/server/research-links";
import { enrichXArticleUrls } from "@/lib/server/x-article-ingest";
import type { NormalizedXArticle } from "@/lib/x-articles";
import type { XArticleProvider } from "@/lib/server/x-article-provider";
import { createResearchLinksRouteHandlers } from "./route.ts";

const ARTICLE_BODY_SENTINEL = "ARTICLE_BODY_SENTINEL";

function savedLink(id: string, url: string, patch: Partial<SavedLink> = {}): SavedLink {
  return {
    id,
    url,
    category: "other",
    title: id,
    addedAt: "2026-08-18T00:00:00.000Z",
    source: "desk",
    ...patch,
  };
}

function savedXArticleLink(id: string, url: string): SavedLink {
  return savedLink(id, url, {
    category: "article",
    title: "An X Article",
    xArticle: {
      version: 1,
      provider: "sorsa",
      sourcePostId: "100",
      titleSource: "derived",
      author: { id: "author-100", username: "author" },
      body: ARTICLE_BODY_SENTINEL,
      excerpt: "Excerpt",
      publishedAt: "2026-08-18T00:00:00.000Z",
      fetchedAt: "2026-08-18T00:00:00.000Z",
      contentSha256: "a".repeat(64),
    },
  });
}

function localRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (!headers.has("host")) headers.set("host", "localhost");
  return new Request(`http://localhost:3000${path}`, { ...init, headers });
}

function post(body: unknown, host = "localhost"): Request {
  return new Request("http://localhost:3000/api/research/links", {
    method: "POST",
    headers: { host, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function article(sourcePostId: string): NormalizedXArticle {
  return {
    provider: "sorsa",
    sourcePostId,
    title: "Fetched X Article",
    titleSource: "derived",
    author: { id: "author", username: "author" },
    body: ARTICLE_BODY_SENTINEL,
    excerpt: "Excerpt",
    publishedAt: "2026-08-18T00:00:00.000Z",
    fetchedAt: "2026-08-18T00:00:00.000Z",
    contentSha256: "a".repeat(64),
  };
}

function reserveAllXCandidates(urls: readonly string[]) {
  const reservedUrls: string[] = [];
  const reservedIdentities = new Set<string>();
  for (const url of urls) {
    if (!/\/status\/\d+/.test(url)) continue;
    const identity = savedLinkDedupeKey(url);
    if (reservedIdentities.has(identity)) continue;
    reservedIdentities.add(identity);
    reservedUrls.push(url);
  }
  return Promise.resolve({
    reservedUrls,
    reservedIdentities,
    existingIdentities: new Set<string>(),
    contendedIdentities: new Set<string>(),
    release: async () => {},
  });
}

test("rejects non-local list, detail, and save requests before data access", async () => {
  let reads = 0;
  const route = createResearchLinksRouteHandlers({
    listSavedLinkSummaries: async () => {
      reads++;
      return [];
    },
    getSavedLinkById: async () => {
      reads++;
      return null;
    },
    listSavedLinks: async () => {
      reads++;
      return [];
    },
    saveResearchLinks: async () => {
      reads++;
      return { added: [], duplicates: [], invalid: [] };
    },
  });

  for (const request of [
    localRequest("/api/research/links", { headers: { host: "cave.example.com" } }),
    localRequest("/api/research/links?id=link-1", { headers: { host: "cave.example.com" } }),
    post({ urls: ["https://example.com"] }, "cave.example.com"),
  ]) {
    const response = request.method === "POST"
      ? await route.POST(request)
      : await route.GET(request);
    assert.equal(response.status, 403);
  }
  assert.equal(reads, 0);
});

test("lists summaries without Article bodies and returns one full link by id", async () => {
  const full = savedXArticleLink("article-1", "https://x.com/example/status/100");
  let listReads = 0;
  let detailReads = 0;
  const route = createResearchLinksRouteHandlers({
    listSavedLinkSummaries: async () => {
      listReads++;
      return [toSavedLinkSummary(full)];
    },
    getSavedLinkById: async (id) => {
      detailReads++;
      return id === full.id ? full : null;
    },
  });

  const listResponse = await route.GET(localRequest("/api/research/links"));
  assert.equal(listResponse.status, 200);
  const list = await listResponse.json();
  assert.deepEqual(Object.keys(list).sort(), ["links", "ok"]);
  assert.equal(JSON.stringify(list).includes(ARTICLE_BODY_SENTINEL), false);
  assert.equal(listReads, 1);

  const detailResponse = await route.GET(localRequest(`/api/research/links?id=${full.id}`));
  assert.equal(detailResponse.status, 200);
  const detail = await detailResponse.json();
  assert.deepEqual(Object.keys(detail).sort(), ["link", "ok"]);
  assert.equal(detail.link.xArticle.body, ARTICLE_BODY_SENTINEL);
  assert.equal(detailReads, 1);
});

test("unknown and empty detail ids are 404s rather than list reads", async () => {
  let listReads = 0;
  const requestedIds: string[] = [];
  const route = createResearchLinksRouteHandlers({
    listSavedLinkSummaries: async () => {
      listReads++;
      return [];
    },
    getSavedLinkById: async (id) => {
      requestedIds.push(id);
      return null;
    },
  });

  for (const id of ["missing", ""]) {
    const response = await route.GET(localRequest(`/api/research/links?id=${id}`));
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { ok: false, error: "link not found" });
  }
  assert.equal(listReads, 0);
  assert.deepEqual(requestedIds, ["missing", ""]);
});

test("saves ordinary and X siblings, returns X failures, and omits Article bodies", async () => {
  const ordinary = "https://example.com/ordinary";
  const successfulX = "https://x.com/example/status/100";
  const failedX = "https://x.com/example/status/101";
  const savedSuccessfulX = savedXArticleLink("x-100", successfulX);
  const captured: {
    source?: SavedLink["source"];
    urls?: string[];
    enrichment?: unknown;
    saves: number;
  } = { saves: 0 };
  const failure = {
    url: failedX,
    code: "timeout" as const,
    message: "X article request timed out",
    retryable: true,
  };
  const route = createResearchLinksRouteHandlers({
    listSavedLinks: async () => [],
    reserveXArticleCandidates: reserveAllXCandidates,
    fetchHfPaperMetadata: async () => null,
    enrichXArticleUrls: async () => ({
      enrichments: new Map([[successfulX, {
        xArticle: {
          title: "Fetched X Article",
          snapshot: savedSuccessfulX.xArticle!,
        },
      }]]),
      failures: [failure],
    }),
    saveResearchLinks: async (urls, source, enrichment) => {
      captured.urls = urls;
      captured.source = source;
      captured.enrichment = enrichment;
      captured.saves++;
      return {
        added: [
          savedLink("ordinary", ordinary),
          savedSuccessfulX,
        ],
        duplicates: [],
        invalid: [],
      };
    },
  });

  const response = await route.POST(post({ urls: [ordinary, successfulX, failedX], source: "desk" }));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(captured.urls, [ordinary, successfulX]);
  assert.equal(captured.source, "desk");
  assert.equal(captured.saves, 1);
  assert.equal(
    (captured.enrichment as Map<string, ResearchLinkEnrichment> | undefined)
      ?.get(successfulX)
      ?.xArticle
      ?.title,
    "Fetched X Article",
  );
  assert.deepEqual(payload.failed, [failure]);
  assert.equal(JSON.stringify(payload.added).includes(ARTICLE_BODY_SENTINEL), false);
});

test("a missing X provider is a partial result and still saves ordinary links", async () => {
  const ordinary = "https://example.com/ordinary";
  const xUrl = "https://x.com/example/status/200";
  let saves = 0;
  const route = createResearchLinksRouteHandlers({
    listSavedLinks: async () => [],
    reserveXArticleCandidates: reserveAllXCandidates,
    enrichXArticleUrls: async () => ({
      enrichments: new Map(),
      failures: [{
        url: xUrl,
        code: "missing-credential",
        message: "X article provider credentials are unavailable",
        retryable: false,
      }],
    }),
    saveResearchLinks: async (urls) => {
      saves++;
      return {
        added: urls.map((url, index) => savedLink(`saved-${index}`, url)),
        duplicates: [],
        invalid: [],
      };
    },
  });

  const response = await route.POST(post({ urls: [ordinary, xUrl] }));
  assert.equal(response.status, 200);
  assert.equal(saves, 1);
  const payload = await response.json();
  assert.equal(payload.added.length, 1);
  assert.equal(payload.failed[0].code, "missing-credential");
});

test("keeps HF enrichment structured while X enrichment is absent", async () => {
  const paperUrl = "https://huggingface.co/papers/2401.12345";
  const paper = {
    title: "A Paper Title",
    authors: ["A. Author"],
    abstract: "An abstract.",
    publishedAt: "2024-01-22T00:00:00.000Z",
  };
  let enrichment: unknown;
  const route = createResearchLinksRouteHandlers({
    listSavedLinks: async () => [],
    reserveXArticleCandidates: reserveAllXCandidates,
    fetchHfPaperMetadata: async (arxivId) => {
      assert.equal(arxivId, "2401.12345");
      return paper;
    },
    enrichXArticleUrls: async () => ({ enrichments: new Map(), failures: [] }),
    saveResearchLinks: async (_urls, _source, receivedEnrichment) => {
      enrichment = receivedEnrichment;
      return { added: [savedLink("paper", paperUrl, { category: "paper" })], duplicates: [], invalid: [] };
    },
  });

  const response = await route.POST(post({ urls: [paperUrl] }));
  assert.equal(response.status, 200);
  assert.deepEqual(
    (enrichment as Map<string, ResearchLinkEnrichment>).get(paperUrl),
    { paper },
  );
});

test("ordinary and HF-only saves skip X reservation while saving each request once", async () => {
  const ordinaryUrl = "https://example.com/ordinary";
  const paperUrl = "https://huggingface.co/papers/2401.12345";
  let reservations = 0;
  let xEnrichments = 0;
  let hfLookups = 0;
  const savedInputs: string[][] = [];
  const route = createResearchLinksRouteHandlers({
    reserveXArticleCandidates: async () => {
      reservations += 1;
      return reserveAllXCandidates([]);
    },
    fetchHfPaperMetadata: async () => {
      hfLookups += 1;
      return {
        title: "A Paper Title",
        authors: ["A. Author"],
        abstract: "An abstract.",
        publishedAt: "2024-01-22T00:00:00.000Z",
      };
    },
    enrichXArticleUrls: async () => {
      xEnrichments += 1;
      return { enrichments: new Map(), failures: [] };
    },
    saveResearchLinks: async (urls) => {
      savedInputs.push([...urls]);
      return {
        added: urls.map((url, index) => savedLink(`saved-${savedInputs.length}-${index}`, url)),
        duplicates: [],
        invalid: [],
      };
    },
  });

  const ordinaryResponse = await route.POST(post({ urls: [ordinaryUrl] }));
  const paperResponse = await route.POST(post({ urls: [paperUrl] }));

  assert.equal(ordinaryResponse.status, 200);
  assert.equal(paperResponse.status, 200);
  assert.equal(reservations, 0);
  assert.equal(xEnrichments, 0);
  assert.equal(hfLookups, 1);
  assert.deepEqual(savedInputs, [[ordinaryUrl], [paperUrl]]);
  assert.deepEqual((await ordinaryResponse.json()).failed, []);
  assert.deepEqual((await paperResponse.json()).failed, []);
});

test("the X Article cap returns 400 before provider resolution or saving", async () => {
  const urls = Array.from(
    { length: 11 },
    (_, index) => `https://x.com/example/status/${index + 300}`,
  );
  let providerFactoryCalls = 0;
  let saves = 0;
  const provider: XArticleProvider = {
    id: "sorsa",
    fetchArticle: async (url) => article(url.split("/").at(-1)!),
  };
  const route = createResearchLinksRouteHandlers({
    listSavedLinks: async () => [],
    reserveXArticleCandidates: reserveAllXCandidates,
    enrichXArticleUrls: (candidateUrls, existingUrls) => enrichXArticleUrls(candidateUrls, existingUrls, {
      providerFactory: () => {
        providerFactoryCalls++;
        return provider;
      },
    }),
    saveResearchLinks: async () => {
      saves++;
      return { added: [], duplicates: [], invalid: [] };
    },
  });

  const response = await route.POST(post({ urls }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "too many X Articles in one save (max 10)",
  });
  assert.equal(providerFactoryCalls, 0);
  assert.equal(saves, 0);
});

test("the X Article cap rejects before HF metadata, provider work, or saving", async () => {
  const xUrls = Array.from(
    { length: 11 },
    (_, index) => `https://x.com/example/status/${index + 350}`,
  );
  const paperUrl = "https://huggingface.co/papers/2401.12345";
  let hfCalls = 0;
  let providerFactoryCalls = 0;
  let saves = 0;
  const route = createResearchLinksRouteHandlers({
    listSavedLinks: async () => [],
    fetchHfPaperMetadata: async () => {
      hfCalls++;
      return null;
    },
    enrichXArticleUrls: (candidateUrls, existingUrls) => enrichXArticleUrls(candidateUrls, existingUrls, {
      providerFactory: () => {
        providerFactoryCalls++;
        return {
          id: "sorsa",
          fetchArticle: async () => article("350"),
        };
      },
    }),
    saveResearchLinks: async () => {
      saves++;
      return { added: [], duplicates: [], invalid: [] };
    },
  });

  const response = await route.POST(post({ urls: [...xUrls, paperUrl] }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "too many X Articles in one save (max 10)",
  });
  assert.equal(hfCalls, 0);
  assert.equal(providerFactoryCalls, 0);
  assert.equal(saves, 0);
});

test("existing X aliases are passed as dedupe identities and skip provider billing", async () => {
  const saved = savedLink("saved-x", "https://x.com/example/status/400");
  const alias = "https://twitter.com/example/status/400?ref=home";
  let providerFactoryCalls = 0;
  let saves = 0;
  const savedInputs: string[][] = [];
  const route = createResearchLinksRouteHandlers({
    listSavedLinks: async () => [saved],
    reserveXArticleCandidates: async () => ({
      reservedUrls: [],
      reservedIdentities: new Set<string>(),
      existingIdentities: new Set([savedLinkDedupeKey(saved.url)]),
      contendedIdentities: new Set<string>(),
      release: async () => {},
    }),
    enrichXArticleUrls: (urls, existingUrls) => enrichXArticleUrls(urls, existingUrls, {
      providerFactory: () => {
        providerFactoryCalls++;
        return {
          id: "sorsa",
          fetchArticle: async () => {
            throw new Error("saved alias must not be billed");
          },
        };
      },
    }),
    saveResearchLinks: async (urls) => {
      saves++;
      savedInputs.push([...urls]);
      return { added: [], duplicates: [], invalid: [] };
    },
  });

  const response = await route.POST(post({ urls: [alias] }));
  assert.equal(response.status, 200);
  assert.equal(providerFactoryCalls, 0);
  assert.equal(saves, 1);
  assert.deepEqual(savedInputs, [[]]);
  assert.deepEqual((await response.json()).duplicates, [alias]);
});

test("a failed X Article is omitted from saving and can resolve on a later retry", async () => {
  const ordinary = "https://example.com/ordinary";
  const xUrl = "https://x.com/example/status/601";
  const savedInputs: string[][] = [];
  let resolutionAttempts = 0;
  const route = createResearchLinksRouteHandlers({
    listSavedLinks: async () => [],
    reserveXArticleCandidates: reserveAllXCandidates,
    enrichXArticleUrls: async (_urls) => {
      resolutionAttempts++;
      if (resolutionAttempts === 1) {
        return {
          enrichments: new Map(),
          failures: [{
            url: xUrl,
            code: "timeout",
            message: "X article request timed out",
            retryable: true,
          }],
        };
      }
      return {
        enrichments: new Map([[xUrl, {
          xArticle: {
            title: "Fetched X Article",
            snapshot: savedXArticleLink("x-601", xUrl).xArticle!,
          },
        }]]),
        failures: [],
      };
    },
    saveResearchLinks: async (urls) => {
      savedInputs.push([...urls]);
      return {
        added: urls.map((url, index) => savedLink(`saved-${savedInputs.length}-${index}`, url)),
        duplicates: [],
        invalid: [],
      };
    },
  });

  const first = await route.POST(post({ urls: [ordinary, xUrl] }));
  assert.equal(first.status, 200);
  assert.deepEqual(savedInputs, [[ordinary]]);
  assert.equal((await first.json()).failed[0].code, "timeout");

  const second = await route.POST(post({ urls: [xUrl] }));
  assert.equal(second.status, 200);
  assert.deepEqual(savedInputs, [[ordinary], [xUrl]]);
  assert.equal((await second.json()).failed.length, 0);
  assert.equal(resolutionAttempts, 2);
});

test("not-article and invalid X results are never saved as plain links", async () => {
  for (const code of ["not-article", "invalid-response"] as const) {
    const xUrl = `https://x.com/example/status/${code === "not-article" ? "611" : "612"}`;
    const savedInputs: string[][] = [];
    const route = createResearchLinksRouteHandlers({
      listSavedLinks: async () => [],
      reserveXArticleCandidates: reserveAllXCandidates,
      enrichXArticleUrls: async () => ({
        enrichments: new Map(),
        failures: [{
          url: xUrl,
          code,
          message: "X article could not be resolved",
          retryable: code === "invalid-response",
        }],
      }),
      saveResearchLinks: async (urls) => {
        savedInputs.push([...urls]);
        return { added: [], duplicates: [], invalid: [] };
      },
    });

    const response = await route.POST(post({ urls: [xUrl] }));
    assert.equal(response.status, 200, code);
    assert.deepEqual(savedInputs, [[]], code);
    assert.equal((await response.json()).failed[0].code, code);
  }
});

test("overlapping X ingests bill once and never save a plain downgrade", async () => {
  const xUrl = "https://x.com/example/status/701";
  const identity = savedLinkDedupeKey(xUrl);
  let reserved = false;
  let releaseProvider!: () => void;
  const providerGate = new Promise<void>((resolve) => {
    releaseProvider = resolve;
  });
  let providerStarted!: () => void;
  const providerStartedGate = new Promise<void>((resolve) => {
    providerStarted = resolve;
  });
  let secondReservationObserved!: () => void;
  const secondReservationGate = new Promise<void>((resolve) => {
    secondReservationObserved = resolve;
  });
  let providerCalls = 0;
  const saved: Array<{ urls: string[]; hasArticle: boolean }> = [];
  const reserveXArticleCandidates = async (urls: readonly string[]) => {
    if (reserved) {
      secondReservationObserved();
      return {
        reservedUrls: [],
        reservedIdentities: new Set<string>(),
        existingIdentities: new Set<string>(),
        contendedIdentities: new Set([identity]),
        release: async () => {},
      };
    }
    reserved = true;
    return {
      reservedUrls: [...urls],
      reservedIdentities: new Set([identity]),
      existingIdentities: new Set<string>(),
      contendedIdentities: new Set<string>(),
      release: async () => {
        reserved = false;
      },
    };
  };
  const route = createResearchLinksRouteHandlers({
    listSavedLinks: async () => [],
    reserveXArticleCandidates,
    enrichXArticleUrls: async (urls) => {
      if (urls.length === 0) return { enrichments: new Map(), failures: [] };
      providerCalls += urls.length;
      providerStarted();
      await providerGate;
      return {
        enrichments: new Map([[xUrl, {
          xArticle: {
            title: "Fetched X Article",
            snapshot: savedXArticleLink("x-701", xUrl).xArticle!,
          },
        }]]),
        failures: [],
      };
    },
    saveResearchLinks: async (urls, _source, enrichment) => {
      const savedEnrichment = enrichment?.get(xUrl);
      saved.push({
        urls: [...urls],
        hasArticle: savedEnrichment !== undefined
          && savedEnrichment !== null
          && "xArticle" in savedEnrichment
          && savedEnrichment.xArticle !== undefined,
      });
      return {
        added: urls.map((url) => savedLink("saved-x", url)),
        duplicates: [],
        invalid: [],
      };
    },
  });

  const first = route.POST(post({ urls: [xUrl] }));
  await providerStartedGate;
  const second = route.POST(post({ urls: [xUrl] }));
  await secondReservationGate;
  assert.equal(providerCalls, 1);
  releaseProvider();
  const [firstResponse, secondResponse] = await Promise.all([first, second]);

  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 200);
  assert.equal(saved.length, 2);
  assert.ok(saved.some((entry) => (
    entry.urls.length === 0 && entry.hasArticle === false
  )));
  assert.ok(saved.some((entry) => (
    entry.urls.length === 1 && entry.urls[0] === xUrl && entry.hasArticle
  )));
  assert.deepEqual((await secondResponse.json()).duplicates, [xUrl]);
});

test("preserves the total-link cap before loading or saving links", async () => {
  let reads = 0;
  let saves = 0;
  const route = createResearchLinksRouteHandlers({
    listSavedLinks: async () => {
      reads++;
      return [];
    },
    saveResearchLinks: async () => {
      saves++;
      return { added: [], duplicates: [], invalid: [] };
    },
  });
  const urls = Array.from({ length: 51 }, (_, index) => `https://example.com/${index}`);

  const response = await route.POST(post({ urls }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "too many links in one save (max 50)",
  });
  assert.equal(reads, 0);
  assert.equal(saves, 0);
});

test("unexpected X provider errors drain started calls before release and block early retry billing", async () => {
  const urls = Array.from(
    { length: 4 },
    (_, index) => `https://x.com/example/status/${801 + index}`,
  );
  const identities = urls.map(savedLinkDedupeKey);
  const reserved = new Set<string>();
  const providerCalls: string[] = [];
  let releaseStartedCalls!: () => void;
  const startedCallsGate = new Promise<void>((resolve) => {
    releaseStartedCalls = resolve;
  });
  let threeCallsStarted!: () => void;
  const threeCallsStartedGate = new Promise<void>((resolve) => {
    threeCallsStarted = resolve;
  });
  const route = createResearchLinksRouteHandlers({
    listSavedLinks: async () => [],
    reserveXArticleCandidates: async (urls) => {
      const reservedUrls: string[] = [];
      const reservedIdentities = new Set<string>();
      const contendedIdentities = new Set<string>();
      for (const url of urls) {
        const identity = savedLinkDedupeKey(url);
        if (reserved.has(identity)) {
          contendedIdentities.add(identity);
          continue;
        }
        reserved.add(identity);
        reservedUrls.push(url);
        reservedIdentities.add(identity);
      }
      return {
        reservedUrls,
        reservedIdentities,
        existingIdentities: new Set<string>(),
        contendedIdentities,
        release: async () => {
          for (const identity of reservedIdentities) reserved.delete(identity);
        },
      };
    },
    enrichXArticleUrls: (candidateUrls, existingUrls) => enrichXArticleUrls(
      candidateUrls,
      existingUrls,
      {
        provider: {
          id: "sorsa",
          fetchArticle: async (url) => {
            providerCalls.push(url);
            if (providerCalls.length === 3) threeCallsStarted();
            if (url === urls[0]) throw new Error("unexpected X provider wiring");
            await startedCallsGate;
            return article(url.split("/").at(-1)!);
          },
        },
      },
    ),
    saveResearchLinks: async (savedUrls) => ({
      added: savedUrls.map((url) => savedLink("saved-x", url)),
      duplicates: [],
      invalid: [],
    }),
  });

  const first = route.POST(post({ urls }));
  let firstSettled = false;
  void first.then(
    () => {
      firstSettled = true;
    },
    () => {
      firstSettled = true;
    },
  );
  await threeCallsStartedGate;

  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(firstSettled, false);
    assert.deepEqual(providerCalls, urls.slice(0, 3));
    assert.deepEqual([...reserved].sort(), [...identities].sort());

    const retry = await route.POST(post({ urls }));
    assert.equal(retry.status, 200);
    assert.deepEqual((await retry.json()).duplicates, urls);
    assert.deepEqual(providerCalls, urls.slice(0, 3));
    assert.deepEqual([...reserved].sort(), [...identities].sort());
  } finally {
    releaseStartedCalls();
  }

  await assert.rejects(() => first, /unexpected X provider wiring/);
  assert.deepEqual(providerCalls, urls.slice(0, 3));
  assert.equal(reserved.size, 0);
});

test("storage failures release X reservations for a later save", async () => {
  const xUrl = "https://x.com/example/status/802";
  const identity = savedLinkDedupeKey(xUrl);
  let reserved = false;
  let writes = 0;
  const route = createResearchLinksRouteHandlers({
    listSavedLinks: async () => [],
    reserveXArticleCandidates: async (urls) => {
      if (reserved) {
        return {
          reservedUrls: [],
          reservedIdentities: new Set<string>(),
          existingIdentities: new Set<string>(),
          contendedIdentities: new Set([identity]),
          release: async () => {},
        };
      }
      reserved = true;
      return {
        reservedUrls: [...urls],
        reservedIdentities: new Set([identity]),
        existingIdentities: new Set<string>(),
        contendedIdentities: new Set<string>(),
        release: async () => {
          reserved = false;
        },
      };
    },
    enrichXArticleUrls: async () => ({
      enrichments: new Map([[xUrl, {
        xArticle: {
          title: "Fetched X Article",
          snapshot: savedXArticleLink("x-802", xUrl).xArticle!,
        },
      }]]),
      failures: [],
    }),
    saveResearchLinks: async (urls) => {
      writes++;
      if (writes === 1) throw new Error("disk full");
      return {
        added: urls.map((url) => savedLink("saved-x", url)),
        duplicates: [],
        invalid: [],
      };
    },
  });

  const failed = await route.POST(post({ urls: [xUrl] }));
  assert.equal(failed.status, 500);
  assert.equal(reserved, false);

  const retry = await route.POST(post({ urls: [xUrl] }));
  assert.equal(retry.status, 200);
  assert.equal(writes, 2);
});
