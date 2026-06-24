import type { Page } from "@playwright/test";

type MockFavorite = {
  aid: string;
  title: string;
  author: string;
  coverUrl: string;
  addedAt: number;
  updatedAt: number;
  latestChapterSort?: string | null;
};

type MockSearchItem = {
  id: string;
  name: string;
  author: string;
};

type MockOptions = {
  favorites?: MockFavorite[];
  searchItems?: MockSearchItem[];
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
};

export async function installTauriMock(page: Page, options: MockOptions = {}) {
  await page.addInitScript((payload: MockOptions) => {
    const favorites = Array.isArray(payload.favorites) ? payload.favorites : [];
    const searchItems = Array.isArray(payload.searchItems) ? payload.searchItems : [];
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
    const fallbackCoverDataUrl =
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

    localStorage.setItem("jm_session_v1", JSON.stringify(defaultSession));
    localStorage.setItem("jm_auto_login", "0");
    localStorage.setItem("jm_auto_sign", "0");
    localStorage.setItem("jm_save_password", "0");
    localStorage.setItem("jm_read_progress_v1", JSON.stringify(readProgress));

    let callbackId = 1;
    let eventListenerId = 1;
    const callbacks = new Map<number, (payload: unknown) => void>();
    const eventListeners = new Map<number, { event: string; handler: number }>();
    const cancelledScanIds = new Set<string>();

    (window as any).__mockInvokeCalls = [];
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

    const invoke = async (cmd: string, args?: Record<string, unknown>) => {
      (window as any).__mockInvokeCalls.push({ cmd, args: args ?? {} });
      switch (cmd) {
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
            list,
          };
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
          return {
            id: aid,
            name: `AID ${aid}`,
            author: "mock",
            series: [{ id: aid, sort: 1, name: "第1话" }],
          };
        }
        case "api_chapter": {
          const id = String(args?.id ?? "1");
          return {
            id,
            series_id: id,
            name: "mock chapter",
            series: [{ id, sort: 1, name: "mock chapter" }],
            images: ["00001.jpg"],
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
          return "/tmp/mock-reader-image.jpg";
        }
        case "api_local_favorite_has": {
          return false;
        }
        case "api_read_progress_upsert":
        case "api_read_progress_clear":
        case "api_read_cancel":
        case "api_read_cache_refresh":
        case "api_read_cache_cleanup":
        case "api_config_set_socks_proxy":
        case "api_api_domain_fetch":
        case "api_api_base_select":
        case "api_api_base_latency":
        case "api_read_progress_export":
        case "api_read_progress_import":
        case "api_local_favorite_toggle":
        case "plugin:opener|open_url":
        case "plugin:opener|open_path":
        case "plugin:event|unlisten": {
          const eventId = Number(args?.eventId ?? -1);
          eventListeners.delete(eventId);
          return null;
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
