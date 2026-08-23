import assert from "node:assert/strict";
import { test } from "node:test";

import { savedLinkDedupeKey } from "../link-organizer.ts";
import {
  XArticleProviderError,
  type NormalizedXArticle,
} from "../x-articles.ts";
import type { XArticleProvider } from "./x-article-provider.ts";
import {
  MAX_X_ARTICLE_INGEST_CONCURRENCY,
  XArticleIngestCapError,
  enrichXArticleUrls,
} from "./x-article-ingest.ts";

function article(sourcePostId: string, title = `Article ${sourcePostId}`): NormalizedXArticle {
  return {
    provider: "sorsa",
    sourcePostId,
    title,
    titleSource: "derived",
    author: { id: `author-${sourcePostId}`, username: "author" },
    body: `Body ${sourcePostId}`,
    excerpt: `Excerpt ${sourcePostId}`,
    publishedAt: "2026-08-18T00:00:00.000Z",
    fetchedAt: "2026-08-18T00:00:00.000Z",
    contentSha256: "a".repeat(64),
  };
}

function provider(
  fetchArticle: (url: string) => Promise<NormalizedXArticle>,
): XArticleProvider {
  return { id: "sorsa", fetchArticle };
}

test("saved X URLs and aliases never resolve or call the provider", async () => {
  const exact = "https://x.com/example/status/101";
  const alias = "https://twitter.com/i/web/status/102?ref=home";
  const saved = new Set([
    exact,
    savedLinkDedupeKey(alias),
  ]);
  let providerFactoryCalls = 0;
  let providerCalls = 0;

  const result = await enrichXArticleUrls(
    [
      "https://twitter.com/example/status/101?ref=home",
      "https://x.com/example/status/102",
    ],
    saved,
    {
      providerFactory: () => {
        providerFactoryCalls++;
        return provider(async () => {
          providerCalls++;
          throw new Error("the provider must not be called");
        });
      },
    },
  );

  assert.equal(providerFactoryCalls, 0);
  assert.equal(providerCalls, 0);
  assert.deepEqual([...result.enrichments], []);
  assert.deepEqual(result.failures, []);
});

test("dedupes source-post aliases before the cap and preserves the first URL as the map key", async () => {
  const first = "https://twitter.com/example/status/111?ref=home";
  const second = "https://x.com/example/status/112";
  const calls: string[] = [];

  const result = await enrichXArticleUrls(
    [
      first,
      "https://x.com/example/status/111",
      second,
    ],
    new Set(),
    {
      provider: provider(async (url) => {
        calls.push(url);
        return article(url.includes("111") ? "111" : "112");
      }),
    },
  );

  assert.deepEqual(calls, [first, second]);
  assert.deepEqual([...result.enrichments.keys()], [first, second]);
  assert.deepEqual(result.failures, []);
});

test("rejects eleven unique X Articles before resolving or calling a provider", async () => {
  const urls = Array.from(
    { length: 11 },
    (_, index) => `https://x.com/example/status/${index + 1}`,
  );
  let providerFactoryCalls = 0;

  await assert.rejects(
    () => enrichXArticleUrls(urls, new Set(), {
      providerFactory: () => {
        providerFactoryCalls++;
        return provider(async () => article("1"));
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof XArticleIngestCapError);
      assert.equal(error.message, "too many X Articles in one save (max 10)");
      return true;
    },
  );
  assert.equal(providerFactoryCalls, 0);
});

test("uses at most three provider calls in flight", async () => {
  const urls = Array.from(
    { length: 6 },
    (_, index) => `https://x.com/example/status/${index + 201}`,
  );
  let inFlight = 0;
  let maxInFlight = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const pending = enrichXArticleUrls(urls, new Set(), {
    provider: provider(async (url) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await gate;
      inFlight--;
      return article(url.split("/").at(-1)!);
    }),
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(maxInFlight, MAX_X_ARTICLE_INGEST_CONCURRENCY);
  release();
  await pending;
  assert.equal(maxInFlight, 3);
});

test("preserves successful siblings and reports provider failures in input order", async () => {
  const failedFirst = "https://x.com/example/status/301";
  const successful = "https://x.com/example/status/302";
  const failedLast = "https://x.com/example/status/303";
  const lateFailure = new XArticleProviderError("timeout", "late timeout", true);
  const earlyFailure = new XArticleProviderError("not-article", "not an article", false);

  const result = await enrichXArticleUrls(
    [failedFirst, successful, failedLast],
    new Set(),
    {
      provider: provider(async (url) => {
        if (url === failedFirst) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          throw lateFailure;
        }
        if (url === failedLast) throw earlyFailure;
        return article("302", "Saved sibling");
      }),
    },
  );

  assert.deepEqual([...result.enrichments.keys()], [successful]);
  assert.deepEqual(result.failures, [
    { url: failedFirst, code: "timeout", message: "late timeout", retryable: true },
    { url: failedLast, code: "not-article", message: "not an article", retryable: false },
  ]);
});

test("a configured-provider error fans out per unsaved URL, while unexpected errors rethrow", async () => {
  const urls = [
    "https://x.com/example/status/401",
    "https://x.com/example/status/402",
  ];
  let factoryCalls = 0;
  const unavailable = new XArticleProviderError(
    "missing-credential",
    "X article provider credentials are unavailable",
    false,
  );

  const unavailableResult = await enrichXArticleUrls(urls, new Set(), {
    providerFactory: () => {
      factoryCalls++;
      throw unavailable;
    },
  });

  assert.equal(factoryCalls, 1);
  assert.deepEqual(unavailableResult.failures, urls.map((url) => ({
    url,
    code: "missing-credential",
    message: "X article provider credentials are unavailable",
    retryable: false,
  })));

  await assert.rejects(
    () => enrichXArticleUrls(urls, new Set(), {
      provider: provider(async () => {
        throw new Error("programming error");
      }),
    }),
    /programming error/,
  );
});

test("rethrows unexpected provider errors in candidate order after started calls settle", async () => {
  const urls = Array.from(
    { length: 3 },
    (_, index) => `https://x.com/example/status/${451 + index}`,
  );
  const releases: Array<() => void> = [];
  const gates = urls.map(() => new Promise<void>((resolve) => {
    releases.push(resolve);
  }));
  const errors = urls.map((_, index) => new Error(`unexpected ${index}`));
  let calls = 0;

  const pending = enrichXArticleUrls(urls, new Set(), {
    provider: provider(async (url) => {
      const index = urls.indexOf(url);
      calls++;
      await gates[index];
      throw errors[index];
    }),
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 3);
  releases[2]();
  releases[1]();
  releases[0]();
  await assert.rejects(
    () => pending,
    (error: unknown) => error === errors[0],
  );
});

test("creates a versioned snapshot without retaining the title", async () => {
  const url = "https://x.com/example/status/501";
  const result = await enrichXArticleUrls([url], new Set(), {
    provider: provider(async () => article("501", "A retained title")),
  });

  const enrichment = result.enrichments.get(url);
  assert.deepEqual(enrichment?.xArticle?.title, "A retained title");
  assert.deepEqual(enrichment?.xArticle?.snapshot, {
    version: 1,
    provider: "sorsa",
    sourcePostId: "501",
    titleSource: "derived",
    author: { id: "author-501", username: "author" },
    body: "Body 501",
    excerpt: "Excerpt 501",
    publishedAt: "2026-08-18T00:00:00.000Z",
    fetchedAt: "2026-08-18T00:00:00.000Z",
    contentSha256: "a".repeat(64),
  });
  assert.equal("title" in (enrichment?.xArticle?.snapshot ?? {}), false);
});
