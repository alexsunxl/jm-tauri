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
};

export async function installTauriMock(page: Page, options: MockOptions = {}) {
  await page.addInitScript((payload: MockOptions) => {
    const favorites = Array.isArray(payload.favorites) ? payload.favorites : [];
    const searchItems = Array.isArray(payload.searchItems) ? payload.searchItems : [];
    const followAids = Array.isArray(payload.followAids) ? payload.followAids : [];
    const readProgress = payload.readProgress ?? {};

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
            await sleep(30);

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
        case "api_read_progress_upsert":
        case "api_read_progress_clear":
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
