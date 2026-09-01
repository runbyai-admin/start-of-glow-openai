import { expect, test } from "@playwright/test";

/**
 * The smoke test contestants extend.
 *
 * It answers the only question the owner asks at judging time: does the build
 * actually come up and respond to input? Add your own tests beside it - keep
 * this one passing, a build that fails it is not playable.
 */

function collectConsoleErrors(page: import("@playwright/test").Page): string[] {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    // "Failed to load resource" carries no URL, so bad responses are checked
    // through the response listener below instead.
    if (msg.type() === "error" && !/Failed to load resource/.test(msg.text())) {
      consoleErrors.push(msg.text());
    }
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  // The analytics beacon is fire-and-forget and only accepted from the
  // deployed origins, so its status off-production is not the game's problem.
  page.on("response", (res) => {
    if (res.status() >= 400 && !res.url().includes("/api/marketing/analytics/")) {
      consoleErrors.push(`${res.status()} ${res.url()}`);
    }
  });
  return consoleErrors;
}

test("the title screen comes up with the light pipeline running", async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);

  await page.goto("/", { waitUntil: "domcontentloaded" });

  // The scene sets this once its first frame has been rendered.
  await page.waitForSelector("body[data-game-ready='true']", { timeout: 30_000 });
  await expect(page.locator("canvas")).toBeVisible();

  const state = await page.evaluate(() => window.__glow);
  expect(state?.ready).toBe(true);
  expect(state?.scene).toBe("menu");
  expect(state?.lightsActive).toBe(true);

  // The menu is already play: moving onto the central mote gathers it but
  // does not cross the explicit click/touch/Enter/Space start boundary.
  const box = await page.locator("canvas").boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * (420 / 720));
  await page.waitForFunction(() => (window.__glow?.collected ?? 0) >= 1, undefined, { timeout: 30_000 });
  await page.keyboard.press("ArrowRight");
  expect((await page.evaluate(() => window.__glow))?.scene).toBe("menu");

  await page.screenshot({ path: "test-results/menu.png" });

  // Finish the composed path without crossing the explicit start boundary.
  // Live positions matter because nearby motes visibly magnetize toward the
  // wisp; the test follows that same on-screen information a player sees.
  for (;;) {
    const glow = await page.evaluate(() => window.__glow);
    if ((glow?.remaining ?? 0) === 0) break;
    const next = glow?.motes[0];
    expect(next).toBeDefined();
    const before = glow!.remaining;
    await page.mouse.move(box!.x + (next!.x * box!.width) / 1280, box!.y + (next!.y * box!.height) / 720);
    await page.waitForFunction((remaining) => (window.__glow?.remaining ?? remaining) < remaining, before, { timeout: 10_000 });
  }
  const complete = await page.evaluate(() => window.__glow);
  expect(complete?.scene).toBe("menu");
  expect(complete?.collected).toBe(5);
  expect(complete?.radianceWaves).toBe(1);
  await page.screenshot({ path: "test-results/menu-complete.png" });
  expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual([]);
});

test("the authored threshold keeps immediate keyboard and touch start parity", async ({ browser }) => {
  test.setTimeout(90_000);
  const starts: Array<{ name: string; action: "Enter" | "Space" | "tap"; touch?: boolean }> = [
    { name: "Enter", action: "Enter" },
    { name: "Space", action: "Space" },
    { name: "touch", action: "tap", touch: true },
  ];

  for (const start of starts) {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:4383",
      viewport: { width: 1280, height: 720 },
      hasTouch: Boolean(start.touch),
    });
    const page = await context.newPage();
    const consoleErrors = collectConsoleErrors(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("body[data-game-ready='true']", { timeout: 30_000 });

    if (start.action === "tap") {
      const box = await page.locator("canvas").boundingBox();
      expect(box, `${start.name} canvas bounds`).not.toBeNull();
      await page.touchscreen.tap(box!.x + box!.width * 0.82, box!.y + box!.height * 0.62);
    } else {
      await page.keyboard.press(start.action);
    }

    await page.waitForFunction(() => window.__glow?.scene === "level", undefined, { timeout: 15_000 });
    expect(consoleErrors, `${start.name} console errors: ${consoleErrors.join(" | ")}`).toEqual([]);
    await context.close();
  }
});

test("the round-five shortcut enters the Moonwell without changing the normal start", async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);
  await page.goto("/?level=4", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("body[data-game-ready='true']", { timeout: 30_000 });
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__glow?.scene === "level", undefined, { timeout: 15_000 });

  const state = await page.evaluate(() => window.__glow);
  expect(state?.level).toBe(4);
  expect(state?.echoesRequired).toBe(3);
  expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual([]);
});

test("starting the game loads level 1, and the light-being follows input and collects motes", async ({ page }) => {
  // Headless rendering on this host runs the Light2D level scene at ~5fps
  // (software rasterizer; a real browser with a GPU runs it at full rate),
  // so input processing is frame-bound, not wall-clock-bound. The moves
  // below pace themselves by the page's own frames, and the whole test gets
  // a budget sized for a slow-frame environment instead of a fast one - a
  // 120s budget proved marginal (one pass at 108s, one miss at 120s), so
  // this is deliberately not tight.
  test.setTimeout(180_000);
  const consoleErrors = collectConsoleErrors(page);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("body[data-game-ready='true']", { timeout: 30_000 });

  const canvas = page.locator("canvas");
  let box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  // Any input starts the game from the title screen.
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.waitForFunction(() => window.__glow?.scene === "level", { timeout: 15_000 });

  box = await canvas.boundingBox();
  const { x, y, width, height } = box!;

  // Each step waits two rendered frames, then tops up to 90ms of wall time -
  // on a fast machine this is exactly the old 90ms pacing, on a slow one it
  // waits for the game to actually process the movement.
  const step = async (px: number, py: number): Promise<void> => {
    await page.mouse.move(px, py);
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
    await page.waitForTimeout(90);
  };

  // First pass: the opening curve. Level 1 is hand-authored (see levels.ts)
  // and its first five motes line a broad safe curve from the start point with no
  // hazard anywhere near them - so "the wisp follows input and collects" is
  // provable deterministically here, no hazard-collision luck involved.
  // The camera follows the wisp, so world->screen needs the live scroll
  // offset (estimated from the published wisp position) - a fixed mapping
  // drifts rightward as the camera pans and would steer off the arc.
  const arc: Array<[number, number]> = [
    [250, 460],
    [330, 430],
    [480, 520],
    [630, 420],
    [780, 400],
    [930, 400],
  ];
  for (const [wx, wy] of arc) {
    for (let i = 0; i < 2; i += 1) {
      const glow = await page.evaluate(() => window.__glow);
      const scrollX = Math.min(Math.max((glow?.wispX ?? 0) - 640, 0), 1280);
      const sx = Math.min(Math.max(wx - scrollX, 12), 1268);
      await step(x + (sx * width) / 1280, y + (wy * height) / 720);
    }
  }

  const afterArc = await page.evaluate(() => window.__glow);
  expect(afterArc?.scene).toBe("level");
  expect(afterArc?.level).toBe(1);
  expect(afterArc?.collected, "tracing the opening arc must collect motes").toBeGreaterThan(0);
  expect(afterArc?.glowRadius).toBeGreaterThan(260);
  expect(afterArc?.chain, "the opening must defer the lumen chain until the final clearing").toBe(0);

  // Optional-collection wiring: level 1 opens its beacon at 10 of 14 motes
  // (see levels.ts), and state remains internally consistent after input.
  expect(afterArc?.required).toBe(10);
  expect(afterArc?.beaconOpen).toBe((afterArc?.collected ?? 0) >= 10);
  expect((afterArc?.collected ?? 0) + (afterArc?.remaining ?? 0)).toBe(14);

  await page.screenshot({ path: "test-results/level-1-after-input.png" });
  expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual([]);
});
