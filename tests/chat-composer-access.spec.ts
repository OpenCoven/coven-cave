import { expect, test, type Page } from "@playwright/test";

const ISO = "2026-08-25T02:00:00.000Z";
const SESSION_ID = "composer-access";

async function setup(page: Page, sends: Array<Record<string, unknown>>) {
  await page.addInitScript(() => {
    localStorage.setItem("cave:active-familiar", "nova");
    localStorage.setItem("cave:familiar:nova:last-surface", "chat");
    localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        familiars: [{
          id: "nova",
          display_name: "Nova",
          role: "Orchestrator",
          status: "active",
          icon: "ph:sparkle-fill",
        }],
      },
    }));
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        sessions: [{
          id: SESSION_ID,
          title: "Composer access",
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
        }],
      },
    }));
  await page.route("**/api/projects**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        projects: [{ id: "p1", name: "Coven Cave", root: "/tmp/coven-cave", access: "write" }],
      },
    }));
  await page.route("**/api/inbox**", route => route.fulfill({ json: { ok: true, items: [] } }));
  await page.route("**/api/chat/conversation/**", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          json: {
            ok: true,
            conversation: {
              activeLeafId: "assistant-1",
              turns: [{
                id: "assistant-1",
                parentId: null,
                role: "assistant",
                text: "Choose the access level for the next request.",
                createdAt: ISO,
              }],
            },
          },
        })
      : route.fulfill({ json: { ok: true } }));
  await page.route("**/api/chat/send", (route) => {
    sends.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({
      contentType: "text/event-stream",
      body: 'data: {"type":"done"}\n\n',
    });
  });
  await page.goto(`/?mode=chat#chat-${SESSION_ID}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("chat-main").locator(".cave-composer-input")).toBeVisible({ timeout: 45_000 });
}

async function chooseAccess(page: Page, label: "Explore · read only" | "Build · full access") {
  await page.getByTestId("chat-main").getByRole("button", { name: "Tools" }).click();
  const responseTrigger = page.getByRole("menuitem", { name: /Response options/ });
  await responseTrigger.hover();
  const dialog = page.getByRole("dialog", { name: "Response options" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("radio", { name: label }).click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
}

async function send(page: Page, prompt: string) {
  const main = page.getByTestId("chat-main");
  await main.locator(".cave-composer-input").fill(prompt);
  await main.getByRole("button", { name: "Send message" }).click();
}

test("Response options preserves Explore and Build permission payloads", async ({ page }) => {
  const sends: Array<Record<string, unknown>> = [];
  await setup(page, sends);

  await chooseAccess(page, "Explore · read only");
  await send(page, "Inspect the repository.");
  await expect.poll(() => sends.find((entry) => entry.prompt === "Inspect the repository.")?.permissionMode)
    .toBe("read");

  await chooseAccess(page, "Build · full access");
  await send(page, "Apply the focused patch.");
  await expect.poll(() => sends.find((entry) => entry.prompt === "Apply the focused patch.")?.permissionMode)
    .toBe("full");
});

test("attachments remain removable after picker, drop and paste, without consuming the draft", async ({ page }, testInfo) => {
  const sends: Array<Record<string, unknown>> = [];
  await setup(page, sends);
  const chat = page.getByTestId("chat-main");
  const draft = chat.locator(".cave-composer-input");
  // Live messages clear after 250ms. Record mutations before acting so a
  // slow browser cannot miss a correct announcement between assertions.
  const announcements = await page.evaluateHandle(() => {
    const region = document.querySelector('div.sr-only[role="status"][aria-live="polite"]');
    if (!region) throw new Error("Polite announcement region is missing");
    const messages: string[] = [];
    new MutationObserver(() => {
      if (region.textContent) messages.push(region.textContent);
    }).observe(region, { childList: true, subtree: true, characterData: true });
    return messages;
  });
  await draft.fill("Keep this draft while attaching evidence.");
  await chat.locator('input[type="file"]').setInputFiles({
    name: "picked.txt", mimeType: "text/plain", buffer: Buffer.from("Picked evidence"),
  });
  await expect(chat.getByRole("button", { name: "Remove picked.txt", exact: true })).toBeVisible();
  await expect(draft).toBeFocused();
  await expect.poll(() => announcements.jsonValue()).toContain("Attached 1 file.");
  for (const kind of ["drop", "paste"] as const) {
    await draft.evaluate((element, method) => {
      const data = new DataTransfer();
      data.items.add(new File([`${method} evidence`], `${method}.txt`, { type: "text/plain" }));
      element.dispatchEvent(method === "paste"
        ? new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data })
        : new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }));
    }, kind);
    await expect(chat.getByRole("button", { name: `Remove ${kind}.txt`, exact: true })).toBeVisible();
  }
  const remove = chat.getByRole("button", { name: "Remove picked.txt", exact: true });
  const touch = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  const target = await remove.boundingBox();
  expect(target!.width).toBeGreaterThanOrEqual(touch ? 44 : 24);
  expect(target!.height).toBeGreaterThanOrEqual(touch ? 44 : 24);
  await page.screenshot({ path: testInfo.outputPath("attachments.png") });
  await remove.click();
  await expect(chat.getByRole("button", { name: "Remove picked.txt", exact: true })).toHaveCount(0);
  await expect(draft).toBeFocused();
  await expect.poll(() => announcements.jsonValue()).toContain("Removed picked.txt.");
  await expect(draft).toHaveValue("Keep this draft while attaching evidence.");
  expect(sends).toHaveLength(0);
  await chat.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => sends.length).toBe(1);
  expect(sends[0].attachments).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: "drop.txt", text: "drop evidence" }),
    expect.objectContaining({ name: "paste.txt", text: "paste evidence" }),
  ]));
  expect(sends[0].attachments).toHaveLength(2);
});


for (const width of [1280, 390]) {
  test(`attachment read failures remain actionable without losing the draft at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const sends: Array<Record<string, unknown>> = [];
    await setup(page, sends);
    await page.evaluate(() => {
      const slice = File.prototype.slice;
      File.prototype.slice = function(...args) {
        const blob = slice.apply(this, args);
        if (this.name === "unreadable.txt") {
          blob.text = async () => { throw new Error("Synthetic read failure"); };
        }
        return blob;
      };
    });
    const chat = page.getByTestId("chat-main");
    const draft = chat.locator(".cave-composer-input");
    await draft.fill("Keep my draft and the readable file.");
    await chat.locator('input[type="file"]').setInputFiles([
      { name: "readable.txt", mimeType: "text/plain", buffer: Buffer.from("Good evidence") },
      { name: "unreadable.txt", mimeType: "text/plain", buffer: Buffer.from("Bad evidence") },
    ]);
    const feedback = chat.locator(".composer-attachment-feedback");
    await expect(feedback).toContainText("unreadable.txt couldn't be read. Choose it again.");
    await expect(chat.getByRole("button", { name: "Remove readable.txt", exact: true })).toBeVisible();
    await expect(chat.getByRole("button", { name: "Remove unreadable.txt", exact: true })).toHaveCount(0);
    await expect(draft).toHaveValue("Keep my draft and the readable file.");
    expect(await feedback.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await feedback.getByRole("button", { name: "Dismiss attachment notice" }).click();
    await expect(draft).toBeFocused();
    await expect(feedback).toHaveCount(0);
    await chat.getByRole("button", { name: "Send message", exact: true }).click();
    await expect.poll(() => sends.length).toBe(1);
    expect(sends[0].attachments).toEqual([expect.objectContaining({ name: "readable.txt", text: "Good evidence" })]);
  });
}

test("oversized attachments are explained and pending reads block send until capture finishes", async ({ page }) => {
  const sends: Array<Record<string, unknown>> = [];
  await setup(page, sends);
  const chat = page.getByTestId("chat-main");
  const draft = chat.locator(".cave-composer-input");
  await draft.fill("Read this evidence.");
  await draft.evaluate(element => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array(6 * 1024 * 1024)], "oversized.png", { type: "image/png" }));
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }));
  });
  await expect(chat.locator(".composer-attachment-feedback")).toContainText("oversized.png is too large. Choose a smaller file.");
  await expect(chat.getByRole("button", { name: "Remove oversized.png", exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    const slice = File.prototype.slice;
    File.prototype.slice = function(...args) {
      const blob = slice.apply(this, args);
      blob.text = () => new Promise(resolve => {
        window.addEventListener("release-attachment-read", () => resolve("Slow evidence"), { once: true });
      });
      return blob;
    };
  });
  await chat.locator('input[type="file"]').setInputFiles({ name: "slow.txt", mimeType: "text/plain", buffer: Buffer.from("Slow evidence") });
  await expect(chat.getByRole("status").filter({ hasText: "Reading attachments…" })).toBeVisible();
  await expect(chat.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
  await draft.press("Enter");
  expect(sends).toHaveLength(0);
  await expect(draft).toHaveValue("Read this evidence.");
  await page.evaluate(() => window.dispatchEvent(new Event("release-attachment-read")));
  await expect(chat.getByRole("button", { name: "Remove slow.txt", exact: true })).toBeVisible();
  await expect(chat.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
});

test("a stop phrase cancels a streaming response while an attachment is still reading", async ({ page }) => {
  await setup(page, []);
  const stops: unknown[] = [];
  await page.route("**/api/chat/stop", route => {
    stops.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true, stopped: true } });
  });
  await page.evaluate(() => {
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      if (String(args[0]) === "/api/chat/send") {
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"type":"text","text":"Working…"}\n\n'));
            args[1]?.signal?.addEventListener("abort", () => controller.error(new DOMException("Stopped", "AbortError")), { once: true });
          },
        }), { headers: { "content-type": "text/event-stream" } });
      }
      return originalFetch(...args);
    };
    const slice = File.prototype.slice;
    File.prototype.slice = function(...args) {
      const blob = slice.apply(this, args);
      blob.text = () => new Promise(resolve => {
        window.addEventListener("release-attachment-read", () => resolve("Slow evidence"), { once: true });
      });
      return blob;
    };
  });
  const chat = page.getByTestId("chat-main");
  const draft = chat.locator(".cave-composer-input");
  await draft.fill("Start the response.");
  await chat.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(chat.getByRole("button", { name: "Cancel response", exact: true })).toBeVisible();
  await chat.locator('input[type="file"]').setInputFiles({ name: "slow.txt", mimeType: "text/plain", buffer: Buffer.from("Slow evidence") });
  await expect(chat.getByRole("status").filter({ hasText: "Reading attachments…" })).toBeVisible();
  await draft.fill("stop");
  await draft.press("Enter");
  await expect.poll(() => stops.length).toBe(1);
  await expect(draft).toHaveValue("");
  await page.evaluate(() => window.dispatchEvent(new Event("release-attachment-read")));
  await expect(chat.getByRole("button", { name: "Remove slow.txt", exact: true })).toBeVisible();
});

test("queued follow-ups can be removed and reordered before automatic delivery", async ({ page }) => {
  await setup(page, []);
  const sends: Array<Record<string, unknown>> = [];
  let releaseFirst!: () => void;
  const firstResponse = new Promise<void>(resolve => { releaseFirst = resolve; });
  await page.route("**/api/chat/send", async route => {
    sends.push(route.request().postDataJSON());
    const index = sends.length;
    if (index === 1) await firstResponse;
    await route.fulfill({
      contentType: "text/event-stream",
      body: [
        { kind: "assistant_chunk", text: `Response ${index}` },
        { kind: "done", sessionId: SESSION_ID, persistedTurnId: `queued-response-${index}` },
      ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(""),
    });
  });
  const chat = page.getByTestId("chat-main");
  const draft = chat.locator(".cave-composer-input");
  await draft.fill("Start the first response.");
  await chat.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => sends.length).toBe(1);
  for (const prompt of ["Follow-up A", "Follow-up B", "Discard this follow-up"]) {
    await draft.fill(prompt);
    await chat.getByRole("button", { name: "Queue message", exact: true }).click();
  }
  const queue = chat.getByRole("group", { name: "Queued messages" });
  await expect(queue.locator(".cave-composer-queue__chip")).toHaveCount(3);
  await queue.locator(".cave-composer-queue__chip").filter({ hasText: "Discard this follow-up" }).getByRole("button", { name: "Remove queued message" }).click();
  await queue.locator(".cave-composer-queue__chip").filter({ hasText: "Follow-up B" }).getByRole("button", { name: "Send queued message next" }).click();
  await expect(queue.locator(".cave-composer-queue__chip").first()).toContainText("Follow-up B");
  expect(sends).toHaveLength(1);
  releaseFirst();
  await expect.poll(() => sends.map(entry => entry.prompt)).toEqual(["Start the first response.", "Follow-up B", "Follow-up A"]);
  await expect(queue).toHaveCount(0);
  await expect(draft).toHaveValue("");
});
