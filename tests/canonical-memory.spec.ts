import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type Route,
} from "@playwright/test";

const MEMORY_IDS = {
  alpha: "11111111-1111-5111-8111-111111111111",
  beta: "22222222-2222-5222-8222-222222222222",
} as const;

const FAMILIAR = {
  id: "fixture-familiar",
  display_name: "Fixture Familiar",
  role: "Synthetic archivist",
  status: "active",
  harness: "codex",
};

const FILE_ENTRY = {
  root: "fixture-workspace",
  rootLabel: "Fixture workspace",
  relPath: "memory/synthetic-file-note.md",
  fullPath: "/tmp/cave-canonical-memory-fixture/memory/synthetic-file-note.md",
  size: 256,
  modified: "2026-07-26T09:50:00.000Z",
  sourceId: "fixture-source",
  sourceKind: "runtime",
  sourceKindLabel: "Runtime memory",
  rootPath: "/tmp/cave-canonical-memory-fixture",
  runtimeId: "fixture-runtime",
  familiarId: FAMILIAR.id,
};

const summaries = [
  {
    id: MEMORY_IDS.alpha,
    familiarId: FAMILIAR.id,
    title: "Synthetic alpha memory",
    updatedAt: "2026-07-26T09:56:00.000Z",
    relativeUpdatedAt: "4m ago",
    excerpt: "Deterministic alpha excerpt.",
    source: { kind: "coven-origin", label: "Coven origin" },
    privacy: { classification: "public", revealRequired: false },
    verification: { state: "verified" },
  },
  {
    id: MEMORY_IDS.beta,
    familiarId: FAMILIAR.id,
    title: "Synthetic beta memory",
    updatedAt: "2026-07-26T09:55:00.000Z",
    relativeUpdatedAt: "5m ago",
    excerpt: "Deterministic beta excerpt.",
    source: { kind: "coven-origin", label: "Coven origin" },
    privacy: { classification: "public", revealRequired: false },
    verification: { state: "needs-review" },
  },
] as const;

const overview = {
  generatedAt: "2026-07-26T10:00:00.000Z",
  totals: {
    entries: 2,
    familiars: 1,
    verified: 1,
    needsReview: 1,
    unknown: 0,
  },
  lastUpdatedAt: "2026-07-26T09:56:00.000Z",
  capabilities: {
    detail: true,
    verification: true,
    attestationMetadata: true,
    supersessionHistory: true,
    mutations: false,
  },
  verification: {
    state: "verified",
    checkedAt: "2026-07-26T10:00:00.000Z",
    manifest: "fixture-manifest",
    index: "fixture-index",
    issues: [],
  },
} as const;

function detail(id: string) {
  const alpha = id === MEMORY_IDS.alpha;
  return {
    id,
    familiarId: FAMILIAR.id,
    title: alpha ? "Synthetic alpha memory" : "Synthetic beta memory",
    updatedAt: alpha
      ? "2026-07-26T09:56:00.000Z"
      : "2026-07-26T09:55:00.000Z",
    source: { kind: "coven-origin", label: "Coven origin" },
    content: alpha
      ? [
          "# Synthetic alpha detail",
          "",
          "ALPHA-PRIVATE-MARKER",
          "",
          "![blocked synthetic image](https://synthetic.invalid/canonical-image.png)",
        ].join("\n")
      : "# Synthetic beta detail\n\nBETA-PRIVATE-MARKER",
    contentFormat: "markdown",
    privacy: {
      classification: "public",
      revealRequired: false,
      reason: "Synthetic public fixture still requires an explicit reveal.",
    },
    verification: {
      state: alpha ? "verified" : "needs-review",
      reason: "Synthetic deterministic verification.",
    },
    attestationMetadata: { fieldCount: 2 },
    supersession: { supersedes: null, supersededBy: null },
  };
}

type CanonicalErrorCode =
  | "local_daemon_required"
  | "daemon_update_required"
  | "canonical_memory_unavailable"
  | "invalid_daemon_payload";

type SyntheticRouteOptions = {
  listError?: { status: number; code: CanonicalErrorCode };
  detailError?: { status: number; code: CanonicalErrorCode };
};

type SyntheticRouteState = {
  canonicalShellSnapshots: boolean[];
  detailRequests: string[];
  imageRequests: string[];
  fileRequests: string[];
};

function defaultApiPayload(pathname: string): unknown {
  if (pathname === "/api/harnesses") return { ok: true, harnesses: [] };
  if (pathname === "/api/openclaw-agents") return { ok: true, agents: [] };
  if (pathname === "/api/projects") return { ok: true, projects: [] };
  if (pathname === "/api/github/tasks") return { ok: true, tasks: [] };
  if (pathname === "/api/inbox/prefs") return { ok: true, prefs: {} };
  if (pathname === "/api/inbox") return { ok: true, items: [] };
  if (pathname === "/api/knowledge") return { ok: true, entries: [] };
  if (pathname === "/api/knowledge/collections") {
    return { ok: true, collections: [] };
  }
  return { ok: true };
}

async function shellIsPainted(page: Page): Promise<boolean> {
  return page
    .evaluate(() => {
      const shell = document.querySelector<HTMLElement>(".shell-frame");
      if (!shell) return false;
      const rect = shell.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    })
    .catch(() => false);
}

async function fulfillSyntheticApi(
  page: Page,
  route: Route,
  state: SyntheticRouteState,
  options: SyntheticRouteOptions,
): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  const { pathname } = url;

  if (url.hostname === "synthetic.invalid") {
    state.imageRequests.push(url.href);
    await route.fulfill({ status: 204, body: "" });
    return;
  }
  if (!pathname.startsWith("/api/")) {
    await route.continue();
    return;
  }

  if (
    pathname === "/api/preferences" ||
    pathname === "/api/theme" ||
    pathname.startsWith("/api/backdrop")
  ) {
    // Playwright's server owns deterministic temporary files for these stores.
    await route.fallback();
    return;
  }

  // `/api/daemon/status` and `/api/daemon/connection` must agree. The daemon
  // connection supervisor (b7ecf460e, "decouple heartbeat from daemon
  // diagnostics") moved local-daemon readiness onto /connection, and this
  // spec only knew about /status — so acceptedLocalDaemonHealthy never went
  // true, localDaemonReady stayed false, and canonical-memory-reader returned
  // before ever requesting a detail. The visible symptom was detailRequests
  // sitting empty, which reads like a selection bug rather than a mock gap.
  if (
    pathname === "/api/daemon/status" ||
    pathname === "/api/daemon/connection"
  ) {
    await route.fulfill({
      json: {
        running: true,
        availability: "online",
        target: { mode: "local" },
        checkedAt: new Date().toISOString(),
      },
    });
    return;
  }
  if (pathname === "/api/onboarding/status") {
    await route.fulfill({
      json: { ok: true, complete: true, steps: {}, tools: [] },
    });
    return;
  }
  if (pathname === "/api/familiars") {
    await route.fulfill({ json: { ok: true, familiars: [FAMILIAR] } });
    return;
  }
  if (pathname === "/api/sessions/list") {
    await route.fulfill({ json: { ok: true, sessions: [] } });
    return;
  }
  if (pathname === "/api/memory") {
    await route.fulfill({ json: { ok: true, entries: [FILE_ENTRY] } });
    return;
  }
  if (pathname === "/api/memory/file") {
    state.fileRequests.push(url.searchParams.get("path") ?? "");
    await route.fulfill({
      json: {
        ok: true,
        path: FILE_ENTRY.fullPath,
        revealed: false,
        text: "# Synthetic file memory\n\nFILE-MEMORY-MARKER",
        redactions: [],
        rawLength: 44,
        mtimeMs: 1_721_987_400_000,
      },
    });
    return;
  }
  if (
    pathname === "/api/coven-memory" ||
    pathname === "/api/coven-memory/overview"
  ) {
    state.canonicalShellSnapshots.push(await shellIsPainted(page));
    if (options.listError) {
      await route.fulfill({
        status: options.listError.status,
        json: { ok: false, code: options.listError.code },
      });
      return;
    }
    await route.fulfill({
      json:
        pathname.endsWith("/overview")
          ? { ok: true, overview }
          : { ok: true, entries: summaries },
    });
    return;
  }
  if (pathname.startsWith("/api/coven-memory/")) {
    state.canonicalShellSnapshots.push(await shellIsPainted(page));
    const requestedId = decodeURIComponent(
      pathname.slice("/api/coven-memory/".length),
    );
    state.detailRequests.push(requestedId);
    if (options.detailError) {
      await route.fulfill({
        status: options.detailError.status,
        json: { ok: false, code: options.detailError.code },
      });
      return;
    }
    await route.fulfill({
      json: { ok: true, entry: detail(requestedId) },
    });
    return;
  }

  await route.fulfill({ json: defaultApiPayload(pathname) });
}

async function installSyntheticRoutes(
  page: Page,
  options: SyntheticRouteOptions = {},
): Promise<SyntheticRouteState> {
  const state: SyntheticRouteState = {
    canonicalShellSnapshots: [],
    detailRequests: [],
    imageRequests: [],
    fileRequests: [],
  };
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/*", (route) =>
    fulfillSyntheticApi(page, route, state, options),
  );
  return state;
}

async function openMemory(page: Page) {
  await page.goto("/?mode=agents", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".shell-frame")).toBeVisible({ timeout: 45_000 });
  await expect(page.locator(".familiars-view")).toBeVisible({
    timeout: 45_000,
  });
  await page
    .getByRole("button", { name: `Open ${FAMILIAR.display_name}` })
    .click();
  await page
    .getByRole("button", { name: "Familiar memory", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: `Memory for ${FAMILIAR.display_name}`,
  });
  await expect(dialog).toBeVisible();
  return dialog;
}

function rowButton(page: Page, title: string) {
  return page
    .getByRole("dialog", { name: `Memory for ${FAMILIAR.display_name}` })
    .getByRole("button")
    .filter({ hasText: title })
    .first();
}

async function setThemeMode(
  request: APIRequestContext,
  mode: "light" | "dark",
) {
  const response = await request.patch("/api/preferences", {
    data: {
      appearance: {
        theme: { modePreference: mode, resolvedMode: mode },
      },
    },
  });
  expect(response.ok(), `failed to set synthetic ${mode} theme`).toBe(true);
}

test.describe.configure({ mode: "serial" });

test("local-ready canonical memory renders after shell paint at 1280x720 without file authority", async ({
  page,
  request,
}) => {
  await setThemeMode(request, "dark");
  await page.setViewportSize({ width: 1280, height: 720 });
  const state = await installSyntheticRoutes(page);
  const dialog = await openMemory(page);

  await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
  await expect(
    dialog.getByLabel("Canonical memory overview"),
  ).toContainText("Canonical overview");
  await expect(rowButton(page, "Synthetic alpha memory")).toBeVisible();
  await expect(
    dialog.getByRole("button", {
      name: "Delete Synthetic alpha memory",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(rowButton(page, "synthetic-file-note.md")).toBeVisible();
  expect(state.canonicalShellSnapshots.length).toBeGreaterThanOrEqual(2);
  expect(
    state.canonicalShellSnapshots.every(Boolean),
    "canonical list and overview must start only after the shell has painted",
  ).toBe(true);
  expect(state.detailRequests, "detail stays lazy until selection").toEqual([]);

  await rowButton(page, "Synthetic alpha memory").click();
  await expect
    .poll(() => [...new Set(state.detailRequests)])
    .toEqual([MEMORY_IDS.alpha]);
  expect(
    state.detailRequests.every((id) => id === MEMORY_IDS.alpha),
    "canonical selection must request only its opaque ID",
  ).toBe(true);
  await expect(dialog.getByRole("button", { name: "Reveal" })).toBeVisible();
  await expect(dialog.getByText("ALPHA-PRIVATE-MARKER")).toHaveCount(0);

  const canonicalReader = dialog.locator("article");
  await expect(canonicalReader).toBeVisible();
  for (const action of [
    "Edit memory file",
    "Delete",
    "Archive",
    "Copy path",
    "Open file",
    "Memories",
    "Grimoire",
  ]) {
    await expect(
      canonicalReader.getByRole("button", {
        name: new RegExp(`^${action}`, "i"),
      }),
      `canonical detail must not expose ${action}`,
    ).toHaveCount(0);
  }

  await dialog.getByRole("button", { name: "Back to list" }).click();
  await expect(rowButton(page, "synthetic-file-note.md")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Delete synthetic-file-note.md" }),
  ).toHaveCount(1);
  await rowButton(page, "synthetic-file-note.md").click();
  await expect(dialog).toContainText("FILE-MEMORY-MARKER");
  expect(state.fileRequests).toEqual([FILE_ENTRY.fullPath]);
  await expect(
    dialog.getByRole("button", { name: "Edit memory file" }),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Copy path" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Open file" })).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Memories" }),
  ).toBeVisible();
});

test("narrow master-detail stays keyboard-operable and resets privacy on selection", async ({
  page,
  request,
}) => {
  await setThemeMode(request, "light");
  try {
    await page.setViewportSize({ width: 760, height: 720 });
    const state = await installSyntheticRoutes(page);
    const dialog = await openMemory(page);

    await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
    const refresh = dialog.getByRole("button", { name: "Refresh memory" });
    await refresh.focus();
    await expect(refresh).toBeFocused();
    await page.keyboard.press("Enter");

    const alpha = rowButton(page, "Synthetic alpha memory");
    await alpha.focus();
    await expect(alpha).toBeFocused();
    await page.keyboard.press("Enter");
    await expect
      .poll(() => [...new Set(state.detailRequests)])
      .toContain(MEMORY_IDS.alpha);

    const back = dialog.getByRole("button", { name: "Back to list" });
    await back.focus();
    await expect(back).toBeFocused();
    await page.keyboard.press("Tab");
    const reveal = dialog.getByRole("button", { name: "Reveal" });
    await expect(reveal).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog.getByText("ALPHA-PRIVATE-MARKER")).toBeVisible();
    await expect(
      dialog.getByText("[Image: blocked synthetic image]"),
    ).toBeVisible();
    expect(
      state.imageRequests,
      "canonical Markdown image syntax must never issue a request",
    ).toEqual([]);

    await back.focus();
    await page.keyboard.press("Tab");
    const rendered = dialog.getByRole("button", { name: "Rendered" });
    const raw = dialog.getByRole("button", { name: "Raw" });
    await expect(rendered).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(raw).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(raw).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByText("![blocked synthetic image]")).toBeVisible();

    await back.focus();
    await page.keyboard.press("Enter");
    await expect(rowButton(page, "Synthetic beta memory")).toBeVisible();
    const beta = rowButton(page, "Synthetic beta memory");
    await beta.focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(() => [...new Set(state.detailRequests)])
      .toContain(MEMORY_IDS.beta);
    await expect(dialog.getByRole("button", { name: "Reveal" })).toBeVisible();
    await expect(dialog.getByText("BETA-PRIVATE-MARKER")).toHaveCount(0);
    await expect(dialog.getByText("ALPHA-PRIVATE-MARKER")).toHaveCount(0);
  } finally {
    await setThemeMode(request, "dark");
  }
});

const approvedErrors = [
  {
    status: 409,
    code: "local_daemon_required",
    headline: "Local daemon required",
    subtitle: "Switch Cave to Local daemon to read canonical memory.",
  },
  {
    status: 426,
    code: "daemon_update_required",
    headline: "Daemon update required",
    subtitle: "Update Coven, restart the daemon, then retry.",
  },
  {
    status: 503,
    code: "canonical_memory_unavailable",
    headline: "Canonical memory unavailable",
    subtitle: "Start the local daemon with coven daemon start, then retry.",
  },
  {
    status: 502,
    code: "invalid_daemon_payload",
    headline: "Incompatible daemon response",
    subtitle:
      "The daemon returned an incompatible daemon response. Update Coven, restart the daemon, then retry.",
  },
] as const;

for (const scenario of approvedErrors) {
  test(`canonical detail ${scenario.status} uses approved safe copy`, async ({
    page,
  }) => {
    const state = await installSyntheticRoutes(page, {
      detailError: { status: scenario.status, code: scenario.code },
    });
    const dialog = await openMemory(page);
    await rowButton(page, "Synthetic alpha memory").click();
    await expect
      .poll(() => [...new Set(state.detailRequests)])
      .toEqual([MEMORY_IDS.alpha]);
    await expect(
      dialog.getByText(scenario.headline, { exact: true }),
    ).toBeVisible();
    await expect(dialog).toContainText(scenario.subtitle);
    await expect(
      dialog.getByRole("button", { name: "Back to list" }),
    ).toBeVisible();
  });
}

test("canonical list failure leaves the independently successful file-memory feed usable", async ({
  page,
}) => {
  const state = await installSyntheticRoutes(page, {
    listError: {
      status: 503,
      code: "canonical_memory_unavailable",
    },
  });
  const dialog = await openMemory(page);

  await expect(dialog).toContainText("Couldn't load familiar memories");
  await expect(dialog).toContainText(
    "Start the local daemon with coven daemon start, then retry.",
  );
  await expect(rowButton(page, "synthetic-file-note.md")).toBeVisible();
  await rowButton(page, "synthetic-file-note.md").click();
  await expect(dialog).toContainText("FILE-MEMORY-MARKER");
  expect(state.fileRequests).toEqual([FILE_ENTRY.fullPath]);
  await expect(
    dialog.getByRole("button", { name: "Edit memory file" }),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Copy path" })).toBeVisible();
});
