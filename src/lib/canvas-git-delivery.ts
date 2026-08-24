export function canvasCommitRequiresDefaultBranch(
  currentBranch: string,
  defaultBranch: string,
  required: boolean,
): boolean {
  return required && currentBranch !== defaultBranch;
}

export function exactBranchPushRef(branch: string, expectedHead: string): string {
  return `${expectedHead}:refs/heads/${branch}`;
}

export function remoteBranchMatchesExpectedHead(
  lsRemoteOutput: string,
  expectedHead: string,
): boolean {
  return lsRemoteOutput.trim().split(/\s+/)[0] === expectedHead;
}
