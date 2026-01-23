import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { RefreshCw } from "lucide-react";
import type { Session } from "../auth/session";
import { getImgBase } from "../config/endpoints";
import Loading from "../components/Loading";
import { useToast } from "../components/Toast";
import { upsertReadProgress } from "../reading/progress";
import type { ReadProgress } from "../reading/progress";
import ReadingPageMenu from "./ReadingPageMenu";
import ReadingPullContainer from "./ReadingPullContainer";
import { Info } from "lucide-react";
import {
  DEFAULT_READ_IMG_SCALE,
  getReadImageScale,
  getReadMaxConcurrency,
  getReadWheelMultiplier,
  MAX_READ_IMG_SCALE,
  MIN_READ_IMG_SCALE,
  setReadWheelMultiplier,
  subscribeSettings,
} from "../settings/userSettings";

type LoadInfoStats = {
  done: number;
  inFlight: number;
  errors: number;
};

type ProcessedMap = Record<number, { url?: string; error?: string; retries?: number }>;

type ReadImage = { raw: string; url: string; pictureName: string };

type Ref<T> = { current: T };

type ReadingSchedulerProps = {
  aid: string;
  startPage?: number;
  currentPage: number;
  images: ReadImage[];
  segmentNums: number[] | null;
  processedRef: Ref<ProcessedMap>;
  setProcessed: Dispatch<SetStateAction<ProcessedMap>>;
  objectUrlsByIndex: Ref<Map<number, string>>;
  readKeyRef: Ref<string>;
  genRef: Ref<number>;
  leavingRef: Ref<boolean>;
  maxConcurrencyRef: Ref<number>;
  requestToken: number;
  resetToken: number;
  onInflightChange: (pages: number[], count: number) => void;
};

const ChapterNavBar = memo(function ChapterNavBar(props: {
  chapters: ChapterNavItem[];
  chapterId: string;
  onOpenChapter: (chapterId: string, chapterTitle: string) => void;
}) {
  if (props.chapters.length <= 1) return null;
  const list = [...props.chapters].sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0));
  const currentId = props.chapterId;
  const curIdx = list.findIndex((c) => toId(c.id) === currentId);
  const prev = curIdx > 0 ? list[curIdx - 1] : null;
  const next = curIdx >= 0 && curIdx < list.length - 1 ? list[curIdx + 1] : null;
  return (
    <div className="sticky bottom-0 z-10 mt-4 w-full rounded-lg border border-zinc-200 bg-white/70 p-2 shadow-sm backdrop-blur-md">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="h-10 flex-1 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50"
          disabled={!prev}
          onClick={() => {
            if (!prev) return;
            props.onOpenChapter(toId(prev.id), formatChapterTitle(prev));
          }}
        >
          上一话{prev ? ` · ${formatChapterTitle(prev)}` : ""}
        </button>
        <button
          type="button"
          className="h-10 flex-1 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50"
          disabled={!next}
          onClick={() => {
            if (!next) return;
            props.onOpenChapter(toId(next.id), formatChapterTitle(next));
          }}
        >
          下一话{next ? ` · ${formatChapterTitle(next)}` : ""}
        </button>
      </div>
    </div>
  );
});

const ReadingLoadInfo = memo(function ReadingLoadInfo(props: {
  imagesLength: number;
  imgBase: string;
  scrambleId: number | null;
  scrambleError: string;
  segmentReady: boolean;
  stats: LoadInfoStats | null;
  inflightPages: number[];
}) {
  const [open, setOpen] = useState(false);
  const maxQueuedShow = 6;
  const inflightDisplay = props.inflightPages.slice(0, maxQueuedShow).map((p) => `p${p}`);
  const inflightTotal = props.stats?.inFlight ?? props.inflightPages.length;
  const inflightMore = Math.max(0, inflightTotal - inflightDisplay.length);
  return (
    <div className="fixed right-4 top-10 z-40 flex flex-col items-end">
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-full bg-black/60 px-3 py-1 text-xs text-white shadow-md backdrop-blur"
        onClick={() => setOpen((v) => !v)}
      >
        <Info className="h-3.5 w-3.5" />
        载入信息
        <span className="ml-1 opacity-75">{open ? "收起" : "展开"}</span>
      </button>
      {open ? (
        <div className="mt-2 max-w-[85vw] rounded-lg border border-zinc-200 bg-white/95 p-3 text-xs text-zinc-700 shadow-lg backdrop-blur">
          <div>共 {props.imagesLength} 张（图片域名：{props.imgBase}）</div>
          {props.scrambleId != null ? <div>scramble_id：{props.scrambleId}</div> : null}
          {props.scrambleError ? <div>scramble获取失败：{props.scrambleError}</div> : null}
          <div>{props.segmentReady ? "已计算分割参数" : "计算分割参数中…"}</div>
          {props.segmentReady && props.stats ? (
            <div>
              已完成 {props.stats.done} · 处理中 {props.stats.inFlight} · 错误{" "}
              {props.stats.errors}
            </div>
          ) : null}
          {props.segmentReady && props.inflightPages.length ? (
            <div>
              处理中：【{inflightDisplay.join(",")}
              {inflightMore > 0 ? `…+${inflightMore}` : ""}】
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

const ReadingScheduler = memo(function ReadingScheduler(props: ReadingSchedulerProps) {
  const inFlight = useRef<Set<number>>(new Set());
  const pumpScheduled = useRef<number | null>(null);
  const pumpFnRef = useRef<(() => void) | null>(null);
  const imagesRef = useRef<ReadImage[]>(props.images);
  const segmentNumsRef = useRef<number[] | null>(props.segmentNums);

  useEffect(() => {
    imagesRef.current = props.images;
  }, [props.images]);

  useEffect(() => {
    segmentNumsRef.current = props.segmentNums;
  }, [props.segmentNums]);

  const emitInflight = useCallback(() => {
    const total = imagesRef.current.length;
    const count = inFlight.current.size;
    if (total === 0 || count === 0) {
      props.onInflightChange([], count);
      return;
    }
    const pages: number[] = [];
    inFlight.current.forEach((idx) => {
      if (idx < 0 || idx >= total) return;
      pages.push(idx + 1);
    });
    pages.sort((a, b) => a - b);
    props.onInflightChange(pages, count);
  }, [props.onInflightChange]);

  const clearPump = useCallback(() => {
    if (pumpScheduled.current != null) {
      window.clearTimeout(pumpScheduled.current);
      pumpScheduled.current = null;
    }
  }, []);

  useEffect(() => {
    inFlight.current.clear();
    clearPump();
    emitInflight();
  }, [props.resetToken, clearPump, emitInflight]);

  useEffect(() => {
    emitInflight();
  }, [props.segmentNums, props.images.length, emitInflight]);

  useEffect(() => {
    return () => {
      clearPump();
      inFlight.current.clear();
    };
  }, [clearPump]);

  const schedulePump = useCallback(() => {
    if (props.leavingRef.current) return;
    if (pumpScheduled.current != null) return;
    pumpScheduled.current = window.setTimeout(() => {
      pumpScheduled.current = null;
      pumpFnRef.current?.();
    }, 0);
  }, [props.leavingRef]);

  const pump = useCallback(async () => {
    if (props.leavingRef.current) return;
    const maxConcurrency = props.maxConcurrencyRef.current;

    const currentSegs = segmentNumsRef.current;
    const currentImages = imagesRef.current;
    if (!currentSegs?.length || currentImages.length === 0) return;
    if (inFlight.current.size >= maxConcurrency) return;

    const total = currentImages.length;
    let page = props.currentPage;
    if (page <= 1 && (props.startPage ?? 1) > 1) {
      page = props.startPage ?? 1;
    }
    page = Math.min(total, Math.max(1, page));
    const cur = page - 1;

    const gen = props.genRef.current;
    const available = maxConcurrency - inFlight.current.size;
    const startNow: number[] = [];
    const consider = (idx: number) => {
      if (startNow.length >= available) return;
      if (idx < 0 || idx >= total) return;
      const done = props.processedRef.current[idx];
      if (done?.url || done?.error) return;
      if (inFlight.current.has(idx)) return;
      startNow.push(idx);
    };
    for (let i = cur; i < total && startNow.length < available; i += 1) {
      consider(i);
    }
    for (let i = cur - 1; i >= 0 && startNow.length < available; i -= 1) {
      consider(i);
    }
    if (!startNow.length) return;

    for (const idx of startNow) {
      inFlight.current.add(idx);
      emitInflight();
      (async () => {
        try {
          if (props.leavingRef.current) return;
          const segs = segmentNumsRef.current;
          const imgs = imagesRef.current;
          const img = imgs[idx];
          if (!img) return;
          const num = Math.max(1, segs?.[idx] ?? 1);
          const { invoke, convertFileSrc } = await import("@tauri-apps/api/core");
          const fileOrUrl = await invoke<string>("api_image_descramble_file", {
            url: img.url,
            num,
            aid: props.aid,
            readKey: props.readKeyRef.current,
          });
          if (props.leavingRef.current) return;
          if (gen !== props.genRef.current) return;
          const objectUrl = fileOrUrl.startsWith("http")
            ? fileOrUrl
            : convertFileSrc(fileOrUrl, "jmcache");
          const prevUrl = props.objectUrlsByIndex.current.get(idx);
          if (prevUrl?.startsWith("blob:")) URL.revokeObjectURL(prevUrl);
          props.objectUrlsByIndex.current.set(idx, objectUrl);
          const retries = props.processedRef.current[idx]?.retries;
          props.processedRef.current = {
            ...props.processedRef.current,
            [idx]: { url: objectUrl, retries },
          };
          props.setProcessed((prev) => ({ ...prev, [idx]: { url: objectUrl, retries } }));
        } catch (e) {
          if (gen !== props.genRef.current) return;
          const msg = e instanceof Error ? e.message : String(e);
          if (msg === "cancelled") return;
          const retries = props.processedRef.current[idx]?.retries ?? 0;
          props.processedRef.current = {
            ...props.processedRef.current,
            [idx]: { error: msg, retries },
          };
          props.setProcessed((prev) => ({ ...prev, [idx]: { error: msg, retries } }));
        } finally {
          inFlight.current.delete(idx);
          emitInflight();
          schedulePump();
        }
      })();
    }
  }, [
    emitInflight,
    props.aid,
    props.currentPage,
    props.genRef,
    props.leavingRef,
    props.maxConcurrencyRef,
    props.objectUrlsByIndex,
    props.processedRef,
    props.readKeyRef,
    props.setProcessed,
    props.startPage,
    schedulePump,
  ]);

  useEffect(() => {
    pumpFnRef.current = () => {
      void pump();
    };
  }, [pump]);

  useEffect(() => {
    schedulePump();
  }, [
    schedulePump,
    props.segmentNums,
    props.images.length,
    props.currentPage,
    props.startPage,
    props.requestToken,
  ]);

  return null;
});


type Chapter = {
  id: string | number;
  series_id?: string | number;
  name?: string;
  series?: Array<{ id: string | number; sort?: string | number; name?: string }>;
  images?: string[];
};

type ChapterNavItem = { id: string | number; sort?: string | number; name?: string };

function normalizeImgUrl(p: string, chapterId: string) {
  if (!p) return "";
  if (p.startsWith("http://") || p.startsWith("https://")) return p;
  const base = getImgBase();
  if (p.startsWith("/")) return `${base}${p}`;
  return `${base}/media/photos/${chapterId}/${p}`;
}

function numKey(s: string): number | null {
  const m = s.match(/\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function pictureNameFromPath(p: string): string {
  const base = p.split("/").pop() ?? p;
  return base.split(".")[0] ?? "";
}

function toId(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
}

function toAuthorText(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) {
    return v.map((x) => toAuthorText(x)).filter(Boolean).join(", ");
  }
  return "";
}

function formatChapterTitle(c: ChapterNavItem): string {
  return `第${c.sort ?? "?"}话${c.name ? `：${c.name}` : ""}`;
}

function getLocalImageScaleKey(aid: string) {
  return `jm_read_image_scale_local_${aid}`;
}

function loadLocalImageScale(aid: string): number | null {
  if (!aid) return null;
  try {
    const raw = localStorage.getItem(getLocalImageScaleKey(aid));
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return Math.min(MAX_READ_IMG_SCALE, Math.max(MIN_READ_IMG_SCALE, n));
  } catch {
    return null;
  }
}

function saveLocalImageScale(aid: string, v: number | null) {
  if (!aid) return;
  try {
    const key = getLocalImageScaleKey(aid);
    if (v == null) {
      localStorage.removeItem(key);
      return;
    }
    const n = Math.min(MAX_READ_IMG_SCALE, Math.max(MIN_READ_IMG_SCALE, v));
    localStorage.setItem(key, String(n));
  } catch {
    // ignore
  }
}

function makeReadKey(aid: string, chapterId: string) {
  const base = `${aid}-${chapterId}-${Date.now()}`;
  try {
    // webview should support crypto, but keep fallback.
    const rand = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2);
    return `${base}-${rand}`;
  } catch {
    return `${base}-${Math.random().toString(16).slice(2)}`;
  }
}

function ProcessedImage(props: {
  src: string;
  num: number;
  alt: string;
  index: number;
  height: number;
  onVisible: (index: number) => void;
  onRetry: (index: number) => void;
  onMeasured: (index: number, height: number) => void;
  processedUrl?: string;
  error?: string;
  retries?: number;
  isQueued: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const containerClass = props.error
    ? "relative w-full overflow-hidden rounded-md border border-zinc-200 bg-white"
    : "relative w-full overflow-hidden bg-white";
  const containerStyle = { height: `${props.height}px` };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) props.onVisible(props.index);
        }
      },
      { root: null, rootMargin: "1200px 0px", threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [props.index, props.onVisible]);

  if (props.error) {
    const retryCount = props.retries ?? 0;
    const retryNote = `重试次数：${retryCount}`;
    return (
      <div ref={ref} className={containerClass} style={containerStyle}>
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-3 text-sm text-red-600">
          <div>图片加载失败：{props.error}</div>
          <div className="text-xs text-red-500">{retryNote}</div>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2 py-1 text-xs text-red-600 hover:bg-red-50"
            onClick={() => props.onRetry(props.index)}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            重试
          </button>
        </div>
      </div>
    );
  }

  if (!props.processedUrl) {
    return (
      <div
        ref={ref}
        className={containerClass}
        style={containerStyle}
      >
        <div className="flex h-full w-full items-center justify-between p-3 text-sm text-zinc-600">
          <div>图片处理中…</div>
          <div>{props.isQueued ? "队列中" : "等待进入首屏/可视区"}</div>
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className={containerClass} style={containerStyle}>
      <img
        src={props.processedUrl}
        loading="lazy"
        className="h-full w-full object-contain"
        alt={props.alt}
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth && img.naturalHeight) {
            const ratio = img.naturalHeight / img.naturalWidth;
            const width = ref.current?.clientWidth ?? img.clientWidth;
            const next = Math.max(1, Math.round(width * ratio));
            if (next !== props.height) props.onMeasured(props.index, next);
          }
        }}
      />
    </div>
  );
}

export default function ReadingPage(props: {
  session: Session;
  aid: string;
  chapterId: string;
  chapterTitle: string;
  chapters: ChapterNavItem[];
  startPage?: number;
  onBack: () => void;
  onGoHome: () => void;
  onOpenChapter: (chapterId: string, chapterTitle: string) => void;
}) {
  const DEFAULT_ITEM_HEIGHT = 1060;
  const ITEM_GAP = 0;
  const OVERSCAN = 12;
  const wheelMultiplierRef = useRef<number>(getReadWheelMultiplier());
  const maxConcurrencyRef = useRef<number>(getReadMaxConcurrency());
  const [wheelMultiplier, setWheelMultiplier] = useState(() => getReadWheelMultiplier());
  const [globalScale, setGlobalScale] = useState(() => getReadImageScale());
  const [localScale, setLocalScale] = useState<number | null>(() =>
    loadLocalImageScale(props.aid),
  );

  const readKeyRef = useRef<string>(makeReadKey(props.aid, props.chapterId));
  const leavingRef = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [loading, setLoading] = useState(false);
  const [scrambleId, setScrambleId] = useState<number | null>(null);
  const [scrambleError, setScrambleError] = useState<string>("");
  const [segmentNums, setSegmentNums] = useState<number[] | null>(null);
  const [processed, setProcessed] = useState<ProcessedMap>({});
  const processedRef = useRef(processed);
  const genRef = useRef(0);
  const objectUrlsByIndex = useRef<Map<number, string>>(new Map());
  const [inflightPages, setInflightPages] = useState<number[]>([]);
  const [inflightCount, setInflightCount] = useState(0);
  const [schedulerToken, setSchedulerToken] = useState(0);
  const [pumpToken, setPumpToken] = useState(0);
  const [headerVisible, setHeaderVisible] = useState(false);
  const hideHeaderTimer = useRef<number | null>(null);
  const chapterLoadToken = useRef(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [windowRange, setWindowRange] = useState<{ start: number; end: number }>(() => ({
    start: 0,
    end: 0,
  }));
  const [currentPage, setCurrentPage] = useState(1);
  const [localFavBusy, setLocalFavBusy] = useState(false);
  const [isLocalFav, setIsLocalFav] = useState(false);
  const lastPageRef = useRef<number | null>(null);
  const savePageTimerRef = useRef<number | null>(null);
  const initialScrollDoneRef = useRef(false);
  const [itemBaseHeights, setItemBaseHeights] = useState<Record<number, number>>({});
  const { showToast } = useToast();

  const images = useMemo<ReadImage[]>(() => {
    const list = Array.isArray(chapter?.images) ? chapter!.images! : [];
    const sorted = [...list].sort((a, b) => {
      const na = numKey(a);
      const nb = numKey(b);
      if (na == null && nb == null) return a.localeCompare(b);
      if (na == null) return 1;
      if (nb == null) return -1;
      return na - nb;
    });
    return sorted
      .map((p) => ({
        raw: p,
        url: normalizeImgUrl(p, props.chapterId),
        pictureName: pictureNameFromPath(p),
      }))
      .filter((x) => Boolean(x.url));
  }, [chapter, props.chapterId]);

  const chapterMeta = useMemo(() => {
    const list = Array.isArray(props.chapters) ? props.chapters : [];
    const current = list.find((c) => toId(c.id) === props.chapterId);
    return {
      chapterId: props.chapterId,
      chapterSort: current?.sort != null ? String(current.sort) : undefined,
      chapterName: current?.name ?? props.chapterTitle,
    };
  }, [props.chapterId, props.chapterTitle, props.chapters]);

  const nextChapter = useMemo(() => {
    const list = [...(Array.isArray(props.chapters) ? props.chapters : [])].sort(
      (a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0),
    );
    const curIdx = list.findIndex((c) => toId(c.id) === props.chapterId);
    if (curIdx >= 0 && curIdx < list.length - 1) return list[curIdx + 1];
    return null;
  }, [props.chapterId, props.chapters]);

  const rootAid = useMemo(() => {
    const list = Array.isArray(props.chapters) ? [...props.chapters] : [];
    const isMulti = list.length > 1;
    if (isMulti) {
      const seriesId = toId(chapter?.series_id);
      if (seriesId) return seriesId;
      list.sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0));
      const firstId = toId(list[0]?.id);
      if (firstId) return firstId;
    }
    return props.aid;
  }, [chapter?.series_id, props.aid, props.chapters]);

  const [albumMeta, setAlbumMeta] = useState<{ title: string; author: string } | null>(null);
  const handleInflightChange = useCallback((pages: number[], count: number) => {
    setInflightCount((prev) => (prev === count ? prev : count));
    setInflightPages((prev) => {
      if (prev.length === pages.length && prev.every((v, i) => v === pages[i])) return prev;
      return pages;
    });
  }, []);
  const inflightSet = useMemo(() => {
    return new Set(inflightPages.map((p) => p - 1));
  }, [inflightPages]);
  const requestPump = useCallback(() => {
    setPumpToken((v) => v + 1);
  }, []);
  const loadInfoStats = useMemo<LoadInfoStats | null>(() => {
    if (!segmentNums) return null;
    const processedDone = Object.values(processed).filter((v) => Boolean(v.url)).length;
    const processedErr = Object.values(processed).filter((v) => Boolean(v.error)).length;
    const done = processedDone;
    return { done, inFlight: inflightCount, errors: processedErr };
  }, [inflightCount, processed, segmentNums]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!rootAid) {
        if (!cancelled) setAlbumMeta(null);
        return;
      }
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const raw = await invoke<any>("api_album", {
          id: rootAid,
          cookies: props.session.cookies,
        });
        if (cancelled) return;
        const title = typeof raw?.name === "string" ? raw.name : "";
        const author = toAuthorText(raw?.author);
        setAlbumMeta({ title, author });
      } catch {
        if (!cancelled) setAlbumMeta(null);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [props.session.cookies, rootAid]);

  const localFavTitle = useMemo(() => {
    if (albumMeta?.title) return albumMeta.title;
    return `AID ${rootAid}`;
  }, [albumMeta?.title, rootAid]);

  const coverUrl = useMemo(() => {
    return `${getImgBase()}/media/albums/${rootAid}_3x4.jpg`;
  }, [rootAid]);

  const effectiveScale = localScale ?? globalScale ?? DEFAULT_READ_IMG_SCALE;

  const handleToggleLocalFav = useCallback(() => {
    void (async () => {
      try {
        setLocalFavBusy(true);
        const { invoke } = await import("@tauri-apps/api/core");
        const nowFav = await invoke<boolean>("api_local_favorite_toggle", {
          aid: rootAid,
          title: localFavTitle,
          author: albumMeta?.author ?? "",
          coverUrl,
        });
        setIsLocalFav(Boolean(nowFav));
        showToast({
          ok: true,
          text: nowFav ? "已添加本地收藏" : "已取消本地收藏",
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        showToast({ ok: false, text: `本地收藏失败：${msg}` });
      } finally {
        setLocalFavBusy(false);
      }
    })();
  }, [albumMeta?.author, coverUrl, localFavTitle, rootAid, showToast]);

  const handleGoHome = useCallback(() => {
    leavingRef.current = true;
    genRef.current += 1;
    setInflightCount(0);
    setInflightPages([]);
    const key = readKeyRef.current;
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("api_read_cancel", { readKey: key });
      } catch {
        // ignore
      } finally {
        props.onGoHome();
      }
    })();
  }, [props.onGoHome]);

  const handleBack = useCallback(() => {
    leavingRef.current = true;
    genRef.current += 1;
    setInflightCount(0);
    setInflightPages([]);
    const key = readKeyRef.current;
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("api_read_cancel", { readKey: key });
      } catch {
        // ignore
      } finally {
        props.onBack();
      }
    })();
  }, [props.onBack]);

  const handleLocalScaleChange = useCallback(
    (v: number) => {
      setLocalScale(v);
      saveLocalImageScale(props.aid, v);
    },
    [props.aid],
  );

  const handleLocalScaleReset = useCallback(() => {
    setLocalScale(DEFAULT_READ_IMG_SCALE);
    saveLocalImageScale(props.aid, DEFAULT_READ_IMG_SCALE);
  }, [props.aid]);

  const handleLocalScaleFollow = useCallback(() => {
    setLocalScale(null);
    saveLocalImageScale(props.aid, null);
  }, [props.aid]);

  const handleWheelMultiplierChange = useCallback((v: number) => {
    setWheelMultiplier(v);
    setReadWheelMultiplier(v);
  }, []);

  const heightPrefix = useMemo(() => {
    const prefix = new Array(images.length + 1);
    prefix[0] = 0;
    for (let i = 0; i < images.length; i += 1) {
      const base = itemBaseHeights[i] ?? DEFAULT_ITEM_HEIGHT;
      const scaled = Math.max(1, Math.round(base * effectiveScale));
      prefix[i + 1] = prefix[i] + scaled + ITEM_GAP;
    }
    return prefix;
  }, [DEFAULT_ITEM_HEIGHT, ITEM_GAP, effectiveScale, images.length, itemBaseHeights]);

  const totalHeight = heightPrefix[images.length] ?? 0;

  useEffect(() => {
    const prevKey = readKeyRef.current;
    const nextKey = makeReadKey(props.aid, props.chapterId);
    readKeyRef.current = nextKey;
    leavingRef.current = false;

    // Best-effort cancel previous chapter tasks (e.g., when switching chapters quickly).
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("api_read_cancel", { readKey: prevKey });
      } catch {
        // ignore
      }
    })();

    genRef.current += 1;
    setProcessed({});
    setItemBaseHeights({});
    setLocalScale(loadLocalImageScale(props.aid));
    setInflightCount(0);
    setInflightPages([]);
    setSchedulerToken((v) => v + 1);
    lastPageRef.current = null;
    initialScrollDoneRef.current = false;
    for (const url of objectUrlsByIndex.current.values()) {
      if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    }
    objectUrlsByIndex.current.clear();
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [props.chapterId]);

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

  useEffect(() => {
    let raf = 0;
    const recompute = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const total = images.length;
        if (!total) {
          setWindowRange({ start: 0, end: 0 });
          return;
        }
        const el = listRef.current;
        if (!el) {
          setWindowRange({ start: 0, end: Math.min(total, OVERSCAN * 2) });
          return;
        }
        const rect = el.getBoundingClientRect();
        const listTop = rect.top + window.scrollY;
        const y = window.scrollY;
        const viewportH = window.innerHeight;
        const visibleTop = Math.max(0, y - listTop);
        const visibleBottom = visibleTop + viewportH;

        const findIndex = (offset: number) => {
          let lo = 0;
          let hi = total;
          while (lo < hi) {
            const mid = Math.floor((lo + hi) / 2);
            if (heightPrefix[mid + 1] <= offset) {
              lo = mid + 1;
            } else {
              hi = mid;
            }
          }
          return Math.min(total - 1, Math.max(0, lo));
        };

        const startIdx = findIndex(visibleTop);
        const endIdx = findIndex(visibleBottom);
        let start = Math.max(0, startIdx - OVERSCAN);
        let end = Math.min(total, endIdx + OVERSCAN + 1);
        if (end <= start) end = Math.min(total, start + 1);
        setWindowRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));

        const nextPage = startIdx + 1;
        if (nextPage !== lastPageRef.current) {
          lastPageRef.current = nextPage;
          setCurrentPage(nextPage);
          if (savePageTimerRef.current) window.clearTimeout(savePageTimerRef.current);
          savePageTimerRef.current = window.setTimeout(() => {
            const entry: ReadProgress = {
              aid: props.aid,
              updatedAt: Date.now(),
              title: undefined,
              coverUrl: undefined,
              chapterId: chapterMeta.chapterId,
              chapterSort: chapterMeta.chapterSort,
              chapterName: chapterMeta.chapterName,
              pageIndex: nextPage,
            };
            try {
              upsertReadProgress(entry);
              void (async () => {
                try {
                  const { invoke } = await import("@tauri-apps/api/core");
                  await invoke("api_read_progress_upsert", { entry });
                } catch {
                  // ignore
                }
              })();
            } catch {
              // ignore
            }
          }, 400);
        }
      });
    };

    recompute();
    window.addEventListener("scroll", recompute, { passive: true });
    window.addEventListener("resize", recompute);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", recompute);
      window.removeEventListener("resize", recompute);
    };
  }, [chapterMeta.chapterId, chapterMeta.chapterName, chapterMeta.chapterSort, heightPrefix, images.length, props.aid]);

  useEffect(() => {
    if (!props.startPage || props.startPage <= 1) return;
    if (initialScrollDoneRef.current) return;
    if (images.length === 0) return;
    const targetIndex = Math.min(images.length - 1, Math.max(0, props.startPage - 1));
    const offset = heightPrefix[targetIndex] ?? 0;
    initialScrollDoneRef.current = true;
    window.scrollTo({ top: offset, behavior: "instant" as ScrollBehavior });
  }, [heightPrefix, images.length, props.startPage]);

  useEffect(() => {
    return () => {
      if (hideHeaderTimer.current) window.clearTimeout(hideHeaderTimer.current);
    };
  }, []);

  const loadChapter = useCallback(async () => {
    const token = ++chapterLoadToken.current;
    setLoading(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const [raw, scramble] = await Promise.all([
        invoke<unknown>("api_chapter", {
          id: props.chapterId,
          cookies: props.session.cookies,
        }),
        invoke<number>("api_chapter_scramble_id", { id: props.chapterId }).catch((e) => {
          const msg = e instanceof Error ? e.message : String(e);
          if (token === chapterLoadToken.current) setScrambleError(msg);
          return 220980;
        }),
      ]);
      if (token !== chapterLoadToken.current) return;
      setChapter(raw as Chapter);
      setScrambleId(scramble);
      setSegmentNums(null);

      const entry: ReadProgress = {
        aid: props.aid,
        updatedAt: Date.now(),
        title: undefined,
        coverUrl: undefined,
        chapterId: chapterMeta.chapterId,
        chapterSort: chapterMeta.chapterSort,
        chapterName: chapterMeta.chapterName,
        pageIndex: lastPageRef.current ?? 1,
      };
      try {
        upsertReadProgress(entry);
        void (async () => {
          try {
            const { invoke } = await import("@tauri-apps/api/core");
            await invoke("api_read_progress_upsert", { entry });
          } catch {
            // ignore
          }
        })();
      } catch {
        // ignore
      }
    } catch (e) {
      if (token !== chapterLoadToken.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      showToast({ ok: false, text: `章节加载失败：${msg}` });
      setChapter(null);
      setScrambleId(null);
      setSegmentNums(null);
    } finally {
      if (token === chapterLoadToken.current) setLoading(false);
    }
  }, [
    chapterMeta.chapterId,
    chapterMeta.chapterName,
    chapterMeta.chapterSort,
    props.aid,
    props.chapterId,
    props.session.cookies,
    showToast,
  ]);

  useEffect(() => {
    void loadChapter();
  }, [loadChapter]);

  useEffect(() => {
    if (!images.length || scrambleId == null) return;
    let cancelled = false;
    const run = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const nums = await invoke<number[]>("api_segmentation_nums", {
          epsId: props.chapterId,
          scrambleId,
          pictureNames: images.map((i) => i.pictureName),
        });
        if (cancelled) return;
        setSegmentNums(nums);
      } catch {
        if (cancelled) return;
        setSegmentNums(images.map(() => 0));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [images, props.chapterId, scrambleId]);

  const onVisible = useCallback((_index: number) => {
    // no-op: queue is generated on-demand by current page
  }, []);

  useEffect(() => {
    processedRef.current = processed;
  }, [processed]);

  const onRetry = useCallback(
    (index: number) => {
      setProcessed((prev) => {
        const current = prev[index] ?? {};
        const retries = (current.retries ?? 0) + 1;
        return { ...prev, [index]: { ...current, error: undefined, retries } };
      });
      requestPump();
    },
    [requestPump],
  );

  useEffect(() => {
    return () => {
      leavingRef.current = true;
      if (savePageTimerRef.current) window.clearTimeout(savePageTimerRef.current);
      for (const url of objectUrlsByIndex.current.values()) {
        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      }
      objectUrlsByIndex.current.clear();

      // Best-effort cancel when leaving ReadingPage.
      const key = readKeyRef.current;
      void (async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("api_read_cancel", { readKey: key });
        } catch {
          // ignore
        }
      })();
    };
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (leavingRef.current) return;
      if (e.ctrlKey || e.metaKey) return;
      if (e.shiftKey) return;

      // Heuristic: only amplify "mouse wheel" like deltas.
      let deltaPx = e.deltaY;
      if (e.deltaMode === 1) deltaPx *= 16;
      else if (e.deltaMode === 2) deltaPx *= window.innerHeight;

      const abs = Math.abs(deltaPx);
      const isLikelyMouse = e.deltaMode === 1 || abs >= 60;
      if (!isLikelyMouse) return;

      e.preventDefault();
      window.scrollBy({ top: deltaPx * wheelMultiplierRef.current, left: 0, behavior: "auto" });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    wheelMultiplierRef.current = getReadWheelMultiplier();
    maxConcurrencyRef.current = getReadMaxConcurrency();
    return subscribeSettings(() => {
      wheelMultiplierRef.current = getReadWheelMultiplier();
      maxConcurrencyRef.current = getReadMaxConcurrency();
      setGlobalScale(getReadImageScale());
      setWheelMultiplier(getReadWheelMultiplier());
    });
  }, []);

  const triggerMenu = useCallback(() => {
    console.log("[read][menu] trigger");
    setHeaderVisible((v) => !v);
    // 自动关闭先不要
    // if (hideHeaderTimer.current) window.clearTimeout(hideHeaderTimer.current);
    // hideHeaderTimer.current = window.setTimeout(() => {
    //   setHeaderVisible(false);
    // }, 2500);
  }, []);

  return (
    <ReadingPullContainer
      rootRef={rootRef}
      className="min-h-screen bg-zinc-100 p-4 text-zinc-900 sm:p-6"
      loading={loading}
      onRefresh={loadChapter}
      canPullUp={Boolean(nextChapter)}
      onPullUp={() => {
        if (!nextChapter) return;
        props.onOpenChapter(toId(nextChapter.id), formatChapterTitle(nextChapter));
      }}
      resetKey={props.chapterId}
      onRootClick={(e) => {
        const target = e.target as HTMLElement | null;
        if (target?.closest("button, a, input, select, textarea")) return;

        const w = window.innerWidth;
        const h = window.innerHeight;
        const x = (e as unknown as MouseEvent).clientX;
        const y = (e as unknown as MouseEvent).clientY;
        const inCenter = x > w * 0.15 && x < w * 0.85 && y > h * 0.2 && y < h * 0.85;
        if (!inCenter) return;
        triggerMenu();
      }}
    >
      <div className="mx-auto flex w-full min-w-0 max-w-[900px] flex-col gap-4">
        <ReadingPageMenu
          visible={headerVisible}
          chapterTitle={props.chapterTitle}
          localFavBusy={localFavBusy}
          isLocalFav={isLocalFav}
          onToggleLocalFav={handleToggleLocalFav}
          onGoHome={handleGoHome}
          onBack={handleBack}
          onClose={() => setHeaderVisible(false)}
          localScale={localScale}
          effectiveScale={effectiveScale}
          minScalePercent={Math.round(MIN_READ_IMG_SCALE * 100)}
          maxScalePercent={Math.round(MAX_READ_IMG_SCALE * 100)}
          defaultScalePercent={Math.round(DEFAULT_READ_IMG_SCALE * 100)}
          onLocalScaleChange={handleLocalScaleChange}
          onLocalScaleReset={handleLocalScaleReset}
          onLocalScaleFollow={handleLocalScaleFollow}
          wheelMultiplier={wheelMultiplier}
          onWheelMultiplierChange={handleWheelMultiplierChange}
        />
        <ReadingScheduler
          aid={props.aid}
          startPage={props.startPage}
          currentPage={currentPage}
          images={images}
          segmentNums={segmentNums}
          processedRef={processedRef}
          setProcessed={setProcessed}
          objectUrlsByIndex={objectUrlsByIndex}
          readKeyRef={readKeyRef}
          genRef={genRef}
          leavingRef={leavingRef}
          maxConcurrencyRef={maxConcurrencyRef}
          requestToken={pumpToken}
          resetToken={schedulerToken}
          onInflightChange={handleInflightChange}
        />

        {loading ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-600 shadow-sm">
            <Loading />
          </div>
        ) : null}

        {!loading && chapter && images.length === 0 ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-600 shadow-sm">
            没有图片数据（chapter.images 为空）
          </div>
        ) : null}

        {!loading && chapter && images.length ? (
          <ReadingLoadInfo
            imagesLength={images.length}
            imgBase={getImgBase()}
            scrambleId={scrambleId}
            scrambleError={scrambleError}
            segmentReady={Boolean(segmentNums)}
            stats={loadInfoStats}
            inflightPages={inflightPages}
          />
        ) : null}

        <div className="flex flex-col">
          <div ref={listRef}>
            <div style={{ height: `${heightPrefix[windowRange.start] ?? 0}px` }} />
            {images.slice(windowRange.start, windowRange.end).map((img, offset) => {
              const idx = windowRange.start + offset;
              const done = processed[idx];
              const isQueued = !done?.url && !done?.error && !inflightSet.has(idx);
              return (
                <div key={`${idx}-${img.url}`} style={{ paddingBottom: `${ITEM_GAP}px` }}>
                  <ProcessedImage
                    src={img.url}
                    num={segmentNums?.[idx] ?? 0}
                    alt={`p${idx + 1}`}
                    index={idx}
                    height={Math.max(
                      1,
                      Math.round((itemBaseHeights[idx] ?? DEFAULT_ITEM_HEIGHT) * effectiveScale),
                    )}
                    onVisible={onVisible}
                    onRetry={onRetry}
                    onMeasured={(i, h) =>
                      setItemBaseHeights((prev) => (prev[i] === h ? prev : { ...prev, [i]: h }))
                    }
                    processedUrl={processed[idx]?.url}
                    error={processed[idx]?.error}
                    retries={processed[idx]?.retries}
                    isQueued={isQueued}
                  />
                </div>
              );
            })}
            <div style={{ height: `${Math.max(0, totalHeight - (heightPrefix[windowRange.end] ?? 0))}px` }} />
          </div>
        </div>

        {images.length > 0 ? (
          <div className="fixed bottom-6 right-4 z-30 rounded-full bg-black/50 px-3 py-1 text-xs text-white shadow-md backdrop-blur">
            {currentPage}/{images.length}
          </div>
        ) : null}

        <ChapterNavBar
          chapters={props.chapters}
          chapterId={props.chapterId}
          onOpenChapter={props.onOpenChapter}
        />
      </div>
    </ReadingPullContainer>
  );
}
