import { expect, test, type Page, type Route } from "@playwright/test";

const FAMILIAR = {
  id: "fixture-mobile-familiar",
  display_name: "Mobile Fixture Familiar",
  role: "Synthetic mobile archivist",
  status: "active",
  harness: "codex",
};

const FILE_ENTRY = {
  root: "fixture-mobile-workspace",
  rootLabel: "Fixture mobile workspace",
  relPath: "memory/mobile-synthetic-note.md",
  fullPath:
    "/tmp/cave-canonical-memory-mobile-fixture/memory/mobile-synthetic-note.md",
  size: 192,
  modified: "2026-07-26T09:45:00.000Z",
  sourceId: "fixture-mobile-source",
  sourceKind: "runtime",
  sourceKindLabel: "Runtime memory",
  rootPath: "/tmp/cave-canonical-memory-mobile-fixture",
  runtimeId: "fixture-mobile-runtime",
  familiarId: FAMILIAR.id,
};

type BoundaryState = {
  outboundCanonicalMarkers: Array<string | undefined>;
  canonicalStatuses: number[];
  canonicalCodes: string[];
  fileReads: string[];
};

function syntheticDefault(pathname: string): unknown {
  if (pathname === "/api/harnesses") return { ok: true, harnesses: [] };
  if (pathname === "/api/openclaw-agents") return { ok: true, agents: [] };
  if (pathname === "/api/projects") return { ok: true, projects: [] };
  if (pathname === "/api/github/tasks") return { ok: true, tasks: [] };
  if (pathname === "/api/inbox/prefs") return { ok: true, prefs: {} };
  if (pathname === "/api/inbox") return { ok: true, items: [] };
  return { ok: true };
}

function isRouteFamily(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

async function routeSyntheticMobile(
  route: Route,
  state: BoundaryState,
): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  const { pathname } = url;
  if (!pathname.startsWith("/api/")) {
    await route.continue();
    return;
  }
  if (
    pathname === "/api/preferences" ||
    pathname === "/api/theme" ||
    pathname.startsWith("/api/backdrop")
  ) {
    await route.fallback();
    return;
  }
  if (
    isRouteFamily(pathname, "/api/coven-memory") ||
    isRouteFamily(pathname, "/api/mobile/coven-memory")
  ) {
    state.outboundCanonicalMarkers.push(
      request.headers()["x-coven-cave-mobile-access"],
    );
    // Exercise proxy.ts plus the real route. The browser is not allowed to
    // self-assert the marker; proxy.ts strips it and stamps a trusted marker
    // only after authenticating the synthetic paired-mobile credential.
    await route.fallback();
    return;
  }
  if (pathname === "/api/daemon/status") {
    await route.fulfill({
      json: {
        running: true,
        availability: "online",
        target: { mode: "local" },
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
    state.fileReads.push(url.searchParams.get("path") ?? "");
    await route.fulfill({
      json: {
        ok: true,
        path: FILE_ENTRY.fullPath,
        revealed: false,
        text: "# Synthetic mobile file\n\nMOBILE-FILE-MEMORY-MARKER",
        redactions: [],
        rawLength: 50,
        mtimeMs: 1_721_987_100_000,
      },
    });
    return;
  }
  await route.fulfill({ json: syntheticDefault(pathname) });
}

async function openMobileMemory(page: Page, state: BoundaryState) {
  await page.setExtraHTTPHeaders({
    "x-coven-cave-local-peer": "mobile-untrusted",
    authorization: "Bearer test-fixture",
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  page.on("response", async (response) => {
    if (
      isRouteFamily(
        new URL(response.url()).pathname,
        "/api/coven-memory",
      )
    ) {
      state.canonicalStatuses.push(response.status());
      const body = await response.json().catch(() => null);
      if (
        body &&
        typeof body === "object" &&
        typeof (body as { code?: unknown }).code === "string"
      ) {
        state.canonicalCodes.push((body as { code: string }).code);
      }
    }
  });
  await page.route("**/*", (route) => routeSyntheticMobile(route, state));

  await page.goto("/?mode=agents", { waitUntil: "domcontentloaded" });
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

test("paired mobile is denied canonical reads while synthetic file memory remains usable", async ({
  page,
}) => {
  const state: BoundaryState = {
    outboundCanonicalMarkers: [],
    canonicalStatuses: [],
    canonicalCodes: [],
    fileReads: [],
  };
  const dialog = await openMobileMemory(page, state);

  await expect(dialog).toContainText("Couldn't load familiar memories");
  await expect(dialog).toContainText(
    "Canonical memory is available only from Cave on this host.",
  );
  await expect
    .poll(() => state.outboundCanonicalMarkers.length)
    .toBeGreaterThanOrEqual(2);
  expect(
    state.outboundCanonicalMarkers.every((marker) => marker === undefined),
    "the browser must not be able to self-assert the paired-mobile marker",
  ).toBe(true);
  await expect
    .poll(() => state.canonicalStatuses)
    .toEqual(expect.arrayContaining([403]));
  expect(
    state.canonicalStatuses.every((status) => status === 403),
    "the real canonical route denies every marked mobile read",
  ).toBe(true);
  await expect
    .poll(() => state.canonicalCodes)
    .toEqual(
      expect.arrayContaining([
        "local_access_required",
        "local_access_required",
      ]),
    );

  const fileRow = dialog
    .getByRole("button")
    .filter({ hasText: "mobile-synthetic-note.md" })
    .first();
  await expect(fileRow).toBeVisible();
  await fileRow.click();
  await expect(dialog).toContainText("MOBILE-FILE-MEMORY-MARKER");
  expect(state.fileReads).toEqual([FILE_ENTRY.fullPath]);
  await expect(
    dialog.getByRole("button", { name: "Edit memory file" }),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Copy path" })).toBeVisible();
});

test("mobile canonical route trusts only the proxy-authenticated marker", async ({
  request,
}) => {
  const untrustedLocalPeer = {
    "x-coven-cave-local-peer": "mobile-untrusted",
  };
  const spoofed = await request.get("/api/mobile/coven-memory/overview", {
    headers: {
      "x-coven-cave-mobile-access": "1",
    },
  });
  expect(spoofed.status()).toBe(401);
  expect(await spoofed.json()).toEqual({
    ok: false,
    code: "mobile_access_required",
  });

  const authenticated = await request.get(
    "/api/mobile/coven-memory/overview",
    {
      headers: {
        ...untrustedLocalPeer,
        authorization: "Bearer test-fixture",
        "x-coven-cave-mobile-access": "forged",
      },
    },
  );
  expect(authenticated.status()).toBe(503);
  expect(await authenticated.json()).toEqual({
    ok: false,
    code: "canonical_memory_unavailable",
  });
});
