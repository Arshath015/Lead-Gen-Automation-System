/**
 * Browser-only regression helper for the Leads Industry filter.
 *
 * Call runIndustryFilterRegression(authenticatedPage, previewOrigin) from a
 * Playwright harness after session-only Quick Dev Login. This deliberately
 * mocks GET /api/leads in the browser; it does not require backend/API restart,
 * credentials, test accounts, or database fixtures. Only GET /api/leads is
 * intercepted; other requests are passed through.
 */
import assert from "node:assert/strict";

const INDUSTRIES = [
  "Fintech", "Manufacturing", "GCC", "BFSI", "Energy", "Startups",
  "Telecommunications", "BPO & BPM", "Healthcare & Wellness",
  "Pharmaceutical", "Others", "IT Services & Consulting", "Engineering",
  "Automotive", "Retail & FMCG", "E-Commerce",
];

const FIXTURE = [
  ["Manufacturing", "Acme Manufacturing"],
  ["Engineering", "Northstar Engineering"],
  ["IT Services & Consulting", "ConsultCo"],
  ["FinTech", "Fintech Labs"],
  ["Engineering", "Legacy Engineering"],
].map(([industry, companyName], index) => ({
  id: 9001 + index,
  companyName,
  contactPerson: "Fixture Contact",
  email: "fixture@example.test",
  phone: "",
  location: "Test City",
  industry,
  stageId: 1,
  stageName: "New Lead",
  stageColor: "#64748b",
  ownerId: null,
  ownerName: null,
  createdAt: "2025-01-15T12:00:00.000Z",
}));

const companyNames = [
  "Acme Manufacturing",
  "Northstar Engineering",
  "ConsultCo",
  "Fintech Labs",
  "Legacy Engineering",
];

export async function runIndustryFilterRegression(page, previewOrigin) {
  const baseURL = previewOrigin ?? new URL(page.url()).origin;
  const requests = [];
  const handler = async route => {
    if (route.request().method() !== "GET") return route.continue();

    const url = new URL(route.request().url());
    const rawIndustry = url.searchParams.get("industry");
    requests.push({ url: url.href, industry: rawIndustry });

    let wanted = null;
    if (rawIndustry !== null) {
      try {
        const parsed = JSON.parse(rawIndustry);
        wanted = Array.isArray(parsed) && parsed.every(value => typeof value === "string")
          ? parsed
          : [rawIndustry];
      } catch {
        wanted = [rawIndustry];
      }
    }

    const leads = wanted === null
      ? FIXTURE
      : FIXTURE.filter(lead =>
          wanted.some(value => lead.industry.toLowerCase() === value.toLowerCase()),
        );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        leads,
        total: leads.length,
        page: Number(url.searchParams.get("page") || 1),
        limit: 20,
      }),
    });
  };

  const rows = async names => {
    await page.waitForFunction(expected =>
      JSON.stringify([...document.querySelectorAll("tbody tr .font-semibold")].map(element =>
        element.textContent.trim())) === JSON.stringify(expected), names);
    if (names.length) {
      await page.getByText(names[0], { exact: true }).waitFor({ state: "visible" });
    } else {
      await page.getByText("No leads found", { exact: true }).waitFor({ state: "visible" });
    }
    assert.deepEqual(
      (await page.locator("tbody tr .font-semibold").allTextContents()).map(text => text.trim()),
      names,
    );
  };
  const industryButton = () => page.getByRole("button", { name: "Industry filter", exact: true });
  const option = name => page.getByRole("checkbox", { name, exact: true });
  const choose = async name => {
    const response = page.waitForResponse(response =>
      new URL(response.url()).pathname === "/api/leads" &&
      response.request().method() === "GET");
    await option(name).click();
    await (await response).finished();
  };

  await page.route("**/api/leads**", handler);
  try {
    await page.goto(new URL("/leads", baseURL).href);
    await page.getByRole("button", { name: "Filter", exact: true }).click();
    await industryButton().click();

    const options = page.getByTestId("industry-filter-options");
    for (const industry of INDUSTRIES) {
      assert.equal(await option(industry).count(), 1, `Expected one ${industry} checkbox`);
    }
    assert.equal(await options.getByRole("checkbox", { name: "Manufacturing", exact: true }).count(), 1);
    assert.equal(await options.getByRole("checkbox").count(), INDUSTRIES.length + 1);
    assert.equal(await option("All Industries").isChecked(), true);

    await choose("Manufacturing");
    assert.equal(requests.at(-1).industry, "Manufacturing", "A single selection stays scalar");
    await rows(["Acme Manufacturing"]);

    const scrollBefore = await page.evaluate(() => {
      const list = document.querySelector('[data-testid="industry-filter-options"]');
      const main = [...document.querySelectorAll("*")].find(element =>
        element !== list &&
        element.className?.toString().includes("flex-1") &&
        getComputedStyle(element).overflowY === "auto" &&
        element.scrollHeight > element.clientHeight,
      );
      return { listTop: list.scrollTop, windowY: scrollY, mainTop: main?.scrollTop ?? 0 };
    });
    const listBox = await options.boundingBox();
    await page.mouse.move(listBox.x + listBox.width / 2, listBox.y + listBox.height / 2);
    await page.mouse.wheel(0, 430);
    await page.waitForFunction(
      () => (document.querySelector('[data-testid="industry-filter-options"]')?.scrollTop ?? 0) > 0,
    );
    const scrollAfter = await page.evaluate(() => {
      const list = document.querySelector('[data-testid="industry-filter-options"]');
      const main = [...document.querySelectorAll("*")].find(element =>
        element !== list &&
        element.className?.toString().includes("flex-1") &&
        getComputedStyle(element).overflowY === "auto" &&
        element.scrollHeight > element.clientHeight,
      );
      return { listTop: list.scrollTop, windowY: scrollY, mainTop: main?.scrollTop ?? 0 };
    });
    assert.ok(scrollAfter.listTop > scrollBefore.listTop, "Wheel scrolls the internal options list");
    assert.equal(scrollAfter.windowY, scrollBefore.windowY, "Wheel does not move the window");
    assert.equal(scrollAfter.mainTop, scrollBefore.mainTop, "Wheel does not move the Leads scroller");

    await choose("Engineering");
    await choose("IT Services & Consulting");
    assert.deepEqual(JSON.parse(requests.at(-1).industry), [
      "Manufacturing", "Engineering", "IT Services & Consulting",
    ]);
    for (const industry of ["Manufacturing", "Engineering", "IT Services & Consulting"]) {
      assert.equal(await option(industry).isChecked(), true);
    }
    await rows([
      "Acme Manufacturing",
      "Northstar Engineering",
      "ConsultCo",
      "Legacy Engineering",
    ]);

    const popup = await page.getByRole("dialog", { name: "Industry options" }).boundingBox();
    const triggerBox = await industryButton().boundingBox();
    await page.mouse.click(
      Math.min(600, (await page.evaluate(() => innerWidth)) - 20),
      Math.max(8, triggerBox.y - 60),
    );
    await industryButton().click();
    for (const industry of ["Manufacturing", "Engineering", "IT Services & Consulting"]) {
      assert.equal(await option(industry).isChecked(), true, `${industry} survives close/reopen`);
    }
    await page.keyboard.press("Escape");
    await industryButton().click();
    await choose("All Industries");
    assert.equal(requests.at(-1).industry, null, "All Industries removes the query field");
    await rows(companyNames);
    await page.keyboard.press("Escape");

    await page.setViewportSize({ width: 820, height: 640 });
    await page.mouse.move(760, 580);
    await page.mouse.wheel(0, 420);
    await page.waitForFunction(() =>
      [...document.querySelectorAll("*")].some(element =>
        element.className?.toString().includes("flex-1") &&
        getComputedStyle(element).overflowY === "auto" &&
        element.scrollTop > 0,
      ),
    );
    const tableBefore = await page.locator("table").boundingBox();
    await industryButton().click();
    const trigger = await industryButton().boundingBox();
    const smallPopup = await page.getByRole("dialog", { name: "Industry options" }).boundingBox();
    const tableAfter = await page.locator("table").boundingBox();
    assert.ok(smallPopup.y >= trigger.y + trigger.height, "Small popup anchors below the trigger");
    assert.ok(smallPopup.y + smallPopup.height <= 640, "Popup fits at the scrolled small viewport");
    assert.equal(tableAfter.y, tableBefore.y, "Opening the popup does not reflow the table");

    await page.goto(new URL("/leads?industry=Telecom", baseURL).href);
    await industryButton().click();
    assert.equal(await option("Telecom").isChecked(), true, "Legacy Telecom remains checked");
    assert.equal(await option("Telecommunications").isChecked(), false);
    assert.equal(await requests.at(-1).industry, "Telecom");

    await page.goto(new URL('/leads?industry=%5B%22manufacturing%22%5D', baseURL).href);
    await rows(["Acme Manufacturing"]);
    assert.deepEqual(JSON.parse(requests.at(-1).industry), ["manufacturing"]);
    return { requests, fixtureCount: FIXTURE.length, standardizedIndustryCount: INDUSTRIES.length };
  } finally {
    await page.unroute("**/api/leads**", handler);
  }
}