// Explicit Research host contract. Keep exports scoped; never export *.
export {
  XArticleIngestCapError,
  assertXArticleIngestCap,
  enrichXArticleUrls,
} from "@/lib/server/x-article-ingest";
export type {
  XArticleBatchResult,
} from "@/lib/server/x-article-ingest";
