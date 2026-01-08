import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";

import type { Session } from "../auth/session";
import { isAuthExpiredError } from "../auth/errors";
import CoverImage from "../components/CoverImage";
import Button from "../components/Button";
import ListViewToggle from "../components/ListViewToggle";
import Loading from "../components/Loading";
import { useToast } from "../components/Toast";
import { getImgBase } from "../config/endpoints";
import { getReadProgress } from "../reading/progress";

export default function FavoritesPage(props: {
  session: Session;
  onAuthExpired: () => void;
  onOpenComic: (aid: string) => void;
  onOpenReader: (
    aid: string,
    chapterId: string,
    chapterTitle: string,
    chapters: Array<{ id: string | number; sort?: string | number; name?: string }>,
    startPage?: number,
  ) => void;
}) {
  const viewKey = "jm_view_favorites";
  const [viewMode, setViewMode] = useState<"list" | "card">(() => {
    try {
      const v = localStorage.getItem(viewKey);
      return v === "card" ? "card" : "list";
    } catch {
      return "list";
    }
  });
  const [favoritePage, setFavoritePage] = useState(1);
  const [favoriteSort, setFavoriteSort] = useState<"mr" | "mp">("mr");
  const [favoriteFolderId, setFavoriteFolderId] = useState("0");
  const [actionError, setActionError] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [toggleLoadingMap, setToggleLoadingMap] = useState<Record<string, boolean>>({});
  const { showToast } = useToast();

  useEffect(() => {
    try {
      localStorage.setItem(viewKey, viewMode);
    } catch {
      // ignore
    }
  }, [viewMode, viewKey]);

  const {
    data: favoriteData,
    error: favoriteError,
    isValidating,
    mutate,
  } = useSWR(
    ["favorites", favoritePage, favoriteSort, favoriteFolderId, props.session.cookies],
    async ([, page, sort, folderId, cookies]) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<any>("api_favorites", {
        page: String(page),
        sort,
        folderId,
        cookies,
      });
    },
    {
      keepPreviousData: true,
      revalidateOnFocus: false,
      onError: (err) => {
        if (isAuthExpiredError(err)) {
          props.onAuthExpired();
        }
      },
    },
  );

  const favoriteErrorText =
    favoriteError && !isAuthExpiredError(favoriteError)
      ? favoriteError instanceof Error
        ? favoriteError.message
        : String(favoriteError)
      : "";
  const favoriteLoading = isValidating && !favoriteData;

  const toggleFavorite = async (aid: string) => {
    if (!aid) return;
    setToggleLoadingMap((prev) => ({ ...prev, [aid]: true }));
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("api_favorite_toggle", { aid, cookies: props.session.cookies });
      await mutate();
      showToast({ ok: true, text: "已取消收藏" });
    } catch (e) {
      if (isAuthExpiredError(e)) {
        props.onAuthExpired();
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      showToast({ ok: false, text: `取消收藏失败：${msg}` });
    } finally {
      setToggleLoadingMap((prev) => ({ ...prev, [aid]: false }));
    }
  };

  const formatChapterTitle = (c: { id: string | number; sort?: string | number; name?: string }) =>
    `第${c.sort ?? "?"}话${c.name ? `：${c.name}` : ""}`;

  const openReaderFromAid = async (aid: string, progress: ReturnType<typeof getReadProgress>) => {
    setActionError("");
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
      setActionError(msg);
    }
  };

  const addFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    setActionError("");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("api_favorite_folder_add", { name, cookies: props.session.cookies });
      setNewFolderName("");
      await mutate();
    } catch (e) {
      if (isAuthExpiredError(e)) {
        props.onAuthExpired();
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      setActionError(msg);
    }
  };

  const delFolder = async (folderId: string) => {
    if (!folderId || folderId === "0") return;
    setActionError("");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("api_favorite_folder_del", {
        folderId,
        cookies: props.session.cookies,
      });
      setFavoriteFolderId("0");
      await mutate();
    } catch (e) {
      if (isAuthExpiredError(e)) {
        props.onAuthExpired();
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      setActionError(msg);
    }
  };

  const favoriteFolders: Array<{ name: string; id: string }> = [];
  try {
    const folderList = favoriteData?.folder_list;
    if (Array.isArray(folderList)) {
      for (const f of folderList) {
        const name = typeof f?.name === "string" ? f.name : "";
        const id = typeof f?.FID === "string" || typeof f?.FID === "number" ? String(f.FID) : "";
        if (name && id) favoriteFolders.push({ name, id });
      }
    }
  } catch {
    // ignore
  }

  const favoriteList: any[] = Array.isArray(favoriteData?.list) ? favoriteData.list : [];
  const header = useMemo(() => {
    if (!favoriteData) return "";
    try {
      const total = favoriteData?.total;
      if (total != null) return `第 ${favoritePage} 页 · 共 ${String(total)} 条`;
    } catch {
      // ignore
    }
    return `第 ${favoritePage} 页`;
  }, [favoriteData, favoritePage]);

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-600 shadow-sm">
        收藏(在线) · {header}
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="mb-3 text-sm font-medium text-zinc-900">列表</div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-9 rounded-md border border-zinc-200 bg-white px-2 text-sm"
            value={favoriteSort}
            onChange={(e) => setFavoriteSort(e.currentTarget.value as "mr" | "mp")}
          >
            <option value="mr">按收藏时间</option>
            <option value="mp">按更新时间</option>
          </select>
          <select
            className="h-9 min-w-[140px] rounded-md border border-zinc-200 bg-white px-2 text-sm"
            value={favoriteFolderId}
            onChange={(e) => setFavoriteFolderId(e.currentTarget.value)}
          >
            <option value="0">默认文件夹</option>
            {favoriteFolders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-50"
              onClick={() => setFavoritePage((p) => Math.max(1, p - 1))}
              disabled={favoriteLoading || favoritePage <= 1}
            >
              上一页
            </button>
            <button
              type="button"
              className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-50"
              onClick={() => setFavoritePage((p) => p + 1)}
              disabled={favoriteLoading}
            >
              下一页
            </button>
            <button
              type="button"
              className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-50"
              onClick={() => void mutate()}
              disabled={favoriteLoading}
            >
              刷新
            </button>
          </div>
          <ListViewToggle value={viewMode} onChange={setViewMode} />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            className="h-9 flex-1 rounded-md border border-zinc-200 bg-white px-3 text-sm"
            placeholder="新建收藏文件夹名称"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.currentTarget.value)}
          />
          <button
            type="button"
            className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-50"
            onClick={() => void addFolder()}
            disabled={!newFolderName.trim() || favoriteLoading}
          >
            新建
          </button>
          <button
            type="button"
            className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm text-red-600 hover:bg-zinc-50"
            onClick={() => void delFolder(favoriteFolderId)}
            disabled={favoriteFolderId === "0" || favoriteLoading}
          >
            删除当前文件夹
          </button>
        </div>

        {favoriteErrorText || actionError ? (
          <div className="mt-3 rounded-md border border-zinc-200 bg-white p-2 text-sm text-red-600">
            {favoriteErrorText || actionError}
          </div>
        ) : null}

        {favoriteLoading ? (
          <Loading />
        ) : (
          <div className="mt-3 text-sm text-zinc-600">当前页 {favoriteList.length} 条</div>
        )}

        {viewMode === "card" ? (
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
            {favoriteList.map((item, idx) => {
              const aid =
                typeof item?.id === "string" || typeof item?.id === "number"
                  ? String(item.id)
                  : typeof item?.aid === "string" || typeof item?.aid === "number"
                    ? String(item.aid)
                    : "";
              const title =
                typeof item?.name === "string"
                  ? item.name
                  : typeof item?.title === "string"
                    ? item.title
                    : typeof item?.album_name === "string"
                      ? item.album_name
                      : `收藏 ${idx + 1}`;
              const author =
                typeof item?.author === "string"
                  ? item.author
                  : typeof item?.author_name === "string"
                    ? item.author_name
                    : "";
              const progress = aid ? getReadProgress(aid) : null;
              const cover = aid ? `${getImgBase()}/media/albums/${aid}_3x4.jpg` : "";
              return (
                <div
                  key={`${aid}-${idx}`}
                  className="flex h-full flex-col overflow-hidden rounded-md border border-zinc-200 bg-white"
                >
                  <button
                    type="button"
                    className="relative aspect-[3/4] w-full overflow-hidden bg-zinc-100"
                    onClick={() => aid && props.onOpenComic(aid)}
                    disabled={!aid}
                  >
                    <CoverImage src={cover} alt={title} className="h-full w-full object-cover" />
                  </button>
                  <div className="flex flex-1 flex-col gap-1 p-2">
                    <button
                      type="button"
                      className="line-clamp-2 text-left text-sm font-medium text-zinc-900 hover:underline"
                      onClick={() => aid && props.onOpenComic(aid)}
                      disabled={!aid}
                    >
                      {title}
                    </button>
                    <div className="truncate text-xs text-zinc-600">
                      {author ? `作者：${author}` : "作者：—"}
                    </div>
                    <div className="truncate text-xs text-zinc-500">AID：{aid || "—"}</div>
                    <div className="mt-auto flex items-center gap-2">
                      <button
                        type="button"
                        className="h-7 flex-1 rounded-md border border-zinc-200 bg-white text-xs text-zinc-900 hover:bg-zinc-50"
                        onClick={() => aid && openReaderFromAid(aid, progress)}
                        disabled={!aid || favoriteLoading}
                      >
                        {progress?.chapterId ? "继续阅读" : "阅读"}
                      </button>
                      <Button
                        className="h-7 flex-1 rounded-md border border-zinc-200 bg-white text-xs text-red-600 hover:bg-zinc-50"
                        onClick={() => aid && toggleFavorite(aid)}
                        disabled={!aid || favoriteLoading}
                        loading={!!toggleLoadingMap[aid]}
                      >
                        取消收藏
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {favoriteList.map((item, idx) => {
              const aid =
                typeof item?.id === "string" || typeof item?.id === "number"
                  ? String(item.id)
                  : typeof item?.aid === "string" || typeof item?.aid === "number"
                    ? String(item.aid)
                    : "";
              const title =
                typeof item?.name === "string"
                  ? item.name
                  : typeof item?.title === "string"
                    ? item.title
                    : typeof item?.album_name === "string"
                      ? item.album_name
                      : `收藏 ${idx + 1}`;
              const author =
                typeof item?.author === "string"
                  ? item.author
                  : typeof item?.author_name === "string"
                    ? item.author_name
                    : "";
              const progress = aid ? getReadProgress(aid) : null;
              const cover = aid ? `${getImgBase()}/media/albums/${aid}_3x4.jpg` : "";
              return (
                <div
                  key={`${aid}-${idx}`}
                  className="flex items-center gap-3 rounded-md border border-zinc-200 bg-white px-3 py-2"
                >
                  <div className="h-16 w-12 flex-none overflow-hidden rounded bg-zinc-100">
                    <CoverImage src={cover} alt={title} className="h-full w-full object-cover" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      className="line-clamp-2 w-full text-left text-sm font-medium text-zinc-900 hover:underline"
                      onClick={() => aid && props.onOpenComic(aid)}
                      disabled={!aid}
                    >
                      {title}
                    </button>
                    <div className="truncate text-xs text-zinc-600">
                      {author ? `作者：${author} · ` : ""}
                      AID：{aid || "—"}
                    </div>
                  </div>
                  <div className="flex flex-none items-center gap-2">
                    <button
                      type="button"
                      className="h-8 whitespace-nowrap rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-900 hover:bg-zinc-50"
                      onClick={() => aid && openReaderFromAid(aid, progress)}
                      disabled={!aid || favoriteLoading}
                    >
                      {progress?.chapterId ? "继续阅读" : "阅读"}
                    </button>
                    <Button
                      className="h-8 whitespace-nowrap rounded-md border border-zinc-200 bg-white px-2 text-sm text-red-600 hover:bg-zinc-50"
                      onClick={() => aid && toggleFavorite(aid)}
                      disabled={!aid || favoriteLoading}
                      loading={!!toggleLoadingMap[aid]}
                    >
                      取消收藏
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
