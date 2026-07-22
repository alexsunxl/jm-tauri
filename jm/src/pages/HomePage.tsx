import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";

import type { Session } from "../auth/session";
import { isAuthExpiredError } from "../auth/errors";
import CoverImage from "../components/CoverImage";
import ListViewToggle from "../components/ListViewToggle";
import Loading from "../components/Loading";
import { getImgBase } from "../config/endpoints";

type RawRecord = Record<string, unknown>;

type HomeComicCard = {
  aid: string;
  title: string;
  author: string;
  category: string;
  cover: string;
};

const HOME_LATEST_CACHE_PREFIX = "jm_home_latest_v1";
const HOME_LATEST_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type PersistedLatest = {
  savedAt: number;
  data: unknown;
};

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => toText(item))
      .filter(Boolean)
      .join(", ");
  }
  if (isRecord(value)) {
    return pickText(value, ["name", "title"]);
  }
  return "";
}

function pickText(item: RawRecord, keys: string[]): string {
  for (const key of keys) {
    const text = toText(item[key]);
    if (text) return text;
  }
  return "";
}

function extractList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!isRecord(raw)) return [];

  const keys = ["content", "list", "data", "albums", "items", "results"];
  for (const key of keys) {
    const value = raw[key];
    if (Array.isArray(value)) return value;
  }
  for (const key of keys) {
    const value = raw[key];
    if (isRecord(value)) {
      const nested = extractList(value);
      if (nested.length) return nested;
    }
  }
  return [];
}

function normalizeCover(src: string, aid: string): string {
  const base = getImgBase().replace(/\/$/, "");
  if (src) {
    if (/^https?:\/\//i.test(src)) return src;
    if (src.startsWith("//")) return `https:${src}`;
    if (src.startsWith("/")) return `${base}${src}`;
    if (src.startsWith("media/")) return `${base}/${src}`;
    return src;
  }
  return aid ? `${base}/media/albums/${aid}_3x4.jpg` : "";
}

function normalizeLatestItem(item: RawRecord, idx: number): HomeComicCard {
  const aid = pickText(item, ["id", "aid", "album_id", "albumId", "comic_id", "comicId"]);
  const title =
    pickText(item, ["name", "title", "album_name", "albumName", "album_title", "albumTitle", "comic_name"]) ||
    `最近更新 ${idx + 1}`;
  const author = pickText(item, ["author", "authors", "author_name", "authorName"]);
  const category = pickText(item, ["category", "category_title", "categoryTitle", "category_sub", "tags"]);
  const cover = normalizeCover(
    pickText(item, ["cover", "cover_url", "coverUrl", "image", "image_url", "imageUrl", "thumb", "thumbnail"]),
    aid,
  );
  return { aid, title, author, category, cover };
}

function latestCacheKey(uid: unknown): string {
  return `${HOME_LATEST_CACHE_PREFIX}:${String(uid ?? "unknown")}`;
}

function loadLatestFallback(uid: unknown): unknown | undefined {
  const key = latestCacheKey(uid);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as PersistedLatest;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.savedAt !== "number" ||
      !("data" in parsed) ||
      Date.now() - parsed.savedAt > HOME_LATEST_CACHE_MAX_AGE_MS
    ) {
      localStorage.removeItem(key);
      return undefined;
    }
    return parsed.data;
  } catch {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore unavailable storage
    }
    return undefined;
  }
}

function saveLatestFallback(uid: unknown, data: unknown): void {
  try {
    localStorage.setItem(
      latestCacheKey(uid),
      JSON.stringify({ savedAt: Date.now(), data } satisfies PersistedLatest),
    );
  } catch {
    // ignore unavailable or full storage
  }
}

function HomeLatestSkeleton(props: { viewMode: "list" | "card" }) {
  if (props.viewMode === "list") {
    return (
      <div className="flex flex-col gap-2" role="status" aria-label="最近更新加载中">
        {Array.from({ length: 4 }, (_, idx) => (
          <div
            key={idx}
            className="flex h-[82px] animate-pulse items-center gap-3 rounded-md border border-zinc-200 px-3 py-2"
          >
            <div className="h-16 w-12 flex-none rounded bg-zinc-200" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-2/3 rounded bg-zinc-200" />
              <div className="h-3 w-1/2 rounded bg-zinc-100" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3" role="status" aria-label="最近更新加载中">
      {Array.from({ length: 6 }, (_, idx) => (
        <div key={idx} className="animate-pulse overflow-hidden rounded-md border border-zinc-200">
          <div className="aspect-[3/4] bg-zinc-200" />
          <div className="space-y-2 p-2">
            <div className="h-4 w-4/5 rounded bg-zinc-200" />
            <div className="h-3 w-3/5 rounded bg-zinc-100" />
            <div className="h-3 w-2/5 rounded bg-zinc-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function HomePage(props: {
  session: Session;
  onAuthExpired: () => void;
  onOpenComic: (aid: string) => void;
}) {
  const [promote, setPromote] = useState<unknown[] | null>(null);
  const [promoteError, setPromoteError] = useState<string>("");
  const viewKey = "jm_view_home_latest";
  const [viewMode, setViewMode] = useState<"list" | "card">(() => {
    try {
      const value = localStorage.getItem(viewKey);
      return value === "list" ? "list" : "card";
    } catch {
      return "card";
    }
  });
  const latestFallback = useMemo(
    () => loadLatestFallback(props.session.user.uid),
    [props.session.user.uid],
  );

  useEffect(() => {
    try {
      localStorage.setItem(viewKey, viewMode);
    } catch {
      // ignore
    }
  }, [viewMode, viewKey]);

  const { data: latestRaw, error: latestError } = useSWR(
    ["home-latest", props.session.cookies],
    async ([, cookies]) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<unknown>("api_latest", { page: "0", cookies });
    },
    {
      fallbackData: latestFallback,
      keepPreviousData: true,
      revalidateOnMount: true,
      revalidateOnFocus: false,
      onSuccess: (data) => {
        saveLatestFallback(props.session.user.uid, data);
      },
      onError: (err) => {
        if (isAuthExpiredError(err)) {
          props.onAuthExpired();
        }
      },
    },
  );

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setPromoteError("");
      setPromote(null);
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const promoteRaw = await invoke<unknown>("api_promote", {
          page: "0",
          cookies: props.session.cookies,
        });

        if (cancelled) return;
        if (Array.isArray(promoteRaw)) {
          setPromote(promoteRaw);
        } else if (promoteRaw && typeof promoteRaw === "object") {
          const blocks = Object.values(promoteRaw as Record<string, unknown>);
          setPromote(blocks);
        } else {
          setPromote([]);
        }
      } catch (e) {
        if (cancelled) return;
        if (isAuthExpiredError(e)) {
          props.onAuthExpired();
          return;
        }
        const msg = e instanceof Error ? e.message : String(e);
        setPromoteError(msg);
        setPromote([]);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [props.onAuthExpired, props.session.cookies]);

  const latest = useMemo(
    () => (latestRaw === undefined ? null : extractList(latestRaw).filter(isRecord)),
    [latestRaw],
  );
  const latestCards = useMemo(
    () => (latest ?? []).map((item, idx) => normalizeLatestItem(item, idx)),
    [latest],
  );
  const latestErrorText =
    latestError && !isAuthExpiredError(latestError)
      ? latestError instanceof Error
        ? latestError.message
        : String(latestError)
      : "";

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col justify-center gap-3 md:min-h-0 md:justify-start">
      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2 text-sm font-medium text-zinc-900">
          <div>最近更新</div>
          <ListViewToggle value={viewMode} onChange={setViewMode} />
        </div>
        {latestErrorText && latest === null ? (
          <div className="rounded-md border border-zinc-200 bg-white p-2 text-sm text-red-600">
            最近更新加载失败：{latestErrorText}
          </div>
        ) : latest === null ? (
          <HomeLatestSkeleton viewMode={viewMode} />
        ) : latestCards.length === 0 ? (
          <div className="rounded-md border border-dashed border-zinc-200 p-3 text-center text-sm text-zinc-500">
            暂无更新
          </div>
        ) : (
          <>
            {latestErrorText ? (
              <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">
                最近更新刷新失败，正在显示上次内容：{latestErrorText}
              </div>
            ) : null}
            {viewMode === "card" ? (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                {latestCards.map((item, idx) => (
                  <div
                    key={`${item.aid}-${idx}`}
                    className="flex h-full flex-col overflow-hidden rounded-md border border-zinc-200 bg-white"
                  >
                    <button
                      type="button"
                      className="relative aspect-[3/4] w-full overflow-hidden bg-zinc-100"
                      onClick={() => item.aid && props.onOpenComic(item.aid)}
                      disabled={!item.aid}
                    >
                      <CoverImage src={item.cover} alt={item.title} className="h-full w-full object-cover" />
                    </button>
                    <div className="flex flex-1 flex-col gap-1 p-2">
                      <button
                        type="button"
                        className="line-clamp-2 text-left text-sm font-medium text-zinc-900 hover:underline"
                        onClick={() => item.aid && props.onOpenComic(item.aid)}
                        disabled={!item.aid}
                      >
                        {item.title}
                      </button>
                      <div className="truncate text-xs text-zinc-600">
                        {item.author ? `作者：${item.author}` : "作者：—"}
                      </div>
                      {item.category ? (
                        <div className="truncate text-xs text-zinc-500">分类：{item.category}</div>
                      ) : null}
                      <div className="truncate text-xs text-zinc-500">AID：{item.aid || "—"}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {latestCards.map((item, idx) => (
                  <div
                    key={`${item.aid}-${idx}`}
                    className="flex items-center gap-3 rounded-md border border-zinc-200 bg-white px-3 py-2"
                  >
                    <div className="h-16 w-12 flex-none overflow-hidden rounded bg-zinc-100">
                      <CoverImage src={item.cover} alt={item.title} className="h-full w-full object-cover" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        className="line-clamp-2 w-full text-left text-sm font-medium text-zinc-900 hover:underline"
                        onClick={() => item.aid && props.onOpenComic(item.aid)}
                        disabled={!item.aid}
                      >
                        {item.title}
                      </button>
                      <div className="truncate text-xs text-zinc-600">
                        {item.author ? `作者：${item.author} · ` : ""}
                        {item.category ? `分类：${item.category} · ` : ""}
                        AID：{item.aid || "—"}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="h-8 flex-none rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
                      onClick={() => item.aid && props.onOpenComic(item.aid)}
                      disabled={!item.aid}
                    >
                      详情
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="mb-3 text-sm font-medium text-zinc-900">推荐/推广</div>
        {promoteError ? (
          <div className="rounded-md border border-zinc-200 bg-white p-2 text-sm text-red-600">
            推荐/推广加载失败：{promoteError}
          </div>
        ) : promote === null ? (
          <Loading />
        ) : (
          <div className="text-sm text-zinc-700">共 {promote.length} 个 block（展示原始数据，后续再渲染内容）</div>
        )}
      </div>
    </div>
  );
}
