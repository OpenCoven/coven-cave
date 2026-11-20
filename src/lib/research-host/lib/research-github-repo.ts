// Explicit Research host contract. Keep exports scoped; never export *.
export {
  GITHUB_REPO_FILE_BYTE_CAP,
  GITHUB_REPO_README_BYTE_CAP,
  GITHUB_REPO_TREE_ENTRY_CAP,
  MAX_GITHUB_REPOSITORIES_PER_INGEST,
  buildGithubRepoTree,
  formatGithubBytes,
  githubRepoCandidates,
  githubRepoFileEndpoint,
  githubRepoFileWebUrl,
  githubRepoReadmeLinkUrl,
  githubRepoTreeWebUrl,
  githubRepoWebUrl,
  normalizeGithubRepoSnapshot,
  parseGithubRepoInput,
  sanitizeGithubObjectSha,
  sanitizeGithubRef,
} from "@/lib/research-github-repo";
export type {
  GithubRepoFileView,
  GithubRepoReadme,
  GithubRepoSnapshot,
  GithubRepoSummary,
  GithubRepoTreeEntry,
  GithubRepoView,
  GithubRepoVisibility,
  RepoTreeNode,
} from "@/lib/research-github-repo";
