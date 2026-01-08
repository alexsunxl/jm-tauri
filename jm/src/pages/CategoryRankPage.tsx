import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import useSWR from "swr";

import type { Session } from "../auth/session";
import { isAuthExpiredError } from "../auth/errors";
import CoverImage from "../components/CoverImage";
import ListViewToggle from "../components/ListViewToggle";
import Loading from "../components/Loading";
import { getImgBase } from "../config/endpoints";

type CategoryItem = {
  id?: string | number;
  name?: string;
  slug?: string;
  total?: number;
};

type CategoryBlock = {
  title: string;
  content: string[];
};

const CATEGORY_CACHE_KEY = "jm_category_cache_v1";

function loadCategoryCache(): { categories: CategoryItem[]; blocks: CategoryBlock[] } | null {
  try {
    const raw = localStorage.getItem(CATEGORY_CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { categories?: CategoryItem[]; blocks?: CategoryBlock[] };
    const categories = Array.isArray(data?.categories) ? data.categories : [];
    const blocks = Array.isArray(data?.blocks) ? data.blocks : [];
    return { categories, blocks };
  } catch {
    return null;
  }
}

function saveCategoryCache(categories: CategoryItem[], blocks: CategoryBlock[]) {
  try {
    localStorage.setItem(
      CATEGORY_CACHE_KEY,
      JSON.stringify({
        categories,
        blocks,
      }),
    );
  } catch {
    // ignore
  }
}

function sameCategoryCache(
  a: { categories: CategoryItem[]; blocks: CategoryBlock[] },
  b: { categories: CategoryItem[]; blocks: CategoryBlock[] },
) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

const SORT_OPTIONS: Array<{ label: string; value: string }> = [
  { label: "最新", value: "mr" },
  { label: "总排行", value: "mv" },
  { label: "月排行", value: "mv_m" },
  { label: "周排行", value: "mv_w" },
  { label: "日排行", value: "mv_t" },
  { label: "最多图片", value: "mp" },
  { label: "最多爱心", value: "tf" },
];

export default function CategoryRankPage(props: {
  session: Session;
  onAuthExpired: () => void;
  onOpenComic: (aid: string) => void;
  onOpenSearch: (query: string) => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const initRef = useRef(false);
  const viewKey = "jm_view_category_rank";
  const [viewMode, setViewMode] = useState<"list" | "card">(() => {
    try {
      const v = localStorage.getItem(viewKey);
      return v === "card" ? "card" : "list";
    } catch {
      return "list";
    }
  });
  const [tabIndex, setTabIndex] = useState(0);
  const [sortKey, setSortKey] = useState(SORT_OPTIONS[0].value);
  const [page, setPage] = useState(1);
  const [jumpValue, setJumpValue] = useState("1");
  const [pendingTab, setPendingTab] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    const tab = searchParams.get("tab");
    const sort = searchParams.get("sort");
    const pageParam = Number(searchParams.get("page"));
    if (sort && SORT_OPTIONS.some((opt) => opt.value === sort)) {
      setSortKey(sort);
    }
    if (Number.isFinite(pageParam) && pageParam > 0) {
      setPage(pageParam);
    }
    setPendingTab(tab);
    setInitialized(true);
  }, [searchParams]);

  const {
    data: categoryData,
    error: categoryError,
    isValidating: categoryValidating,
  } = useSWR(
    ["categories", props.session.cookies],
    async ([, cookies]) => {
      const { invoke } = await import("@tauri-apps/api/core");
      const raw = await invoke<any>("api_categories", { cookies });
      const list = Array.isArray(raw?.categories) ? raw.categories : [];
      const blockList = Array.isArray(raw?.blocks) ? raw.blocks : [];
      const normalizedBlocks: CategoryBlock[] = [];
      for (const b of blockList) {
        const title = typeof b?.title === "string" ? b.title : "";
        const content = Array.isArray(b?.content)
          ? b.content.filter((x: unknown) => typeof x === "string")
          : [];
        if (title && content.length) normalizedBlocks.push({ title, content });
      }
      return { categories: list, blocks: normalizedBlocks };
    },
    {
      fallbackData: loadCategoryCache() ?? { categories: [], blocks: [] },
      revalidateOnFocus: false,
      onError: (err) => {
        if (isAuthExpiredError(err)) {
          props.onAuthExpired();
        }
      },
      onSuccess: (data) => {
        const cached = loadCategoryCache();
        if (!cached || !sameCategoryCache(cached, data)) {
          saveCategoryCache(data.categories, data.blocks);
        }
      },
    },
  );

  const categories = categoryData?.categories ?? [];
  const blocks = categoryData?.blocks ?? [];
  const categoryErrorText =
    categoryError && !isAuthExpiredError(categoryError)
      ? categoryError instanceof Error
        ? categoryError.message
        : String(categoryError)
      : "";

  useEffect(() => {
    try {
      localStorage.setItem(viewKey, viewMode);
    } catch {
      // ignore
    }
  }, [viewMode]);

  const activeCategory = tabIndex > 0 ? categories[tabIndex - 1] : null;

  useEffect(() => {
    if (!pendingTab) return;
    if (pendingTab === "all") {
      setTabIndex(0);
      setPendingTab(null);
      return;
    }
    const idx = categories.findIndex(
      (c: CategoryItem) =>
        String(c?.slug ?? "") === pendingTab ||
        String(c?.id ?? "") === pendingTab,
    );
    if (idx >= 0) {
      setTabIndex(idx + 1);
      setPendingTab(null);
    }
  }, [categories, pendingTab]);

  useEffect(() => {
    if (!initialized) return;
    const params = new URLSearchParams(searchParams);
    params.set("sort", sortKey);
    params.set("page", String(page));
    if (tabIndex === 0) {
      params.set("tab", "all");
    } else {
      const cat = categories[tabIndex - 1];
      const key = cat?.slug ?? cat?.id;
      if (key != null && String(key).trim()) {
        params.set("tab", String(key));
      } else {
        params.set("tab", "all");
      }
    }
    if (params.toString() === searchParams.toString()) return;
    setSearchParams(params, { replace: true });
  }, [categories, initialized, page, searchParams, setSearchParams, sortKey, tabIndex]);

  const searchKey =
    tabIndex > 0 && activeCategory?.slug
      ? ["category_search", activeCategory.slug, sortKey, page, props.session.cookies]
      : null;

  const {
    data: searchData,
    error: searchError,
    isValidating: searchValidating,
  } = useSWR(
    searchKey,
    async ([, category, sort, pageValue, cookies]) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<any>("api_category_search", {
        category: String(category ?? ""),
        page: String(pageValue),
        sort,
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

  const searchErrorText =
    searchError && !isAuthExpiredError(searchError)
      ? searchError instanceof Error
        ? searchError.message
        : String(searchError)
      : "";
  const searchLoading = searchValidating && !searchData;

  useEffect(() => {
    setJumpValue(String(page));
  }, [page]);

  const list: any[] = Array.isArray(searchData?.content) ? searchData.content : [];
  const total =
    typeof searchData?.total === "number"
      ? searchData.total
      : typeof searchData?.total === "string"
        ? Number(searchData.total)
        : null;
  const maxPage = useMemo(() => {
    if (total != null && list.length > 0) {
      return Math.max(1, Math.floor((total - 1) / list.length) + 1);
    }
    return Math.max(1, page);
  }, [list.length, page, total]);

  const header = tabIndex === 0 ? "分类标签" : `第 ${page} 页`;

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-600 shadow-sm">
        分类与排行 · {header}
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="mb-3 text-sm font-medium text-zinc-900">分类</div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`h-9 rounded-md border px-3 text-sm ${
              tabIndex === 0 ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white"
            }`}
            onClick={() => {
              setTabIndex(0);
              setPage(1);
            }}
          >
            分类
          </button>
          {categories.map((c: CategoryItem, i: number) => {
            const name = c?.name ?? `分类${i + 1}`;
            const active = tabIndex === i + 1;
            return (
              <button
                key={`${c?.slug ?? c?.id ?? name}-${i}`}
                type="button"
                className={`h-9 rounded-md border px-3 text-sm ${
                  active ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white"
                }`}
                onClick={() => {
                  setTabIndex(i + 1);
                  setPage(1);
                }}
              >
                {name}
              </button>
            );
          })}
        </div>
        {categoryErrorText ? (
          <div className="mt-3 rounded-md border border-zinc-200 bg-white p-2 text-sm text-red-600">
            {categoryErrorText}
          </div>
        ) : null}
        {categoryValidating && categories.length === 0 ? (
          <div className="mt-3">
            <Loading />
          </div>
        ) : null}

        {tabIndex === 0 ? (
          <div className="mt-4 space-y-4">
            {blocks.map((block) => (
              <div key={block.title} className="rounded-md border border-zinc-200 p-3">
                <div className="mb-2 text-sm font-medium text-zinc-900">{block.title}</div>
                <div className="flex flex-wrap gap-2">
                  {block.content.map((text) => (
                    <button
                      key={text}
                      type="button"
                      className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-800 hover:bg-zinc-50"
                      onClick={() => props.onOpenSearch(text)}
                    >
                      {text}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {blocks.length === 0 ? (
              <div className="rounded-md border border-dashed border-zinc-200 p-3 text-center text-sm text-zinc-500">
                暂无分类标签
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-4">
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="h-9 rounded-md border border-zinc-200 bg-white px-2 text-sm"
                value={sortKey}
                onChange={(e) => {
                  setSortKey(e.currentTarget.value);
                  setPage(1);
                }}
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-50"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={searchLoading || page <= 1}
                >
                  上一页
                </button>
                <button
                  type="button"
                  className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-50"
                  onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
                  disabled={searchLoading || page >= maxPage}
                >
                  下一页
                </button>
              </div>

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
                    setPage(next);
                  }}
                  disabled={searchLoading}
                >
                  跳转
                </button>
              </div>

              <div className="text-xs text-zinc-500">页 {page}/{maxPage}</div>
              <ListViewToggle value={viewMode} onChange={setViewMode} />
            </div>

            {searchErrorText ? (
              <div className="mt-3 rounded-md border border-zinc-200 bg-white p-2 text-sm text-red-600">
                {searchErrorText}
              </div>
            ) : null}

            {searchLoading ? (
              <Loading />
            ) : (
              <div className="mt-3 text-sm text-zinc-600">当前页 {list.length} 条</div>
            )}

            {viewMode === "card" ? (
              <div className="mt-3">
                {list.length === 0 && !searchLoading ? (
                  <div className="rounded-md border border-dashed border-zinc-200 p-3 text-center text-sm text-zinc-500">
                    暂无数据
                  </div>
                ) : null}
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  {list.map((item, idx) => {
                  const aid =
                    typeof item?.id === "string" || typeof item?.id === "number"
                      ? String(item.id)
                      : "";
                  const title =
                    typeof item?.name === "string"
                      ? item.name
                      : typeof item?.title === "string"
                        ? item.title
                        : `作品 ${idx + 1}`;
                  const author =
                    typeof item?.author === "string"
                      ? item.author
                      : Array.isArray(item?.author)
                        ? item.author.filter((x: unknown) => typeof x === "string").join(", ")
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
                      </div>
                    </div>
                  );
                  })}
                </div>
              </div>
            ) : (
              <div className="mt-3 flex flex-col gap-2">
                {list.length === 0 && !searchLoading ? (
                  <div className="rounded-md border border-dashed border-zinc-200 p-3 text-center text-sm text-zinc-500">
                    暂无数据
                  </div>
                ) : null}
                {list.map((item, idx) => {
                  const aid =
                    typeof item?.id === "string" || typeof item?.id === "number"
                      ? String(item.id)
                      : "";
                  const title =
                    typeof item?.name === "string"
                      ? item.name
                      : typeof item?.title === "string"
                        ? item.title
                        : `作品 ${idx + 1}`;
                  const author =
                    typeof item?.author === "string"
                      ? item.author
                      : Array.isArray(item?.author)
                        ? item.author.filter((x: unknown) => typeof x === "string").join(", ")
                        : "";
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
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
