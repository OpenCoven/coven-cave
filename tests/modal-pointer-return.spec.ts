import { expect, test } from "@playwright/test";
import { build } from "esbuild";

let script: string;
let styles: string;

// Real Modal/focus ownership, isolated props and production CSS. In particular,
// the root Modal is not mounted until its trigger is activated.
test.beforeAll(async ({ request }) => {
  const response = await request.get("/aesthetic");
  expect(response.ok()).toBe(true);
  styles = ((await response.text()).match(/<link\b[^>]*>/g) ?? [])
    .filter(link => /rel="stylesheet"/.test(link)).join("\n");
  expect(styles).not.toBe("");
  const result = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React, { useRef, useState } from "react";
      import { createRoot } from "react-dom/client";
      import { Modal } from "./src/components/ui/modal";
      function Fixture() {
        const [open, setOpen] = useState(false);
        const [nested, setNested] = useState(false);
        const destination = useRef(null);
        return <>
          <main>
            <input aria-label="Previous focus" />
            <button onClick={() => setOpen(true)}><span>Open root</span></button>
            <button onClick={() => { destination.current.focus(); setOpen(true); }}>Choose return destination</button>
            <button onPointerDown={event => { event.preventDefault(); destination.current.focus(); }} onClick={() => setOpen(true)}>Choose return destination before click</button>
            <input ref={destination} aria-label="Chosen return destination" />
          </main>
          {open && <Modal open title="Root dialog" onClose={() => setOpen(false)}>
            <input aria-label="Parent draft" />
            <button onClick={() => setNested(true)}><span>Open nested</span></button>
            {nested && <Modal open title="Nested dialog" onClose={() => setNested(false)}>Nested content</Modal>}
          </Modal>}
        </>;
      }
      createRoot(document.getElementById("root")).render(<Fixture />);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    tsconfig: "tsconfig.json", define: { "process.env.NODE_ENV": '"production"' },
  });
  script = result.outputFiles[0].text;
});

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/__modal-pointer-return", route => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html data-theme="coven" data-mode="dark"><head>${styles}</head><body><div id="root"></div></body></html>`,
  }));
  await page.goto("/__modal-pointer-return");
  await page.addScriptTag({ content: script });
});

test("pointer activation restores a conditionally mounted root to its actual trigger", async ({ page }) => {
  await page.getByRole("textbox", { name: "Previous focus", exact: true }).focus();
  const opener = page.getByRole("button", { name: "Open root", exact: true });
  await opener.locator("span").click();
  await expect(page.getByRole("dialog", { name: "Root dialog", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("pointer activation restores a nested trigger and preserves the parent draft", async ({ page }) => {
  const opener = page.getByRole("button", { name: "Open root", exact: true });
  await opener.focus();
  await page.keyboard.press("Enter");
  const parent = page.getByRole("dialog", { name: "Root dialog", exact: true });
  await parent.getByRole("textbox", { name: "Parent draft" }).fill("Keep this draft");
  const nestedOpener = parent.getByRole("button", { name: "Open nested", exact: true });
  await nestedOpener.locator("span").click();
  await expect(page.getByRole("dialog", { name: "Nested dialog", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Nested dialog", exact: true })).toHaveCount(0);
  await expect(nestedOpener).toBeFocused();
  await expect(parent.getByRole("textbox", { name: "Parent draft" })).toHaveValue("Keep this draft");
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
});

for (const label of ["Choose return destination", "Choose return destination before click"]) {
  test(`explicit focus supersedes the trigger: ${label}`, async ({ page }) => {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Root dialog", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("textbox", { name: "Chosen return destination" })).toBeFocused();
  });
}
