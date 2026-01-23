import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type MutableRefObject,
  type ReactNode,
  type Ref,
} from "react";
import { RefreshCw } from "lucide-react";

const PULL_THRESHOLD = 120;
const PULL_UP_THRESHOLD = 120;
const BOTTOM_TOLERANCE = 24;

function getScrollHeight(): number {
  const doc = document.documentElement;
  const body = document.body;
  return Math.max(doc?.scrollHeight ?? 0, body?.scrollHeight ?? 0);
}

function isAtTop(): boolean {
  return window.scrollY <= 0;
}

function isAtBottom(): boolean {
  const scrollHeight = getScrollHeight();
  return window.innerHeight + window.scrollY >= scrollHeight - BOTTOM_TOLERANCE;
}

export default function ReadingPullContainer(props: {
  loading: boolean;
  onRefresh: () => Promise<void>;
  canPullUp: boolean;
  onPullUp: () => void;
  onRootClick?: (e: MouseEvent<HTMLDivElement>) => void;
  resetKey: string | number;
  rootRef?: Ref<HTMLDivElement>;
  className?: string;
  children: ReactNode;
}) {
  const [touchAction, setTouchAction] = useState<"auto" | "pan-y">("pan-y");
  const [pullDistance, setPullDistance] = useState(0);
  const [pulling, setPulling] = useState(false);
  const [pullUpDistance, setPullUpDistance] = useState(0);
  const [pullingUp, setPullingUp] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const pullHideTimer = useRef<number | null>(null);
  const pullUpHideTimer = useRef<number | null>(null);
  const dragModeRef = useRef<"down" | "up" | null>(null);
  const touchStartRef = useRef(0);
  const lastDeltaRef = useRef(0);
  const rootElRef = useRef<HTMLDivElement | null>(null);
  const lastPullUpDistanceRef = useRef(0);

  useEffect(() => {
    let raf = 0;
    const updateTouchAction = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setTouchAction(isAtTop() || isAtBottom() ? "auto" : "pan-y");
      });
    };
    updateTouchAction();
    window.addEventListener("scroll", updateTouchAction, { passive: true });
    window.addEventListener("resize", updateTouchAction);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", updateTouchAction);
      window.removeEventListener("resize", updateTouchAction);
    };
  }, []);


  useEffect(() => {
    if (!pullingUp) {
      lastPullUpDistanceRef.current = 0;
      return;
    }
    const prev = lastPullUpDistanceRef.current;
    const delta = pullUpDistance - prev;
    if (delta > 0) {
      window.scrollBy({ top: delta, left: 0, behavior: "auto" });
    }
    lastPullUpDistanceRef.current = pullUpDistance;
  }, [pullUpDistance, pullingUp]);

  useEffect(() => {
    setPullDistance(0);
    setPulling(false);
    setPullUpDistance(0);
    setPullingUp(false);
    setRefreshing(false);
    if (pullHideTimer.current) {
      window.clearTimeout(pullHideTimer.current);
      pullHideTimer.current = null;
    }
    if (pullUpHideTimer.current) {
      window.clearTimeout(pullUpHideTimer.current);
      pullUpHideTimer.current = null;
    }
  }, [props.resetKey]);

  useEffect(() => {
    const el = rootElRef.current;
    if (!el) return;

    const onTouchStart = (event: TouchEvent) => {
      if (refreshing || props.loading) return;
      if (event.touches.length !== 1) return;

      const atTop = isAtTop();
      const atBottom = isAtBottom();
      dragModeRef.current = null;
      lastDeltaRef.current = 0;
      touchStartRef.current = event.touches[0]?.clientY ?? 0;

      if (atTop) {
        dragModeRef.current = "down";
        setPulling(true);
        setPullDistance(0);
        return;
      }
      if (atBottom && props.canPullUp) {
        dragModeRef.current = "up";
        setPullingUp(true);
        setPullUpDistance(0);
      }
    };

    const onTouchMove = (event: TouchEvent) => {
      const mode = dragModeRef.current;
      if (!mode) return;
      const touch = event.touches[0];
      if (!touch) return;
      const delta = touch.clientY - touchStartRef.current;

      if (mode === "down") {
        if (delta <= 0 || !isAtTop()) {
          dragModeRef.current = null;
          lastDeltaRef.current = 0;
          setPulling(false);
          setPullDistance(0);
          return;
        }
        const next = Math.min(160, delta);
        lastDeltaRef.current = next;
        setPullDistance(next);
        if (event.cancelable) event.preventDefault();
        return;
      }

      if (mode === "up") {
        if (delta >= 0 || !isAtBottom()) {
          dragModeRef.current = null;
          lastDeltaRef.current = 0;
          setPullingUp(false);
          setPullUpDistance(0);
          return;
        }
        const next = Math.min(160, -delta);
        lastDeltaRef.current = next;
        setPullUpDistance(next);
        if (event.cancelable) event.preventDefault();
      }
    };

    const onTouchEnd = () => {
      const mode = dragModeRef.current;
      if (!mode) return;
      dragModeRef.current = null;

      if (mode === "down") {
        setPulling(false);
        const ready = lastDeltaRef.current >= PULL_THRESHOLD;
        if (ready && !refreshing) {
          setRefreshing(true);
          setPullDistance(PULL_THRESHOLD);
          void (async () => {
            try {
              await props.onRefresh();
            } catch {
              // ignore
            } finally {
              setRefreshing(false);
              if (pullHideTimer.current) window.clearTimeout(pullHideTimer.current);
              pullHideTimer.current = window.setTimeout(() => {
                setPullDistance(0);
                pullHideTimer.current = null;
              }, 800);
            }
          })();
        } else {
          setPullDistance(0);
        }
      } else if (mode === "up") {
        setPullingUp(false);
        const ready = lastDeltaRef.current >= PULL_UP_THRESHOLD;
        if (ready && props.canPullUp) {
          setPullUpDistance(PULL_UP_THRESHOLD);
          if (pullUpHideTimer.current) window.clearTimeout(pullUpHideTimer.current);
          pullUpHideTimer.current = window.setTimeout(() => {
            setPullUpDistance(0);
            pullUpHideTimer.current = null;
          }, 400);
          props.onPullUp();
        } else {
          setPullUpDistance(0);
        }
      }
    };

    const onTouchCancel = () => {
      dragModeRef.current = null;
      lastDeltaRef.current = 0;
      setPulling(false);
      setPullDistance(0);
      setPullingUp(false);
      setPullUpDistance(0);
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchCancel);

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [props.canPullUp, props.loading, props.onPullUp, props.onRefresh, refreshing]);

  const setRootRef = useCallback(
    (node: HTMLDivElement | null) => {
      rootElRef.current = node;
      if (!props.rootRef) return;
      if (typeof props.rootRef === "function") {
        props.rootRef(node);
        return;
      }
      (props.rootRef as MutableRefObject<HTMLDivElement | null>).current = node;
    },
    [props.rootRef],
  );

  return (
    <div
      ref={setRootRef}
      className={props.className}
      style={{ touchAction }}
      onClick={(e) => {
        if (pulling || refreshing || pullDistance > 0 || pullingUp || pullUpDistance > 0) return;
        props.onRootClick?.(e);
      }}
    >
      {pulling || refreshing || pullDistance > 0 ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center">
          <div
            className="inline-flex items-center gap-2 rounded-full bg-emerald-700/80 px-6 py-4 text-base text-white shadow-md backdrop-blur-md"
            style={{
              transform: `translateY(${Math.round(Math.min(220, pullDistance * 1.1))}px)`,
              transition: pulling ? "none" : "transform 1.6s cubic-bezier(0.2, 0.8, 0.2, 1)",
            }}
          >
            <RefreshCw className="h-4 w-4 animate-spin" />
            {refreshing
              ? "正在刷新..."
              : pullDistance >= PULL_THRESHOLD
                ? "松开刷新"
                : "下拉刷新完成"}
          </div>
        </div>
      ) : null}

      {props.children}

      {props.canPullUp && (pullingUp || pullUpDistance > 0) ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[999] flex justify-center">
          <div
            className="inline-flex items-center gap-2 rounded-full bg-emerald-700/80 px-6 py-4 text-base text-white shadow-md backdrop-blur-md"
            style={{
              transform: `translateY(-${Math.round(Math.min(220, pullUpDistance * 1.1))}px)`,
              transition: pullingUp ? "none" : "transform 1.6s cubic-bezier(0.2, 0.8, 0.2, 1)",
            }}
          >
            {pullUpDistance >= PULL_UP_THRESHOLD ? "松开进入下一话" : "上拉进入下一话"}
          </div>
        </div>
      ) : null}
    </div>
  );
}
