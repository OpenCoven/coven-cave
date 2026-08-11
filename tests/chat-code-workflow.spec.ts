import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { buildChatUsagePlanSnapshot } from "../src/lib/chat-usage-plan";
import { createDefaultPreferences } from "../src/lib/preferences-schema";
import { catalogForRuntime, runtimeModelInventoryScope } from "../src/lib/runtime-models";

const ISO = "2026-08-11T05:00:00.000Z";
const PROJECT_ROOT = "/repo/alpha";
const WORKTREE_ROOT = "/repo/alpha/.worktrees/feat-auth";
const SESSION_ID = "chat-code-baseline";
const SESSION_TITLE = "Harden the auth boundary";
const OTHER_SESSION_ID = "chat-code-wrong-default";
const OTHER_SESSION_TITLE = "Unrelated release planning";
const OTHER_TRANSCRIPT = "The release checklist is ready for a separate review.";
const DRAFT = "Keep the compatibility note in the final summary.";
const PREFERENCES = createDefaultPreferences(true);
const CLAUDE_CATALOG = catalogForRuntime("claude")!;

test.use({ timezoneId: "UTC" });

const SESSION = {
  id: SESSION_ID,
  title: SESSION_TITLE,
  status: "running",
  origin: "chat",
  harness: "claude",
  familiarId: "nova",
  model: "openclaw-local",
  runtime: `local:${WORKTREE_ROOT}`,
  project_root: PROJECT_ROOT,
  workBranch: "feat/auth-boundary",
  git: {
    branch: "feat/auth-boundary",
    worktreeRoot: WORKTREE_ROOT,
    isWorktree: true,
  },
  diff: { additions: 7, deletions: 2 },
  exit_code: null,
  archived_at: null,
  created_at: ISO,
  updated_at: ISO,
};

const OTHER_SESSION = {
  ...SESSION,
  id: OTHER_SESSION_ID,
  title: OTHER_SESSION_TITLE,
  status: "idle",
  project_root: "/repo/other",
  runtime: "local:/repo/other",
  git: {
    branch: "main",
    worktreeRoot: "/repo/other",
    isWorktree: false,
  },
  workBranch: "main",
  updated_at: "2026-08-11T05:01:00.000Z",
};

const FAMILIAR = {
  id: "nova",
  display_name: "Nova",
  role: "Software Engineer",
  familiarType: "coding",
  harness: "claude",
  model: "anthropic/claude-sonnet-5",
  status: "active",
  icon: "ph:sparkle-fill",
};

type FixtureState = {
  changeCount: number;
  requestedConversationIds: string[];
  requestedDiffTargets: Array<[string, string]>;
  requestedPaths: string[];
  requestedRoots: string[];
};

async function installDaemonlessFixture(page: Page): Promise<FixtureState> {
  const state: FixtureState = {
    changeCount: 0,
    requestedConversationIds: [],
    requestedDiffTargets: [],
    requestedPaths: [],
    requestedRoots: [],
  };

  await page.clock.setFixedTime(new Date(ISO));
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:active-familiar", "nova");
    window.localStorage.setItem("cave:familiar-scope", JSON.stringify(["nova"]));
    window.localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
    window.localStorage.setItem("cave:code-rail:pinned:v1", "false");
    window.localStorage.setItem("cave:shell:min-applied:cave.shell.widths.v3", "1");
    window.localStorage.setItem("cave:shell:min-applied:cave.shell.widths.v3.two-pane", "1");
  });

  await page.route("**/api/**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    throw new Error(`Unexpected API request: ${request.method()} ${url.pathname}${url.search}`);
  });
  await page.route(/\/api\/familiars(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: { ok: true, familiars: [FAMILIAR] } });
  });
  await page.route(/\/api\/familiars\/nova\/backdrop(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ status: 204, body: "" });
  });
  await page.route(/\/api\/sessions\/list(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: { ok: true, sessions: [OTHER_SESSION, SESSION] } });
  });
  await page.route(/\/api\/projects(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({
      json: {
        ok: true,
        projects: [{
          id: "alpha",
          name: "alpha",
          root: PROJECT_ROOT,
          access: "write",
          createdAt: ISO,
          updatedAt: ISO,
        }],
      },
    });
  });
  await page.route(/\/api\/profile(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: { ok: true, profile: null } });
  });
  await page.route(/\/api\/preferences(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: { ok: true, preferences: PREFERENCES } });
  });
  await page.route(/\/api\/preferences\/backdrop(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ status: 204, body: "" });
  });
  await page.route(/\/api\/theme(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    const theme = PREFERENCES.appearance.theme;
    return route.fulfill({
      json: {
        ok: true,
        theme: {
          themeId: theme.id,
          mode: theme.resolvedMode,
          tokens: theme.tokens,
          updatedAt: theme.updatedAt,
          revision: PREFERENCES.revision,
          selectionRevision: theme.selectionRevision,
          modePreference: theme.modePreference,
          custom: theme.custom,
        },
      },
    });
  });
  await page.route(/\/api\/runtime-models\/claude(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    const familiarId = new URL(route.request().url()).searchParams.get("familiarId");
    return route.fulfill({
      json: {
        ok: true,
        runtime: "claude",
        models: CLAUDE_CATALOG.models,
        provenance: "fallback",
        freshness: "seed",
        refreshState: "degraded",
        availability: "degraded",
        defaultOwner: CLAUDE_CATALOG.defaultOwner,
        allowCustom: CLAUDE_CATALOG.allowCustom,
        scope: runtimeModelInventoryScope("claude", familiarId),
      },
    });
  });
  await page.route(/\/api\/skills\/local(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: { ok: true, skills: [] } });
  });
  await page.route(/\/api\/prompts(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: { ok: true, prompts: [] } });
  });
  await page.route(/\/api\/mobile-handoff(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("POST");
    const body = route.request().postDataJSON() as { action?: string };
    if (body.action === "status") {
      return route.fulfill({ json: { ok: true, lastSeenAt: null } });
    }
    if (body.action === "install-info") {
      return route.fulfill({ json: { ok: true, configured: false } });
    }
    if (body.action === "app-start") {
      return route.fulfill({
        json: {
          ok: false,
          unavailable: true,
          error: "Phone pairing is unavailable in the deterministic fixture.",
          steps: [],
        },
      });
    }
    throw new Error(`Unexpected mobile handoff action: ${String(body.action)}`);
  });
  await page.route(/\/api\/github\/tasks(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: { ok: true, tasks: [] } });
  });
  await page.route(/\/api\/github\/assigned(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: { ok: true, items: [], configured: false } });
  });
  await page.route(/\/api\/escalations(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: { ok: true, items: [] } });
  });
  await page.route(/\/api\/board(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: { ok: true, cards: [] } });
  });
  await page.route(/\/api\/coven-memory(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: { ok: true, entries: [] } });
  });
  await page.route(/\/api\/coven-memory\/overview(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({
      json: {
        ok: true,
        overview: {
          generatedAt: ISO,
          totals: { entries: 0, familiars: 0, verified: 0, needsReview: 0, unknown: 0 },
          lastUpdatedAt: null,
          capabilities: {
            detail: false,
            verification: false,
            attestationMetadata: false,
            supersessionHistory: false,
            mutations: false,
          },
          verification: {
            state: "unknown",
            checkedAt: ISO,
            manifest: null,
            index: null,
            issues: [],
          },
        },
      },
    });
  });
  await page.route(/\/api\/queue\/readiness(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({
      json: {
        ok: true,
        readiness: {
          ok: true,
          message: "Fixture project is ready.",
          canGenerate: false,
          project: { id: "alpha", name: "alpha", root: PROJECT_ROOT },
        },
      },
    });
  });
  await page.route(/\/api\/beads(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    const url = new URL(route.request().url());
    expect(url.searchParams.get("mode")).toBe("ready");
    expect(url.searchParams.get("projectRoot")).toBe(PROJECT_ROOT);
    return route.fulfill({ json: { ok: true, data: [] } });
  });
  await page.route(/\/api\/project\/files(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    const url = new URL(route.request().url());
    expect(url.searchParams.get("root")).toBe(PROJECT_ROOT);
    expect(url.searchParams.get("familiarId")).toBe("nova");
    return route.fulfill({
      json: {
        ok: true,
        repo: true,
        root: PROJECT_ROOT,
        files: ["src/auth.ts", "src/auth.test.ts"],
        truncated: false,
      },
    });
  });
  await page.route(/\/api\/codex-automations(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: { ok: true, automations: [] } });
  });
  await page.route(/\/api\/marketplace(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: { ok: true, plugins: [] } });
  });
  await page.route(/\/api\/skills\/directory(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    expect(new URL(route.request().url()).searchParams.get("scope")).toBe("local");
    return route.fulfill({ json: { ok: true, entries: [] } });
  });
  await page.route(/\/api\/knowledge(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: { ok: true, entries: [] } });
  });
  await page.route(/\/api\/knowledge\/collections(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: { ok: true, collections: [] } });
  });
  await page.route(/\/api\/memory(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: { ok: true, entries: [] } });
  });
  await page.route(/\/api\/journal(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    expect(new URL(route.request().url()).search).toBe("");
    return route.fulfill({ json: { ok: true, days: [] } });
  });
  await page.route(/\/api\/chat\/model-state(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    expect(new URL(route.request().url()).searchParams.get("familiarId")).toBe("nova");
    return route.fulfill({
      json: {
        ok: true,
        state: {
          familiarId: "nova",
          runtime: null,
          harness: "claude",
          effectiveModel: "anthropic/claude-sonnet-5",
          source: "familiar-default",
          applicationState: "saved",
          reason: "fixture",
        },
      },
    });
  });
  await page.route(/\/api\/chat\/usage(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    const url = new URL(route.request().url());
    expect(url.searchParams.get("familiarId")).toBe("nova");
    expect([null, "anthropic/claude-sonnet-5"]).toContain(url.searchParams.get("model"));
    return route.fulfill({
      json: {
        ok: true,
        snapshot: buildChatUsagePlanSnapshot({
          model: "anthropic/claude-sonnet-5",
          availability: "unconfigured",
          source: "local-conversations",
          updatedAt: ISO,
          period: {
            id: "monthly",
            label: "Monthly",
            startsAt: "2026-08-01T00:00:00.000Z",
            endsAt: "2026-09-01T00:00:00.000Z",
          },
          totals: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            totalTokens: 0,
            costUsd: 0,
          },
        }),
      },
    });
  });
  await page.route(/\/api\/inbox(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: { ok: true, items: [] } });
  });
  await page.route(/\/api\/inbox\/prefs(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({
      json: {
        ok: true,
        prefs: {
          version: 1,
          mutedFamiliars: [],
          mutedKinds: [],
          sound: { mode: "default" },
        },
      },
    });
  });
  await page.route(/\/api\/inbox\/stream(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: { "cache-control": "no-cache" },
      body: `data: ${JSON.stringify({ type: "snapshot", items: [] })}\n\n`,
    });
  });
  await page.route(/\/api\/inbox\/daily-summary(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("POST");
    return route.fulfill({ json: { ok: true, created: false, updated: false } });
  });
  await page.route(/\/api\/milestones(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: { ok: true, awarded: ["summon:first"] } });
  });
  await page.route(/\/api\/chat\/conversation\/[^/?]+(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1) ?? "");
    state.requestedConversationIds.push(id);
    if (id === OTHER_SESSION_ID) {
      return route.fulfill({
        json: {
          ok: true,
          context: {},
          conversation: {
            turns: [{
              id: "turn-other",
              role: "assistant",
              text: OTHER_TRANSCRIPT,
              createdAt: ISO,
            }],
          },
        },
      });
    }
    if (id !== SESSION_ID) {
      return route.fulfill({ status: 404, json: { ok: false, error: `Unknown fixture session ${id}` } });
    }
    return route.fulfill({
      json: {
        ok: true,
        context: {},
        conversation: {
          turns: [
            {
              id: "turn-user",
              role: "user",
              text: "Harden the auth boundary without changing callers.",
              createdAt: ISO,
            },
            {
              id: "turn-assistant",
              role: "assistant",
              text: "The boundary now keeps the legacy caller contract.",
              createdAt: ISO,
              durationMs: 1_240,
              tools: [{
                id: "tool-edit-auth",
                name: "Edit",
                status: "ok",
                durationMs: 320,
                input: JSON.stringify({
                  file_path: `${PROJECT_ROOT}/src/auth.ts`,
                  old_string: "return false;",
                  new_string: "return true;",
                }),
              }],
            },
          ],
        },
      },
    });
  });
  await page.route(/\/api\/changes(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    const url = new URL(route.request().url());
    const root = url.searchParams.get("projectRoot");
    if (root) state.requestedRoots.push(root);
    if (url.searchParams.has("path")) {
      const path = url.searchParams.get("path") ?? "";
      if (root === null) {
        throw new Error(`Diff request omitted projectRoot: ${url.pathname}${url.search}`);
      }
      state.requestedPaths.push(path);
      state.requestedDiffTargets.push([root, path]);
      return route.fulfill({
        json: {
          ok: true,
          diff: [
            "diff --git a/src/auth.ts b/src/auth.ts",
            "--- a/src/auth.ts",
            "+++ b/src/auth.ts",
            "@@ -1 +1 @@",
            "-return false;",
            "+return true;",
          ].join("\n"),
          truncated: false,
        },
      });
    }
    if (url.searchParams.has("checkpoints")) {
      return route.fulfill({ json: { ok: true, checkpoints: [] } });
    }
    if (url.searchParams.has("branches")) {
      return route.fulfill({
        json: {
          ok: true,
          branches: [{
            name: "feat/auth-boundary",
            current: true,
            worktree: "feat-auth",
            worktreePath: WORKTREE_ROOT,
          }],
        },
      });
    }
    const files = Array.from({ length: state.changeCount }, (_, index) => ({
      path: index === 0 ? "src/auth.ts" : "src/auth.test.ts",
      status: "modified",
      insertions: index === 0 ? 4 : 3,
      deletions: 1,
    }));
    return route.fulfill({
      json: { ok: true, repo: true, repoRoot: root ?? PROJECT_ROOT, files },
    });
  });
  await page.route(/\/api\/project-tree(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({
      json: {
        ok: true,
        entries: [{
          name: "src",
          path: `${WORKTREE_ROOT}/src`,
          isDir: true,
        }],
      },
    });
  });
  await page.route(/\/api\/project-file(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({
      json: {
        ok: true,
        kind: "text",
        content: "export function allow() {\n  return true;\n}\n",
        size: 44,
      },
    });
  });
  await page.route(/\/api\/daemon\/status(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({
      json: { running: true, availability: "online", target: { mode: "local" } },
    });
  });
  await page.route(/\/api\/daemon\/connection(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({
      json: {
        running: true,
        availability: "online",
        checkedAt: ISO,
        target: { mode: "local", label: "Local daemon", socket: "fixture.sock" },
      },
    });
  });
  await page.route(/\/api\/cave-home-migration(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({
      json: {
        ok: true,
        status: {
          pending: [],
          conflicts: [],
          migrated: true,
          details: [],
          backupRoot: "",
          journalPath: "",
        },
      },
    });
  });
  await page.route(/\/api\/onboarding\/status(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: { ok: true, complete: true, steps: {}, tools: [] } });
  });
  await page.route(/\/api\/onboarding\/bootstrap(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({
      json: {
        ok: true,
        version: 1,
        updatedAt: ISO,
        boundaries: {
          credentials: "Provider sign-in is deferred until first use.",
          elevation: "Setup uses only the current user account.",
          git: "Git is optional.",
        },
        confirmed: true,
        complete: true,
        needsSetup: false,
        status: "complete",
        activeStage: null,
        stages: [
          { id: "core-tools", label: "Prepare local components", status: "complete", detail: "Ready." },
          { id: "workspace", label: "Create Cave defaults", status: "complete", detail: "Ready." },
          { id: "daemon", label: "Start local services", status: "complete", detail: "Ready." },
        ],
        failure: null,
      },
    });
  });
  await page.route(/\/api\/onboarding\/update(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: { ok: true, tools: [], checkedAt: ISO, stale: false } });
  });
  await page.route(/\/api\/onboarding\/install(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: { npmBusy: false } });
  });
  await page.route(/\/api\/roles(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: { ok: true, roles: [] } });
  });
  return state;
}

async function openRepoConversation(page: Page) {
  await page.goto("/?mode=chat", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => {
      window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "chat" } }));
      return document.querySelector(".chat-surface") !== null;
    },
    undefined,
    { timeout: 30_000 },
  );
  await page.locator(".chat-sidebar").getByRole("button", { name: new RegExp(SESSION_TITLE) }).first().click();
  await expect(page.getByText("The boundary now keeps the legacy caller contract.")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page).toHaveURL(new RegExp(`#chat-${SESSION_ID}$`));
  await expect(page.getByText(OTHER_TRANSCRIPT)).toBeHidden();
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

async function setTheme(page: Page, theme: string, mode: "dark" | "light") {
  await page.evaluate(
    ({ theme, mode }) => {
      document.documentElement.setAttribute("data-theme", theme);
      document.documentElement.setAttribute("data-mode", mode);
      window.dispatchEvent(new CustomEvent("cave:theme-changed", { detail: { themeId: theme, mode } }));
    },
    { theme, mode },
  );
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator("html")).toHaveAttribute("data-mode", mode);
}

type Bounds = { x: number; y: number; width: number; height: number };

async function requiredBounds(page: Page, selector: string): Promise<Bounds> {
  const locator = page.locator(selector).first();
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${selector} must have measurable geometry`).not.toBeNull();
  return {
    x: Math.round(box!.x),
    y: Math.round(box!.y),
    width: Math.round(box!.width),
    height: Math.round(box!.height),
  };
}

function expectBoundsNear(actual: Bounds, expected: Bounds, tolerance = 1) {
  for (const key of ["x", "y", "width", "height"] as const) {
    expect(actual[key], `${key} geometry`).toBeGreaterThanOrEqual(expected[key] - tolerance);
    expect(actual[key], `${key} geometry`).toBeLessThanOrEqual(expected[key] + tolerance);
  }
}

function waitForChangesListResponse(page: Page, projectRoot: string) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/changes" &&
      url.searchParams.get("projectRoot") === projectRoot &&
      !url.searchParams.has("path") &&
      !url.searchParams.has("checkpoints") &&
      !url.searchParams.has("branches");
  });
}

async function finishAnimations(page: Page, selector: string) {
  await page.locator(selector).first().evaluate(async (element) => {
    await Promise.all(
      element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)),
    );
  });
}

test.describe.configure({ mode: "serial" });

test("repo chat hands an exact changed file to the same Coding Desk session and returns intact", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop journey; responsive baselines run separately");
  const fixture = await installDaemonlessFixture(page);
  const initialChangesResponse = waitForChangesListResponse(page, PROJECT_ROOT);
  await openRepoConversation(page);
  expect(fixture.requestedConversationIds).toContain(SESSION_ID);
  expect(await initialChangesResponse.then((response) => response.json())).toMatchObject({
    ok: true,
    files: [],
  });

  await expect(page.getByRole("button", { name: "Show code rail" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Code rail" })).toHaveCount(0);

  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill(DRAFT);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("cave:chat-composer-draft:v1")))
    .toBe(DRAFT);

  fixture.changeCount = 2;
  const populatedChangesResponse = waitForChangesListResponse(page, PROJECT_ROOT);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("cave:changes-refresh")));
  expect(await populatedChangesResponse.then((response) => response.json())).toMatchObject({
    ok: true,
    files: [{ path: "src/auth.ts" }, { path: "src/auth.test.ts" }],
  });

  const chatRail = page.getByRole("region", { name: "Code rail" });
  await expect(chatRail).toBeVisible({ timeout: 15_000 });
  const changesTab = chatRail.getByRole("button", { name: "Changes", exact: true });
  await expect(changesTab).toHaveAttribute("aria-pressed", "true");
  await expect(changesTab).toContainText("2");
  await expect(chatRail.locator(".session-changes-table-row")).toHaveCount(2);
  await expect(chatRail.getByTitle("src/auth.ts", { exact: true })).toBeVisible();
  await expect(chatRail.getByTitle("src/auth.test.ts", { exact: true })).toBeVisible();
  await expect(page.getByText("The boundary now keeps the legacy caller contract.")).toBeVisible();

  await page.locator(".cave-edit-card").getByRole("button", { name: "Review", exact: true }).click();

  const header = page.getByTestId("code-workbench-header");
  await expect(header.getByRole("button", { name: new RegExp(SESSION_TITLE) })).toBeVisible({
    timeout: 30_000,
  });
  await expect(header).toContainText("feat/auth-boundary");
  await expect(header).toContainText("worktree");

  const reviewRail = page.getByTestId("code-review-rail");
  await expect(reviewRail).toBeVisible();
  const authFile = reviewRail.getByRole("button").filter({ hasText: "auth.ts" }).first();
  await expect(authFile).toHaveAttribute("aria-expanded", "true", { timeout: 15_000 });
  await expect(reviewRail).toContainText("return true;");

  const terminal = page.getByRole("button", { name: "Open the terminal drawer" });
  await terminal.click();
  await expect(page.getByRole("button", { name: "Close the terminal drawer" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(page.getByText("Terminal · this worktree")).toBeVisible();

  expect(fixture.requestedRoots).toContain(PROJECT_ROOT);
  expect(fixture.requestedRoots).toContain(WORKTREE_ROOT);
  expect(fixture.requestedPaths).toContain("src/auth.ts");
  expect(fixture.requestedDiffTargets).toContainEqual([WORKTREE_ROOT, "src/auth.ts"]);

  await page.getByRole("button", { name: "Open in Chat" }).click();
  await expect(page).toHaveURL(new RegExp(`#chat-${SESSION_ID}$`));
  await expect(page.getByText("The boundary now keeps the legacy caller contract.")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(OTHER_TRANSCRIPT)).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue(DRAFT);

  await capture(page, testInfo, "chat-code-workflow-returned-chat");
});

test("resized desktop Chromium pins theme, constrained-pane, responsive-sheet, and reduced-motion contracts", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "resized desktop Chromium intentionally pins responsive CSS behavior");
  const fixture = await installDaemonlessFixture(page);
  const measurements: Record<string, unknown> = {};

  await page.setViewportSize({ width: 1440, height: 900 });
  const initialChangesResponse = waitForChangesListResponse(page, PROJECT_ROOT);
  await openRepoConversation(page);
  expect(await initialChangesResponse.then((response) => response.json())).toMatchObject({
    ok: true,
    files: [],
  });
  await setTheme(page, "coven", "dark");
  await capture(page, testInfo, "01-wide-dark-chat");

  await setTheme(page, "coven", "light");
  await capture(page, testInfo, "02-wide-light-chat");

  await setTheme(page, "tide", "dark");
  await capture(page, testInfo, "03-wide-tide-chat");

  await setTheme(page, "coven", "dark");
  await page.setViewportSize({ width: 1120, height: 760 });
  fixture.changeCount = 2;
  const populatedChangesResponse = waitForChangesListResponse(page, PROJECT_ROOT);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("cave:changes-refresh")));
  await populatedChangesResponse;
  await expect(page.getByRole("region", { name: "Code rail" })).toBeVisible({ timeout: 15_000 });
  await finishAnimations(page, ".workspace-rail");
  const constrainedChat = await requiredBounds(page, ".chat-surface");
  const constrainedRail = await requiredBounds(page, ".workspace-rail");
  const shellDetail = await requiredBounds(page, ".shell-detail");
  expectBoundsNear(constrainedChat, { x: 65, y: 47, width: 1046, height: 676 });
  expectBoundsNear(constrainedRail, { x: 791, y: 81, width: 320, height: 642 });
  const shellContract = await page.locator(".shell-detail").evaluate((element) => {
    const style = getComputedStyle(element);
    const rootStyle = getComputedStyle(document.documentElement);
    return {
      borderTopRightRadius: style.borderTopRightRadius,
      radiusToken: rootStyle.getPropertyValue("--radius-panel").trim(),
      borderRightWidth: Number.parseFloat(style.borderRightWidth),
    };
  });
  expect(shellContract.borderTopRightRadius).toBe(shellContract.radiusToken);
  expect(Number.parseFloat(shellContract.borderTopRightRadius)).toBeGreaterThan(0);
  expect(Math.abs(constrainedRail.x + constrainedRail.width - (shellDetail.x + shellDetail.width - shellContract.borderRightWidth))).toBeLessThanOrEqual(1);
  measurements.constrained = {
    viewport: page.viewportSize(),
    chatSurface: constrainedChat,
    codeRail: constrainedRail,
    shellDetail,
    shellContract,
  };
  await capture(page, testInfo, "04-constrained-chat-code-split");

  await page.setViewportSize({ width: 820, height: 900 });
  const mobileToggle = page.getByRole("button", { name: /^(Show|Hide) code rail$/ });
  await expect(mobileToggle).toBeVisible({ timeout: 15_000 });
  if ((await mobileToggle.getAttribute("aria-expanded")) !== "true") await mobileToggle.click();
  const sheet = page.getByRole("dialog", { name: "Code rail" });
  await expect(sheet).toBeVisible();
  await finishAnimations(page, '[role="dialog"][aria-label="Code rail"]');
  const tabletChat = await requiredBounds(page, ".chat-surface");
  const tabletSheet = await requiredBounds(page, '[role="dialog"][aria-label="Code rail"]');
  expectBoundsNear(tabletChat, { x: 0, y: 52, width: 820, height: 787 });
  expectBoundsNear(tabletSheet, { x: 400, y: 0, width: 420, height: 900 });
  measurements.tablet = {
    viewport: page.viewportSize(),
    chatSurface: tabletChat,
    sheet: tabletSheet,
  };
  await capture(page, testInfo, "05-tablet-code-rail-sheet");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(sheet).toBeVisible();
  const narrowChat = await requiredBounds(page, ".chat-surface");
  const narrowSheet = await requiredBounds(page, '[role="dialog"][aria-label="Code rail"]');
  expectBoundsNear(narrowChat, { x: 0, y: 52, width: 390, height: 731 });
  expectBoundsNear(narrowSheet, { x: 31, y: 0, width: 359, height: 844 });
  measurements.narrow = {
    viewport: page.viewportSize(),
    chatSurface: narrowChat,
    sheet: narrowSheet,
  };
  await capture(page, testInfo, "06-narrow-code-rail-sheet");

  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setTheme(page, "coven", "dark");
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  const reducedMotionAnimation = await page.locator(".workspace-rail__body").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      animationName: style.animationName,
      animationDuration: style.animationDuration,
      activeAnimationCount: element.getAnimations({ subtree: true }).length,
    };
  });
  expect(reducedMotionAnimation.animationName).toBe("none");
  expect(reducedMotionAnimation.activeAnimationCount).toBe(0);
  measurements.reducedMotion = {
    viewport: page.viewportSize(),
    prefersReducedMotion: true,
    animation: reducedMotionAnimation,
    chatSurface: await requiredBounds(page, ".chat-surface"),
  };
  await capture(page, testInfo, "07-reduced-motion-chat");

  const measurementsPath = testInfo.outputPath("layout-measurements.json");
  await writeFile(measurementsPath, `${JSON.stringify(measurements, null, 2)}\n`, "utf8");
  await testInfo.attach("layout-measurements", {
    path: measurementsPath,
    contentType: "application/json",
  });
});
