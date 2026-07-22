import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { AlertTriangle, Info, RefreshCw } from "lucide-react";
import type { Session } from "../auth/session";
import { getImgBase } from "../config/endpoints";
import Loading from "../components/Loading";
import { useToast } from "../components/Toast";
import { upsertReadProgress } from "../reading/progress";
import type { ReadProgress } from "../reading/progress";
import { formatChapterTitle, toNavigationId } from "../reading/navigation";
import type { ChapterNavItem } from "../reading/navigation";
import ReadingPageMenu from "./ReadingPageMenu";
import ReadingPullContainer from "./ReadingPullContainer";
import {
  DEFAULT_READ_IMG_SCALE,
  getContinuousReading,
  getReadImageScale,
  getReadMaxConcurrency,
  getReadWheelMultiplier,
  MAX_READ_IMG_SCALE,
  MIN_READ_IMG_SCALE,
  setContinuousReading,
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
  visibleStart: number;
  visibleEnd: number;
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

const ReadingLoadInfo = memo(function ReadingLoadInfo(props: {
  imagesLength: number;
  imgBase: string;
  scrambleId: number | null;
  scrambleError: string;
  segmentReady: boolean;
  stats: LoadInfoStats | null;
  inflightPages: number[];
  errorCount: number;
  onRetryAllErrors: () => void;
}) {
  const [open, setOpen] = useState(false);
  const maxQueuedShow = 6;
  const inflightDisplay = props.inflightPages.slice(0, maxQueuedShow).map((p) => `p${p}`);
  const inflightTotal = props.stats?.inFlight ?? props.inflightPages.length;
  const inflightMore = Math.max(0, inflightTotal - inflightDisplay.length);
  const loadComplete = Boolean(
    props.stats &&
      props.imagesLength > 0 &&
      props.stats.done >= props.imagesLength &&
      props.stats.inFlight === 0 &&
      props.stats.errors === 0,
  );
  useEffect(() => {
    if (open && loadComplete) {
      setOpen(false);
    }
  }, [open, loadComplete]);
  const infoTone = props.errorCount > 0 ? "text-red-200" : loadComplete ? "text-emerald-200" : "text-white";
  return (
    <div className="fixed right-4 top-10 z-40 flex flex-col items-end">
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-full bg-black/60 px-3 py-1 text-xs text-white shadow-md backdrop-blur"
        onClick={() => setOpen((v) => !v)}
      >
        <Info className={`h-3.5 w-3.5 ${infoTone}`} />
        {loadComplete ? "加载完成" : "载入信息"}
        {props.errorCount > 0 ? (
          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-red-500/90 px-2 py-0.5 text-[10px] font-semibold text-white">
            <AlertTriangle className="h-3 w-3" />
            {props.errorCount}
          </span>
        ) : null}
        <span className="ml-2 opacity-75">{open ? "收起" : "展开"}</span>
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
          {props.errorCount > 0 ? (
            <button
              type="button"
              className="mt-2 inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100"
              onClick={props.onRetryAllErrors}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              重试全部错误
            </button>
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
  const rampLimitRef = useRef(1);
  const additiveCounterRef = useRef(0);

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
    imagesRef.current = [];
    segmentNumsRef.current = null;
    rampLimitRef.current = 1;
    additiveCounterRef.current = 0;
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

  const clampRampLimit = useCallback(() => {
    const configuredMax = Math.max(1, props.maxConcurrencyRef.current);
    if (rampLimitRef.current > configuredMax) {
      rampLimitRef.current = configuredMax;
    }
    if (rampLimitRef.current < 1) {
      rampLimitRef.current = 1;
    }
    return configuredMax;
  }, [props.maxConcurrencyRef]);

  const increaseRampLimit = useCallback(() => {
    const configuredMax = clampRampLimit();
    const prev = rampLimitRef.current;
    if (prev >= configuredMax) return false;
    const threshold = Math.min(configuredMax, 4);
    if (prev < threshold) {
      rampLimitRef.current = Math.min(configuredMax, Math.max(1, prev * 2));
      additiveCounterRef.current = 0;
      return rampLimitRef.current !== prev;
    }

    additiveCounterRef.current += 1;
    if (additiveCounterRef.current >= prev) {
      rampLimitRef.current = Math.min(configuredMax, prev + 1);
      additiveCounterRef.current = 0;
    }
    return rampLimitRef.current !== prev;
  }, [clampRampLimit]);

  const decreaseRampLimit = useCallback(() => {
    const configuredMax = clampRampLimit();
    const prev = rampLimitRef.current;
    rampLimitRef.current = Math.max(1, Math.min(configuredMax, Math.floor(prev / 2)));
    additiveCounterRef.current = 0;
    return rampLimitRef.current !== prev;
  }, [clampRampLimit]);

  const pump = useCallback(async () => {
    if (props.leavingRef.current) return;
    const configuredMax = clampRampLimit();
    const maxConcurrency = Math.max(1, Math.min(configuredMax, rampLimitRef.current));

    const currentSegs = segmentNumsRef.current;
    const currentImages = imagesRef.current;
    if (!currentSegs?.length || currentImages.length === 0) return;
    if (currentSegs.length !== currentImages.length) return;
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
    const visibleStart = Math.max(0, Math.min(total, props.visibleStart));
    const visibleEnd = Math.max(visibleStart, Math.min(total, props.visibleEnd));
    const consider = (idx: number) => {
      if (startNow.length >= available) return;
      if (idx < 0 || idx >= total) return;
      const done = props.processedRef.current[idx];
      if (done?.url || done?.error) return;
      if (inFlight.current.has(idx)) return;
      startNow.push(idx);
    };
    for (let i = visibleStart; i < visibleEnd && startNow.length < available; i += 1) {
      consider(i);
    }
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
        let needBackoff = false;
        let shouldRampUp = false;
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
          shouldRampUp = true;
        } catch (e) {
          if (gen !== props.genRef.current) return;
          const msg = e instanceof Error ? e.message : String(e);
          if (msg === "cancelled") return;
          needBackoff = true;
          const retries = props.processedRef.current[idx]?.retries ?? 0;
          props.processedRef.current = {
            ...props.processedRef.current,
            [idx]: { error: msg, retries },
          };
          props.setProcessed((prev) => ({ ...prev, [idx]: { error: msg, retries } }));
        } finally {
          inFlight.current.delete(idx);
          emitInflight();
          if (!props.leavingRef.current && gen === props.genRef.current) {
            if (needBackoff) {
              decreaseRampLimit();
            } else if (shouldRampUp) {
              increaseRampLimit();
            }
          }
          schedulePump();
        }
      })();
    }
  }, [
    clampRampLimit,
    decreaseRampLimit,
    emitInflight,
    increaseRampLimit,
    props.aid,
    props.currentPage,
    props.genRef,
    props.leavingRef,
    props.maxConcurrencyRef,
    props.objectUrlsByIndex,
    props.processedRef,
    props.readKeyRef,
    props.visibleEnd,
    props.visibleStart,
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
  name?: string;
  series?: Array<{ id: string | number; sort?: string | number; name?: string }>;
  images?: string[];
};

type OfflineChapterMeta = {
  chapter?: unknown | null;
  scrambleId?: number | null;
  segmentNums?: number[];
  updatedAt?: number;
};

type OfflineCacheMeta = {
  aid: string;
  album?: unknown | null;
  chapters?: Record<string, OfflineChapterMeta>;
  updatedAt?: number;
};

type ChapterMeta = {
  chapterId: string;
  chapterSort?: string;
  chapterName: string;
};

type ReadingImageListProps = {
  aid: string;
  chapterId: string;
  readTitle?: string;
  coverUrl?: string;
  startPage?: number;
  images: ReadImage[];
  segmentNums: number[] | null;
  chapterMeta: ChapterMeta;
  effectiveScale: number;
  defaultItemHeight: number;
  itemGap: number;
  overscan: number;
  processed: ProcessedMap;
  inflightSet: Set<number>;
  pageIndexRef: Ref<number | null>;
  onRetry: (index: number) => void;
  onPageChange: (page: number) => void;
  onWindowChange: (start: number, end: number) => void;
  onActivePage: (page: number, total: number) => void;
};

const ReadingImageList = memo(function ReadingImageList(props: ReadingImageListProps) {
  const {
    listRef,
    windowRange,
    currentPage,
    itemBaseHeights,
    setItemBaseHeights,
    heightPrefix,
    totalHeight,
    isViewportActive,
  } = useReadingWindow({
    aid: props.aid,
    readTitle: props.readTitle,
    coverUrl: props.coverUrl,
    startPage: props.startPage,
    imagesLength: props.images.length,
    effectiveScale: props.effectiveScale,
    defaultItemHeight: props.defaultItemHeight,
    itemGap: props.itemGap,
    overscan: props.overscan,
    chapterMeta: props.chapterMeta,
    pageIndexRef: props.pageIndexRef,
    resetKey: props.chapterId,
  });

  useEffect(() => {
    props.onPageChange(currentPage);
  }, [currentPage, props.onPageChange]);

  useEffect(() => {
    props.onWindowChange(windowRange.start, windowRange.end);
  }, [props.onWindowChange, windowRange.end, windowRange.start]);

  useEffect(() => {
    if (isViewportActive) props.onActivePage(currentPage, props.images.length);
  }, [currentPage, isViewportActive, props.images.length, props.onActivePage]);

  const handleMeasured = useCallback(
    (index: number, height: number) => {
      setItemBaseHeights((prev) => (prev[index] === height ? prev : { ...prev, [index]: height }));
    },
    [setItemBaseHeights],
  );

  const handleVisible = useCallback((_index: number) => {}, []);

  return (
    <div className="flex flex-col">
      <div ref={listRef}>
        <div style={{ height: `${heightPrefix[windowRange.start] ?? 0}px` }} />
        {props.images.slice(windowRange.start, windowRange.end).map((img, offset) => {
          const idx = windowRange.start + offset;
          const done = props.processed[idx];
          const isQueued = !done?.url && !done?.error && !props.inflightSet.has(idx);
          const base = itemBaseHeights[idx] ?? props.defaultItemHeight;
          const height = Math.max(1, Math.round(base * props.effectiveScale));
          const num = props.segmentNums?.[idx] ?? 0;
          return (
            <div key={`${idx}-${img.url}`} style={{ paddingBottom: `${props.itemGap}px` }}>
              <ProcessedImage
                src={img.url}
                num={num}
                alt={`p${idx + 1}`}
                index={idx}
                height={height}
                onVisible={handleVisible}
                onRetry={props.onRetry}
                onMeasured={handleMeasured}
                processedUrl={props.processed[idx]?.url}
                error={props.processed[idx]?.error}
                retries={props.processed[idx]?.retries}
                isQueued={isQueued}
              />
            </div>
          );
        })}
        <div
          style={{
            height: `${Math.max(0, totalHeight - (heightPrefix[windowRange.end] ?? 0))}px`,
          }}
        />
      </div>
    </div>
  );
});

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

function isEditingKeyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName);
}

function toAuthorText(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) {
    return v.map((x) => toAuthorText(x)).filter(Boolean).join(", ");
  }
  return "";
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

function useReadSettingsState(aid: string) {
  const wheelMultiplierRef = useRef<number>(getReadWheelMultiplier());
  const maxConcurrencyRef = useRef<number>(getReadMaxConcurrency());
  const [wheelMultiplier, setWheelMultiplier] = useState(() => getReadWheelMultiplier());
  const [globalScale, setGlobalScale] = useState(() => getReadImageScale());
  const [localScale, setLocalScale] = useState<number | null>(() => loadLocalImageScale(aid));
  const [continuousReading, setContinuousReadingState] = useState(() => getContinuousReading());

  const effectiveScale = useMemo(
    () => localScale ?? globalScale ?? DEFAULT_READ_IMG_SCALE,
    [globalScale, localScale],
  );

  const handleLocalScaleChange = useCallback(
    (v: number) => {
      setLocalScale(v);
      saveLocalImageScale(aid, v);
    },
    [aid],
  );

  const handleLocalScaleReset = useCallback(() => {
    setLocalScale(DEFAULT_READ_IMG_SCALE);
    saveLocalImageScale(aid, DEFAULT_READ_IMG_SCALE);
  }, [aid]);

  const handleLocalScaleFollow = useCallback(() => {
    setLocalScale(null);
    saveLocalImageScale(aid, null);
  }, [aid]);

  const handleWheelMultiplierChange = useCallback((v: number) => {
    setWheelMultiplier(v);
    setReadWheelMultiplier(v);
  }, []);

  const handleContinuousReadingChange = useCallback((enabled: boolean) => {
    setContinuousReadingState(enabled);
    setContinuousReading(enabled);
  }, []);

  useEffect(() => {
    wheelMultiplierRef.current = getReadWheelMultiplier();
    maxConcurrencyRef.current = getReadMaxConcurrency();
    return subscribeSettings(() => {
      wheelMultiplierRef.current = getReadWheelMultiplier();
      maxConcurrencyRef.current = getReadMaxConcurrency();
      setGlobalScale(getReadImageScale());
      setWheelMultiplier(getReadWheelMultiplier());
      setContinuousReadingState(getContinuousReading());
    });
  }, []);

  return {
    wheelMultiplierRef,
    maxConcurrencyRef,
    wheelMultiplier,
    localScale,
    setLocalScale,
    effectiveScale,
    handleLocalScaleChange,
    handleLocalScaleReset,
    handleLocalScaleFollow,
    handleWheelMultiplierChange,
    continuousReading,
    handleContinuousReadingChange,
  };
}

function useInflightTracker() {
  const [inflightPages, setInflightPages] = useState<number[]>([]);
  const [inflightCount, setInflightCount] = useState(0);

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

  const resetInflight = useCallback(() => {
    setInflightCount(0);
    setInflightPages([]);
  }, []);

  return { inflightPages, inflightCount, inflightSet, handleInflightChange, resetInflight };
}

function useLoadInfoStats(
  processed: ProcessedMap,
  inflightCount: number,
  segmentNums: number[] | null,
) {
  const processedStats = useMemo(() => {
    let done = 0;
    let errors = 0;
    for (const v of Object.values(processed)) {
      if (v.url) done += 1;
      if (v.error) errors += 1;
    }
    return { done, errors };
  }, [processed]);

  const loadInfoStats = useMemo<LoadInfoStats | null>(() => {
    if (!segmentNums) return null;
    return { done: processedStats.done, inFlight: inflightCount, errors: processedStats.errors };
  }, [inflightCount, processedStats, segmentNums]);

  return { loadInfoStats, errorCount: processedStats.errors };
}

function useChapterLoad(params: {
  aid: string;
  chapterId: string;
  cookies: Session["cookies"];
  showToast: (payload: { ok: boolean; text: string }) => void;
}) {
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [loading, setLoading] = useState(false);
  const [scrambleId, setScrambleId] = useState<number | null>(null);
  const [scrambleError, setScrambleError] = useState<string>("");
  const [segmentNums, setSegmentNums] = useState<number[] | null>(null);
  const chapterLoadToken = useRef(0);

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
        url: normalizeImgUrl(p, params.chapterId),
        pictureName: pictureNameFromPath(p),
      }))
      .filter((x) => Boolean(x.url));
  }, [chapter, params.chapterId]);

  const loadChapter = useCallback(async () => {
    const token = ++chapterLoadToken.current;
    setLoading(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const [raw, scramble] = await Promise.all([
        invoke<unknown>("api_chapter", {
          id: params.chapterId,
          cookies: params.cookies,
        }),
        invoke<number>("api_chapter_scramble_id", { id: params.chapterId }).catch((e) => {
          const msg = e instanceof Error ? e.message : String(e);
          if (token === chapterLoadToken.current) setScrambleError(msg);
          return 220980;
        }),
      ]);
      if (token !== chapterLoadToken.current) return;
      setChapter(raw as Chapter);
      setScrambleId(scramble);
      setSegmentNums(null);
      void invoke("api_read_offline_cache_upsert_chapter", {
        aid: params.aid,
        chapterId: params.chapterId,
        chapter: raw,
        scrambleId: scramble,
        segmentNums: [],
      }).catch(() => {
        // ignore offline metadata write failures
      });

    } catch (e) {
      if (token !== chapterLoadToken.current) return;
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const cached = await invoke<OfflineCacheMeta | null>("api_read_offline_cache_get", {
          aid: params.aid,
        });
        const cachedChapter = cached?.chapters?.[params.chapterId];
        if (cachedChapter?.chapter) {
          setChapter(cachedChapter.chapter as Chapter);
          setScrambleId(cachedChapter.scrambleId ?? 220980);
          setSegmentNums(cachedChapter.segmentNums?.length ? cachedChapter.segmentNums : null);
          return;
        }
      } catch {
        // fall through to the original error
      }
      const msg = e instanceof Error ? e.message : String(e);
      params.showToast({ ok: false, text: `章节加载失败：${msg}` });
      setChapter(null);
      setScrambleId(null);
      setSegmentNums(null);
    } finally {
      if (token === chapterLoadToken.current) setLoading(false);
    }
  }, [params.aid, params.chapterId, params.cookies, params.showToast]);

  useEffect(() => {
    setChapter(null);
    setScrambleId(null);
    setScrambleError("");
    setSegmentNums(null);
  }, [params.chapterId]);

  useEffect(() => {
    void loadChapter();
  }, [loadChapter]);

  useEffect(() => {
    if (!images.length || scrambleId == null) return;
    if (segmentNums?.length === images.length) return;
    let cancelled = false;
    const run = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const nums = await invoke<number[]>("api_segmentation_nums", {
          epsId: params.chapterId,
          scrambleId,
          pictureNames: images.map((i) => i.pictureName),
        });
        if (cancelled) return;
        setSegmentNums(nums);
        if (chapter) {
          void invoke("api_read_offline_cache_upsert_chapter", {
            aid: params.aid,
            chapterId: params.chapterId,
            chapter,
            scrambleId,
            segmentNums: nums,
          }).catch(() => {
            // ignore offline metadata write failures
          });
        }
      } catch {
        if (cancelled) return;
        setSegmentNums(images.map(() => 0));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [chapter, images, params.aid, params.chapterId, scrambleId, segmentNums]);

  return { chapter, images, loading, scrambleId, scrambleError, segmentNums, loadChapter };
}

function useReadingWindow(params: {
  aid: string;
  readTitle?: string;
  coverUrl?: string;
  startPage?: number;
  imagesLength: number;
  effectiveScale: number;
  defaultItemHeight: number;
  itemGap: number;
  overscan: number;
  chapterMeta: ChapterMeta;
  pageIndexRef: Ref<number | null>;
  resetKey: string;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [windowRange, setWindowRange] = useState<{ start: number; end: number }>(() => ({
    start: 0,
    end: 0,
  }));
  const [currentPage, setCurrentPage] = useState(1);
  const [isViewportActive, setIsViewportActive] = useState(false);
  const [itemBaseHeights, setItemBaseHeights] = useState<Record<number, number>>({});
  const savePageTimerRef = useRef<number | null>(null);
  const initialScrollDoneRef = useRef(false);
  const viewportActiveRef = useRef(false);

  const heightPrefix = useMemo(() => {
    const prefix = new Array(params.imagesLength + 1);
    prefix[0] = 0;
    for (let i = 0; i < params.imagesLength; i += 1) {
      const base = itemBaseHeights[i] ?? params.defaultItemHeight;
      const scaled = Math.max(1, Math.round(base * params.effectiveScale));
      prefix[i + 1] = prefix[i] + scaled + params.itemGap;
    }
    return prefix;
  }, [itemBaseHeights, params.defaultItemHeight, params.effectiveScale, params.imagesLength, params.itemGap]);

  const totalHeight = heightPrefix[params.imagesLength] ?? 0;

  useEffect(() => {
    setItemBaseHeights({});
    setWindowRange({ start: 0, end: 0 });
    setCurrentPage(1);
    setIsViewportActive(false);
    viewportActiveRef.current = false;
    initialScrollDoneRef.current = false;
  }, [params.resetKey]);

  useEffect(() => {
    let raf = 0;
    const recompute = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const total = params.imagesLength;
        if (!total) {
          setWindowRange({ start: 0, end: 0 });
          return;
        }
        const el = listRef.current;
        if (!el) {
          setWindowRange({ start: 0, end: Math.min(total, params.overscan * 2) });
          return;
        }
        const rect = el.getBoundingClientRect();
        const listTop = rect.top + window.scrollY;
        const y = window.scrollY;
        const viewportH = window.innerHeight;
        const visibleTop = Math.max(0, y - listTop);
        const visibleBottom = visibleTop + viewportH;
        const listBottom = listTop + totalHeight;
        const viewportCenter = y + viewportH / 2;
        const active = viewportCenter >= listTop && viewportCenter < listBottom;
        const becameActive = active && !viewportActiveRef.current;
        viewportActiveRef.current = active;
        setIsViewportActive((prev) => (prev === active ? prev : active));

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
        let start = Math.max(0, startIdx - params.overscan);
        let end = Math.min(total, endIdx + params.overscan + 1);
        if (end <= start) end = Math.min(total, start + 1);
        setWindowRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));

        const nextPage = startIdx + 1;
        if (active && (becameActive || nextPage !== params.pageIndexRef.current)) {
          params.pageIndexRef.current = nextPage;
          setCurrentPage(nextPage);
          if (savePageTimerRef.current) window.clearTimeout(savePageTimerRef.current);
          savePageTimerRef.current = window.setTimeout(() => {
            const entry: ReadProgress = {
              aid: params.aid,
              updatedAt: Date.now(),
              title: params.readTitle,
              coverUrl: params.coverUrl,
              chapterId: params.chapterMeta.chapterId,
              chapterSort: params.chapterMeta.chapterSort,
              chapterName: params.chapterMeta.chapterName,
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
  }, [
    heightPrefix,
    params.aid,
    params.chapterMeta.chapterId,
    params.chapterMeta.chapterName,
    params.chapterMeta.chapterSort,
    params.coverUrl,
    params.imagesLength,
    params.overscan,
    params.pageIndexRef,
    params.readTitle,
    totalHeight,
  ]);

  useEffect(() => {
    if (!params.startPage || params.startPage <= 1) return;
    if (initialScrollDoneRef.current) return;
    if (params.imagesLength === 0) return;
    const targetIndex = Math.min(params.imagesLength - 1, Math.max(0, params.startPage - 1));
    const offset = heightPrefix[targetIndex] ?? 0;
    const listTop = (listRef.current?.getBoundingClientRect().top ?? 0) + window.scrollY;
    initialScrollDoneRef.current = true;
    window.scrollTo({ top: listTop + offset, behavior: "instant" as ScrollBehavior });
  }, [heightPrefix, params.imagesLength, params.startPage]);

  useEffect(() => {
    return () => {
      if (savePageTimerRef.current) window.clearTimeout(savePageTimerRef.current);
    };
  }, []);

  return {
    listRef,
    windowRange,
    currentPage,
    itemBaseHeights,
    setItemBaseHeights,
    heightPrefix,
    totalHeight,
    isViewportActive,
  };
}

type ReadingSegmentActivity = {
  chapterId: string;
  chapterTitle: string;
  page: number;
  total: number;
};

const ReadingChapterSegment = memo(function ReadingChapterSegment(props: {
  session: Session;
  aid: string;
  chapterItem: ChapterNavItem;
  startPage?: number;
  readTitle: string;
  coverUrl: string;
  effectiveScale: number;
  active: boolean;
  showBoundary: boolean;
  maxConcurrencyRef: Ref<number>;
  showToast: (payload: { ok: boolean; text: string }) => void;
  onActivity: (activity: ReadingSegmentActivity) => void;
  onRegisterReload: (chapterId: string, reload: (() => Promise<void>) | null) => void;
  sectionRef: (chapterId: string, node: HTMLElement | null) => void;
}) {
  const chapterId = toNavigationId(props.chapterItem.id);
  const chapterTitle = formatChapterTitle(props.chapterItem);
  const pageIndexRef = useRef<number | null>(null);
  const [processed, setProcessed] = useState<ProcessedMap>({});
  const processedRef = useRef(processed);
  const objectUrlsByIndex = useRef<Map<number, string>>(new Map());
  const readKeyRef = useRef(makeReadKey(props.aid, chapterId));
  const genRef = useRef(0);
  const leavingRef = useRef(false);
  const segmentConcurrencyRef = useRef(1);
  const { inflightPages, inflightCount, inflightSet, handleInflightChange, resetInflight } =
    useInflightTracker();
  const [pumpToken, setPumpToken] = useState(0);
  const [visibleWindow, setVisibleWindow] = useState({ start: 0, end: 0 });
  const [currentPage, setCurrentPage] = useState(1);

  segmentConcurrencyRef.current = props.active
    ? Math.max(1, props.maxConcurrencyRef.current)
    : 1;

  const chapterMeta = useMemo<ChapterMeta>(
    () => ({
      chapterId,
      chapterSort: props.chapterItem.sort != null ? String(props.chapterItem.sort) : undefined,
      chapterName: props.chapterItem.name ?? chapterTitle,
    }),
    [chapterId, chapterTitle, props.chapterItem.name, props.chapterItem.sort],
  );
  const { chapter, images, loading, scrambleId, scrambleError, segmentNums, loadChapter } =
    useChapterLoad({
      aid: props.aid,
      chapterId,
      cookies: props.session.cookies,
      showToast: props.showToast,
    });
  const { loadInfoStats, errorCount } = useLoadInfoStats(processed, inflightCount, segmentNums);

  useEffect(() => {
    if (props.active) setPumpToken((value) => value + 1);
  }, [props.active]);

  useEffect(() => {
    processedRef.current = processed;
  }, [processed]);

  useEffect(() => {
    props.onRegisterReload(chapterId, loadChapter);
    return () => props.onRegisterReload(chapterId, null);
  }, [chapterId, loadChapter, props.onRegisterReload]);

  useEffect(() => {
    readKeyRef.current = makeReadKey(props.aid, chapterId);
    leavingRef.current = false;
    return () => {
      leavingRef.current = true;
      genRef.current += 1;
      resetInflight();
      for (const url of objectUrlsByIndex.current.values()) {
        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      }
      objectUrlsByIndex.current.clear();
      const readKey = readKeyRef.current;
      void (async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("api_read_cancel", { readKey });
        } catch {
          // ignore segment cancellation failures
        }
      })();
    };
  }, [chapterId, props.aid, resetInflight]);

  const handleWindowChange = useCallback((start: number, end: number) => {
    setVisibleWindow((prev) =>
      prev.start === start && prev.end === end ? prev : { start, end },
    );
  }, []);

  const onRetry = useCallback((index: number) => {
    setProcessed((prev) => {
      const current = prev[index] ?? {};
      return {
        ...prev,
        [index]: { ...current, error: undefined, retries: (current.retries ?? 0) + 1 },
      };
    });
    setPumpToken((value) => value + 1);
  }, []);

  const handleRetryAllErrors = useCallback(() => {
    if (errorCount === 0) return;
    setProcessed((prev) => {
      let changed = false;
      const next: ProcessedMap = { ...prev };
      for (const [key, value] of Object.entries(prev)) {
        if (!value?.error) continue;
        next[Number(key)] = {
          ...value,
          error: undefined,
          retries: (value.retries ?? 0) + 1,
        };
        changed = true;
      }
      return changed ? next : prev;
    });
    setPumpToken((value) => value + 1);
  }, [errorCount]);

  const handleActivePage = useCallback(
    (page: number, total: number) => {
      props.onActivity({ chapterId, chapterTitle, page, total });
    },
    [chapterId, chapterTitle, props.onActivity],
  );

  return (
    <section
      ref={(node) => props.sectionRef(chapterId, node)}
      data-reading-chapter={chapterId}
      data-reading-active={props.active ? "true" : "false"}
      className="relative scroll-mt-4"
    >
      {props.showBoundary ? (
        <div className="pointer-events-none sticky top-2 z-20 mb-2 flex justify-center">
          <div className="rounded-full bg-black/60 px-3 py-1 text-xs text-white shadow backdrop-blur">
            {chapterTitle}
          </div>
        </div>
      ) : null}

      <ReadingScheduler
        aid={props.aid}
        startPage={props.startPage}
        currentPage={currentPage}
        visibleStart={visibleWindow.start}
        visibleEnd={visibleWindow.end}
        images={images}
        segmentNums={segmentNums}
        processedRef={processedRef}
        setProcessed={setProcessed}
        objectUrlsByIndex={objectUrlsByIndex}
        readKeyRef={readKeyRef}
        genRef={genRef}
        leavingRef={leavingRef}
        maxConcurrencyRef={segmentConcurrencyRef}
        requestToken={pumpToken}
        resetToken={0}
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

      {props.active && !loading && chapter && images.length ? (
        <ReadingLoadInfo
          imagesLength={images.length}
          imgBase={getImgBase()}
          scrambleId={scrambleId}
          scrambleError={scrambleError}
          segmentReady={Boolean(segmentNums)}
          stats={loadInfoStats}
          inflightPages={inflightPages}
          errorCount={errorCount}
          onRetryAllErrors={handleRetryAllErrors}
        />
      ) : null}

      <ReadingImageList
        aid={props.aid}
        chapterId={chapterId}
        readTitle={props.readTitle}
        coverUrl={props.coverUrl}
        startPage={props.startPage}
        images={images}
        segmentNums={segmentNums}
        chapterMeta={chapterMeta}
        effectiveScale={props.effectiveScale}
        defaultItemHeight={1060}
        itemGap={0}
        overscan={12}
        processed={processed}
        inflightSet={inflightSet}
        pageIndexRef={pageIndexRef}
        onRetry={onRetry}
        onPageChange={setCurrentPage}
        onWindowChange={handleWindowChange}
        onActivePage={handleActivePage}
      />
    </section>
  );
});

export default function ReadingPage(props: {
  session: Session;
  aid: string;
  chapterId: string;
  chapterTitle: string;
  chapters: ChapterNavItem[];
  startPage?: number;
  backLabel?: string;
  onBack: () => void;
  onGoHome: () => void;
  onOpenChapter: (chapterId: string, chapterTitle: string) => void;
}) {
  const {
    wheelMultiplierRef,
    maxConcurrencyRef,
    wheelMultiplier,
    localScale,
    setLocalScale,
    effectiveScale,
    handleLocalScaleChange,
    handleLocalScaleReset,
    handleLocalScaleFollow,
    handleWheelMultiplierChange,
    continuousReading,
    handleContinuousReadingChange,
  } = useReadSettingsState(props.aid);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const leavingRef = useRef(false);
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const reloadRefs = useRef(new Map<string, () => Promise<void>>());
  const pendingAnchorRef = useRef<{ chapterId: string; top: number } | null>(null);
  const pendingScrollChapterRef = useRef<string | null>(null);
  const [headerVisible, setHeaderVisible] = useState(false);
  const [localFavBusy, setLocalFavBusy] = useState(false);
  const [isLocalFav, setIsLocalFav] = useState(false);
  const [albumMeta, setAlbumMeta] = useState<{ title: string; author: string } | null>(null);
  const { showToast } = useToast();

  const sortedChapters = useMemo(() => {
    const seen = new Set<string>();
    const list = (Array.isArray(props.chapters) ? props.chapters : [])
      .filter((chapter) => {
        const id = toNavigationId(chapter.id);
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0));
    if (!seen.has(props.chapterId)) {
      list.push({ id: props.chapterId, sort: list.length + 1, name: props.chapterTitle });
    }
    return list;
  }, [props.chapterId, props.chapterTitle, props.chapters]);

  const chapterSignature = useMemo(
    () => sortedChapters.map((chapter) => toNavigationId(chapter.id)).join("\u0000"),
    [sortedChapters],
  );
  const routeChapterIndex = useMemo(
    () =>
      Math.max(
        0,
        sortedChapters.findIndex((chapter) => toNavigationId(chapter.id) === props.chapterId),
      ),
    [props.chapterId, sortedChapters],
  );
  const initialSegmentIndices = useMemo(() => {
    if (!continuousReading || routeChapterIndex >= sortedChapters.length - 1) {
      return [routeChapterIndex];
    }
    return [routeChapterIndex, routeChapterIndex + 1];
  }, [continuousReading, routeChapterIndex, sortedChapters.length]);
  const [segmentIndices, setSegmentIndices] = useState<number[]>(initialSegmentIndices);
  const segmentIndicesRef = useRef(segmentIndices);
  const [activeActivity, setActiveActivity] = useState<ReadingSegmentActivity>({
    chapterId: props.chapterId,
    chapterTitle: props.chapterTitle,
    page: 1,
    total: 0,
  });

  const chapterWindow = useCallback(
    (centerIndex: number) => {
      const start = Math.max(0, centerIndex - 1);
      const end = Math.min(sortedChapters.length - 1, centerIndex + 1);
      const next: number[] = [];
      for (let index = start; index <= end; index += 1) next.push(index);
      return next;
    },
    [sortedChapters.length],
  );

  const commitSegmentIndices = useCallback((next: number[], anchorChapterId?: string) => {
    const prev = segmentIndicesRef.current;
    if (prev.length === next.length && prev.every((value, index) => value === next[index])) return;
    if (anchorChapterId) {
      const node = sectionRefs.current.get(anchorChapterId);
      if (node) {
        pendingAnchorRef.current = {
          chapterId: anchorChapterId,
          top: node.getBoundingClientRect().top,
        };
      }
    }
    segmentIndicesRef.current = next;
    setSegmentIndices(next);
  }, []);

  useLayoutEffect(() => {
    const scrollChapter = pendingScrollChapterRef.current;
    if (scrollChapter) {
      const node = sectionRefs.current.get(scrollChapter);
      if (node) {
        pendingScrollChapterRef.current = null;
        pendingAnchorRef.current = null;
        node.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }

    const anchor = pendingAnchorRef.current;
    if (!anchor) return;
    pendingAnchorRef.current = null;
    const node = sectionRefs.current.get(anchor.chapterId);
    if (!node) return;
    const delta = node.getBoundingClientRect().top - anchor.top;
    if (Math.abs(delta) >= 1) window.scrollBy({ top: delta, left: 0, behavior: "auto" });
  }, [segmentIndices]);

  const routeKey = props.aid + "\u0000" + props.chapterId + "\u0000" + chapterSignature;
  const previousRouteKeyRef = useRef(routeKey);
  useEffect(() => {
    if (previousRouteKeyRef.current === routeKey) return;
    previousRouteKeyRef.current = routeKey;
    leavingRef.current = false;
    const next =
      continuousReading && routeChapterIndex < sortedChapters.length - 1
        ? [routeChapterIndex, routeChapterIndex + 1]
        : [routeChapterIndex];
    pendingAnchorRef.current = null;
    pendingScrollChapterRef.current = null;
    segmentIndicesRef.current = next;
    setSegmentIndices(next);
    setActiveActivity({
      chapterId: props.chapterId,
      chapterTitle: props.chapterTitle,
      page: 1,
      total: 0,
    });
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [
    continuousReading,
    props.chapterId,
    props.chapterTitle,
    routeChapterIndex,
    routeKey,
    sortedChapters.length,
  ]);

  const previousContinuousReadingRef = useRef(continuousReading);
  useEffect(() => {
    if (previousContinuousReadingRef.current === continuousReading) return;
    previousContinuousReadingRef.current = continuousReading;
    const activeIndex = sortedChapters.findIndex(
      (chapter) => toNavigationId(chapter.id) === activeActivity.chapterId,
    );
    if (activeIndex < 0) return;
    commitSegmentIndices(
      continuousReading ? chapterWindow(activeIndex) : [activeIndex],
      activeActivity.chapterId,
    );
  }, [
    activeActivity.chapterId,
    chapterWindow,
    commitSegmentIndices,
    continuousReading,
    sortedChapters,
  ]);

  useEffect(() => {
    setLocalScale(loadLocalImageScale(props.aid));
  }, [props.aid, setLocalScale]);

  const handleSectionRef = useCallback((chapterId: string, node: HTMLElement | null) => {
    if (node) sectionRefs.current.set(chapterId, node);
    else sectionRefs.current.delete(chapterId);
  }, []);

  const handleRegisterReload = useCallback(
    (chapterId: string, reload: (() => Promise<void>) | null) => {
      if (reload) reloadRefs.current.set(chapterId, reload);
      else reloadRefs.current.delete(chapterId);
    },
    [],
  );

  const handleSegmentActivity = useCallback(
    (activity: ReadingSegmentActivity) => {
      setActiveActivity((prev) =>
        prev.chapterId === activity.chapterId &&
        prev.chapterTitle === activity.chapterTitle &&
        prev.page === activity.page &&
        prev.total === activity.total
          ? prev
          : activity,
      );
      if (!continuousReading) return;
      const activeIndex = sortedChapters.findIndex(
        (chapter) => toNavigationId(chapter.id) === activity.chapterId,
      );
      if (activeIndex >= 0) {
        commitSegmentIndices(chapterWindow(activeIndex), activity.chapterId);
      }
    },
    [chapterWindow, commitSegmentIndices, continuousReading, sortedChapters],
  );

  const activeChapterIndex = useMemo(
    () =>
      sortedChapters.findIndex(
        (chapter) => toNavigationId(chapter.id) === activeActivity.chapterId,
      ),
    [activeActivity.chapterId, sortedChapters],
  );
  const previousChapter =
    activeChapterIndex > 0 ? sortedChapters[activeChapterIndex - 1] : null;
  const nextChapter =
    activeChapterIndex >= 0 && activeChapterIndex < sortedChapters.length - 1
      ? sortedChapters[activeChapterIndex + 1]
      : null;

  const handleOpenChapter = useCallback(
    (chapterId: string, chapterTitle: string, feedbackText?: string) => {
      const targetIndex = sortedChapters.findIndex(
        (chapter) => toNavigationId(chapter.id) === chapterId,
      );
      if (targetIndex < 0 || !continuousReading) {
        showToast({
          ok: true,
          text: feedbackText ?? "正在切换到 " + chapterTitle,
          durationMs: 1200,
        });
        props.onOpenChapter(chapterId, chapterTitle);
        return;
      }

      showToast({
        ok: true,
        text: feedbackText ?? "正在滚动到 " + chapterTitle,
        durationMs: 1200,
      });
      const node = sectionRefs.current.get(chapterId);
      if (node) {
        node.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      pendingScrollChapterRef.current = chapterId;
      commitSegmentIndices(chapterWindow(targetIndex));
    },
    [
      chapterWindow,
      commitSegmentIndices,
      continuousReading,
      props.onOpenChapter,
      showToast,
      sortedChapters,
    ],
  );

  const rootAid = props.aid;
  useEffect(() => {
    let cancelled = false;
    void (async () => {
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
        setAlbumMeta({
          title: typeof raw?.name === "string" ? raw.name : "",
          author: toAuthorText(raw?.author),
        });
      } catch {
        if (!cancelled) setAlbumMeta(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.session.cookies, rootAid]);

  const localFavTitle = useMemo(
    () => albumMeta?.title || "AID " + rootAid,
    [albumMeta?.title, rootAid],
  );
  const coverUrl = useMemo(
    () => getImgBase() + "/media/albums/" + rootAid + "_3x4.jpg",
    [rootAid],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const ok = await invoke<boolean>("api_local_favorite_has", { aid: rootAid });
        if (!cancelled) setIsLocalFav(Boolean(ok));
      } catch {
        if (!cancelled) setIsLocalFav(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rootAid]);

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
        showToast({ ok: true, text: nowFav ? "已添加本地收藏" : "已取消本地收藏" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        showToast({ ok: false, text: "本地收藏失败：" + message });
      } finally {
        setLocalFavBusy(false);
      }
    })();
  }, [albumMeta?.author, coverUrl, localFavTitle, rootAid, showToast]);

  const handleGoHome = useCallback(() => {
    leavingRef.current = true;
    props.onGoHome();
  }, [props.onGoHome]);

  const handleBack = useCallback(() => {
    leavingRef.current = true;
    props.onBack();
  }, [props.onBack]);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (leavingRef.current || event.ctrlKey || event.metaKey || event.shiftKey) return;
      let deltaPx = event.deltaY;
      if (event.deltaMode === 1) deltaPx *= 16;
      else if (event.deltaMode === 2) deltaPx *= window.innerHeight;
      if (event.deltaMode !== 1 && Math.abs(deltaPx) < 60) return;
      event.preventDefault();
      window.scrollBy({
        top: deltaPx * wheelMultiplierRef.current,
        left: 0,
        behavior: "auto",
      });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [wheelMultiplierRef]);

  const triggerMenu = useCallback(() => setHeaderVisible((visible) => !visible), []);
  const showMenu = useCallback(() => setHeaderVisible(true), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || isEditingKeyTarget(event.target)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        showMenu();
        return;
      }
      if (
        (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
        !event.repeat &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        window.matchMedia("(min-width: 768px)").matches
      ) {
        event.preventDefault();
        const target = event.key === "ArrowLeft" ? previousChapter : nextChapter;
        if (target) {
          const title = formatChapterTitle(target);
          handleOpenChapter(
            toNavigationId(target.id),
            title,
            "正在切换到" + (event.key === "ArrowLeft" ? "上一话 " : "下一话 ") + title,
          );
        }
        return;
      }
      if (
        event.key === "Backspace" &&
        !event.repeat &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        handleBack();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleBack, handleOpenChapter, nextChapter, previousChapter, showMenu]);

  const handleRefresh = useCallback(async () => {
    const reload = reloadRefs.current.get(activeActivity.chapterId);
    if (reload) await reload();
  }, [activeActivity.chapterId]);

  return (
    <ReadingPullContainer
      rootRef={rootRef}
      className="safe-area-top min-h-screen bg-zinc-100 p-4 text-zinc-900 sm:p-6"
      loading={false}
      onRefresh={handleRefresh}
      canPullUp={Boolean(nextChapter)}
      onPullUp={() => {
        if (nextChapter) {
          handleOpenChapter(toNavigationId(nextChapter.id), formatChapterTitle(nextChapter));
        }
      }}
      resetKey={props.chapterId + "-" + (continuousReading ? "continuous" : "single")}
      onRootClick={(event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest("button, a, input, select, textarea")) return;
        const x = (event as unknown as MouseEvent).clientX;
        const y = (event as unknown as MouseEvent).clientY;
        const inCenter =
          x > window.innerWidth * 0.15 &&
          x < window.innerWidth * 0.85 &&
          y > window.innerHeight * 0.2 &&
          y < window.innerHeight * 0.85;
        if (inCenter) triggerMenu();
      }}
    >
      <div className="mx-auto flex w-full min-w-0 max-w-[900px] flex-col gap-4">
        <ReadingPageMenu
          visible={headerVisible}
          chapterTitle={activeActivity.chapterTitle}
          chapters={sortedChapters}
          chapterId={activeActivity.chapterId}
          onOpenChapter={handleOpenChapter}
          localFavBusy={localFavBusy}
          isLocalFav={isLocalFav}
          onToggleLocalFav={handleToggleLocalFav}
          onGoHome={handleGoHome}
          onBack={handleBack}
          backLabel={props.backLabel}
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
          continuousReading={continuousReading}
          onContinuousReadingChange={handleContinuousReadingChange}
        />

        {segmentIndices.map((chapterIndex) => {
          const chapterItem = sortedChapters[chapterIndex];
          if (!chapterItem) return null;
          const chapterId = toNavigationId(chapterItem.id);
          return (
            <ReadingChapterSegment
              key={chapterId}
              session={props.session}
              aid={props.aid}
              chapterItem={chapterItem}
              startPage={chapterId === props.chapterId ? props.startPage : undefined}
              readTitle={localFavTitle}
              coverUrl={coverUrl}
              effectiveScale={effectiveScale}
              active={chapterId === activeActivity.chapterId}
              showBoundary={continuousReading}
              maxConcurrencyRef={maxConcurrencyRef}
              showToast={showToast}
              onActivity={handleSegmentActivity}
              onRegisterReload={handleRegisterReload}
              sectionRef={handleSectionRef}
            />
          );
        })}

        {activeActivity.total > 0 ? (
          <div className="fixed bottom-6 right-4 z-30 rounded-full bg-black/50 px-3 py-1 text-xs text-white shadow-md backdrop-blur">
            {activeActivity.page}/{activeActivity.total}
          </div>
        ) : null}
      </div>
    </ReadingPullContainer>
  );
}
