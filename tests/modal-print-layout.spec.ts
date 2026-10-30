import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { readFileSync } from "node:fs";

// Real Modal portals and styles; documents are synthetic and no local store is read.
test("printing selects the foreground document and ignores retained hidden readers", async ({ page }) => {
  const styles = ["foundations", "themes", "primitives"].map(name => readFileSync(`src/styles/globals/${name}.css`, "utf8")).join("\n");
  const result = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React, { useState } from "react";
      import { createRoot } from "react-dom/client";
      import { Modal } from "./src/components/ui/modal";
      function Example() {
        const [open, setOpen] = useState(true);
        const [child, setChild] = useState(false);
        return <><main>Application document</main>
          <Modal open={open} keepMounted printable title="Parent document" onClose={() => setOpen(false)}>
            <p>Parent-only content</p><button onClick={() => setChild(true)}>Open child</button>
            <Modal open={child} printable title="Child document" onClose={() => setChild(false)}>
              <p>Foreground content</p>
            </Modal>
          </Modal>
        </>;
      }
      createRoot(document.getElementById("root")).render(<Example />);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", tsconfig: "tsconfig.json",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  await page.setContent(`<html data-theme="coven" data-mode="dark"><style>${styles}</style><div id="root"></div></html>`);
  await page.addScriptTag({ content: result.outputFiles[0].text });
  await page.getByRole("button", { name: "Open child" }).click();
  await expect(page.getByRole("dialog", { name: "Child document" })).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.getByText("Foreground content", { exact: true })).toBeVisible();
  await expect(page.getByText("Parent-only content", { exact: true })).toBeHidden();
  await expect(page.getByText("Application document", { exact: true })).toBeHidden();
  await expect(page.locator(".ui-modal-close").last()).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.emulateMedia({ media: "print" });
  await expect(page.getByText("Application document", { exact: true })).toBeVisible();
  await expect(page.getByText("Parent-only content", { exact: true })).toBeHidden();
});
