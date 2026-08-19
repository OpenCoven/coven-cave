"use client";

import { forwardRef } from "react";
import { RelativeTime } from "@/components/ui/relative-time";
import type { XArticleSnapshot } from "@/lib/x-articles";

type ResearchXArticleReaderProps = {
  title: string;
  article: XArticleSnapshot;
};

function authorName(article: XArticleSnapshot): string {
  return article.author.displayName ?? `@${article.author.username}`;
}

export const ResearchXArticleReader = forwardRef<HTMLElement, ResearchXArticleReaderProps>(
  function ResearchXArticleReader({ title, article }, ref) {
    const paragraphs = article.body
      .split(/\r?\n\s*\r?\n/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);

    return (
      <article
        ref={ref}
        className="research-x-article-reader focus-ring"
        aria-label={`Reading ${title}`}
        tabIndex={-1}
      >
        <header className="research-x-article-reader__head">
          <span className="research-x-article-reader__provenance">
            X Article · via {article.provider}
          </span>
          <h4>{title}</h4>
          <div className="research-x-article-reader__byline">
            <span>{authorName(article)}</span>
            {article.author.displayName ? <span>@{article.author.username}</span> : null}
            <span>
              Published <RelativeTime iso={article.publishedAt} fallback="date unavailable" />
            </span>
          </div>
        </header>
        <div className="research-x-article-reader__body">
          {paragraphs.map((paragraph, index) => (
            <p key={`${article.contentSha256}-${index}`}>{paragraph}</p>
          ))}
        </div>
      </article>
    );
  },
);
