import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import useSWR from "swr";

import type { Session } from "../auth/session";
import { isAuthExpiredError } from "../auth/errors";
import CoverImage from "../components/CoverImage";
import ListViewToggle from "../components/ListViewToggle";
import Loading from "../components/Loading";
import { getImgBase } from "../config/endpoints";
import { getAllReadProgress, getReadProgress } from "../reading/progress";
import type { ReadProgress } from "../reading/progress";
import { useToast } from "../components/Toast";

type HistoryRow = {
  key: string;
  aid: string;
  title: string;
  author: string;
  coverUrl: string;
  local: boolean;
  progress: ReadProgress | null;
};

function rowAid(item: any): string {
  if (typeof item?.id === "string" || typeof item?.id === "number") return String(item.id);
  if (typeof item?.aid === "string" || typeof item?.aid === "number") return String(item.aid);
  return "";
}

function rowFromApiItem(item: any, idx: number): HistoryRow {
  const aid = rowAid(item);
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
  const cover =
    typeof item?.coverUrl === "string" && item.coverUrl
      ? item.coverUrl
      : aid
        ? `${getImgBase()}/media/albums/${aid}_3x4.jpg`
        : "";
  return {
    key: `${aid || "row"}-${idx}`,
    aid,
    title,
    author,
    coverUrl: cover,
    local: Boolean(item?.localReadProgress),
    progress: aid ? getReadProgress(aid) : null,
  };
}

function rowFromLocalProgress(progress: ReadProgress, idx: number): HistoryRow {
  return {
    key: `${progress.aid}-local-${idx}`,
    aid: progress.aid,
    title: progress.title || `AID ${progress.aid}`,
    author: "",
    coverUrl: progress.coverUrl ?? "",
    local: true,
    progress,
  };
}

function EmptyList(props: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-zinc-200 p-3 text-center text-sm text-zinc-500">
      {props.text}
    </div>
  );
}

function LocalBadge() {
  return (
    <span className="inline-flex h-5 items-center rounded border border-amber-200 bg-amber-50 px-1.5 text-xs text-amber-700">
      本地
    </span>
  );
}

function HistoryCard(props: {
  row: HistoryRow;
  onOpenComic: (aid: string) => void;
  onRead: (row: HistoryRow) => void;
}) {
  const row = props.row;
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-md border border-zinc-200 bg-white">
      <button
        type="button"
        className="relative aspect-[3/4] w-full overflow-hidden bg-zinc-100"
        onClick={() => row.aid && props.onOpenComic(row.aid)}
        disabled={!row.aid}
      >
        <CoverImage src={row.coverUrl} alt={row.title} className="h-full w-full object-cover" />
      </button>
      <div className="flex flex-1 flex-col gap-1 p-2">
        <button
          type="button"
          className="line-clamp-2 text-left text-sm font-medium text-zinc-900 hover:underline"
          onClick={() => row.aid && props.onOpenComic(row.aid)}
          disabled={!row.aid}
        >
          {row.title}
        </button>
        {row.local ? (
          <div>
            <LocalBadge />
          </div>
        ) : null}
        <div className="truncate text-xs text-zinc-600">
          {row.author ? `作者：${row.author}` : "作者：—"}
        </div>
        <div className="truncate text-xs text-zinc-500">AID：{row.aid || "—"}</div>
        <button
          type="button"
          className="mt-auto h-7 rounded-md border border-zinc-200 bg-white text-xs text-zinc-900 hover:bg-zinc-50"
          onClick={() => row.aid && props.onRead(row)}
          disabled={!row.aid}
        >
          {row.progress?.chapterId ? "继续阅读" : "阅读"}
        </button>
      </div>
    </div>
  );
}

function HistoryRowItem(props: {
  row: HistoryRow;
  onOpenComic: (aid: string) => void;
  onRead: (row: HistoryRow) => void;
}) {
  const row = props.row;
  return (
    <div className="flex items-center gap-3 rounded-md border border-zinc-200 bg-white px-3 py-2">
      <div className="h-16 w-12 flex-none overflow-hidden rounded bg-zinc-100">
        <CoverImage src={row.coverUrl} alt={row.title} className="h-full w-full object-cover" />
      </div>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          className="line-clamp-2 w-full text-left text-sm font-medium text-zinc-900 hover:underline"
          onClick={() => row.aid && props.onOpenComic(row.aid)}
          disabled={!row.aid}
        >
          {row.title}
        </button>
        {row.local ? (
          <div className="mt-1">
            <LocalBadge />
          </div>
        ) : null}
        <div className="truncate text-xs text-zinc-600">
          {row.author ? `作者：${row.author} · ` : ""}
          AID：{row.aid || "—"}
        </div>
      </div>
      <div className="flex flex-none items-center gap-2">
        <button
          type="button"
          className="h-8 whitespace-nowrap rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-900 hover:bg-zinc-50"
          onClick={() => row.aid && props.onRead(row)}
          disabled={!row.aid}
        >
          {row.progress?.chapterId ? "继续阅读" : "阅读"}
        </button>
      </div>
    </div>
  );
}

export default function HistoryPage(props: {
  session: Session | null;
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
  const navigate = useNavigate();
  const location = useLocation();

  // 服务端浏览记录需要登录 cookies；未登录或游客（cookies 为空）时不下发请求，仅展示提示。
  const sessionCookies = props.session?.cookies;
  const hasLogin = Boolean(
    sessionCookies && Object.keys(sessionCookies).length > 0,
  );

  const {
    data: historyData,
    error: historyError,
    isValidating: historyValidating,
    mutate,
  } = useSWR(
    ["history", historyPage, hasLogin ? sessionCookies : null],
    async ([, pageValue, cookies]) => {
      if (!cookies) return null;
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

  const { data: localProgressData, mutate: mutateLocalProgress } = useSWR(
    "read-progress-history",
    async () => {
      const byAid = new Map<string, ReadProgress>();
      for (const item of getAllReadProgress()) {
        if (item.aid) byAid.set(item.aid, item);
      }
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const list = await invoke<ReadProgress[]>("api_read_progress_list");
        for (const item of list) {
          if (!item?.aid) continue;
          const prev = byAid.get(item.aid);
          if (!prev || (item.updatedAt ?? 0) > (prev.updatedAt ?? 0)) {
            byAid.set(item.aid, item);
          }
        }
      } catch {
        // The browser copy is enough when the native store is unavailable.
      }
      return [...byAid.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    },
    {
      revalidateOnFocus: true,
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

  const localRows: HistoryRow[] = useMemo(
    () => (localProgressData ?? []).map(rowFromLocalProgress),
    [localProgressData],
  );

  const serverRows: HistoryRow[] = useMemo(() => {
    if (!hasLogin) return [];
    const apiHistoryList = Array.isArray(historyData?.list) ? historyData.list : [];
    return apiHistoryList.map(rowFromApiItem);
  }, [hasLogin, historyData]);

  const total =
    typeof historyData?.total === "number"
      ? historyData.total
      : typeof historyData?.total === "string"
        ? Number(historyData.total)
        : null;

  const maxPage = useMemo(() => {
    if (total != null && serverRows.length > 0) {
      return Math.max(1, Math.floor((total - 1) / serverRows.length) + 1);
    }
    return Math.max(1, historyPage);
  }, [historyPage, serverRows.length, total]);

  const formatChapterTitle = (c: { id: string | number; sort?: string | number; name?: string }) =>
    `第${c.sort ?? "?"}话${c.name ? `：${c.name}` : ""}`;

  const openReaderFromRow = (row: HistoryRow) => {
    const session = props.session;
    if (!session || !hasLogin) {
      showToast({ ok: false, text: "未登录：请先登录后再阅读" });
      return;
    }
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const raw = await invoke<any>("api_album", {
          id: row.aid,
          cookies: session.cookies,
        });
        const series = Array.isArray(raw?.series) ? raw.series : [];
        const chapters =
          series.length > 0
            ? [...series].sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0))
            : [
                {
                  id: raw?.id ?? row.aid,
                  sort: 1,
                  name: "",
                },
              ];

        const first = chapters[0];
        const target =
          row.progress?.chapterId != null
            ? chapters.find((c) => String(c.id) === String(row.progress?.chapterId))
            : null;
        const chosen = target ?? first ?? { id: row.aid, sort: 1, name: "" };
        const chapterId = String(chosen.id ?? row.aid);
        const chapterTitle = formatChapterTitle(chosen);
        const startPage = target ? row.progress?.pageIndex ?? 1 : 1;
        props.onOpenReader(row.aid, chapterId, chapterTitle, chapters, startPage);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        showToast({ ok: false, text: `读取漫画信息失败：${msg}` });
      }
    })();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-medium text-zinc-900">浏览记录</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-50"
              onClick={() => {
                void mutate();
                void mutateLocalProgress();
              }}
              disabled={historyLoading}
            >
              刷新
            </button>
            <ListViewToggle value={viewMode} onChange={setViewMode} />
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="mb-3 text-sm font-medium text-zinc-900">本地记录</div>
        {localRows.length === 0 ? (
          <EmptyList text="暂无本地浏览记录" />
        ) : viewMode === "card" ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {localRows.map((row) => (
              <HistoryCard
                key={row.key}
                row={row}
                onOpenComic={props.onOpenComic}
                onRead={openReaderFromRow}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {localRows.map((row) => (
              <HistoryRowItem
                key={row.key}
                row={row}
                onOpenComic={props.onOpenComic}
                onRead={openReaderFromRow}
              />
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-sm font-medium text-zinc-900">服务端记录</div>
          {hasLogin && total != null ? (
            <div className="text-xs text-zinc-500">共 {String(total)} 条</div>
          ) : null}
        </div>

        {!hasLogin ? (
          <div className="rounded-md border border-dashed border-zinc-200 bg-zinc-50 p-4 text-center text-sm text-zinc-500">
            <div>未登录：无法查看服务端浏览记录。</div>
            <div className="mt-1 text-xs text-zinc-400">
              登录后可查看账号浏览记录；本地记录不受影响。
            </div>
            <button
              type="button"
              className="mt-3 h-8 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 hover:bg-zinc-100"
              onClick={() => navigate("/login", { state: { from: location } })}
            >
              去登录
            </button>
          </div>
        ) : (
          <>
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
            </div>

            {historyErrorText ? (
              <div className="mt-3 rounded-md border border-zinc-200 bg-white p-2 text-sm text-red-600">
                {historyErrorText}
              </div>
            ) : null}

            {historyLoading ? (
              <Loading />
            ) : (
              <div className="mt-3 text-sm text-zinc-600">当前页 {serverRows.length} 条</div>
            )}

            {viewMode === "card" ? (
              <div className="mt-3">
                {serverRows.length === 0 && !historyLoading ? (
                  <EmptyList text="暂无服务端浏览记录" />
                ) : null}
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  {serverRows.map((row) => (
                    <HistoryCard
                      key={row.key}
                      row={row}
                      onOpenComic={props.onOpenComic}
                      onRead={openReaderFromRow}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-3 flex flex-col gap-2">
                {serverRows.length === 0 && !historyLoading ? (
                  <EmptyList text="暂无服务端浏览记录" />
                ) : null}
                {serverRows.map((row) => (
                  <HistoryRowItem
                    key={row.key}
                    row={row}
                    onOpenComic={props.onOpenComic}
                    onRead={openReaderFromRow}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
