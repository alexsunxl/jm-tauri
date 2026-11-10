export type PageTransfer = {
  percent?: number;
  speed: number;
  processing?: boolean;
};

const ringMask = "radial-gradient(farthest-side, transparent calc(100% - 7px), #000 calc(100% - 6px))";

export default function PageDownloadRing({
  page, transfer, compact = false,
}: { page: number; transfer?: PageTransfer; compact?: boolean }) {
  const percent = transfer?.percent;
  const speed = `${Math.round(transfer?.speed ?? 0)} k/s`;
  const sweep = percent ?? 24;
  // Distribute the colors over the filled arc, even at low progress.
  const ringFill = sweep > 0
    ? `conic-gradient(#f59e0b, #f97316 ${sweep / 3}%, #e11d48 ${2 * sweep / 3}%, #a21caf ${sweep}%, #d4d4d8 ${sweep}%)`
    : "#d4d4d8";
  return (
    <div className="flex shrink-0 flex-col items-center gap-1 text-xs text-zinc-600">
      <div
        className={`relative grid place-items-center rounded-full bg-zinc-100 ${compact ? "size-14" : "size-16"}`}
        role="progressbar"
        aria-label={`第 ${page} 页图片${transfer?.processing ? "处理" : "下载"}`}
        aria-valuenow={percent == null ? undefined : Math.round(percent)}
        aria-valuetext={transfer?.processing ? "下载完成，处理中" : percent == null ? speed : `${Math.round(percent)}%，${speed}`}
      >
        <span
          aria-hidden="true"
          className={`absolute inset-0 rounded-full ${percent == null ? "motion-safe:animate-spin" : ""}`}
          style={{ background: ringFill, maskImage: ringMask, WebkitMaskImage: ringMask }}
        />
        <span className={`relative whitespace-nowrap font-semibold tabular-nums text-zinc-800 ${compact ? "text-[9px]" : "text-[10px]"}`}>{speed}</span>
      </div>
      <span>p{page}{transfer?.processing ? " · 处理中" : ""}</span>
    </div>
  );
}
