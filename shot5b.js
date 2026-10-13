const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 420 } });
  await page.goto("http://localhost:5174/", { waitUntil: "networkidle" });
  await page.getByText("ICP Profiles", { exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /New profile/i }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "icp-modal-veryshort.png" });

  const dialog = page.locator('[role="dialog"]');
  const scrollBody = dialog.locator(".scroll-contain");
  const metrics = await scrollBody.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    canScroll: el.scrollHeight > el.clientHeight,
    overflowY: getComputedStyle(el).overflowY,
  }));
  console.log("modal body metrics @420h:", JSON.stringify(metrics));

  await scrollBody.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await page.waitForTimeout(200);
  await page.screenshot({ path: "icp-modal-veryshort-scrolled.png" });
  const saveBtn = page.getByRole("button", { name: /Create profile|Save/i });
  console.log("save button visible after scroll:", await saveBtn.first().isVisible().catch(() => false));

  await browser.close();
})();
