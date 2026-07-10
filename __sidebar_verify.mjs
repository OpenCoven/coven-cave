import { chromium } from "@playwright/test";

const base = "http://127.0.0.1:34739/?demo=1";
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });

async function prepare(context) {
  await context.addInitScript(() => {
    localStorage.setItem("cave:onboarding:dismissed", "1");
  });
  const page = await context.newPage();
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".shell-nav", { timeout: 20000 });
  return page;
}

const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await prepare(desktopContext);
await page.evaluate(() => window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "home" } })));
await page.waitForSelector(".sidebar-minimal", { timeout: 20000 });

const desktopToggle = page.locator(".shell-top-toggle--nav");
if ((await desktopToggle.getAttribute("aria-expanded")) !== "true") await desktopToggle.click();
await page.mouse.move(900, 400);
await page.waitForSelector(".shell-nav-panel--open .sidebar-brand__copy", { state: "visible" });

const expanded = await page.evaluate(() => {
  const rect = (selector) => {
    const box = document.querySelector(selector)?.getBoundingClientRect();
    return box ? { x: box.x, y: box.y, width: box.width, height: box.height, bottom: box.bottom } : null;
  };
  const active = document.querySelector(".sidebar-folder-row--active");
  const nav = document.querySelector(".shell-nav");
  return {
    nav: rect(".shell-nav"),
    brand: rect(".sidebar-brand"),
    primary: rect(".sidebar-primary-action"),
    footer: rect(".sidebar-identity-footer"),
    activeBorder: active ? getComputedStyle(active).borderLeftWidth : null,
    activeShadow: active ? getComputedStyle(active).boxShadow : null,
    navScrollOverflow: nav ? nav.scrollWidth - nav.clientWidth : null,
    labels: [...document.querySelectorAll(".sidebar-section-label")].filter((node) => getComputedStyle(node).display !== "none").map((node) => node.textContent?.trim()),
  };
});
await page.screenshot({ path: "/tmp/cave-sidebar-expanded.png" });

await desktopToggle.click();
await page.mouse.move(900, 400);
await page.waitForSelector(".shell-nav--rail");
const rail = await page.evaluate(() => {
  const rect = (selector) => {
    const box = document.querySelector(selector)?.getBoundingClientRect();
    return box ? { x: box.x, y: box.y, width: box.width, height: box.height, bottom: box.bottom } : null;
  };
  return {
    nav: rect(".shell-nav--rail"),
    brandCopy: getComputedStyle(document.querySelector(".sidebar-brand__copy")).display,
    row: rect(".sidebar-folder-row"),
    footer: rect(".sidebar-identity-footer"),
    footerLabel: getComputedStyle(document.querySelector(".sidebar-attribution")).display,
    visibleSectionLabels: [...document.querySelectorAll(".sidebar-section-label")].filter((node) => getComputedStyle(node).display !== "none").length,
  };
});
await page.screenshot({ path: "/tmp/cave-sidebar-rail.png" });

await desktopToggle.click();
await page.waitForSelector(".shell-nav-panel--open");
await page.evaluate(() => window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "chat" } })));
await page.waitForSelector(".workspace-sidebar__full .cnav__scroll", { timeout: 20000 });
const chat = await page.evaluate(() => ({
  brandVisible: document.querySelector(".workspace-sidebar__full .sidebar-brand__copy")?.getBoundingClientRect().width > 0,
  primaryVisible: document.querySelector(".workspace-sidebar__full .sidebar-primary-action")?.getBoundingClientRect().height,
  threadNavVisible: document.querySelector(".workspace-sidebar__full .cnav__scroll")?.getBoundingClientRect().height > 0,
  utilityVisible: document.querySelector(".workspace-sidebar__full .sidebar-utility")?.getBoundingClientRect().height > 0,
  identityVisible: document.querySelector(".workspace-sidebar__full .sidebar-identity-footer")?.getBoundingClientRect().height > 0,
  oldRailCount: document.querySelectorAll(".chat-sidebar__rail").length,
}));
await page.screenshot({ path: "/tmp/cave-sidebar-chat.png" });

await page.locator(".workspace-sidebar__full .sidebar-identity-control .familiar-switcher__trigger").click();
await page.waitForSelector('.familiar-switcher[role="dialog"]', { state: "visible" });
const familiar = await page.evaluate(() => {
  const trigger = document.querySelector(".workspace-sidebar__full .sidebar-identity-control .familiar-switcher__trigger").getBoundingClientRect();
  const popover = document.querySelector('.familiar-switcher[role="dialog"]').getBoundingClientRect();
  return {
    trigger: { x: trigger.x, y: trigger.y, width: trigger.width, height: trigger.height },
    popover: { x: popover.x, y: popover.y, width: popover.width, height: popover.height, bottom: popover.bottom },
    opensAbove: popover.bottom <= trigger.y + 1,
  };
});
await page.screenshot({ path: "/tmp/cave-sidebar-familiar.png" });
await desktopContext.close();

const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const mobilePage = await prepare(mobileContext);
await mobilePage.getByRole("button", { name: /Open navigation/ }).click();
await mobilePage.waitForSelector('[data-mobile-drawer="nav"] .shell-nav');
const mobile = await mobilePage.evaluate(() => {
  const rect = (selector) => {
    const box = document.querySelector(selector)?.getBoundingClientRect();
    return box ? { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right } : null;
  };
  const heights = [...document.querySelectorAll(".shell-nav .sidebar-primary-action, .shell-nav .sidebar-search-action, .shell-nav .sidebar-folder-row, .shell-nav .sidebar-utility-row")]
    .filter((node) => node.getBoundingClientRect().width > 0)
    .map((node) => node.getBoundingClientRect().height);
  return {
    nav: rect(".shell-nav"),
    drawer: rect(".shell-nav-panel"),
    minimumControlHeight: Math.min(...heights),
    viewportWidth: innerWidth,
    horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
  };
});
await mobilePage.screenshot({ path: "/tmp/cave-sidebar-mobile.png" });
await mobileContext.close();

await browser.close();
console.log(JSON.stringify({ expanded, rail, chat, familiar, mobile }, null, 2));
