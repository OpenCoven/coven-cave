// @ts-nocheck
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const executablePath = chromium.executablePath();
if (!existsSync(executablePath)) {
  console.log(`vault-visibility-chromium.test.ts skipped: browser not installed at ${executablePath}`);
} else {
  const css = readFileSync(new URL("../styles/vault-panel.css", import.meta.url), "utf8");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <style>
        :root {
          --text-primary: rgb(240, 240, 240);
          --duration-slow: 260ms;
          --ease-standard: cubic-bezier(0.2, 0, 0, 1);
        }
        ${css}
      </style>
      <textarea class="vault-paste-input vault-paste-input--masked">SECRET</textarea>
    `);

    const snapshots = await page.locator("textarea").evaluate(async (element) => {
      const textarea = element as HTMLTextAreaElement;
      textarea.classList.remove("vault-paste-input--masked");
      textarea.dataset.visibilityTransition = "reveal";

      const reveal = textarea.getAnimations()[0];
      if (!reveal) throw new Error("reveal animation did not start");
      reveal.pause();
      reveal.currentTime = 130;

      const duringReveal = getComputedStyle(textarea);
      const revealSnapshot = {
        color: duringReveal.color,
        textSecurity: duringReveal.webkitTextSecurity,
      };

      textarea.classList.add("vault-paste-input--masked");
      textarea.dataset.visibilityTransition = "mask";
      const immediateHide = getComputedStyle(textarea);
      const immediateHideSnapshot = {
        color: immediateHide.color,
        textSecurity: immediateHide.webkitTextSecurity,
      };

      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const nextFrame = getComputedStyle(textarea);
      return {
        reveal: revealSnapshot,
        immediateHide: immediateHideSnapshot,
        nextFrameHide: {
          color: nextFrame.color,
          textSecurity: nextFrame.webkitTextSecurity,
        },
      };
    });

    assert.deepEqual(
      snapshots.reveal,
      { color: "rgba(0, 0, 0, 0)", textSecurity: "none" },
      "the probe interrupts reveal after the raw text has become transparent",
    );
    assert.deepEqual(
      snapshots.immediateHide,
      { color: "rgba(0, 0, 0, 0)", textSecurity: "disc" },
      "Hide masks the secret without restarting from visible raw text",
    );
    assert.equal(
      snapshots.nextFrameHide.textSecurity,
      "disc",
      "the first painted Hide frame remains masked",
    );
  } finally {
    await browser.close();
  }

  console.log("vault-visibility-chromium.test.ts: ok");
}
