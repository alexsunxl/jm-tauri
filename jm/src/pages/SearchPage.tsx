import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import useSWR from "swr";
import { X } from "lucide-react";

import type { Session } from "../auth/session";
import { isAuthExpiredError } from "../auth/errors";
import CoverImage from "../components/CoverImage";
import ListViewToggle from "../components/ListViewToggle";
import { getImgBase } from "../config/endpoints";

function loadPrefs(): { sort: "mr" | "mv" | "mp" | "tf" } {
  try {
    const sort = (localStorage.getItem("jm_search_sort") as any) ?? "mr";
    return {
      sort: sort === "mv" || sort === "mp" || sort === "tf" ? sort : "mr",
    };
  } catch {
    return { sort: "mr" };
  }
}

function savePrefs(p: { sort: "mr" | "mv" | "mp" | "tf" }) {
  try {
    localStorage.setItem("jm_search_sort", p.sort);
  } catch {
    // ignore
  }
}

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem("jm_search_history");
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((s) => typeof s === "string" && s.trim()) : [];
  } catch {
    return [];
  }
}

function saveHistory(list: string[]) {
  try {
    localStorage.setItem("jm_search_history", JSON.stringify(list.slice(0, 30)));
  } catch {
    // ignore
  }
}

export default function SearchPage(props: {
  session: Session;
  onAuthExpired: () => void;
  onOpenComic: (aid: string) => void;
}) {
  const pref = loadPrefs();
  const [searchParams, setSearchParams] = useSearchParams();
  const [queryInput, setQueryInput] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");
  const [searchSort, setSearchSort] = useState<"mr" | "mv" | "mp" | "tf">(pref.sort);
  const [searchPage, setSearchPage] = useState(1);
  const viewKey = "jm_view_search";
  const [viewMode, setViewMode] = useState<"list" | "card">(() => {
    try {
      const v = localStorage.getItem(viewKey);
      return v === "card" ? "card" : "list";
    } catch {
      return "list";
    }
  });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<string[]>(() => loadHistory());
  const [historyFilter, setHistoryFilter] = useState("");

  const composingRef = useRef(false);
  const queryInputRef = useRef<HTMLInputElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const prefillRef = useRef(false);

  useEffect(() => {
    savePrefs({ sort: searchSort });
  }, [searchSort]);

  useEffect(() => {
    try {
      localStorage.setItem(viewKey, viewMode);
    } catch {
      // ignore
    }
  }, [viewMode, viewKey]);

  useEffect(() => {
    const onDown = (ev: MouseEvent) => {
      const t = ev.target as HTMLElement | null;
      if (!t) return;
      if (queryInputRef.current?.contains(t)) return;
      if (dropdownRef.current?.contains(t)) return;
      setHistoryOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  const swrKey = committedQuery
    ? ["search", committedQuery, searchSort, searchPage, props.session.cookies]
    : null;
  const {
    data: searchData,
    error: searchError,
    isValidating,
  } = useSWR(
    swrKey,
    async ([, q, sort, page, cookies]) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<any>("api_search", {
        searchQuery: q,
        sort,
        page: String(page),
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
      onSuccess: () => {
        // history is handled when user initiates search
      },
    },
  );

  const runSearch = useCallback((page: number, options?: { query?: string; sort?: "mr" | "mv" | "mp" | "tf" }) => {
    const q = (options?.query ?? queryInput).trim();
    if (!q) return;
    const m = q.match(/^(?:jm|JM)?(\d+)$/);
    if (m) {
      props.onOpenComic(m[1]);
      return;
    }
    const sort = options?.sort ?? searchSort;
    setCommittedQuery(q);
    setSearchSort(sort);
    setSearchPage(page);
    setSearchParams(
      {
        q,
        sort,
        page: String(page),
      },
      { replace: true },
    );
    setHistory((prev) => {
      const nextHistory = [q, ...prev.filter((x) => x !== q)].slice(0, 30);
      saveHistory(nextHistory);
      return nextHistory;
    });
  }, [props.onOpenComic, queryInput, searchSort, setSearchParams]);

  const paramsKey = searchParams.toString();

  useEffect(() => {
    const q = (searchParams.get("q") ?? "").trim();
    const rawSort = searchParams.get("sort");
    const nextSort =
      rawSort === "mv" || rawSort === "mp" || rawSort === "tf" || rawSort === "mr"
        ? rawSort
        : pref.sort;
    const pageRaw = searchParams.get("page");
    const nextPage = Math.max(1, pageRaw ? Number(pageRaw) || 1 : 1);
    if (q === committedQuery && nextSort === searchSort && nextPage === searchPage) {
      return;
    }
    setQueryInput(q);
    setCommittedQuery(q);
    setSearchSort(nextSort);
    setSearchPage(nextPage);
  }, [paramsKey, pref.sort]);

  useEffect(() => {
    if (prefillRef.current) return;
    let q = "";
    try {
      q = localStorage.getItem("jm_search_prefill") ?? "";
      if (!q.trim()) return;
      localStorage.removeItem("jm_search_prefill");
    } catch {
      return;
    }
    setQueryInput(q);
    prefillRef.current = true;
    void runSearch(1, { query: q });
  }, [runSearch]);

  const searchLoading = isValidating && !searchData;
  const searchErrorText =
    searchError && !isAuthExpiredError(searchError)
      ? searchError instanceof Error
        ? searchError.message
        : String(searchError)
      : "";
  const list: any[] = Array.isArray(searchData?.content) ? searchData.content : [];

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-600 shadow-sm">
        搜索 ·{" "}
        {searchData?.total != null ? `共 ${String(searchData.total)} 条 · 第 ${searchPage} 页` : "—"}
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="mb-3 text-sm font-medium text-zinc-900">条件</div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <input
              ref={queryInputRef}
              className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm"
              placeholder="输入关键词 / JM12345"
              value={queryInput}
              onFocus={() => {
                setHistory(loadHistory());
                setHistoryFilter(queryInput);
                setHistoryOpen(true);
              }}
              onClick={() => {
                setHistory(loadHistory());
                setHistoryFilter(queryInput);
                setHistoryOpen(true);
              }}
              onChange={(e) => {
                if (composingRef.current) return;
                const next = e.currentTarget.value;
                setQueryInput(next);
                setHistoryFilter(next);
              }}
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onCompositionEnd={(e) => {
                composingRef.current = false;
                const next = e.currentTarget.value;
                setQueryInput(next);
                setHistoryFilter(next);
              }}
              onKeyUp={(e) => {
                if (e.key === "Enter" && !composingRef.current) void runSearch(1);
              }}
            />
            {historyOpen ? (
              <div
                ref={dropdownRef}
                className="absolute left-0 right-0 top-10 z-20 max-h-[280px] overflow-auto rounded-md border border-zinc-200 bg-white shadow-sm"
              >
                <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2 text-xs text-zinc-600">
                  <div>搜索记录</div>
                </div>
                <div className="p-1">
                  {(() => {
                    const needle = historyFilter.trim().toLowerCase();
                    const items = needle
                      ? history.filter((h) => h.toLowerCase().includes(needle))
                      : history;
                    if (!items.length) {
                      return <div className="px-3 py-2 text-sm text-zinc-500">暂无记录</div>;
                    }
                    return (
                      <div className="flex flex-wrap gap-2 p-2">
                        {items.map((h) => (
                          <button
                            key={h}
                            type="button"
                            className="group flex max-w-full items-center gap-1 rounded-full border border-zinc-200 bg-white px-2 py-1 text-left text-sm text-zinc-900 hover:bg-zinc-50"
                            onClick={() => {
                              setQueryInput(h);
                              setHistoryOpen(false);
                              void runSearch(1, { query: h });
                            }}
                            title={h}
                          >
                            <span className="block max-w-[200px] truncate">{h}</span>
                            <span className="ml-1 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
                              <button
                                type="button"
                                className="flex h-5 w-5 items-center justify-center"
                                aria-label={`删除搜索记录 ${h}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setHistory((prev) => {
                                    const next = prev.filter((x) => x !== h);
                                    saveHistory(next);
                                    return next;
                                  });
                                }}
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </span>
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </div>
            ) : null}
          </div>
          <select
            className="h-9 rounded-md border border-zinc-200 bg-white px-2 text-sm"
            value={searchSort}
            onChange={(e) => {
              const next = e.currentTarget.value as any;
              setSearchSort(next);
              savePrefs({ sort: next });
              if (committedQuery.trim()) {
                void runSearch(1, { sort: next, query: committedQuery });
              }
            }}
          >
            <option value="mr">最新</option>
            <option value="mv">最多点击</option>
            <option value="mp">最多图片</option>
            <option value="tf">最多爱心</option>
          </select>
          <button
            type="button"
            className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-50 disabled:opacity-60"
            onClick={() => void runSearch(1)}
            disabled={searchLoading}
          >
            搜索
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-50 disabled:opacity-60"
            onClick={() => void runSearch(Math.max(1, searchPage - 1), { query: committedQuery })}
            disabled={searchLoading || searchPage <= 1}
          >
            上一页
          </button>
          <button
            type="button"
            className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-50 disabled:opacity-60"
            onClick={() => void runSearch(searchPage + 1, { query: committedQuery })}
            disabled={searchLoading}
          >
            下一页
          </button>
          <div className="text-sm text-zinc-600">{isValidating ? "搜索中…" : ""}</div>
        </div>

        {searchErrorText ? (
          <div className="mt-3 rounded-md border border-zinc-200 bg-white p-2 text-sm text-red-600">
            {searchErrorText}
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2 text-sm font-medium text-zinc-900">
          <div>结果</div>
          <ListViewToggle value={viewMode} onChange={setViewMode} />
        </div>
        {viewMode === "card" ? (
          <div className="mt-3">
            {!list.length && !searchLoading ? (
              <div className="rounded-md border border-dashed border-zinc-200 p-3 text-center text-sm text-zinc-500">
                暂无结果
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {list.map((item, idx) => {
                const aid =
                  typeof item?.id === "string" || typeof item?.id === "number" ? String(item.id) : "";
                const title =
                  typeof item?.name === "string"
                    ? item.name
                    : typeof item?.title === "string"
                      ? item.title
                      : `搜索结果 ${idx + 1}`;
                const author =
                  typeof item?.author === "string"
                    ? item.author
                    : Array.isArray(item?.author)
                      ? item.author.join(", ")
                      : "";
                const cover = aid ? `${getImgBase()}/media/albums/${aid}_3x4.jpg` : "";
                return (
                  <div
                    key={`${aid}-${idx}`}
                    className="flex flex-col overflow-hidden rounded-md border border-zinc-200 bg-white"
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
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {list.map((item, idx) => {
              const aid =
                typeof item?.id === "string" || typeof item?.id === "number" ? String(item.id) : "";
              const title =
                typeof item?.name === "string"
                  ? item.name
                  : typeof item?.title === "string"
                    ? item.title
                    : `搜索结果 ${idx + 1}`;
              const author =
                typeof item?.author === "string"
                  ? item.author
                  : Array.isArray(item?.author)
                    ? item.author.join(", ")
                    : "";
              const categoryMain =
                typeof item?.category?.title === "string" ? item.category.title : "";
              const categorySub =
                typeof item?.category_sub?.title === "string" ? item.category_sub.title : "";
              const category =
                categoryMain && categorySub ? `${categoryMain}/${categorySub}` : categoryMain || categorySub;
              const cover = aid ? `${getImgBase()}/media/albums/${aid}_3x4.jpg` : "";

              return (
                <div
                  key={`${aid}-${idx}`}
                  className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="h-16 w-12 flex-none overflow-hidden rounded bg-zinc-100">
                      <CoverImage src={cover} alt={title} className="h-full w-full object-cover" />
                    </div>
                    <div className="min-w-0">
                      <button
                        type="button"
                        className="line-clamp-2 text-left text-sm font-medium text-zinc-900 hover:underline"
                        onClick={() => aid && props.onOpenComic(aid)}
                        disabled={!aid}
                      >
                        {title}
                      </button>
                      <div className="mt-1 text-xs text-zinc-600">
                        {author ? `作者：${author} · ` : ""}
                        {category ? `分类：${category} · ` : ""}
                        AID：{aid || "—"}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="h-8 flex-none rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
                    onClick={() => aid && props.onOpenComic(aid)}
                    disabled={!aid}
                  >
                    详情
                  </button>
                </div>
              );
            })}
            {!list.length && !searchLoading ? <div className="text-sm text-zinc-600">暂无结果</div> : null}
          </div>
        )}
      </div>
    </div>
  );
}
