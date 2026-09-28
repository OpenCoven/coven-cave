import { expect, test, type Page } from "@playwright/test";

// Production service workers otherwise forward mocked POSTs to the real server.
test.use({ serviceWorkers: "block" });

async function openVoiceCall(page: Page, failFirst = false) {
  await page.addInitScript(() => {
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem("cave:active-familiar", "voice-acceptance");
    Object.defineProperty(navigator, "mediaDevices", { configurable: true,
      value: { getUserMedia: async () => new MediaStream() },
    });
    const state = { contexts: [] as AudioContext[], starts: 0, stops: 0 };
    Object.assign(window, { __voiceAcceptance: state, SpeechRecognition: class {
      start() {} stop() {}
    } });
    const Context = window.AudioContext;
    window.AudioContext = class extends Context {
      constructor() { super(); state.contexts.push(this); }
      createBufferSource() {
        const source = super.createBufferSource();
        const start = source.start.bind(source);
        source.start = (...args) => { state.starts++; start(...args); };
        const stop = source.stop.bind(source);
        source.stop = (...args) => { state.stops++; stop(...args); };
        return source;
      }
    };
  });
  await page.route("**/api/**", route => route.abort());
  await page.route("**/api/familiars**", route => route.fulfill({ json: { ok: true, familiars: [
    { id: "voice-acceptance", display_name: "Voice acceptance", role: "Builder", status: "active", icon: "ph:sparkle-fill", voiceProvider: "elevenlabs" },
  ] } }));
  await page.route("**/api/projects**", route => route.fulfill({ json: { ok: true, projects: [{ id: "p1", name: "Queue", root: "/repo/queue", access: "write" }] } }));
  await page.route("**/api/sessions/list**", route => route.fulfill({ json: { ok: true, sessions: [] } }));
  await page.route("**/api/board**", route => route.fulfill({ json: { ok: true, cards: [] } }));
  await page.route("**/api/inbox**", route => route.fulfill({ json: { ok: true, items: [] } }));
  await page.route("**/api/chat/conversation", route => route.fulfill({ json: { ok: true, sessionId: "voice-acceptance-session" } }));
  await page.route("**/api/chat/conversation/**", route => route.fulfill({ json: { ok: true, conversation: { turns: [] }, context: { task: null, github: [] } } }));
  const settings = { voiceProvider: "elevenlabs", voiceModel: "eleven_v3_conversational", voiceName: "21m00Tcm4TlvDq8ikWAM" };
  const saved: unknown[] = [];
  await page.route("**/api/voice/elevenlabs/catalog", route => route.fulfill({ json: { ok: true,
    voices: [{ id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel" }, { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella" }],
    models: [{ id: "eleven_v3_conversational", name: "v3 Conversational" }, { id: "eleven_flash_v2_5", name: "Flash v2.5" }],
  } }));
  await page.route("**/api/config", route => {
    const next = route.request().postDataJSON().familiars["voice-acceptance"];
    Object.assign(settings, next); saved.push(next);
    return route.fulfill({ json: { ok: true } });
  });
  let minted = 0;
  await page.route("**/api/voice/session", route => {
    if (failFirst && minted++ === 0) return route.fulfill({ status: 503, json: { ok: false, error: "provider_error", hint: "Temporary voice service failure. Retry the call." } });
    return route.fulfill({ json: { ok: true, callId: "voice-acceptance-call", grant: {
      provider: "elevenlabs", clientSecret: "proxied", expiresAt: "2099-01-01T00:00:00Z",
      connection: { kind: "elevenlabs", familiarId: "voice-acceptance", sessionId: "voice-acceptance-session", voiceId: settings.voiceName, modelId: settings.voiceModel },
    } } });
  });
  await page.route("**/api/chat/send", route => route.fulfill({ contentType: "text/event-stream", body:
    'data: {"kind":"assistant_chunk","text":"Hello Val. This is a spoken response for the voice acceptance check."}\n\ndata: {"kind":"done"}\n\n',
  }));
  await page.route("**/api/voice/elevenlabs/tts", route => {
    expect(route.request().postDataJSON().format).toBe("pcm");
    return route.fulfill({ contentType: "audio/pcm", body: Buffer.alloc(24_000 * 2 * 8) });
  });
  await page.goto("/?mode=chat");
  const call = page.getByTestId("chat-main").getByRole("button", { name: "Voice call", exact: true });
  await expect(call).toBeVisible({ timeout: 45_000 });
  await call.click();
  const dialog = page.getByRole("dialog", { name: "Voice acceptance", exact: true });
  await expect(dialog).toBeVisible();
  return { dialog, call, saved };
}

test("voice call retries, speaks streamed PCM, mutes, interrupts, and releases audio on Escape", async ({ page }) => {
  const { dialog } = await openVoiceCall(page, true);
  await expect(dialog.getByText("Temporary voice service failure. Retry the call.")).toBeVisible();
  await dialog.getByRole("button", { name: "Try again" }).click();
  await expect(dialog.getByText("Listening", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Mute", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Unmute", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByText("Microphone off")).toBeVisible();
  await dialog.getByRole("button", { name: "Unmute", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Reply without speaking" }).fill("Say hello.");
  await dialog.getByRole("button", { name: "Send reply" }).click();
  await expect(dialog.getByRole("button", { name: "Stop speaking" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__voiceAcceptance.contexts.some((c: AudioContext) => c.state === "running"))).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).__voiceAcceptance.starts)).toBeGreaterThan(0);
  await dialog.getByRole("button", { name: "Stop speaking" }).click();
  await expect(dialog.getByRole("button", { name: "Stop speaking" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__voiceAcceptance.stops)).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__voiceAcceptance.contexts.every((c: AudioContext) => c.state === "closed"))).toBe(true);
  // Starting from an empty chat promotes a new session and replaces the
  // launch button; the new chat composer is the surviving return target.
  await expect(page.getByTestId("chat-main").locator("textarea").first()).toBeFocused();
});

test("voice controls stay reachable in a narrow viewport with keyboard focus contained", async ({ page }) => {
  const { dialog } = await openVoiceCall(page);
  await expect(dialog.getByText("Listening", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 664 });
  for (const name of ["Mute", "End call"]) {
    const button = dialog.getByRole("button", { name, exact: true });
    await expect(button).toBeInViewport();
    const bounds = await button.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
  }
  await expect(dialog.getByRole("textbox", { name: "Reply without speaking" })).toBeInViewport();
  await dialog.getByRole("button", { name: "End call" }).focus();
  await page.keyboard.press("Tab");
  await expect.poll(() => dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [theme, mode] of [["coven", "dark"], ["coven", "light"], ["tide", "dark"]]) {
    await page.evaluate(({ theme, mode }) => {
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.mode = mode;
    }, { theme, mode });
    await page.screenshot({ path: test.info().outputPath(`voice-${theme}-${mode}.png`), animations: "disabled" });
  }
  await dialog.getByRole("button", { name: "End call" }).click();
  await expect(dialog).toHaveCount(0);
});


test("fullscreen game keeps live captions above play and exposes full history", async ({ page }) => {
  const { dialog } = await openVoiceCall(page);
  await expect(dialog.getByText("Listening", { exact: true })).toBeVisible();
  const viewport = page.viewportSize()!;
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.width).toBe(viewport.width);
  expect(bounds.height).toBe(viewport.height);
  await dialog.getByRole("button", { name: "Play Glitter Crypt" }).click();
  const game = page.frameLocator('iframe[title="Glitter Crypt — playable"]');
  await game.getByRole("button", { name: "Enter the crypt" }).click();
  await dialog.getByRole("textbox", { name: "Reply without speaking" }).fill("Tell me about this game.");
  await dialog.getByRole("button", { name: "Send reply" }).click();
  const captions = dialog.getByRole("log", { name: "Live game captions" });
  await expect(captions).toContainText("Hello Val.");
  await expect(captions).toBeInViewport();
  expect(await captions.evaluate(el => getComputedStyle(el).pointerEvents)).toBe("none");
  const frameBounds = (await dialog.locator("iframe").boundingBox())!;
  const captionBounds = (await captions.boundingBox())!;
  expect(captionBounds.y).toBeGreaterThan(frameBounds.y);
  expect(captionBounds.y + captionBounds.height).toBeLessThanOrEqual(frameBounds.y + frameBounds.height);
  await page.screenshot({ path: test.info().outputPath("voice-fullscreen-game.png"), animations: "disabled" });
  await dialog.getByRole("button", { name: "Show full transcript" }).click();
  await expect(dialog.getByRole("log", { name: "Call transcript" })).toContainText("Tell me about this game.");
  await page.keyboard.press("Escape");
  await expect(captions).toBeVisible();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "End call" }).click();
});

test("voice selection saves and reconnects with preserved history and mute", async ({ page }) => {
  const { dialog, saved } = await openVoiceCall(page);
  await expect(dialog.getByText("Listening", { exact: true })).toBeVisible();
  await dialog.getByRole("textbox", { name: "Reply without speaking" }).fill("Keep this conversation.");
  await dialog.getByRole("button", { name: "Send reply" }).click();
  await expect(dialog.getByRole("log", { name: "Call transcript" })).toContainText("Keep this conversation.");
  await dialog.getByRole("button", { name: "Mute", exact: true }).click();
  const trigger = dialog.getByRole("button", { name: "Change familiar voice" });
  await trigger.click();
  const settings = page.getByRole("dialog", { name: "Call Familiar voice" });
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "Familiar voice", exact: true }).click();
  expect((await page.getByRole("menuitemradio", { name: "Bella" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.getByRole("menuitemradio", { name: "Bella" }).click();
  await settings.getByRole("button", { name: "Voice delivery", exact: true }).click();
  await page.getByRole("menuitemradio", { name: /Flash v2.5/ }).click();
  await page.screenshot({ path: test.info().outputPath("voice-settings.png"), animations: "disabled" });
  await settings.getByRole("button", { name: "Save and reconnect" }).click();
  await expect(settings).toHaveCount(0);
  await expect(dialog.getByText("Microphone off")).toBeVisible();
  await expect(trigger).toBeFocused();
  expect(saved).toEqual([{ voiceProvider: "elevenlabs", voiceModel: "eleven_flash_v2_5", voiceName: "EXAVITQu4vr4xnSDxMaL" }]);
  await expect(dialog.getByRole("log", { name: "Call transcript" })).toContainText("Keep this conversation.");
  await expect.poll(() => page.evaluate(() => (window as any).__voiceAcceptance.contexts.filter((c: AudioContext) => c.state === "closed").length)).toBeGreaterThan(0);
  await dialog.getByRole("button", { name: "End call" }).click();
});

test("long game captions follow new words in a narrow viewport", async ({ page }) => {
  const { dialog } = await openVoiceCall(page);
  await expect(dialog.getByText("Listening", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 664 });
  await dialog.getByRole("button", { name: "Play Glitter Crypt" }).click();
  await page.frameLocator('iframe[title="Glitter Crypt — playable"]').getByRole("button", { name: "Enter the crypt" }).click();
  await dialog.getByRole("textbox", { name: "Reply without speaking" }).fill("A longer thought continues here. ".repeat(25) + "These are the latest words.");
  await dialog.getByRole("button", { name: "Send reply" }).click();
  const captions = dialog.getByRole("log", { name: "Live game captions" });
  const userCaption = captions.locator("p").first();
  await expect(userCaption).toContainText("These are the latest words.");
  await expect.poll(() => userCaption.evaluate(p => p.scrollTop > 0 && p.scrollHeight - p.clientHeight - p.scrollTop <= 1)).toBe(true);
  for (const [theme, mode] of [["coven", "dark"], ["coven", "light"], ["tide", "dark"]]) {
    await page.evaluate(({ theme, mode }) => { document.documentElement.dataset.theme = theme; document.documentElement.dataset.mode = mode; }, { theme, mode });
    await page.screenshot({ path: test.info().outputPath(`voice-game-${theme}-${mode}.png`), animations: "disabled" });
  }
  await dialog.getByRole("button", { name: "Show full transcript" }).click();
  const reply = dialog.getByRole("button", { name: "Reply", exact: true }).first();
  expect((await reply.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await reply.click();
  expect((await dialog.getByRole("button", { name: "Cancel reply" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await dialog.getByRole("button", { name: "End call" }).click();
});
