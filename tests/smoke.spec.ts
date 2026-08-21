import { expect, test, type Page } from "@playwright/test";

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource/.test(message.text())) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().includes("/api/marketing/analytics/")) errors.push(`${response.status()} ${response.url()}`);
  });
  return errors;
}

async function ready(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("body[data-game-ready='true']", { timeout: 30_000 });
  await expect(page.locator("canvas")).toBeVisible();
}

test("title scene is immediate, lit and fixed at 1280 by 720", async ({ page }) => {
  const errors = collectErrors(page);
  await ready(page);
  const state = await page.evaluate(() => window.__glow);
  expect(state).toMatchObject({ ready: true, scene: "menu", status: "menu", lightsActive: true });
  const canvas = page.locator("canvas");
  await expect(canvas).toHaveAttribute("width", "1280");
  await expect(canvas).toHaveAttribute("height", "720");
  await page.screenshot({ path: "test-results/title.png" });
  expect(errors).toEqual([]);
});

test("first pointer click starts play and carries its destination into movement", async ({ page }) => {
  const errors = collectErrors(page);
  await ready(page);
  await page.mouse.click(1000, 360);
  await page.waitForFunction(() => window.__glow?.scene === "game" && window.__glow.level === 1);
  await page.waitForFunction(() => (window.__glow?.playerX ?? 0) > 135);
  expect(await page.evaluate(() => window.__glow)).toMatchObject({ status: "playing", level: 1, sparks: 3, dashReady: true, lightsActive: true });
  await page.screenshot({ path: "test-results/pointer-start.png" });
  expect(errors).toEqual([]);
});

test("real input starts play, moves the light and exposes the complete first chamber", async ({ page }) => {
  const errors = collectErrors(page);
  await ready(page);
  await page.keyboard.down("ArrowRight");
  await page.waitForFunction(() => window.__glow?.scene === "game" && window.__glow.level === 1);
  await page.waitForFunction(() => (window.__glow?.playerX ?? 0) > 135);
  await page.keyboard.up("ArrowRight");
  await page.keyboard.down("Space");
  await page.waitForFunction(() => window.__glow?.dashReady === false);
  await page.keyboard.up("Space");
  const after = await page.evaluate(() => window.__glow);
  expect(after?.playerX).toBeGreaterThan(135);
  expect(after).toMatchObject({ status: "playing", level: 1, sparks: 3, target: 5, ending: false, lightsActive: true });
  await page.screenshot({ path: "test-results/chamber-one.png" });
  expect(errors).toEqual([]);
});

test("three chamber progression reaches the authored ending", async ({ page }) => {
  const errors = collectErrors(page);
  await ready(page);
  await page.evaluate(() => window.__glowCommand?.("start"));
  await page.waitForFunction(() => window.__glow?.scene === "game");

  for (let level = 1; level <= 3; level += 1) {
    await page.evaluate(() => window.__glowCommand?.("collectAll"));
    await page.waitForFunction(() => window.__glow?.gateOpen === true);
    const state = await page.evaluate(() => window.__glow);
    expect(state?.collected).toBe(state?.target);
    await page.evaluate(() => window.__glowCommand?.("enterGate"));
    if (level < 3) await page.waitForFunction((nextLevel) => window.__glow?.scene === "game" && window.__glow.level === nextLevel, level + 1);
  }

  await page.waitForFunction(() => window.__glow?.ending === true, undefined, { timeout: 10_000 });
  expect(await page.evaluate(() => window.__glow)).toMatchObject({ scene: "ending", status: "ending", level: 3, ending: true, lightsActive: true });
  await page.screenshot({ path: "test-results/ending.png" });
  expect(errors).toEqual([]);
});

test("losing all sparks enters fail state and retry resets the journey", async ({ page }) => {
  const errors = collectErrors(page);
  await ready(page);
  await page.evaluate(() => window.__glowCommand?.("start"));
  await page.waitForFunction(() => window.__glow?.scene === "game");
  await page.evaluate(() => {
    window.__glowCommand?.("damage");
    window.__glowCommand?.("damage");
    window.__glowCommand?.("damage");
  });
  await page.waitForFunction(() => window.__glow?.status === "fail");
  expect(await page.evaluate(() => window.__glow?.sparks)).toBe(0);
  await page.screenshot({ path: "test-results/failure.png" });
  await page.evaluate(() => window.__glowCommand?.("retry"));
  await page.waitForFunction(() => window.__glow?.scene === "game" && window.__glow.level === 1 && window.__glow.sparks === 3);
  expect(await page.evaluate(() => window.__glow)).toMatchObject({ status: "playing", collected: 0, score: 0 });
  expect(errors).toEqual([]);
});
