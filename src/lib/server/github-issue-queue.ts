import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { caveToolSpawnEnv } from "@/lib/coven-bin";

/**
 * The Queue and Work surfaces read and write GitHub Issues through the `gh`
 * CLI, run in the selected project's repository so `gh` resolves OWNER/REPO
 * from its remote without Cave hardcoding it (#5566).
 *
 * GitHub has no status or priority fields, so the queue derives them:
 *   - status: `in_progress` when the issue has an assignee or a
 *     `familiar:<id>` label, otherwise `open`;
 *   - priority: a `P0`–`P4` label (0 = Critical … 4 = Backlog), or null
 *     (Unranked) when the issue has none;
 *   - ready / blocked: an open issue is blocked while any issue in its
 *     `blockedBy` dependency list is still open.
 */

const execFileAsync = promisify(execFile);
const GH_TIMEOUT_MS = 30_000;
const MAX_GH_BUFFER = 16 * 1024 * 1024;
/** Five pages of 100: enough for any queue a person triages by hand. */
const MAX_ISSUE_PAGES = 5;
const REPO_CACHE_TTL_MS = 60_000;

export const ISSUE_PRIORITY_MIN = 0;
export const ISSUE_PRIORITY_MAX = 4;
const PRIORITY_LABEL_RE = /^p([0-4])$/i;
const FAMILIAR_LABEL_PREFIX = "familiar:";

export type GhResult =
  | { ok: true; stdout: string; stderr: string }
  | { ok: false; status: number; error: string; stdout: string; stderr: string };

export type IssueQueueItem = {
  /** `#123` for this repository; `owner/repo#123` for a cross-repository blocker. */
  id: string;
  number: number;
  title: string;
  status: "open" | "in_progress" | "closed";
  priority: number | null;
  assignee: string | null;
  labels: string[];
  updated_at: string | null;
  comment_count: number;
  description: string | null;
  url: string;
  issue_type: string | null;
  /** Ids of the still-open issues this one is blocked by. */
  blocked_by: string[];
  blocked_by_count: number;
};

/** A blocker named for the gates rail: enough to say what clears it. */
export type IssueBlockerRecord = {
  id: string;
  title: string;
  status: "open" | "closed";
  priority: number | null;
  url: string;
};

export type IssueQueueSnapshot = {
  repository: string;
  ready: IssueQueueItem[];
  blocked: IssueQueueItem[];
  blockers: IssueBlockerRecord[];
};

type Runner = (repoRoot: string, args: string[]) => Promise<GhResult>;

export async function runGh(repoRoot: string, args: string[]): Promise<GhResult> {
  try {
    const { stdout, stderr } = await execFileAsync("gh", args, {
      windowsHide: true,
      cwd: repoRoot,
      env: { ...caveToolSpawnEnv(), GH_PROMPT_DISABLED: "1" },
      timeout: GH_TIMEOUT_MS,
      maxBuffer: MAX_GH_BUFFER,
    });
    return { ok: true, stdout, stderr };
  } catch (cause) {
    const error = cause as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    const stderr = error.stderr ?? "";
    if (error.code === "ENOENT") {
      return { ok: false, status: 503, error: "gh unavailable", stdout: "", stderr };
    }
    return {
      ok: false,
      status: 502,
      error: stderr.trim().split("\n")[0] || error.message || "gh command failed",
      stdout: error.stdout ?? "",
      stderr,
    };
  }
}

const repositoryCache = new Map<string, { expiresAt: number; nameWithOwner: string }>();

/** OWNER/REPO for the project's GitHub remote, or a failed gh result. */
export async function resolveGitHubRepository(
  repoRoot: string,
  run: Runner = runGh,
): Promise<{ ok: true; nameWithOwner: string } | Extract<GhResult, { ok: false }>> {
  const cached = repositoryCache.get(repoRoot);
  if (cached && cached.expiresAt > Date.now()) return { ok: true, nameWithOwner: cached.nameWithOwner };
  const result = await run(repoRoot, ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  if (!result.ok) return result;
  const nameWithOwner = result.stdout.trim();
  if (!/^[^/\s]+\/[^/\s]+$/.test(nameWithOwner)) {
    return { ok: false, status: 502, error: "gh did not report a GitHub repository", stdout: result.stdout, stderr: result.stderr };
  }
  repositoryCache.set(repoRoot, { expiresAt: Date.now() + REPO_CACHE_TTL_MS, nameWithOwner });
  return { ok: true, nameWithOwner };
}

export function priorityFromLabels(labels: readonly string[]): number | null {
  let best: number | null = null;
  for (const label of labels) {
    const match = PRIORITY_LABEL_RE.exec(label.trim());
    if (!match) continue;
    const value = Number(match[1]);
    if (best === null || value < best) best = value;
  }
  return best;
}

export function priorityLabel(priority: number): string {
  return `P${priority}`;
}

export function familiarLabel(familiarId: string): string {
  return `${FAMILIAR_LABEL_PREFIX}${familiarId}`;
}

/** `#123` and `123` name an issue in this repository; anything else is refused. */
export function issueNumberFromId(id: string): number | null {
  const match = /^#?(\d{1,9})$/.exec(id.trim());
  if (!match) return null;
  const value = Number(match[1]);
  return value > 0 ? value : null;
}

type RawIssueRef = {
  number?: number;
  title?: string;
  state?: string;
  url?: string;
  repository?: { nameWithOwner?: string } | null;
  labels?: { nodes?: Array<{ name?: string } | null> } | null;
};

type RawIssue = RawIssueRef & {
  body?: string | null;
  updatedAt?: string | null;
  assignees?: { nodes?: Array<{ login?: string } | null> } | null;
  comments?: { totalCount?: number } | null;
  issueType?: { name?: string } | null;
  blockedBy?: { nodes?: Array<RawIssueRef | null> } | null;
};

function labelNames(raw: RawIssueRef): string[] {
  return (raw.labels?.nodes ?? [])
    .map((node) => node?.name?.trim() ?? "")
    .filter(Boolean);
}

function refId(raw: RawIssueRef, repository: string): string {
  const owner = raw.repository?.nameWithOwner;
  return owner && owner.toLowerCase() !== repository.toLowerCase() ? `${owner}#${raw.number}` : `#${raw.number}`;
}

export function issueItemFromGraph(raw: RawIssue, repository: string): IssueQueueItem | null {
  if (typeof raw.number !== "number" || typeof raw.title !== "string") return null;
  const labels = labelNames(raw);
  const assignee = (raw.assignees?.nodes ?? []).map((node) => node?.login).find(Boolean) ?? null;
  const closed = raw.state === "CLOSED";
  const claimed = assignee !== null || labels.some((label) => label.startsWith(FAMILIAR_LABEL_PREFIX));
  const openBlockers = (raw.blockedBy?.nodes ?? [])
    .filter((node): node is RawIssueRef => Boolean(node) && node?.state === "OPEN" && typeof node?.number === "number")
    .map((node) => refId(node, repository));
  return {
    id: `#${raw.number}`,
    number: raw.number,
    title: raw.title,
    status: closed ? "closed" : claimed ? "in_progress" : "open",
    priority: priorityFromLabels(labels),
    assignee,
    labels,
    updated_at: raw.updatedAt ?? null,
    comment_count: raw.comments?.totalCount ?? 0,
    description: raw.body ?? null,
    url: raw.url ?? "",
    issue_type: raw.issueType?.name ?? null,
    blocked_by: openBlockers,
    blocked_by_count: openBlockers.length,
  };
}

const ISSUE_FIELDS = `
  number title state url body updatedAt
  repository { nameWithOwner }
  assignees(first: 5) { nodes { login } }
  labels(first: 30) { nodes { name } }
  comments { totalCount }
  issueType { name }
  blockedBy(first: 20) { nodes { number title state url repository { nameWithOwner } labels(first: 30) { nodes { name } } } }
`;

const QUEUE_QUERY = `query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    issues(first: 100, after: $after, states: OPEN, orderBy: { field: UPDATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes { ${ISSUE_FIELDS} }
    }
  }
}`;

const ISSUE_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { issue(number: $number) { ${ISSUE_FIELDS} } }
}`;

function graphArgs(query: string, nameWithOwner: string, variables: Record<string, string | number>): string[] {
  const [owner, name] = nameWithOwner.split("/");
  const args = ["api", "graphql", "-f", `query=${query}`, "-F", `owner=${owner}`, "-F", `name=${name}`];
  for (const [key, value] of Object.entries(variables)) {
    // -F coerces numbers; -f keeps strings (a cursor must stay a string).
    args.push(typeof value === "number" ? "-F" : "-f", `${key}=${value}`);
  }
  return args;
}

function parseGraph(stdout: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(stdout) as { data?: Record<string, unknown> };
    return parsed && typeof parsed.data === "object" ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Every open issue, split into ready and blocked, with blockers named. */
export async function readIssueQueue(
  repoRoot: string,
  run: Runner = runGh,
): Promise<{ ok: true; snapshot: IssueQueueSnapshot } | Extract<GhResult, { ok: false }>> {
  const repository = await resolveGitHubRepository(repoRoot, run);
  if (!repository.ok) return repository;
  const raws: RawIssue[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_ISSUE_PAGES; page += 1) {
    const result = await run(repoRoot, graphArgs(QUEUE_QUERY, repository.nameWithOwner, after ? { after } : {}));
    if (!result.ok) return result;
    const data = parseGraph(result.stdout);
    const issues = (data?.repository as { issues?: { nodes?: RawIssue[]; pageInfo?: { hasNextPage?: boolean; endCursor?: string } } } | undefined)?.issues;
    if (!issues) {
      return { ok: false, status: 502, error: "gh returned an unexpected issue list", stdout: result.stdout, stderr: result.stderr };
    }
    raws.push(...(issues.nodes ?? []));
    if (!issues.pageInfo?.hasNextPage || !issues.pageInfo.endCursor) break;
    after = issues.pageInfo.endCursor;
  }

  const ready: IssueQueueItem[] = [];
  const blocked: IssueQueueItem[] = [];
  const blockers = new Map<string, IssueBlockerRecord>();
  for (const raw of raws) {
    const item = issueItemFromGraph(raw, repository.nameWithOwner);
    if (!item) continue;
    (item.blocked_by.length > 0 ? blocked : ready).push(item);
    for (const node of raw.blockedBy?.nodes ?? []) {
      if (!node || node.state !== "OPEN" || typeof node.number !== "number") continue;
      const id = refId(node, repository.nameWithOwner);
      blockers.set(id, {
        id,
        title: node.title ?? id,
        status: "open",
        priority: priorityFromLabels(labelNames(node)),
        url: node.url ?? "",
      });
    }
  }
  return { ok: true, snapshot: { repository: repository.nameWithOwner, ready, blocked, blockers: [...blockers.values()] } };
}

export async function readIssue(
  repoRoot: string,
  number: number,
  run: Runner = runGh,
): Promise<{ ok: true; item: IssueQueueItem } | Extract<GhResult, { ok: false }>> {
  const repository = await resolveGitHubRepository(repoRoot, run);
  if (!repository.ok) return repository;
  const result = await run(repoRoot, graphArgs(ISSUE_QUERY, repository.nameWithOwner, { number }));
  if (!result.ok) return result;
  const raw = (parseGraph(result.stdout)?.repository as { issue?: RawIssue } | undefined)?.issue;
  const item = raw ? issueItemFromGraph(raw, repository.nameWithOwner) : null;
  if (!item) return { ok: false, status: 404, error: `issue #${number} not found`, stdout: result.stdout, stderr: result.stderr };
  return { ok: true, item };
}

/** Labels are created on first use so a priority or familiar write never fails on a fresh repository. */
async function editLabels(
  repoRoot: string,
  number: number,
  add: string[],
  remove: string[],
  run: Runner,
): Promise<GhResult> {
  const args = ["issue", "edit", String(number)];
  for (const label of add) args.push("--add-label", label);
  for (const label of remove) args.push("--remove-label", label);
  let result = await run(repoRoot, args);
  if (!result.ok && add.length > 0 && /not found/i.test(result.error + result.stderr)) {
    for (const label of add) {
      await run(repoRoot, ["label", "create", label]);
    }
    result = await run(repoRoot, args);
  }
  return result;
}

export async function setIssuePriority(
  repoRoot: string,
  number: number,
  priority: number | null,
  currentLabels: readonly string[],
  run: Runner = runGh,
): Promise<GhResult> {
  const remove = currentLabels.filter((label) => PRIORITY_LABEL_RE.test(label.trim()));
  const add = priority === null ? [] : [priorityLabel(priority)];
  const toRemove = remove.filter((label) => !add.includes(label));
  if (add.length === 0 && toRemove.length === 0) return { ok: true, stdout: "", stderr: "" };
  return editLabels(repoRoot, number, add, toRemove, run);
}

/**
 * Claim assigns the connected GitHub user. Claiming for a familiar also sets
 * its `familiar:<id>` label (replacing any other familiar label), which is how
 * the queue and scheduler resolve an issue's owning familiar.
 */
export async function claimIssue(
  repoRoot: string,
  number: number,
  familiarId: string | null,
  currentLabels: readonly string[],
  run: Runner = runGh,
): Promise<GhResult> {
  const assigned = await run(repoRoot, ["issue", "edit", String(number), "--add-assignee", "@me"]);
  if (!assigned.ok || !familiarId) return assigned;
  const wanted = familiarLabel(familiarId);
  const remove = currentLabels.filter((label) => label.startsWith(FAMILIAR_LABEL_PREFIX) && label !== wanted);
  const add = currentLabels.includes(wanted) ? [] : [wanted];
  if (add.length === 0 && remove.length === 0) return assigned;
  return editLabels(repoRoot, number, add, remove, run);
}

export async function commentOnIssue(repoRoot: string, number: number, body: string, run: Runner = runGh): Promise<GhResult> {
  return run(repoRoot, ["issue", "comment", String(number), "--body", body]);
}

export async function closeIssue(repoRoot: string, number: number, reason: string, run: Runner = runGh): Promise<GhResult> {
  return run(repoRoot, ["issue", "close", String(number), "--reason", "completed", "--comment", reason]);
}

/** Creates an issue and returns its number and URL from gh's printed URL. */
export async function createIssue(
  repoRoot: string,
  input: { title: string; body: string; labels: string[] },
  run: Runner = runGh,
): Promise<{ ok: true; number: number; url: string } | Extract<GhResult, { ok: false }>> {
  const args = ["issue", "create", "--title", input.title, "--body", input.body];
  for (const label of input.labels) args.push("--label", label);
  let result = await run(repoRoot, args);
  if (!result.ok && input.labels.length > 0 && /not found/i.test(result.error + result.stderr)) {
    for (const label of input.labels) await run(repoRoot, ["label", "create", label]);
    result = await run(repoRoot, args);
  }
  if (!result.ok) return result;
  const url = result.stdout.trim().split("\n").pop() ?? "";
  const match = /\/issues\/(\d+)\s*$/.exec(url);
  if (!match) return { ok: false, status: 502, error: "gh did not report the new issue URL", stdout: result.stdout, stderr: result.stderr };
  return { ok: true, number: Number(match[1]), url };
}
