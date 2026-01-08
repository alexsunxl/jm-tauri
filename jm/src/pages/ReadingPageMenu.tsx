import { Bookmark, Home, ArrowLeft, X } from "lucide-react";

type ReadingPageMenuProps = {
  visible: boolean;
  chapterTitle: string;
  localFavBusy: boolean;
  isLocalFav: boolean;
  onToggleLocalFav: () => void;
  onGoHome: () => void;
  onBack: () => void;
  onClose: () => void;
  localScale: number | null;
  effectiveScale: number;
  minScalePercent: number;
  maxScalePercent: number;
  defaultScalePercent: number;
  onLocalScaleChange: (value: number) => void;
  onLocalScaleReset: () => void;
  onLocalScaleFollow: () => void;
  wheelMultiplier: number;
  onWheelMultiplierChange: (value: number) => void;
};

export default function ReadingPageMenu(props: ReadingPageMenuProps) {
  return (
    <div
      className={[
        "fixed left-0 right-0 bottom-4 z-50 transition-all duration-200",
        props.visible
          ? "pointer-events-auto translate-y-0 opacity-100"
          : "pointer-events-none translate-y-2 opacity-0",
      ].join(" ")}
    >
      <div className="mx-auto w-full min-w-0 max-w-[900px]" onClick={(e) => e.stopPropagation()}>
        <div className="relative rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <button
            type="button"
            className="absolute right-3 top-3 rounded-full p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 sm:hidden"
            onClick={(ev) => {
              ev.stopPropagation();
              props.onClose();
            }}
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col">
              <div className="text-base font-semibold text-zinc-900">阅读</div>
              <div className="text-sm text-zinc-600">{props.chapterTitle}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
              <button
                type="button"
                className="flex h-9 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
                disabled={props.localFavBusy}
                onClick={(ev) => {
                  ev.stopPropagation();
                  props.onToggleLocalFav();
                }}
              >
                <span className="inline-flex items-center gap-1">
                  <Bookmark className="h-4 w-4" />
                  {props.isLocalFav ? "取消本地" : "本地收藏"}
                </span>
              </button>
              <button
                type="button"
                className="flex h-9 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
                onClick={(ev) => {
                  ev.stopPropagation();
                  props.onGoHome();
                }}
              >
                <span className="inline-flex items-center gap-1">
                  <Home className="h-4 w-4" />
                  返回主页
                </span>
              </button>
              <button
                type="button"
                className="flex h-9 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
                onClick={(ev) => {
                  ev.stopPropagation();
                  props.onBack();
                }}
              >
                <span className="inline-flex items-center gap-1">
                  <ArrowLeft className="h-4 w-4" />
                  返回详情
                </span>
              </button>
            </div>
          </div>
          <div className="mt-3">
            <div className="text-sm text-zinc-700">
              当前漫画大小（局部）：{" "}
              <span className="font-medium text-zinc-900">
                {props.localScale != null ? Math.round(props.localScale * 100) : 100}%
              </span>
              <span className="ml-2 text-xs text-zinc-500">
                实际 {Math.round(props.effectiveScale * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={props.minScalePercent}
              max={props.maxScalePercent}
              step={5}
              value={Math.round((props.localScale ?? 1) * 100)}
              onChange={(e) => {
                const v = Number(e.currentTarget.value) / 100;
                props.onLocalScaleChange(v);
              }}
              className="mt-2 w-full"
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs hover:bg-zinc-50"
                onClick={props.onLocalScaleReset}
              >
                重置局部（{props.defaultScalePercent}%）
              </button>
              <button
                type="button"
                className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs hover:bg-zinc-50"
                onClick={props.onLocalScaleFollow}
              >
                跟随全局
              </button>
            </div>
          </div>

          <div className="mt-4">
            <div className="text-sm text-zinc-700">
              滚动倍率（全局）：{" "}
              <span className="font-medium text-zinc-900">
                {props.wheelMultiplier.toFixed(1)}x
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={6}
              step={0.1}
              value={props.wheelMultiplier}
              onChange={(e) => props.onWheelMultiplierChange(Number(e.currentTarget.value))}
              className="mt-2 w-full"
            />
            <div className="mt-2 flex items-center gap-2 text-xs text-zinc-500">
              <div>1.0x</div>
              <div>6.0x</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
