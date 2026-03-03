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
          return {
            total: favorites.length,
            scanned: favorites.length,
            updated: favorites.filter((it) => Boolean(it.latestChapterSort)).length,
            failed: 0,
            forced: true,
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
        case "api_read_progress_upsert":
        case "api_read_progress_clear":
        case "api_local_favorite_toggle":
        case "plugin:opener|open_url":
        case "plugin:opener|open_path":
        case "plugin:event|unlisten": {
          return null;
        }
        case "plugin:event|listen": {
          return eventListenerId++;
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
