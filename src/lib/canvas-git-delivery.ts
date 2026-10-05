export function canvasCommitRequiresDefaultBranch(
  currentBranch: string,
  defaultBranch: string,
  required: boolean,
): boolean {
  return required && currentBranch !== defaultBranch;
}

/**
 * The refspec that pushes `source` (a commit id, or the branch itself) to
 * `branch`. A branch source is spelled out as `refs/heads/<branch>` (#5795):
 * bare, a name starting with `-` reached `git push` as options, so `-fo` was
 * a forced push with no refspec.
 */
export function exactBranchPushRef(branch: string, source: string): string {
  const from = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(source) ? source : `refs/heads/${source}`;
  return `${from}:refs/heads/${branch}`;
}

export function remoteBranchMatchesExpectedHead(
  lsRemoteOutput: string,
  expectedHead: string,
): boolean {
  return lsRemoteOutput.trim().split(/\s+/)[0] === expectedHead;
}
