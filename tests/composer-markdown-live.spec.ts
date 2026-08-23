import { expect, test, type Page } from "@playwright/test";

// Live markdown rendering in the chat composer (cave-7ncq).
//
// The composer stays a real <textarea>; a decoration layer paints the same
// characters behind it with syntax roles applied, and the textarea's own glyphs
// are hidden only while the two have been *measured* to line up. These specs
// drive the real surface in a real engine, because the two things that can
// break here — line-box alignment and the draft that the send path reads — are
// both invisible to a unit test:
//
//   1. alignment is a layout fact, so it is asserted as one (measured
//      scrollHeight, on a draft long enough to wrap);
//   2. the draft is still plain markdown text in a still-selectable textarea,
//      which is what keeps the send path byte-identical to before the feature.
//
// The transcript half of the issue is asserted too: a *user* turn renders
// through the same sanitized markdown renderer the assistant's turns use.

const ISO = "2026-08-10T12:00:00.000Z";

const SESSIONS = [
  {
    id: "s-md-composer",
    title: "Markdown composer",
    status: "idle",
    project_root: "/tmp/coven-cave",
    harness: "claude",
    familiarId: "nova",
    model: "test",
    runtime: "local:/tmp/coven-cave",
    exit_code: null,
    archived_at: null,
    created_at: ISO,
    updated_at: ISO,
  },
];

const USER_MARKDOWN = "Ship **bold**, _italics_, `code`, and [the doc](https://example.com/a).";

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
    route.fulfill({ json: { ok: true, sessions: SESSIONS } }),
  );
  await page.route("**/api/board**", (route) => route.fulfill({ json: { ok: true, cards: [] } }));
  await page.route("**/api/chat/conversation/**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        conversation: {
          activeLeafId: "u-md",
          turns: [
            {
              id: "u-md",
              parentId: null,
              role: "user",
              text: USER_MARKDOWN,
              createdAt: ISO,
            },
          ],
        },
      },
    }),
  );
}

// The shell mounts the home dashboard's composer alongside the chat one, so
// every locator here is scoped to the chat surface's composer specifically.
function chatComposerPanel(page: Page) {
  return page.locator(".cave-chat-linear .cave-composer-input-wrap").first();
}

function composer(page: Page) {
  return chatComposerPanel(page).locator(".cave-composer-input");
}

function layer(page: Page) {
  return chatComposerPanel(page).locator(".cave-composer-md-layer");
}

test.describe("composer live markdown", () => {
  test("plain prose is left completely alone", async ({ page }) => {
    await setup(page);
    await page.goto("/?mode=chat#chat-s-md-composer", { waitUntil: "domcontentloaded" });
    const input = composer(page);
    await expect(input).toBeVisible({ timeout: 45_000 });

    await input.fill("just a normal sentence about the deploy, nothing fancy");

    // Nothing to decorate ⇒ the composer must stay an ordinary opaque textarea.
    // This is the case that would regress most invisibly: a layer that always
    // activates would blank plain text for no benefit at all.
    await expect(layer(page)).toHaveAttribute("data-active", "false");
    await expect(input).not.toHaveClass(/cave-composer-input--md/);
  });

  test("markdown is inked live, and the layer lines up with the textarea", async ({ page }) => {
    await setup(page);
    await page.goto("/?mode=chat#chat-s-md-composer", { waitUntil: "domcontentloaded" });
    const input = composer(page);
    await expect(input).toBeVisible({ timeout: 45_000 });

    await input.fill(USER_MARKDOWN);

    await expect(layer(page)).toHaveAttribute("data-active", "true");
    await expect(input).toHaveClass(/cave-composer-input--md/);

    // Each construct reaches the layer with its own role.
    await expect(layer(page).locator(".cave-md-tok--strong")).toHaveText("bold");
    await expect(layer(page).locator(".cave-md-tok--code")).toHaveText("code");
    await expect(layer(page).locator(".cave-md-tok--link-text")).toHaveText("the doc");
    await expect(layer(page).locator(".cave-md-tok--link-url")).toHaveText("https://example.com/a");

    // The invariant, measured rather than asserted from source: the layer and
    // the textarea must produce the same line boxes, or the decoration slides
    // off the glyphs it describes.
    const metrics = await page.evaluate(() => {
      const wrap = document.querySelector<HTMLElement>(".cave-chat-linear .cave-composer-input-wrap");
      const textarea = wrap?.querySelector<HTMLTextAreaElement>(".cave-composer-input");
      const decoration = wrap?.querySelector<HTMLElement>(".cave-composer-md-layer");
      if (!textarea || !decoration) return null;
      return {
        textareaHeight: textarea.scrollHeight,
        layerHeight: decoration.scrollHeight,
        painted: decoration.textContent ?? "",
        value: textarea.value,
      };
    });
    expect(metrics).not.toBeNull();
    expect(Math.abs(metrics!.textareaHeight - metrics!.layerHeight)).toBeLessThanOrEqual(1);
    // The painted text is the draft, character for character (the layer adds
    // one trailing newline to reserve the final line box, as a textarea does).
    expect(metrics!.painted).toBe(`${USER_MARKDOWN}\n`);
    expect(metrics!.value).toBe(USER_MARKDOWN);
  });

  test("alignment survives a draft long enough to wrap several times", async ({ page }) => {
    await setup(page);
    await page.goto("/?mode=chat#chat-s-md-composer", { waitUntil: "domcontentloaded" });
    const input = composer(page);
    await expect(input).toBeVisible({ timeout: 45_000 });

    // Wrapping is where a font, size, letter-spacing or padding mismatch
    // actually shows up: a single short line hides every metric error.
    const long = Array.from(
      { length: 12 },
      (_, i) => `Line ${i} has **bold**, \`code\`, and _slanted_ words that must wrap identically.`,
    ).join(" ");
    await input.fill(long);

    const metrics = await page.evaluate(() => {
      const wrap = document.querySelector<HTMLElement>(".cave-chat-linear .cave-composer-input-wrap");
      const textarea = wrap?.querySelector<HTMLTextAreaElement>(".cave-composer-input");
      const decoration = wrap?.querySelector<HTMLElement>(".cave-composer-md-layer");
      return textarea && decoration
        ? { textareaHeight: textarea.scrollHeight, layerHeight: decoration.scrollHeight }
        : null;
    });
    expect(metrics).not.toBeNull();
    expect(Math.abs(metrics!.textareaHeight - metrics!.layerHeight)).toBeLessThanOrEqual(1);
    await expect(layer(page)).toHaveAttribute("data-active", "true");
  });

  test("a draft past the composer's height cap scrolls the layer with the textarea", async ({
    page,
  }) => {
    await setup(page);
    await page.goto("/?mode=chat#chat-s-md-composer", { waitUntil: "domcontentloaded" });
    const input = composer(page);
    await expect(input).toBeVisible({ timeout: 45_000 });

    // Past ~13 lines the composer stops growing and starts scrolling. The layer
    // is a separate scroll container, so it has to be both clipped to the same
    // box and scrolled to the same offset — otherwise the decoration stays
    // pinned to the top while the text moves underneath it.
    const long = Array.from({ length: 40 }, (_, i) => `Line ${i} has **bold** text.`).join("\n");
    await input.fill(long);
    await expect(layer(page)).toHaveAttribute("data-active", "true");

    const capped = await page.evaluate(() => {
      const wrap = document.querySelector<HTMLElement>(".cave-chat-linear .cave-composer-input-wrap");
      const textarea = wrap?.querySelector<HTMLTextAreaElement>(".cave-composer-input");
      const decoration = wrap?.querySelector<HTMLElement>(".cave-composer-md-layer");
      if (!textarea || !decoration) return null;
      return {
        scrolls: textarea.scrollHeight > textarea.clientHeight,
        textareaClient: textarea.clientHeight,
        layerClient: decoration.clientHeight,
      };
    });
    expect(capped).not.toBeNull();
    expect(capped!.scrolls).toBe(true);
    // The layer is clipped to the textarea's box, not to its wrapper's.
    expect(capped!.layerClient).toBe(capped!.textareaClient);

    const followed = await page.evaluate(async () => {
      const wrap = document.querySelector<HTMLElement>(".cave-chat-linear .cave-composer-input-wrap");
      const textarea = wrap?.querySelector<HTMLTextAreaElement>(".cave-composer-input");
      const decoration = wrap?.querySelector<HTMLElement>(".cave-composer-md-layer");
      if (!textarea || !decoration) return null;
      textarea.scrollTop = 120;
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { textarea: textarea.scrollTop, layer: decoration.scrollTop };
    });
    expect(followed).not.toBeNull();
    expect(followed!.textarea).toBeGreaterThan(0);
    expect(followed!.layer).toBe(followed!.textarea);
  });

  test("the draft stays plain, selectable markdown text behind the decoration", async ({ page }) => {
    await setup(page);
    await page.goto("/?mode=chat#chat-s-md-composer", { waitUntil: "domcontentloaded" });
    const input = composer(page);
    await expect(input).toBeVisible({ timeout: 45_000 });

    await input.fill(USER_MARKDOWN);
    await expect(input).toHaveClass(/cave-composer-input--md/);

    // The textarea's glyphs are transparent, not absent. Select-all must still
    // select the real markdown source — this is the property the send path,
    // copy, and every keyboard behaviour in the composer depend on, and it is
    // exactly what a contenteditable rewrite would have put at risk.
    const selected = await page.evaluate(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>(
        ".cave-chat-linear .cave-composer-input-wrap .cave-composer-input",
      );
      if (!textarea) return null;
      textarea.focus();
      textarea.select();
      return textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
    });
    expect(selected).toBe(USER_MARKDOWN);

    // And the caret stays visible against the invisible text.
    const caretColor = await input.evaluate((el) => getComputedStyle(el).caretColor);
    expect(caretColor).not.toBe("transparent");
    expect(caretColor).not.toBe("rgba(0, 0, 0, 0)");
  });

  test("the layer never intercepts pointer input meant for the textarea", async ({ page }) => {
    await setup(page);
    await page.goto("/?mode=chat#chat-s-md-composer", { waitUntil: "domcontentloaded" });
    const input = composer(page);
    await expect(input).toBeVisible({ timeout: 45_000 });
    await input.fill(USER_MARKDOWN);
    await expect(layer(page)).toHaveAttribute("data-active", "true");

    // Clicking where the decoration is painted must land on the textarea and
    // place a caret, not swallow the click.
    await input.click();
    const focused = await page.evaluate(
      () => document.activeElement?.classList.contains("cave-composer-input") ?? false,
    );
    expect(focused).toBe(true);
  });

  test("a sent user turn renders markdown in its bubble", async ({ page }) => {
    await setup(page);
    await page.goto("/?mode=chat#chat-s-md-composer", { waitUntil: "domcontentloaded" });

    // The transcript half of cave-7ncq: user turns go through the same
    // sanitized renderer as assistant turns, so authored markdown reads as
    // markdown once sent rather than as literal asterisks and backticks.
    const bubble = page.locator(".cave-bubble-user").first();
    await expect(bubble).toBeVisible({ timeout: 45_000 });
    await expect(bubble.locator("strong")).toHaveText("bold");
    await expect(bubble.locator("code")).toHaveText("code");
    const href = await bubble.locator("a").first().getAttribute("href");
    expect(href).toBe("https://example.com/a");
    // The raw markers are gone from the rendered bubble.
    await expect(bubble).not.toContainText("**bold**");
  });
});
