import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import type { Session } from "../auth/session";
import CoverImage from "../components/CoverImage";
import ListViewToggle from "../components/ListViewToggle";
import Loading from "../components/Loading";
import { useToast } from "../components/Toast";
import { getImgBase } from "../config/endpoints";
import { getReadProgress } from "../reading/progress";

type LocalFavoriteItem = {
  aid: string;
  title: string;
  author: string;
  coverUrl: string;
  addedAt: number;
  updatedAt: number;
  latestChapterSort?: string | null;
};

type FollowStateEntry = {
  aid: string;
  lastKnownChapterId: string;
  lastKnownChapterSort?: string | null;
  updatedAt: number;
};

export default function LocalFavoritesPage(props: {
  session: Session;
  onOpenComic: (aid: string) => void;
  onOpenReader: (
    aid: string,
    chapterId: string,
    chapterTitle: string,
    chapters: Array<{ id: string | number; sort?: string | number; name?: string }>,
    startPage?: number,
  ) => void;
}) {
  const viewKey = "jm_view_local_favorites";
  const [viewMode, setViewMode] = useState<"list" | "card">(() => {
    try {
      const v = localStorage.getItem(viewKey);
      return v === "card" ? "card" : "list";
    } catch {
      return "list";
    }
  });
  const [items, setItems] = useState<LocalFavoriteItem[]>([]);
  const [followSet, setFollowSet] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(false);
  const [openReaderLoading, setOpenReaderLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const { showToast } = useToast();

  const load = async () => {
    setError("");
    setLoading(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const res = await invoke<LocalFavoriteItem[]>("api_local_favorites_list");
      setItems(Array.isArray(res) ? res : []);
      const follow = await invoke<FollowStateEntry[]>("api_follow_state_list");
      const set = new Set(
        Array.isArray(follow) ? follow.map((f) => String(f.aid)) : [],
      );
      setFollowSet(set);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setItems([]);
      setFollowSet(new Set());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(viewKey, viewMode);
    } catch {
      // ignore
    }
  }, [viewMode]);

  const remove = async (aid: string) => {
    setError("");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke<boolean>("api_local_favorite_toggle", {
        aid,
        title: null,
        author: null,
        coverUrl: null,
      });
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    }
  };

  const formatChapterTitle = (c: { id: string | number; sort?: string | number; name?: string }) =>
    `第${c.sort ?? "?"}话${c.name ? `：${c.name}` : ""}`;

  const getReadHint = (
    item: LocalFavoriteItem,
    progress: ReturnType<typeof getReadProgress>,
  ) => {
    const isMulti = Boolean(item.latestChapterSort);
    if (isMulti) {
      if (progress?.chapterSort) {
        return `阅读至：第${progress.chapterSort}话`;
      }
      return progress?.chapterId ? "阅读至：已读章节" : "";
    }
    return progress?.pageIndex ? `阅读至：第${progress.pageIndex}页` : "";
  };

  const openReaderFromAid = async (aid: string, progress: ReturnType<typeof getReadProgress>) => {
    setError("");
    if (openReaderLoading[aid]) return;
    setOpenReaderLoading((prev) => ({ ...prev, [aid]: true }));
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const raw = await invoke<any>("api_album", {
        id: aid,
        cookies: props.session.cookies,
      });
      const series = Array.isArray(raw?.series) ? raw.series : [];
      const chapters =
        series.length > 0
          ? [...series].sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0))
          : [
              {
                id: raw?.id ?? aid,
                sort: 1,
                name: "",
              },
            ];

      const first = chapters[0];
      const target =
        progress?.chapterId != null
          ? chapters.find((c) => String(c.id) === String(progress.chapterId))
          : null;
      const chosen = target ?? first ?? { id: aid, sort: 1, name: "" };
      const chapterId = String(chosen.id ?? aid);
      const chapterTitle = formatChapterTitle(chosen);
      const startPage = target ? progress?.pageIndex ?? 1 : 1;
      props.onOpenReader(aid, chapterId, chapterTitle, chapters, startPage);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      showToast({ ok: false, text: `打开阅读失败：${msg}` });
    } finally {
      setOpenReaderLoading((prev) => ({ ...prev, [aid]: false }));
    }
  };

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    return items.filter((x) => {
      return (
        x.aid.toLowerCase().includes(q) ||
        x.title.toLowerCase().includes(q) ||
        x.author.toLowerCase().includes(q)
      );
    });
  }, [filter, items]);

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-600 shadow-sm">
        收藏(本地) · 共 {items.length} 条
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="mb-3 text-sm font-medium text-zinc-900">列表</div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            className="h-9 flex-1 rounded-md border border-zinc-200 bg-white px-3 text-sm"
            placeholder="过滤：标题/作者/AID"
            value={filter}
            onChange={(e) => setFilter(e.currentTarget.value)}
          />
          <button
            type="button"
            className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-50 disabled:opacity-60"
            onClick={() => void load()}
            disabled={loading}
          >
            刷新
          </button>
          <ListViewToggle value={viewMode} onChange={setViewMode} />
        </div>

        {error ? (
          <div className="mt-3 rounded-md border border-zinc-200 bg-white p-2 text-sm text-red-600">
            {error}
          </div>
        ) : null}

        {loading ? <Loading /> : null}

        {viewMode === "card" ? (
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
            {visible.map((it) => {
              const cover =
                it.coverUrl?.trim() || `${getImgBase()}/media/albums/${it.aid}_3x4.jpg`;
              const progress = it.aid ? getReadProgress(it.aid) : null;
              const readHint = getReadHint(it, progress);
              const isFollowed = followSet.has(it.aid);
              return (
                <div
                  key={it.aid}
                  className="relative flex h-full flex-col overflow-hidden rounded-md border border-zinc-200 bg-white"
                >
                  <button
                    type="button"
                    className="relative aspect-[3/4] w-full overflow-hidden bg-zinc-100"
                    onClick={() => props.onOpenComic(it.aid)}
                  >
                    <CoverImage
                      src={cover}
                      alt={it.title || `AID ${it.aid}`}
                      className="h-full w-full object-cover"
                    />
                  </button>
                  <div className="flex flex-1 flex-col p-2">
                    <button
                      type="button"
                      className="text-left text-sm font-medium text-zinc-900 hover:underline"
                      onClick={() => props.onOpenComic(it.aid)}
                    >
                      <span className="block h-10 line-clamp-2 leading-5">
                        {it.title || `AID ${it.aid}`}
                      </span>
                    </button>
                    <div className="mt-1 flex flex-1 flex-col gap-1">
                      <div className="truncate text-xs text-zinc-600">
                        {it.author ? `作者：${it.author}` : "作者：—"}
                      </div>
                      {isFollowed ? (
                        <div className="absolute right-2 top-2 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm">
                          已追更
                        </div>
                      ) : null}
                      {readHint ? <div className="text-xs text-zinc-500">{readHint}</div> : null}
                      {it.latestChapterSort ? (
                        <div className="text-xs text-zinc-500">
                          最新：第{it.latestChapterSort}话
                        </div>
                      ) : null}
                      <div className="truncate text-xs text-zinc-500">AID：{it.aid}</div>
                      <div className="mt-auto flex items-center gap-2">
                        <button
                          type="button"
                          className="h-7 flex-1 rounded-md border border-zinc-200 bg-white text-xs text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
                          onClick={() => openReaderFromAid(it.aid, progress)}
                          disabled={!!openReaderLoading[it.aid]}
                        >
                          <span className="relative flex items-center justify-center">
                            {openReaderLoading[it.aid] ? (
                              <Loader2 className="absolute left-1 h-3 w-3 animate-spin" />
                            ) : null}
                            {progress?.chapterId ? "继续阅读" : "阅读"}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="h-7 flex-1 rounded-md border border-zinc-200 bg-white text-xs text-red-600 hover:bg-zinc-50"
                          onClick={() => void remove(it.aid)}
                        >
                          取消本地
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {visible.map((it) => {
              const cover =
                it.coverUrl?.trim() || `${getImgBase()}/media/albums/${it.aid}_3x4.jpg`;
              const progress = it.aid ? getReadProgress(it.aid) : null;
              const readHint = getReadHint(it, progress);
              const isFollowed = followSet.has(it.aid);
              return (
                <div
                  key={it.aid}
                  className="relative flex flex-col gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 sm:flex-row sm:items-center sm:gap-3"
                >
                  <div className="flex w-full min-w-0 items-center gap-3 sm:flex-1">
                    <div className="h-16 w-12 flex-none overflow-hidden rounded bg-zinc-100">
                      <CoverImage
                        src={cover}
                        alt={it.title || `AID ${it.aid}`}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        className="line-clamp-2 w-full text-left text-sm font-medium text-zinc-900 hover:underline"
                        onClick={() => props.onOpenComic(it.aid)}
                      >
                        {it.title || `AID ${it.aid}`}
                      </button>
                      {isFollowed ? (
                        <div className="absolute right-2 top-2 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm">
                          已追更
                        </div>
                      ) : null}
                      {readHint ? (
                        <div className="mt-1 text-xs text-zinc-500">{readHint}</div>
                      ) : null}
                      {it.latestChapterSort ? (
                        <div className="mt-1 text-xs text-zinc-500">
                          最新：第{it.latestChapterSort}话
                        </div>
                      ) : null}
                      <div className="truncate text-xs text-zinc-600">
                        {it.author ? `作者：${it.author} · ` : ""}
                        AID：{it.aid}
                      </div>
                    </div>
                  </div>
                  <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                    <button
                      type="button"
                      className="h-8 whitespace-nowrap rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
                      onClick={() => openReaderFromAid(it.aid, progress)}
                      disabled={!!openReaderLoading[it.aid]}
                    >
                      <span className="relative flex items-center justify-center">
                        {openReaderLoading[it.aid] ? (
                          <Loader2 className="absolute left-1 h-3 w-3 animate-spin" />
                        ) : null}
                        {progress?.chapterId ? "继续阅读" : "阅读"}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="h-8 whitespace-nowrap rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-900 hover:bg-zinc-50"
                      onClick={() => props.onOpenComic(it.aid)}
                    >
                      详情
                    </button>
                    <button
                      type="button"
                      className="h-8 whitespace-nowrap rounded-md border border-zinc-200 bg-white px-2 text-sm text-red-600 hover:bg-zinc-50"
                      onClick={() => void remove(it.aid)}
                    >
                      取消本地
                    </button>
                  </div>
                </div>
            );
            })}
          </div>
        )}
        {!visible.length && !loading ? (
          <div className="text-sm text-zinc-600">暂无本地收藏</div>
        ) : null}
      </div>
    </div>
  );
}
