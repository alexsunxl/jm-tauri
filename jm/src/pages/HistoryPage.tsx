import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";

import type { Session } from "../auth/session";
import { isAuthExpiredError } from "../auth/errors";
import CoverImage from "../components/CoverImage";
import ListViewToggle from "../components/ListViewToggle";
import Loading from "../components/Loading";
import { getImgBase } from "../config/endpoints";
import { getReadProgress } from "../reading/progress";
import { useToast } from "../components/Toast";

export default function HistoryPage(props: {
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
  const viewKey = "jm_view_history";
  const [viewMode, setViewMode] = useState<"list" | "card">(() => {
    try {
      const v = localStorage.getItem(viewKey);
      return v === "card" ? "card" : "list";
    } catch {
      return "list";
    }
  });
  const [historyPage, setHistoryPage] = useState(1);
  const [jumpValue, setJumpValue] = useState("1");
  const { showToast } = useToast();

  const {
    data: historyData,
    error: historyError,
    isValidating: historyValidating,
    mutate,
  } = useSWR(
    ["history", historyPage, props.session.cookies],
    async ([, pageValue, cookies]) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<any>("api_history", {
        page: String(pageValue),
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

  const historyErrorText =
    historyError && !isAuthExpiredError(historyError)
      ? historyError instanceof Error
        ? historyError.message
        : String(historyError)
      : "";
  const historyLoading = historyValidating && !historyData;

  useEffect(() => {
    setJumpValue(String(historyPage));
  }, [historyPage]);

  useEffect(() => {
    try {
      localStorage.setItem(viewKey, viewMode);
    } catch {
      // ignore
    }
  }, [viewMode]);

  const historyList: any[] = Array.isArray(historyData?.list) ? historyData.list : [];
  const total =
    typeof historyData?.total === "number"
      ? historyData.total
      : typeof historyData?.total === "string"
        ? Number(historyData.total)
        : null;

  const maxPage = useMemo(() => {
    if (total != null && historyList.length > 0) {
      return Math.max(1, Math.floor((total - 1) / historyList.length) + 1);
    }
    return Math.max(1, historyPage);
  }, [historyList.length, historyPage, total]);

  const header = useMemo(() => {
    if (total != null) return `第 ${historyPage} 页 · 共 ${String(total)} 条`;
    return `第 ${historyPage} 页`;
  }, [historyPage, total]);

  const formatChapterTitle = (c: { id: string | number; sort?: string | number; name?: string }) =>
    `第${c.sort ?? "?"}话${c.name ? `：${c.name}` : ""}`;

  const openReaderFromAid = async (
    aid: string,
    progress: ReturnType<typeof getReadProgress>,
  ) => {
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
      showToast({ ok: false, text: `读取漫画信息失败：${msg}` });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-600 shadow-sm">
        浏览记录 · {header}
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="mb-3 text-sm font-medium text-zinc-900">列表</div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-50"
            onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
            disabled={historyLoading || historyPage <= 1}
          >
            上一页
          </button>
          <button
            type="button"
            className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-50"
            onClick={() => setHistoryPage((p) => p + 1)}
            disabled={historyLoading || historyPage >= maxPage}
          >
            下一页
          </button>
          <button
            type="button"
            className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-50"
            onClick={() => void mutate()}
            disabled={historyLoading}
          >
            刷新
          </button>

          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={maxPage}
              className="h-9 w-20 rounded-md border border-zinc-200 bg-white px-2 text-sm"
              value={jumpValue}
              onChange={(e) => setJumpValue(e.currentTarget.value)}
            />
            <button
              type="button"
              className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-50"
              onClick={() => {
                const next = Number(jumpValue);
                if (!Number.isFinite(next)) return;
                if (next < 1 || next > maxPage) return;
                setHistoryPage(next);
              }}
              disabled={historyLoading}
            >
              跳转
            </button>
            <div className="text-xs text-zinc-500">共 {maxPage} 页</div>
          </div>
          <ListViewToggle value={viewMode} onChange={setViewMode} />
        </div>

        {historyErrorText ? (
          <div className="mt-3 rounded-md border border-zinc-200 bg-white p-2 text-sm text-red-600">
            {historyErrorText}
          </div>
        ) : null}

        {historyLoading ? (
          <Loading />
        ) : (
          <div className="mt-3 text-sm text-zinc-600">当前页 {historyList.length} 条</div>
        )}

        {viewMode === "card" ? (
          <div className="mt-3">
            {historyList.length === 0 && !historyLoading ? (
              <div className="rounded-md border border-dashed border-zinc-200 p-3 text-center text-sm text-zinc-500">
                暂无浏览记录
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {historyList.map((item, idx) => {
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
                        : `记录 ${idx + 1}`;
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
                      <CoverImage
                        src={cover}
                        alt={title}
                        className="h-full w-full object-cover"
                      />
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
                      <button
                        type="button"
                        className="mt-auto h-7 rounded-md border border-zinc-200 bg-white text-xs text-zinc-900 hover:bg-zinc-50"
                        onClick={() => aid && openReaderFromAid(aid, progress)}
                        disabled={!aid}
                      >
                        {progress?.chapterId ? "继续阅读" : "阅读"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {historyList.length === 0 && !historyLoading ? (
              <div className="rounded-md border border-dashed border-zinc-200 p-3 text-center text-sm text-zinc-500">
                暂无浏览记录
              </div>
            ) : null}

            {historyList.map((item, idx) => {
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
                      : `记录 ${idx + 1}`;
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
                    <CoverImage
                      src={cover}
                      alt={title}
                      className="h-full w-full object-cover"
                    />
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
                    disabled={!aid}
                  >
                    {progress?.chapterId ? "继续阅读" : "阅读"}
                  </button>
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
