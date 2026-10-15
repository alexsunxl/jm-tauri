import { expect, test } from "@playwright/test";
import { ReaderLoadGovernor } from "../src/reading/loadGovernor";
import { installTauriMock } from "./support/tauriMock";

function transferWindow(governor: ReaderLoadGovernor, start: number, bytesPerSecond: number) {
  for (let elapsed = 250; elapsed <= 5_000; elapsed += 250) {
    governor.report("image", { phase: "progress", bytes: bytesPerSecond / 4 }, start + elapsed);
  }
}

function startTransfer(governor: ReaderLoadGovernor, at = 0) {
  expect(governor.tryAcquire("image", true, 4)).toBe(true);
  governor.report("image", { phase: "start", bytes: 0 }, at);
}

test("loading uses two speed thresholds and a fresh window before recovering", () => {
  const governor = new ReaderLoadGovernor();
  startTransfer(governor);
  transferWindow(governor, 0, 64 * 1024);
  expect(governor.isParallel).toBe(false);
  transferWindow(governor, 5_000, 256 * 1024);
  expect(governor.isParallel).toBe(false);
  transferWindow(governor, 10_000, 512 * 1024);
  expect(governor.isParallel).toBe(true);
  transferWindow(governor, 15_000, 256 * 1024);
  expect(governor.isParallel).toBe(true);
  transferWindow(governor, 20_000, 64 * 1024);
  expect(governor.isParallel).toBe(false);
  governor.report("image", { phase: "progress", bytes: 8 * 1024 * 1024 }, 25_250);
  governor.tick(25_500);
  expect(governor.isParallel).toBe(false);
  governor.tick(30_000);
  expect(governor.isParallel).toBe(true);
});

test("a stalled request falls back without waiting for its completion", () => {
  const governor = new ReaderLoadGovernor();
  startTransfer(governor);
  transferWindow(governor, 0, 512 * 1024);
  expect(governor.isParallel).toBe(true);
  governor.tick(10_000);
  expect(governor.isParallel).toBe(false);
});

test("cached results and idle or CPU time do not count as network bandwidth", () => {
  const governor = new ReaderLoadGovernor();
  for (let index = 0; index < 100; index++) {
    expect(governor.tryAcquire(`cached-${index}`, true, 4)).toBe(true);
    governor.release(`cached-${index}`, index * 100);
  }
  expect(governor.isParallel).toBe(false);
  startTransfer(governor, 10_000);
  transferWindow(governor, 10_000, 512 * 1024);
  governor.report("image", { phase: "end", bytes: 0 }, 15_000);
  governor.tick(60_000);
  expect(governor.isParallel).toBe(true);
  governor.release("image", 60_000);
  startTransfer(governor, 60_000);
  governor.tick(65_000);
  expect(governor.isParallel).toBe(false);
});

test("an expired fast estimate cannot start a new parallel burst", () => {
  const governor = new ReaderLoadGovernor();
  startTransfer(governor);
  transferWindow(governor, 0, 512 * 1024);
  governor.release("image", 5_000);
  expect(governor.isParallel).toBe(true);
  expect(governor.tryAcquire("new-image", true, 4, 60_000)).toBe(true);
  expect(governor.isParallel).toBe(false);
  expect(governor.tryAcquire("second", true, 4, 60_000)).toBe(false);
});

test("cancellation releases the shared slot and late telemetry cannot change the new transfer", () => {
  const governor = new ReaderLoadGovernor();
  startTransfer(governor);
  governor.release("image", 100);
  expect(governor.tryAcquire("next-chapter", true, 4, 100)).toBe(true);
  governor.report("next-chapter", { phase: "start", bytes: 0 }, 100);
  governor.report("image", { phase: "progress", bytes: 100 * 1024 * 1024 }, 5_100);
  governor.tick(5_100);
  expect(governor.isParallel).toBe(false);
  expect(governor.tryAcquire("second", true, 4, 5_100)).toBe(false);
});

test("all chapters share the limit and serial loading gives foreground work priority", () => {
  const governor = new ReaderLoadGovernor();
  governor.setDemand("current", true, true);
  expect(governor.tryAcquire("prefetch", false, 4)).toBe(false);
  startTransfer(governor);
  expect(governor.tryAcquire("other-chapter", true, 4)).toBe(false);
  transferWindow(governor, 0, 512 * 1024);
  expect(governor.tryAcquire("second", true, 4)).toBe(true);
  expect(governor.tryAcquire("second", true, 4)).toBe(false);
  expect(governor.tryAcquire("third", false, 4)).toBe(true);
  expect(governor.tryAcquire("fourth", false, 4)).toBe(true);
  expect(governor.tryAcquire("fifth", true, 4)).toBe(false);
  governor.tick(10_000);
  governor.release("second", 10_000);
  governor.release("third", 10_000);
  governor.release("fourth", 10_000);
  expect(governor.tryAcquire("next", true, 4)).toBe(false);
  governor.release("image", 10_000);
  expect(governor.tryAcquire("prefetch", false, 4)).toBe(false);
  governor.removeDemand("current");
  expect(governor.tryAcquire("prefetch", false, 4)).toBe(true);
});

test("reader stays serial on a slow connection and ramps up only after recovery", async ({ page }) => {
  await installTauriMock(page, {
    continuousReading: true,
    readerImageDelayMs: 1_000,
    readerNetworkBytesPerSecond: 64 * 1024,
    albumSeries: [
      { id: "11", sort: 1, name: "One", images: Array.from({ length: 100 }, (_, i) => `${i + 1}.jpg`) },
      { id: "22", sort: 2, name: "Two" },
    ],
  });
  await page.goto("/#/detail/123");
  await page.clock.install();
  await page.getByRole("button", { name: "第1话：One", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__mockActiveReaderRequests)).toBe(1);
  await page.clock.runFor(7_000);
  expect(await page.evaluate(() => (window as any).__mockPeakReaderRequests)).toBe(1);
  await expect(page.locator('[data-reading-chapter="22"]')).toHaveCount(1);

  await page.evaluate(() => { (window as any).__mockReaderBytesPerSecond = 768 * 1024; });
  await page.clock.runFor(7_000);
  expect(await page.evaluate(() => (window as any).__mockPeakReaderRequests)).toBeGreaterThan(1);
  expect(await page.evaluate(() => (window as any).__mockPeakReaderRequests)).toBeLessThanOrEqual(4);

  await page.evaluate(() => { (window as any).__mockReaderBytesPerSecond = 8 * 1024; });
  await page.clock.runFor(8_000);
  expect(await page.evaluate(() => (window as any).__mockActiveReaderRequests)).toBeLessThanOrEqual(1);
  await page.evaluate(() => {
    (window as any).__mockPeakReaderRequests = (window as any).__mockActiveReaderRequests;
    (window as any).__mockReaderBytesPerSecond = 256 * 1024;
  });
  await page.clock.runFor(5_000);
  expect(await page.evaluate(() => (window as any).__mockPeakReaderRequests)).toBe(1);
});
