import { useEffect, useState } from "react";

import type { Session } from "../auth/session";
import { isAuthExpiredError } from "../auth/errors";
import Loading from "../components/Loading";

export default function HomePage(props: { session: Session; onAuthExpired: () => void }) {
  const [latest, setLatest] = useState<unknown[] | null>(null);
  const [promote, setPromote] = useState<unknown[] | null>(null);
  const [loadError, setLoadError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoadError("");
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const [latestRaw, promoteRaw] = await Promise.all([
          invoke<unknown>("api_latest", { page: "0", cookies: props.session.cookies }),
          invoke<unknown>("api_promote", { page: "0", cookies: props.session.cookies }),
        ]);

        if (cancelled) return;
        setLatest(Array.isArray(latestRaw) ? latestRaw : []);
        if (Array.isArray(promoteRaw)) {
          setPromote(promoteRaw);
        } else if (promoteRaw && typeof promoteRaw === "object") {
          const blocks = Object.values(promoteRaw as Record<string, unknown>);
          setPromote(blocks);
        } else {
          setPromote([]);
        }
      } catch (e) {
        if (cancelled) return;
        if (isAuthExpiredError(e)) {
          props.onAuthExpired();
          return;
        }
        const msg = e instanceof Error ? e.message : String(e);
        setLoadError(msg);
        setLatest(null);
        setPromote(null);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [props.onAuthExpired, props.session.cookies]);

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col justify-center gap-3 md:min-h-0 md:justify-start">
      {loadError ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm text-red-600 shadow-sm">
          首页数据加载失败：{loadError}
        </div>
      ) : null}

      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="mb-3 text-sm font-medium text-zinc-900">最近更新</div>
        {latest === null ? (
          <Loading />
        ) : (
          <div className="text-sm text-zinc-700">共 {latest.length} 条（展示原始数据，后续再映射成卡片）</div>
        )}
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="mb-3 text-sm font-medium text-zinc-900">推荐/推广</div>
        {promote === null ? (
          <Loading />
        ) : (
          <div className="text-sm text-zinc-700">共 {promote.length} 个 block（展示原始数据，后续再渲染内容）</div>
        )}
      </div>
    </div>
  );
}
