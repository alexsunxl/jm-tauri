import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Loader2 } from "lucide-react";

import type { Session } from "../auth/session";
import { isAuthExpiredError } from "../auth/errors";
import Button from "../components/Button";
import { useToast } from "../components/Toast";
import { getImgBase } from "../config/endpoints";
import { clearReadProgress, getReadProgress, upsertReadProgress } from "../reading/progress";
import type { ReadProgress } from "../reading/progress";
import Loading from "../components/Loading";

type Album = {
  id: string | number;
  series_id?: string | number;
  name?: string;
  author?: unknown;
  tags?: string[];
  description?: string;
  is_favorite?: boolean;
  likes?: number | string;
  total_views?: number | string;
  comment_total?: number | string;
  images?: unknown[];
  series?: Array<{
    id: string | number;
    sort?: string | number;
    name?: string;
  }>;
};

type ComicExtraEntry = {
  id: string;
  pageCount: number;
  updatedAt: number;
};

function toId(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
}

function toText(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map((x) => toText(x)).filter(Boolean).join(", ");
  return "";
}

function splitAuthors(raw: string): string[] {
  return raw
    .split(/[、,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeAuthorList(v: unknown): string[] {
  if (Array.isArray(v)) {
    const out: string[] = [];
    for (const item of v) {
      const text = toText(item);
      if (!text) continue;
      out.push(...splitAuthors(text));
    }
    return out;
  }
  if (typeof v === "string") return splitAuthors(v);
  if (typeof v === "number") return [String(v)];
  return [];
}

function albumCoverUrl(aid: string) {
  return `${getImgBase()}/media/albums/${aid}_3x4.jpg`;
}

export default function ComicDetailPage(props: {
  session: Session;
  aid: string;
  onBack: () => void;
  onAuthExpired: () => void;
  onOpenSearch: (query: string) => void;
  onOpenReader: (
    chapterId: string,
    chapterTitle: string,
    chapters: Array<{ id: string | number; sort?: string | number; name?: string }>,
    startPage?: number,
  ) => void;
}) {
  const [toggleBusy, setToggleBusy] = useState(false);
  const [localFavBusy, setLocalFavBusy] = useState(false);
  const [isLocalFav, setIsLocalFav] = useState(false);
  const [coverBroken, setCoverBroken] = useState(false);
  const [progress, setProgress] = useState<ReadProgress | null>(() => getReadProgress(props.aid));
  const [comicPageCount, setComicPageCount] = useState<number | null>(null);
  const [comicPageLoading, setComicPageLoading] = useState(false);
  const { showToast } = useToast();

  const {
    data: albumData,
    error: albumError,
    isValidating,
    mutate,
  } = useSWR(
    ["album", props.aid, props.session.cookies],
    async ([, aid, cookies]) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<unknown>("api_album", { id: aid, cookies });
    },
    {
      revalidateOnFocus: false,
      onError: (err) => {
        if (isAuthExpiredError(err)) {
          props.onAuthExpired();
        }
      },
    },
  );
  const album = (albumData as Album) ?? null;

  const rootAid = useMemo(() => {
    const series = Array.isArray(album?.series) ? [...album.series] : [];
    const isMulti = series.length > 1;
    if (isMulti) {
      const seriesId = toId(album?.series_id);
      if (seriesId) return seriesId;
      series.sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0));
      const firstId = toId(series[0]?.id);
      if (firstId) return firstId;
    }
    const albumId = toId(album?.id);
    return albumId || props.aid;
  }, [album?.id, album?.series, album?.series_id, props.aid]);

  const coverUrl = useMemo(() => albumCoverUrl(rootAid), [rootAid]);

  useEffect(() => {
    setCoverBroken(false);
    setProgress(getReadProgress(props.aid));
  }, [props.aid]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const ok = await invoke<boolean>("api_local_favorite_has", { aid: rootAid });
        if (!cancelled) setIsLocalFav(Boolean(ok));
      } catch {
        if (!cancelled) setIsLocalFav(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [rootAid]);

  const title = album?.name ?? `漫画 ${props.aid}`;
  const authorText = useMemo(() => toText(album?.author), [album?.author]);
  const authorList = useMemo(() => normalizeAuthorList(album?.author), [album?.author]);
  const tags = useMemo(() => (Array.isArray(album?.tags) ? album!.tags! : []), [album]);
  const chapters = useMemo(() => {
    const s = Array.isArray(album?.series) ? album!.series! : [];
    const normalized =
      s.length > 0
        ? s
        : album
          ? [
              {
                id: album.id ?? props.aid,
                sort: 1,
                name: "",
              },
            ]
          : [];
    return [...normalized].sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0));
  }, [album, props.aid]);
  const isSingle = Boolean(album) && chapters.length <= 1;
  const singleChapterId = useMemo(() => {
    if (!isSingle) return "";
    return toId(chapters[0]?.id) || rootAid;
  }, [chapters, isSingle, rootAid]);
  const errorText =
    albumError && !isAuthExpiredError(albumError)
      ? albumError instanceof Error
        ? albumError.message
        : String(albumError)
      : "";
  const loading = isValidating && !album;

  useEffect(() => {
    const next: ReadProgress = {
      aid: props.aid,
      updatedAt: Date.now(),
      title: album?.name,
      coverUrl,
      chapterId: progress?.chapterId,
      chapterSort: progress?.chapterSort,
      chapterName: progress?.chapterName,
      pageIndex: progress?.pageIndex,
    };
    try {
      upsertReadProgress(next);
      setProgress(next);
      void (async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("api_read_progress_upsert", { entry: next });
        } catch {
          // ignore
        }
      })();
    } catch {
      // ignore
    }
  }, [album?.name, coverUrl, progress?.chapterId, progress?.chapterName, progress?.chapterSort, props.aid]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!isSingle || !rootAid || !singleChapterId) {
        setComicPageCount(null);
        setComicPageLoading(false);
        return;
      }
      setComicPageLoading(true);
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const cached = await invoke<ComicExtraEntry | null>("api_comic_extra_get", { id: rootAid });
        if (cancelled) return;
        if (cached && typeof cached.pageCount === "number") {
          setComicPageCount(cached.pageCount);
          setComicPageLoading(false);
          return;
        }
        const count = await invoke<number>("api_comic_page_count", {
          id: rootAid,
          chapter_id: singleChapterId,
          cookies: props.session.cookies,
        });
        if (cancelled) return;
        setComicPageCount(Number.isFinite(count) ? count : 0);
      } catch {
        if (!cancelled) setComicPageCount(null);
      } finally {
        if (!cancelled) setComicPageLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [isSingle, props.session.cookies, rootAid, singleChapterId]);

  const jumpToProgress = useCallback(() => {
    if (!progress?.chapterId) return;
    const chapterId = progress.chapterId;
    const chapterTitle = progress.chapterSort
      ? `第${progress.chapterSort}话${progress.chapterName ? `：${progress.chapterName}` : ""}`
      : `第?话${progress.chapterName ? `：${progress.chapterName}` : ""}`;
    props.onOpenReader(chapterId, chapterTitle, chapters, progress.pageIndex);
  }, [
    chapters,
    progress?.chapterId,
    progress?.chapterName,
    progress?.chapterSort,
    progress?.pageIndex,
    props.onOpenReader,
  ]);

  const clearProgress = useCallback(() => {
    try {
      clearReadProgress(props.aid);
      setProgress(null);
      void (async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("api_read_progress_clear", { aid: props.aid });
        } catch {
          // ignore
        }
      })();
      showToast({ ok: true, text: "已清除阅读记录" });
    } catch {
      showToast({ ok: false, text: "清除失败（localStorage不可用）" });
    }
  }, [props.aid, showToast]);

  const toggleFavorite = useCallback(async () => {
    if (!album) return;
    const id = toId(album.id) || props.aid;
    const wasFavorite = Boolean(album.is_favorite);
    setToggleBusy(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("api_favorite_toggle", { aid: id, cookies: props.session.cookies });
      await mutate();
      showToast({
        ok: true,
        text: wasFavorite ? "已取消收藏" : "已添加到收藏",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast({ ok: false, text: `收藏操作失败：${msg}` });
    } finally {
      setToggleBusy(false);
    }
  }, [album, mutate, props.aid, props.session.cookies, showToast]);

  const toggleLocalFavorite = useCallback(async () => {
    setLocalFavBusy(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const nowFav = await invoke<boolean>("api_local_favorite_toggle", {
        aid: rootAid,
        title: album?.name ?? "",
        author: authorText,
        coverUrl,
      });
      setIsLocalFav(Boolean(nowFav));
      showToast({
        ok: true,
        text: nowFav ? "已添加到本地收藏" : "已取消本地收藏",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast({ ok: false, text: `本地收藏失败：${msg}` });
    } finally {
      setLocalFavBusy(false);
    }
  }, [album?.name, authorText, coverUrl, rootAid, showToast]);

  return (
    <div className="min-h-screen bg-zinc-100 p-4 text-zinc-900 sm:p-6">
      <div className="mx-auto flex w-full min-w-0 max-w-[900px] flex-col gap-4">
        <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm">
          <div className="flex max-w-[520px] min-w-0 flex-col">
            <div className="break-words text-base font-semibold text-zinc-900">
              {title}
            </div>
            <div className="break-words text-sm text-zinc-600">
              {authorText ? `作者：${authorText}` : null}
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
              onClick={props.onBack}
            >
              返回
            </button>
            <button
              type="button"
              className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
              disabled={localFavBusy}
              onClick={toggleLocalFavorite}
              title="仅保存到本机，不影响在线收藏"
            >
              {isLocalFav ? "取消本地" : "本地收藏"}
            </button>
            <Button
              className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
              disabled={toggleBusy || !album}
              loading={toggleBusy}
              onClick={toggleFavorite}
            >
              {album?.is_favorite ? "取消收藏" : "收藏"}
            </Button>
          </div>
        </div>

	        {errorText ? (
	          <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm text-red-600 shadow-sm">
	            {errorText}
	          </div>
        ) : null}

        {loading ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-600 shadow-sm">
            <Loading />
          </div>
        ) : null}

        {album ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[320px_1fr]">
            <div className="flex flex-col gap-3">
              <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="mb-3 text-sm font-medium text-zinc-900">封面</div>
                {!coverBroken ? (
                  <img
                    src={coverUrl}
                    alt={title}
                    className="w-full rounded-md border border-zinc-200 bg-zinc-50 object-cover"
                    onError={() => setCoverBroken(true)}
                    loading="lazy"
                  />
                ) : (
                  <div className="flex aspect-[3/4] w-full items-center justify-center rounded-md border border-dashed border-zinc-200 bg-zinc-50 text-sm text-zinc-500">
                    封面加载失败
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-sm font-medium text-zinc-900">阅读记录</div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
                      onClick={jumpToProgress}
                      disabled={!progress?.chapterId}
                    >
                      继续阅读
                    </button>
                    <button
                      type="button"
                      className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-900 hover:bg-zinc-50"
                      onClick={clearProgress}
                    >
                      清除
                    </button>
                  </div>
                </div>
                <div className="space-y-1 text-sm text-zinc-700">
                  <div>
                    最近阅读：{" "}
                    {progress?.updatedAt
                      ? new Date(progress.updatedAt).toLocaleString()
                      : "—"}
                  </div>
                  <div>
                    最近章节：{" "}
                    {progress?.chapterSort
                      ? `第${progress.chapterSort}话${progress.chapterName ? `：${progress.chapterName}` : ""}`
                      : "—"}
                  </div>
                  <div>
                    最近页：{" "}
                    {progress?.pageIndex ? `第${progress.pageIndex}页` : "—"}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="mb-3 text-sm font-medium text-zinc-900">信息</div>
                <div className="space-y-1 text-sm text-zinc-700">
                  <div>AID：{toId(album.id) || props.aid}</div>
                  {isSingle ? (
                    <div className="flex items-center gap-2">
                      <span>漫画页数：</span>
                      {comicPageLoading ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <span>{comicPageCount != null ? comicPageCount : "—"}</span>
                      )}
                    </div>
                  ) : null}
                  <div>点赞：{String(album.likes ?? "—")}</div>
                  <div>浏览：{String(album.total_views ?? "—")}</div>
                  <div>评论：{String(album.comment_total ?? "—")}</div>
                </div>
              </div>

              <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="mb-3 text-sm font-medium text-zinc-900">标签</div>
                <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-zinc-700">
                  <span className="text-zinc-600">标签：</span>
                  {tags.length ? (
                    tags.map((t) => (
                      <button
                        key={t}
                        type="button"
                        className="rounded-full border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
                        onClick={() => props.onOpenSearch(t)}
                      >
                        {t}
                      </button>
                    ))
                  ) : (
                    <span className="text-zinc-500">—</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-700">
                  <span className="text-zinc-600">作者：</span>
                  {authorList.length ? (
                    authorList.map((name) => (
                      <button
                        key={name}
                        type="button"
                        className="rounded-full border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
                        onClick={() => props.onOpenSearch(name)}
                      >
                        {name}
                      </button>
                    ))
                  ) : (
                    <span className="text-zinc-500">—</span>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="mb-3 text-sm font-medium text-zinc-900">简介</div>
              <div className="whitespace-pre-wrap text-sm text-zinc-700">
                {album.description || "—"}
              </div>

              <div className="mt-4 mb-2 text-sm font-medium text-zinc-900">章节</div>
              <div className="flex flex-wrap gap-2">
                {chapters.length ? (
                  chapters.map((c) => (
                    <button
                      key={toId(c.id)}
                      type="button"
                      className="inline-flex items-center rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 hover:bg-zinc-50"
                      onClick={() =>
                        props.onOpenReader(
                          toId(c.id),
                          `第${c.sort ?? "?"}话${c.name ? `：${c.name}` : ""}`,
                          chapters,
                          1,
                        )
                      }
                    >
                      第{c.sort ?? "?"}话{c.name ? `：${c.name}` : ""}
                    </button>
                  ))
                ) : (
                  <div className="text-sm text-zinc-600">暂无章节信息</div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
