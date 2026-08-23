import type { NormalizedXArticle, XArticleProviderId } from "../x-articles.ts";
import { XArticleProviderError } from "../x-articles.ts";
import { resolveSecret } from "../grimoire/vault.ts";
import {
  fetchSorsaXArticle,
  type FetchSorsaXArticleOptions,
} from "./x-article-sorsa.ts";

export type XArticleProvider = {
  id: XArticleProviderId;
  fetchArticle(url: string): Promise<NormalizedXArticle>;
};

type FetchSorsaXArticleFn = (
  url: string,
  options: FetchSorsaXArticleOptions,
) => Promise<NormalizedXArticle>;

export type XArticleProviderDependencies = {
  resolveSecretImpl?: (key: string) => string | undefined;
  fetchSorsaXArticleImpl?: FetchSorsaXArticleFn;
};

function providerError(
  code: XArticleProviderError["code"],
  message: string,
  retryable: boolean,
): XArticleProviderError {
  return new XArticleProviderError(code, message, retryable);
}

function notConfigured(): XArticleProviderError {
  return providerError("not-configured", "X article provider is not configured", false);
}

function missingCredential(): XArticleProviderError {
  return providerError("missing-credential", "X article provider credentials are unavailable", false);
}

export function configuredXArticleProviderWithDependencies(
  env: NodeJS.ProcessEnv,
  dependencies: XArticleProviderDependencies = {},
): XArticleProvider {
  const providerId = env.COVEN_CAVE_X_ARTICLE_PROVIDER?.trim().toLowerCase();
  if (providerId !== "sorsa") throw notConfigured();

  const resolveSecretImpl = dependencies.resolveSecretImpl ?? resolveSecret;
  let apiKey: string | undefined;
  try {
    apiKey = resolveSecretImpl("SORSA_API_KEY")?.trim();
  } catch {
    throw missingCredential();
  }
  if (!apiKey) throw missingCredential();

  const fetchSorsaXArticleImpl =
    dependencies.fetchSorsaXArticleImpl ?? fetchSorsaXArticle;
  return {
    id: "sorsa",
    fetchArticle: (url) => fetchSorsaXArticleImpl(url, { apiKey }),
  };
}

export function configuredXArticleProvider(
  env: NodeJS.ProcessEnv = process.env,
): XArticleProvider {
  return configuredXArticleProviderWithDependencies(env);
}
