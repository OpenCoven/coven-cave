import { expect, test, type Page } from "@playwright/test";

const ISO = "2026-08-14T10:00:00.000Z";
const LANDSCAPE = "https://images.example/landscape.png";
const PORTRAIT = "https://images.example/portrait.png";
const SESSION = {
  id: "s-image-carousel",
  title: "Image carousel",
  status: "idle",
  project_root: "/tmp/coven-cave",
  harness: "claude",
  familiarId: "nova",
  exit_code: null,
  archived_at: null,
  created_at: ISO,
  updated_at: ISO,
};

function svg(width: number, height: number, label: string, color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" fill="${color}" />
    <circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 4}" fill="#ffffff" />
    <text x="50%" y="52%" text-anchor="middle" font-family="sans-serif" font-size="${Math.min(width, height) / 12}" fill="#1f1729">${label}</text>
  </svg>`;
}

async function setup(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("cave:active-familiar", "nova");
    localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem("cave:shell:min-applied:cave.shell.widths.v3", "1");
    localStorage.setItem("cave:shell:min-applied:cave.shell.widths.v3.two-pane", "1");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        familiars: [
          {
            id: "nova",
            display_name: "Nova",
            role: "Orchestrator",
            status: "active",
            icon: "ph:sparkle-fill",
          },
        ],
      },
    }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions: [SESSION] } }),
  );
  await page.route("**/api/chat/conversation/**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        conversation: {
          activeLeafId: "a1",
          turns: [
            { id: "u1", role: "user", text: "Show the images", createdAt: ISO },
            {
              id: "a1",
              parentId: "u1",
              role: "assistant",
              text: `<coven:image src="${LANDSCAPE}" alt="Landscape sample" caption="Landscape" />
<coven:image src="${PORTRAIT}" alt="Portrait sample" caption="Portrait" />`,
              createdAt: ISO,
            },
          ],
        },
      },
    }),
  );
  await page.route(LANDSCAPE, (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: svg(1200, 600, "LANDSCAPE", "#8f80c9") }),
  );
  await page.route(PORTRAIT, (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: svg(600, 1200, "PORTRAIT", "#6fa9a0") }),
  );
}

test("carousel images fill the frame while the lightbox stays uncropped", async ({ page }) => {
  await setup(page);
  await page.goto("/?mode=chat#chat-s-image-carousel", { waitUntil: "domcontentloaded" });

  const carousel = page.getByRole("group", { name: "Image carousel, 2 images" });
  await expect(carousel).toBeVisible({ timeout: 30_000 });
  const slide = carousel.locator('button[title^="View"]').first();
  const image = slide.locator("img");
  await expect(image).toBeVisible();

  const frame = await slide.boundingBox();
  const pixels = await image.boundingBox();
  expect(frame).not.toBeNull();
  expect(pixels).not.toBeNull();
  expect(frame!.width / frame!.height).toBeCloseTo(16 / 9, 1);
  expect(pixels!.width).toBeCloseTo(frame!.width, 0);
  expect(pixels!.height).toBeCloseTo(frame!.height, 0);
  await expect(image).toHaveCSS("object-fit", "cover");

  await carousel.getByRole("button", { name: "Next image" }).click();
  await expect(carousel.getByText("Portrait", { exact: true })).toBeVisible();
  await carousel.locator('button[title^="View"][tabindex="0"]').click();

  const lightbox = page.getByRole("dialog", { name: /Portrait sample/ });
  await expect(lightbox).toBeVisible();
  await expect(lightbox.locator("img")).toHaveCSS("object-fit", "contain");
});
