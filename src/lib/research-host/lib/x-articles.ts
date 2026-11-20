// Explicit Research host contract. Keep exports scoped; never export *.
export {
  MAX_X_ARTICLES_PER_INGEST,
  isValidXArticleAuthorDisplayName,
  isValidXArticleAuthorId,
  isValidXArticleContentSha256,
  isValidXArticleSourcePostId,
  isValidXArticleUsername,
  normalizeXArticleCoverImageUrl,
  normalizeXArticleTimestamp,
  parseXArticleCandidateUrl,
} from "@/lib/x-articles";
export type {
  NormalizedXArticle,
  XArticleIngestFailure,
  XArticleSnapshot,
} from "@/lib/x-articles";
