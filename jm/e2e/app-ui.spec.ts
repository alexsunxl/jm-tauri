import { expect, test } from "@playwright/test";

import { installTauriMock } from "./support/tauriMock";

test("home latest updates render as cards and open detail", async ({ page }) => {
  await installTauriMock(page, {
    latestItems: [
      { id: "50001", name: "Recent Alpha", author: "Home Author", category: { title: "短篇" } },
      { aid: "50002", title: "Recent Beta", authors: ["Author B"] },
    ],
  });

  await page.goto("/#/home/home");

  await expect(page.getByText("Recent Alpha", { exact: true })).toBeVisible();
  await expect(page.getByText("作者：Home Author", { exact: true })).toBeVisible();
  await expect(page.getByText("AID：50001", { exact: true })).toBeVisible();

  await page.getByText("Recent Alpha", { exact: true }).click();
  await expect(page).toHaveURL(/\/#\/detail\/50001$/);
  await expect(page.getByText("AID 50001", { exact: true })).toBeVisible();
});

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

test("desktop reader shortcuts show menu and navigate back", async ({ page }) => {
  await installTauriMock(page);

  await page.goto("/#/reading/123/456?ct=Desktop%20Reader");

  const menu = page.locator(".fixed.left-0.right-0.bottom-0.z-50");
  await expect(menu).toHaveClass(/opacity-0/);

  await page.keyboard.press("Escape");
  await expect(menu).toHaveClass(/opacity-100/);

  await page.keyboard.press("Backspace");
  await expect(page).toHaveURL(/\/#\/detail\/123$/);

  const cancelCalls = await page.evaluate(() => {
    const calls = (window as any).__mockInvokeCalls as Array<{ cmd: string; args: any }>;
    return calls.filter((x) => x.cmd === "api_read_cancel").length;
  });
  expect(cancelCalls).toBeGreaterThan(0);
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

test("local favorites list clamps long content without horizontal overflow", async ({ page }) => {
  const longTitle =
    "[超長漢化組] アンソロジー 寝取られ報告されながら驚くアンソロジー " +
    "非常に長いタイトル".repeat(12);
  const longAuthor = [
    "218",
    "akagaisahito",
    "akinosora",
    "asukaren",
    "crow",
    "glycogen",
    "hinamori",
    "hiroaki",
    "hizukiakira",
    "kakinonashiko",
    "kamushi",
    "karl",
    "kosyo",
    "kumaashis",
    "kuriharakenshirou",
    "kuronomiki",
    "mutsutake",
    "verylongauthornamewithoutbreakpoints".repeat(8),
  ].join(", ");

  await installTauriMock(page, {
    favorites: [
      {
        aid: "777001",
        title: longTitle,
        author: longAuthor,
        coverUrl: "",
        addedAt: 100,
        updatedAt: 100,
        latestChapterSort: null,
      },
    ],
  });

  await page.goto("/#/home/local_favorites");
  await expect(page.getByText(/AID：777001/)).toBeVisible();

  const overflow = await page.evaluate(() => ({
    html: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow.html).toBeLessThanOrEqual(1);
  expect(overflow.body).toBeLessThanOrEqual(1);
});

test("settings release build auto-checks update and downloads with progress", async ({ page }) => {
  await installTauriMock(page, {
    appVersion: "0.1.25+jm-20260312-000000",
    updateCheckInfo: {
      currentVersion: "0.1.25+jm-20260312-000000",
      currentTag: "jm-20260312-000000",
      latestTag: "jm-20260312-010000",
      hasUpdate: true,
      asset: {
        name: "jm.apk",
        url: "https://example.com/jm.apk",
        size: 123456,
      },
      isDev: false,
      compareMode: "tag",
      releaseUrl: "https://github.com/alexsunxl/jm-tauri/releases/latest",
    },
    updateDownloadPath: "/tmp/jm.apk",
  });

  await page.goto("/#/home/settings");

  await expect(page.getByText(/版本：0\.1\.25\+jm-20260312-000000（release）/)).toBeVisible();
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const calls = (window as any).__mockInvokeCalls as Array<{ cmd: string; args: any }>;
        return calls.filter((x) => x.cmd === "app_update_check").length;
      });
    })
    .toBeGreaterThan(0);

  await page.getByRole("button", { name: "自动更新", exact: true }).click();
  await expect(page.getByText(/正在下载\.\.\./)).toBeVisible();
  await expect(page.getByText(/正在下载\.\.\.\s*\d+%/)).toBeVisible();

  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const calls = (window as any).__mockInvokeCalls as Array<{ cmd: string; args: any }>;
        const downloadCalls = calls.filter((x) => x.cmd === "app_update_download").length;
        const openPathCalls = calls.filter((x) => x.cmd === "plugin:opener|open_path").length;
        return { downloadCalls, openPathCalls };
      });
    })
    .toEqual({ downloadCalls: 1, openPathCalls: 1 });
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

test("local favorites scan can be cancelled mid-run", async ({ page }) => {
  await installTauriMock(page, {
    favorites: [
      {
        aid: "41001",
        title: "Alpha One",
        author: "Author A",
        coverUrl: "",
        addedAt: 100,
        updatedAt: 100,
        latestChapterSort: "12",
      },
      {
        aid: "41002",
        title: "Beta Two",
        author: "Author B",
        coverUrl: "",
        addedAt: 99,
        updatedAt: 99,
        latestChapterSort: "13",
      },
      {
        aid: "41003",
        title: "Gamma Three",
        author: "Author C",
        coverUrl: "",
        addedAt: 98,
        updatedAt: 98,
        latestChapterSort: "14",
      },
    ],
    scanDelayMs: 220,
  });

  await page.goto("/#/home/local_favorites");
  await page.getByRole("button", { name: "多话", exact: true }).click();
  await page.getByRole("button", { name: "扫描多话最新章节", exact: true }).click();

  const scanModal = page.locator(".fixed.inset-0.z-50");
  await expect(scanModal.getByText("扫描中...", { exact: true })).toBeVisible();

  await scanModal.getByRole("button", { name: "取消扫描", exact: true }).click();

  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const calls = (window as any).__mockInvokeCalls as Array<{ cmd: string; args: any }>;
        const cancelCalls = calls.filter((x) => x.cmd === "api_local_favorites_scan_cancel").length;
        return cancelCalls;
      });
    })
    .toBe(1);

  await expect(scanModal.getByText("扫描已取消").first()).toBeVisible();
  await expect(scanModal.getByRole("button", { name: "关闭", exact: true })).toBeVisible();

  await scanModal.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(scanModal).toHaveCount(0);
});
