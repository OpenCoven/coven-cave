// Count insertions/deletions from a unified-diff string (output of toolInputAsDiff).
export function diffStat(diff: string): { insertions: number; deletions: number } {
  let insertions = 0, deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue; // file headers
    if (line.startsWith("+")) insertions += 1;
    else if (line.startsWith("-")) deletions += 1;
  }
  return { insertions, deletions };
}
