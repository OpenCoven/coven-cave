import { createHash } from "node:crypto";
import type { ResearchMission, ResearchSourceRef } from "../research-missions.ts";
import { getSavedLinkById } from "./research-links.ts";
import {
  restoreResearchMissionSourceFile,
  writeResearchMissionSourceFile,
} from "./research-mission-store.ts";

export type MaterializedSavedLink = {
  source: ResearchSourceRef;
  rollback(): Promise<void>;
};

function savedLinkDigest(savedLinkId: string, contentSha256: string): string {
  return createHash("sha256")
    .update(`saved-x-article:${savedLinkId}\n${contentSha256}`)
    .digest("hex")
    .slice(0, 24);
}

function authorLabel(
  author: { username: string; displayName?: string },
): { author: string; publisher: string } {
  const username = `@${author.username}`;
  if (!author.displayName) return { author: username, publisher: username };
  return {
    author: `${author.displayName} (${username})`,
    publisher: author.displayName,
  };
}

function renderArticleMarkdown(
  title: string,
  url: string,
  article: NonNullable<Awaited<ReturnType<typeof getSavedLinkById>>>["xArticle"],
): string {
  if (!article) throw new Error("saved X Article not found");
  const { author } = authorLabel(article.author);
  return `# ${title}

- Source: ${url}
- Author: ${author}
- Published: ${article.publishedAt}
- Fetched: ${article.fetchedAt}
- Provider: ${article.provider}
- Content SHA-256: ${article.contentSha256}

${article.body}
`;
}

export async function materializeSavedLinkForMission(
  mission: ResearchMission,
  savedLinkId: string,
): Promise<MaterializedSavedLink> {
  const savedLink = await getSavedLinkById(savedLinkId);
  if (!savedLink?.xArticle) throw new Error("saved X Article not found");

  const digest = savedLinkDigest(savedLink.id, savedLink.xArticle.contentSha256);
  const fileName = `x-article-${digest}.md`;
  const labels = authorLabel(savedLink.xArticle.author);
  const written = await writeResearchMissionSourceFile(
    mission.id,
    fileName,
    renderArticleMarkdown(savedLink.title, savedLink.url, savedLink.xArticle),
  );
  return {
    source: {
      id: `saved-${digest}`,
      title: savedLink.title,
      url: savedLink.url,
      localPath: written.path,
      publisher: labels.publisher,
      publishedAt: savedLink.xArticle.publishedAt,
      sourceType: "x-article",
      status: "candidate",
    },
    rollback: () => restoreResearchMissionSourceFile(
      mission.id,
      fileName,
      written.previous,
      written.expected,
    ),
  };
}
