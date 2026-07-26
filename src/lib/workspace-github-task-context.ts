import type { GitHubTask } from "./github-tasks";
import type { SessionRow } from "./types";

function taskCanAnnotateSession(task: GitHubTask): boolean {
  return Boolean(task.sessionId && (task.prNumber != null || task.prUrl));
}

/** Merge low-churn GitHub task context without replacing session-owned PR state. */
export function attachGitHubTaskContext(sessions: SessionRow[], tasks: readonly GitHubTask[]): SessionRow[] {
  const taskBySessionId = new Map<string, GitHubTask>();
  for (const task of tasks) {
    if (taskCanAnnotateSession(task) && task.sessionId && !taskBySessionId.has(task.sessionId)) {
      taskBySessionId.set(task.sessionId, task);
    }
  }
  if (taskBySessionId.size === 0) return sessions;
  return sessions.map((session) => {
    const task = taskBySessionId.get(session.id);
    if (!task) return session;
    return {
      ...session,
      git: task.branch ? { ...(session.git ?? {}), branch: task.branch } : session.git,
      pullRequest: session.pullRequest ?? {
        repo: task.repo,
        number: task.prNumber,
        url: task.prUrl,
        state: task.status,
        branch: task.branch,
      },
    };
  });
}
