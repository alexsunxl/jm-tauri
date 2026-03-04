import { expect, test } from "@playwright/test";

import { installTauriMock } from "./support/tauriMock";

test("search input stays editable during IME composition and returns results", async ({ page }) => {
  await installTauriMock(page, {
    searchItems: [
      { id: "1298961", name: "长十郎大战黑土", author: "臭弟弟" },
      { id: "1246367", name: "黑土本子 重制版", author: "EEGOES" },
    ],
  });

  await page.goto("/#/home/search");

  const input = page.getByPlaceholder("输入关键词 / JM12345");
  await expect(input).toBeVisible();

  await input.click();
  await input.dispatchEvent("compositionstart");
  await input.fill("黑土");
  await expect(input).toHaveValue("黑土");
  await input.dispatchEvent("compositionend", { data: "黑土" });

  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.getByText("长十郎大战黑土")).toBeVisible();
});

test("local favorites filter/sort tabs persist in localStorage", async ({ page }) => {
  await installTauriMock(page, {
    favorites: [
      {
        aid: "10001",
        title: "Alpha",
        author: "A",
        coverUrl: "",
        addedAt: 100,
        updatedAt: 100,
        latestChapterSort: "12",
      },
      {
        aid: "10002",
        title: "Beta",
        author: "B",
        coverUrl: "",
        addedAt: 200,
        updatedAt: 200,
        latestChapterSort: null,
      },
    ],
    readProgress: {
      "10001": { updatedAt: 300, chapterId: "10001", pageIndex: 1 },
      "10002": { updatedAt: 50, chapterId: "10002", pageIndex: 1 },
    },
  });

  await page.goto("/#/home/local_favorites");
  await expect(page.getByRole("button", { name: "多话", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "多话", exact: true }).click();
  await page.getByRole("button", { name: "收藏时间", exact: true }).click();

  await expect(page.getByRole("button", { name: "多话", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "收藏时间", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await expect
    .poll(async () =>
      page.evaluate(() => ({
        typeFilter: localStorage.getItem("jm_type_local_favorites"),
        sortMode: localStorage.getItem("jm_sort_local_favorites"),
      })),
    )
    .toEqual({ typeFilter: "multi", sortMode: "addedAt" });

  await page.reload();

  await expect(page.getByRole("button", { name: "多话", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "收藏时间", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const calls = await page.evaluate(() => (window as any).__mockInvokeCalls as Array<{ cmd: string; args: any }>);
  const calledKinds = calls
    .filter((x) => x.cmd === "api_local_favorites_list")
    .map((x) => x.args?.kind)
    .filter(Boolean);
  expect(calledKinds).toContain("multi");
});

test("local favorites multi tab can trigger latest chapter scan", async ({ page }) => {
  await installTauriMock(page, {
    favorites: [
      {
        aid: "30001",
        title: "Gamma",
        author: "G",
        coverUrl: "",
        addedAt: 100,
        updatedAt: 100,
        latestChapterSort: "33",
      },
      {
        aid: "30002",
        title: "Delta",
        author: "D",
        coverUrl: "",
        addedAt: 90,
        updatedAt: 90,
        latestChapterSort: "40",
      },
    ],
  });

  await page.goto("/#/home/local_favorites");

  await expect(page.getByRole("button", { name: "扫描多话最新章节", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "多话", exact: true }).click();
  const scanBtn = page.getByRole("button", { name: "扫描多话最新章节", exact: true });
  await expect(scanBtn).toBeVisible();

  await scanBtn.click();

  const scanModal = page.locator(".fixed.inset-0.z-50");
  await expect(scanModal.getByText("扫描多话最新章节", { exact: true })).toBeVisible();
  await expect(scanModal.getByText(/进度：/)).toBeVisible();

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const calls = (window as any).__mockInvokeCalls as Array<{ cmd: string; args: any }>;
        const scanCount = calls.filter((x) => x.cmd === "api_local_favorites_scan_latest").length;
        const multiListCount = calls.filter(
          (x) => x.cmd === "api_local_favorites_list" && x.args?.kind === "multi",
        ).length;
        return { scanCount, multiListCount };
      }),
    )
    .toEqual({ scanCount: 1, multiListCount: 2 });

  await expect(scanModal.getByText("Gamma", { exact: true })).toBeVisible();
  await expect(scanModal.getByText("扫描完成，最新第33话")).toBeVisible();
  await expect(scanModal.getByText(/进度：\s*2\/2/)).toBeVisible();
  await scanModal.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(scanModal).toHaveCount(0);
});
