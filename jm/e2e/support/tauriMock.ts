import type { Page } from "@playwright/test";

type MockFavorite = {
  aid: string;
  title: string;
  author: string;
  coverUrl: string;
  addedAt: number;
  updatedAt: number;
  latestChapterSort?: string | null;
  tags?: string[] | null;
};

type MockSearchItem = {
  id: string;
  name: string;
  author: string;
};

type MockHistoryItem = {
  id: string;
  name: string;
  author?: string;
};

type MockLatestItem = Record<string, unknown>;

type MockAlbumChapter = {
  id: string;
  sort?: string | number;
  name?: string;
  images?: string[];
};

type MockOptions = {
  favorites?: MockFavorite[];
  searchItems?: MockSearchItem[];
  latestItems?: MockLatestItem[];
  promoteBlocks?: unknown[];
  albumId?: string;
  albumSeriesId?: string;
  albumSeries?: MockAlbumChapter[];
  chapterImages?: Record<string, string[]>;
  followAids?: string[];
  readProgress?: Record<string, { updatedAt: number; chapterId?: string; pageIndex?: number }>;
  appVersion?: string;
  updateCheckInfo?: {
    currentVersion?: string;
    currentTag?: string | null;
    latestTag?: string | null;
    releaseUrl?: string | null;
    notes?: string | null;
    hasUpdate?: boolean;
    asset?: {
      name: string;
      url: string;
      size: number;
    } | null;
    isDev?: boolean;
    compareMode?: string | null;
  };
  updateDownloadPath?: string;
  scanDelayMs?: number;
  latestDelayMs?: number;
  continuousReading?: boolean;
  blockedReaderChapters?: string[];
  readerImageDelayMs?: number;
  readerNetworkBytesPerSecond?: number;
  albumTags?: Record<string, unknown>;
  cachedFavoriteTags?: Record<string, string[]>;
  blockedTagAids?: string[];
  failedTagAids?: string[];
  noSession?: boolean;
  guest?: boolean;
  historyItems?: MockHistoryItem[];
  historyTotal?: number;
  historyError?: string;
};

export async function installTauriMock(page: Page, options: MockOptions = {}) {
  await page.addInitScript((payload: MockOptions) => {
    const favorites = Array.isArray(payload.favorites) ? payload.favorites : [];
    const searchItems = Array.isArray(payload.searchItems) ? payload.searchItems : [];
    const latestItems = Array.isArray(payload.latestItems) ? payload.latestItems : [];
    const promoteBlocks = Array.isArray(payload.promoteBlocks) ? payload.promoteBlocks : [];
    const albumSeries = Array.isArray(payload.albumSeries) ? payload.albumSeries : [];
    const chapterImages = payload.chapterImages ?? {};
    const followAids = Array.isArray(payload.followAids) ? payload.followAids : [];
    const readProgress = payload.readProgress ?? {};
    const appVersion =
      typeof payload.appVersion === "string" && payload.appVersion.trim()
        ? payload.appVersion.trim()
        : "0.1.25+dev";
    const scanDelayMs =
      typeof payload.scanDelayMs === "number" && Number.isFinite(payload.scanDelayMs)
        ? Math.max(0, payload.scanDelayMs)
        : 30;
    const latestDelayMs =
      typeof payload.latestDelayMs === "number" && Number.isFinite(payload.latestDelayMs)
        ? Math.max(0, payload.latestDelayMs)
        : 0;
    const updateDownloadPath =
      typeof payload.updateDownloadPath === "string" && payload.updateDownloadPath.trim()
        ? payload.updateDownloadPath.trim()
        : "/tmp/mock-update.bin";

    const defaultSession = {
      user: {
        uid: "10001",
        username: "e2e-user",
        level_name: "LV1",
        level: 1,
        coin: 100,
        favorites: 0,
        can_favorites: 0,
      },
      cookies: {
        AVS: "e2e",
      },
      savedAt: Date.now(),
    };
    const guestSession = {
      user: {
        uid: "guest",
        username: "游客",
        level_name: "",
        level: 0,
        coin: 0,
        favorites: 0,
        can_favorites: 0,
      },
      cookies: {},
      savedAt: Date.now(),
    };
    const historyItems = Array.isArray(payload.historyItems) ? payload.historyItems : [];
    const historyTotal =
      typeof payload.historyTotal === "number" ? payload.historyTotal : historyItems.length;
    const historyError = typeof payload.historyError === "string" ? payload.historyError : "";
    const fallbackCoverDataUrl =
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

    if (payload.guest) {
      localStorage.setItem("jm_session_v1", JSON.stringify(guestSession));
    } else if (!payload.noSession) {
      localStorage.setItem("jm_session_v1", JSON.stringify(defaultSession));
    }
    localStorage.setItem("jm_auto_login", "0");
    localStorage.setItem("jm_auto_sign", "0");
    localStorage.setItem("jm_save_password", "0");
    localStorage.setItem("jm_read_progress_v1", JSON.stringify(readProgress));
    localStorage.setItem("jm_continuous_reading", payload.continuousReading ? "1" : "0");

    let callbackId = 1;
    let eventListenerId = 1;
    const callbacks = new Map<number, (payload: unknown) => void>();
    const eventListeners = new Map<number, { event: string; handler: number }>();
    const cancelledScanIds = new Set<string>();

    (window as any).__mockInvokeCalls = [];
    const tagCache: Record<string, string[]> = {
      ...(payload.cachedFavoriteTags ?? {}),
      ...JSON.parse(localStorage.getItem("jm_mock_favorite_tags") ?? "{}"),
    };
    (window as any).__mockActiveTagRequests = 0;
    (window as any).__mockPeakTagRequests = 0;
    (window as any).__mockFailedTagAids = new Set(payload.failedTagAids ?? []);
    (window as any).__mockAlbumTags = { ...(payload.albumTags ?? {}) };
    const tagReleases = new Map<string, () => void>();
    const tagGates = new Map((payload.blockedTagAids ?? []).map((id) => [
      id, new Promise<void>((resolve) => tagReleases.set(id, resolve)),
    ]));
    (window as any).__mockReleaseTagFetch = (id: string) => tagReleases.get(id)?.();
    (window as any).__mockActiveReaderRequests = 0;
    (window as any).__mockPeakReaderRequests = 0;
    (window as any).__mockReaderBytesPerSecond = payload.readerNetworkBytesPerSecond ?? 0;
    const readerImageReleases = new Map<string, () => void>();
    const readerImageGates = new Map(
      (payload.blockedReaderChapters ?? []).map((id) => [
        id,
        new Promise<void>((resolve) => readerImageReleases.set(id, resolve)),
      ]),
    );
    (window as any).__mockReleaseChapterImages = (id: string) => readerImageReleases.get(id)?.();
    (window as any).isTauri = true;

    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => {
        // no-op for test mock
      },
    };

    const filterFavorites = (kind?: string) => {
      if (kind === "single") {
        return favorites.filter((it) => !it.latestChapterSort);
      }
      if (kind === "multi") {
        return favorites.filter((it) => Boolean(it.latestChapterSort));
      }
      return favorites;
    };

    const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

    const defaultUpdateCheckInfo = {
      currentVersion: appVersion,
      currentTag: null,
      latestTag: null,
      releaseUrl: "https://github.com/alexsunxl/jm-tauri/releases/latest",
      notes: null,
      hasUpdate: false,
      asset: null,
      isDev: !appVersion.includes("+jm-"),
      compareMode: "tag",
    };

    const updateCheckInfo = {
      ...defaultUpdateCheckInfo,
      ...(payload.updateCheckInfo ?? {}),
    };

    const emitEvent = (event: string, payload: unknown) => {
      for (const [id, listener] of eventListeners.entries()) {
        if (listener.event !== event) continue;
        const cb = callbacks.get(listener.handler);
        if (!cb) continue;
        cb({
          event,
          id,
          payload,
        });
      }
    };

    const invoke = async (cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
      (window as any).__mockInvokeCalls.push({ cmd, args: args ?? {} });
      switch (cmd) {
        case "login": {
          const username = typeof args?.username === "string" ? args.username.trim() : "";
          const password = typeof args?.password === "string" ? args.password : "";
          if (!username || !password) {
            throw new Error("请输入用户名和密码");
          }
          return { user: { ...defaultSession.user }, cookies: { AVS: "e2e" } };
        }
        case "api_history": {
          if (historyError) throw new Error(historyError);
          return { list: historyItems, total: historyTotal };
        }
        case "api_latest": {
          if (latestDelayMs) await sleep(latestDelayMs);
          return {
            total: latestItems.length,
            content: latestItems,
          };
        }
        case "api_promote": {
          return promoteBlocks;
        }
        case "api_search": {
          return {
            total: searchItems.length,
            content: searchItems,
          };
        }
        case "api_cover_cache": {
          return "/tmp/mock-cover.jpg";
        }
        case "api_local_favorites_list": {
          const kind = typeof args?.kind === "string" ? args.kind : "all";
          const list = filterFavorites(kind);
          return {
            total: favorites.length,
            filtered: list.length,
            list: list.map((item) => ({ ...item, tags: tagCache[item.aid] ?? item.tags ?? null })),
          };
        }
        case "api_local_favorite_tags": {
          const aid = String(args?.aid);
          if (tagCache[aid]) return tagCache[aid];
          (window as any).__mockActiveTagRequests += 1;
          (window as any).__mockPeakTagRequests = Math.max(
            (window as any).__mockPeakTagRequests, (window as any).__mockActiveTagRequests,
          );
          try {
            await tagGates.get(aid);
            if ((window as any).__mockFailedTagAids.has(aid)) throw new Error("tag fetch failed");
            const album = await invoke("api_album", { id: aid, cookies: args?.cookies });
            const tags = (album as any)?.tags;
            if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === "string")) {
              throw new Error("详情未提供完整标签数据");
            }
            tagCache[aid] = [...new Set(tags.map((tag: string) => tag.trim()).filter(Boolean))];
            localStorage.setItem("jm_mock_favorite_tags", JSON.stringify(tagCache));
            return tagCache[aid];
          } finally {
            (window as any).__mockActiveTagRequests -= 1;
          }
        }
        case "api_local_favorites_scan_latest": {
          const kind = typeof args?.kind === "string" ? args.kind : "all";
          const scanId = typeof args?.scanId === "string" ? args.scanId : "scan-e2e";
          const target = filterFavorites(kind);
          const total = target.length;
          let scanned = 0;
          let updated = 0;
          let failed = 0;

          for (const item of target) {
            if (cancelledScanIds.has(scanId)) {
              emitEvent("local-favorites-scan-progress", {
                scanId,
                aid: "",
                title: "扫描已取消",
                status: "cancelled",
                total,
                scanned,
                updated,
                failed,
              });
              return {
                total,
                scanned,
                updated,
                failed,
                forced: true,
                cancelled: true,
              };
            }

            emitEvent("local-favorites-scan-progress", {
              scanId,
              aid: item.aid,
              title: item.title,
              status: "scanning",
              total,
              scanned,
              updated,
              failed,
              latestChapterSort: null,
            });
            await sleep(scanDelayMs);

            scanned += 1;
            if (item.latestChapterSort) {
              updated += 1;
            }
            emitEvent("local-favorites-scan-progress", {
              scanId,
              aid: item.aid,
              title: item.title,
              status: item.latestChapterSort ? "updated" : "noUpdate",
              total,
              scanned,
              updated,
              failed,
              latestChapterSort: item.latestChapterSort ?? null,
            });
          }

          return {
            total,
            scanned,
            updated,
            failed,
            forced: true,
            cancelled: false,
          };
        }
        case "api_local_favorites_scan_cancel": {
          const scanId = typeof args?.scanId === "string" ? args.scanId : "";
          if (scanId) cancelledScanIds.add(scanId);
          return null;
        }
        case "app_update_check": {
          return updateCheckInfo;
        }
        case "app_update_download": {
          const url = typeof args?.url === "string" ? args.url : "";
          const name = typeof args?.name === "string" ? args.name : "update.bin";
          const steps = [8, 37, 76, 100];
          for (const percent of steps) {
            emitEvent("app-update-download-progress", {
              url,
              downloadedBytes: percent,
              totalBytes: 100,
              percent,
            });
            await sleep(70);
          }
          return { path: updateDownloadPath, name };
        }
        case "plugin:app|version": {
          return appVersion;
        }
        case "api_config_get": {
          return { socksProxy: null };
        }
        case "api_api_base_current": {
          return "https://a.example.com";
        }
        case "api_api_base_list": {
          return ["https://a.example.com", "https://b.example.com"];
        }
        case "api_read_cache_stats": {
          return {
            totalBytes: 1024,
            totalFiles: 2,
            totalComics: 1,
            updatedAt: Date.now(),
          };
        }
        case "api_follow_state_list": {
          return followAids.map((aid) => ({
            aid,
            lastKnownChapterId: "1",
            lastKnownChapterSort: "1",
            updatedAt: Date.now(),
          }));
        }
        case "api_album": {
          const aid = String(args?.id ?? "0");
          const albumId = typeof payload.albumId === "string" ? payload.albumId : aid;
          const seriesId = typeof payload.albumSeriesId === "string" ? payload.albumSeriesId : albumId;
          const series = albumSeries.length
            ? albumSeries.map((chapter) => ({
                id: chapter.id,
                sort: chapter.sort,
                name: chapter.name,
              }))
            : [{ id: aid, sort: 1, name: "第1话" }];
          return {
            id: albumId,
            series_id: seriesId,
            name: `AID ${albumId}`,
            author: "mock",
            tags: Object.prototype.hasOwnProperty.call((window as any).__mockAlbumTags, aid)
              ? (window as any).__mockAlbumTags[aid] : [],
            series,
          };
        }
        case "api_chapter": {
          const id = String(args?.id ?? "1");
          const configured = albumSeries.find((chapter) => chapter.id === id);
          const images = Array.isArray(chapterImages[id])
            ? chapterImages[id]
            : Array.isArray(configured?.images)
              ? configured.images
              : ["00001.jpg"];
          return {
            id,
            series_id: id,
            name: configured?.name ?? "mock chapter",
            series: [{ id, sort: 1, name: "mock chapter" }],
            images,
          };
        }
        case "api_chapter_scramble_id": {
          return 220980;
        }
        case "api_segmentation_nums": {
          const pictureNames = Array.isArray(args?.pictureNames) ? args.pictureNames : [];
          return pictureNames.map(() => 0);
        }
        case "api_image_descramble_file": {
          const chapterId = String(args?.url ?? "").match(/\/photos\/(\d+)\//)?.[1];
          if (chapterId) await readerImageGates.get(chapterId);
          (window as any).__mockActiveReaderRequests += 1;
          (window as any).__mockPeakReaderRequests = Math.max(
            (window as any).__mockPeakReaderRequests, (window as any).__mockActiveReaderRequests,
          );
          const network = args?.onNetworkProgress;
          let timer: number | undefined;
          if (payload.readerNetworkBytesPerSecond != null) {
            network?.onmessage({ phase: "start", bytes: 0 });
            timer = window.setInterval(() => network?.onmessage({
              phase: "progress", bytes: (window as any).__mockReaderBytesPerSecond / 4,
            }), 250);
          }
          try {
            if (payload.readerImageDelayMs) await sleep(payload.readerImageDelayMs);
            return "/tmp/mock-reader-image.jpg";
          } finally {
            window.clearInterval(timer);
            if (timer != null) network?.onmessage({ phase: "end", bytes: 0 });
            (window as any).__mockActiveReaderRequests -= 1;
          }
        }
        case "api_local_favorite_has": {
          return false;
        }
        case "api_read_progress_list": {
          return Object.entries(readProgress).map(([aid, value]) => ({
            aid,
            updatedAt: value.updatedAt ?? 0,
            chapterId: value.chapterId,
            pageIndex: value.pageIndex,
          }));
        }
        case "api_read_progress_upsert":
        case "api_read_progress_clear":
        case "api_read_cancel":
        case "api_session_clear":
        case "api_read_cache_refresh":
        case "api_read_cache_cleanup":
        case "api_config_set_socks_proxy":
        case "api_api_domain_fetch":
        case "api_api_base_select":
        case "api_api_base_latency":
        case "api_read_progress_export":
        case "api_read_progress_import":
        case "plugin:opener|open_url":
        case "plugin:opener|open_path":
        case "plugin:event|unlisten": {
          const eventId = Number(args?.eventId ?? -1);
          eventListeners.delete(eventId);
          return null;
        }
        case "api_local_favorite_toggle": {
          const aid = String(args?.aid);
          const index = favorites.findIndex((item) => item.aid === aid);
          if (index >= 0) {
            favorites.splice(index, 1);
            return false;
          }
          favorites.push({ aid, title: String(args?.title ?? ""), author: "", coverUrl: "", addedAt: Date.now(), updatedAt: Date.now() });
          return true;
        }
        case "plugin:event|listen": {
          const event = String(args?.event ?? "");
          const handler = Number(args?.handler ?? -1);
          const id = eventListenerId++;
          eventListeners.set(id, { event, handler });
          return id;
        }
        default:
          throw new Error(`Unmocked invoke command: ${cmd}`);
      }
    };

    (window as any).__TAURI_INTERNALS__ = {
      invoke,
      transformCallback: (cb: (payload: unknown) => void) => {
        const id = callbackId++;
        callbacks.set(id, cb);
        return id;
      },
      unregisterCallback: (id: number) => {
        callbacks.delete(id);
      },
      convertFileSrc: () => fallbackCoverDataUrl,
    };
  }, options);
}
