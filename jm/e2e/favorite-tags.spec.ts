import { expect, test } from "@playwright/test";
import { aggregateTags, normalizeTags } from "../src/favorites/tags";
import { installTauriMock } from "./support/tauriMock";

const favorites = [
  { aid: "10001", title: "Alpha", author: "A", coverUrl: "", addedAt: 3, updatedAt: 3 },
  { aid: "10002", title: "Beta", author: "B", coverUrl: "", addedAt: 2, updatedAt: 2 },
  { aid: "10003", title: "Gamma", author: "C", coverUrl: "", addedAt: 1, updatedAt: 1, latestChapterSort: "12" },
];

test("tag aggregation distinguishes unknown from empty and counts each work once", () => {
  expect(normalizeTags(undefined)).toBeNull();
  expect(normalizeTags(["完结", null])).toBeNull();
  expect(normalizeTags([])).toEqual([]);
  expect(normalizeTags([" 完结 ", "完结", ""])).toEqual(["完结"]);
  expect(aggregateTags(favorites, new Map())).toBeNull();
  expect(aggregateTags(favorites, new Map([
    ["10001", ["完结", "完结"]], ["10002", []], ["10003", ["完结"]],
  ]))).toEqual([["完结", 2]]);
});

test("favorites render immediately, then show complete cached tag counts and filter both views", async ({ page }) => {
  await installTauriMock(page, {
    favorites,
    cachedFavoriteTags: { "10001": ["完结", "女性向"] },
    albumTags: { "10002": ["连载"], "10003": [" 完结 ", "完结"] },
    blockedTagAids: ["10002", "10003"],
  });
  await page.goto("/#/home/local_favorites");
  await expect(page.getByText("Alpha", { exact: true })).toBeVisible();
  await expect(page.getByText("Beta", { exact: true })).toBeVisible();
  await expect(page.getByText("Gamma", { exact: true })).toBeVisible();
  const tags = page.getByRole("group", { name: "标签分类" });
  await expect(tags).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__mockActiveTagRequests)).toBe(2);
  await page.getByPlaceholder("过滤：标题/作者/AID").fill("Alpha");
  await expect(page.getByText("Beta", { exact: true })).toHaveCount(0);
  await page.getByPlaceholder("过滤：标题/作者/AID").clear();
  await page.evaluate(() => (window as any).__mockReleaseTagFetch("10002"));
  await expect.poll(() => page.evaluate(() => (window as any).__mockActiveTagRequests)).toBe(1);
  await expect(tags).toHaveCount(0);
  await page.evaluate(() => (window as any).__mockReleaseTagFetch("10003"));
  await expect(tags.getByRole("button", { name: "全部 3", exact: true })).toBeVisible();
  await expect(tags.getByRole("button", { name: "完结 2", exact: true })).toBeVisible();
  await expect(tags.getByRole("button", { name: "连载 1", exact: true })).toBeVisible();
  await expect(tags.getByRole("button", { name: "女性向 1", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__mockPeakTagRequests)).toBe(2);
  const typeBounds = await page.getByRole("button", { name: "单话", exact: true }).boundingBox();
  const tagBounds = await tags.boundingBox();
  expect(tagBounds!.y).toBeGreaterThan(typeBounds!.y + typeBounds!.height);
  const sortBounds = await page.getByRole("button", { name: "最后阅读时间", exact: true }).boundingBox();
  expect(tagBounds!.y + tagBounds!.height).toBeLessThan(sortBounds!.y);

  await tags.getByRole("button", { name: "完结 2", exact: true }).click();
  await expect(page.getByText("Beta", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "卡片", exact: true }).click();
  await expect(page.getByText("Alpha", { exact: true })).toBeVisible();
  await expect(page.getByText("Gamma", { exact: true })).toBeVisible();
  await page.getByPlaceholder("过滤：标题/作者/AID").fill("Beta");
  await expect(tags.getByRole("button", { name: "完结 0", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Beta", { exact: true })).toHaveCount(0);
  await tags.getByRole("button", { name: "清除标签筛选" }).click();
  await expect(page.getByText("Beta", { exact: true })).toBeVisible();
  await page.getByPlaceholder("过滤：标题/作者/AID").clear();
  await page.getByRole("button", { name: "多话", exact: true }).click();
  await expect(tags.getByRole("button", { name: "全部 1", exact: true })).toBeVisible();
  await expect(tags.getByRole("button", { name: "完结 1", exact: true })).toBeVisible();
  await expect(tags.getByRole("button", { name: "女性向 1", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "全选", exact: true }).click();
  await expect(tags.getByRole("button", { name: "全部 3", exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "test-results/local-favorite-tags.png", fullPage: true });
  await page.reload();
  await expect(tags.getByRole("button", { name: "全部 3", exact: true })).toBeVisible();
  expect(await page.evaluate(() =>
    (window as any).__mockInvokeCalls.filter((call: any) => call.cmd === "api_local_favorite_tags").length,
  )).toBe(0);
});

test("missing or failed tag data stays hidden and refresh retries only unknown works", async ({ page }) => {
  await installTauriMock(page, {
    favorites,
    albumTags: { "10001": [], "10002": null, "10003": ["完结"] },
    failedTagAids: ["10003"],
  });
  await page.goto("/#/home/local_favorites");
  await expect.poll(() => page.evaluate(() =>
    (window as any).__mockInvokeCalls.filter((call: any) => call.cmd === "api_local_favorite_tags").length,
  )).toBe(3);
  await expect.poll(() => page.evaluate(() => (window as any).__mockActiveTagRequests)).toBe(0);
  const tags = page.getByRole("group", { name: "标签分类" });
  await expect(tags).toHaveCount(0);
  await expect(page.getByText("Alpha", { exact: true })).toBeVisible();
  await expect(page.getByText("Beta", { exact: true })).toBeVisible();
  await expect(page.getByText("Gamma", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    (window as any).__mockAlbumTags["10002"] = [];
    (window as any).__mockFailedTagAids.clear();
  });
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(tags.getByRole("button", { name: "全部 3", exact: true })).toBeVisible();
  await expect(tags.getByRole("button", { name: "完结 1", exact: true })).toBeVisible();
  expect(await page.evaluate(() =>
    (window as any).__mockInvokeCalls.filter((call: any) => call.cmd === "api_local_favorite_tags" && call.args.aid === "10001").length,
  )).toBe(1);
  await page.getByRole("button", { name: "取消本地", exact: true }).first().click();
  await expect(tags.getByRole("button", { name: "全部 2", exact: true })).toBeVisible();
});

test("leaving favorites stops queued detail requests", async ({ page }) => {
  await installTauriMock(page, {
    favorites: [...favorites, { aid: "10004", title: "Delta", author: "D", coverUrl: "", addedAt: 0, updatedAt: 0 }],
    blockedTagAids: ["10001", "10002"],
  });
  await page.goto("/#/home/local_favorites");
  await expect.poll(() => page.evaluate(() => (window as any).__mockActiveTagRequests)).toBe(2);
  await page.evaluate(() => { location.hash = "/home/home"; });
  await expect(page).toHaveURL(/\/#\/home\/home$/);
  await page.evaluate(() => {
    (window as any).__mockReleaseTagFetch("10001");
    (window as any).__mockReleaseTagFetch("10002");
  });
  await expect.poll(() => page.evaluate(() => (window as any).__mockActiveTagRequests)).toBe(0);
  expect(await page.evaluate(() =>
    (window as any).__mockInvokeCalls.filter((call: any) => call.cmd === "api_local_favorite_tags").length,
  )).toBe(2);
});

test("an incomplete refresh cannot leave an invisible tag filter", async ({ page }) => {
  await installTauriMock(page, {
    favorites,
    cachedFavoriteTags: { "10001": ["完结"], "10002": ["连载"], "10003": ["完结"] },
  });
  await page.goto("/#/home/local_favorites");
  const tags = page.getByRole("group", { name: "标签分类" });
  await tags.getByRole("button", { name: "完结 2", exact: true }).click();
  await expect(page.getByText("Beta", { exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    const internals = (window as any).__TAURI_INTERNALS__;
    const invoke = internals.invoke;
    internals.invoke = async (cmd: string, args: any) => {
      if (cmd === "api_local_favorite_tags") throw new Error("offline");
      const result = await invoke(cmd, args);
      if (cmd === "api_local_favorites_list") {
        result.list = result.list.map((item: any) => ({ ...item, tags: null }));
      }
      return result;
    };
  });
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(tags).toHaveCount(0);
  for (const title of ["Alpha", "Beta", "Gamma"]) {
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  }
});

test("late type-filter responses cannot overwrite the current favorites", async ({ page }) => {
  await installTauriMock(page, {
    favorites,
    cachedFavoriteTags: { "10001": [], "10002": [], "10003": ["完结"] },
  });
  await page.goto("/#/home/local_favorites");
  const tags = page.getByRole("group", { name: "标签分类" });
  await expect(tags.getByRole("button", { name: "全部 3", exact: true })).toBeVisible();
  await page.evaluate(() => {
    const internals = (window as any).__TAURI_INTERNALS__;
    const invoke = internals.invoke;
    let release: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    (window as any).__mockReleaseSingleList = () => release();
    internals.invoke = async (cmd: string, args: any) => {
      if (cmd === "api_local_favorites_list" && args?.kind === "single") await gate;
      return invoke(cmd, args);
    };
  });
  await page.getByRole("button", { name: "单话", exact: true }).click();
  await page.getByRole("button", { name: "多话", exact: true }).click();
  await expect(tags.getByRole("button", { name: "全部 1", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    (window as any).__mockReleaseSingleList();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await expect(tags.getByRole("button", { name: "全部 1", exact: true })).toBeVisible();
  await expect(page.getByText("Gamma", { exact: true })).toBeVisible();
  await expect(page.getByText("Alpha", { exact: true })).toHaveCount(0);
});
