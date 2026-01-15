import { useEffect, useRef, useState } from "react";

import type { Session } from "../auth/session";
import {
  DEFAULT_WHEEL_MULTIPLIER,
  DEFAULT_READ_IMG_SCALE,
  getReadWheelMultiplier,
  getReadImageScale,
  MAX_WHEEL_MULTIPLIER,
  MAX_READ_IMG_SCALE,
  MIN_WHEEL_MULTIPLIER,
  MIN_READ_IMG_SCALE,
  setReadWheelMultiplier,
  setReadImageScale,
  subscribeSettings,
} from "../settings/userSettings";
import { useToast } from "../components/Toast";
import { Check, HelpCircle } from "lucide-react";

export default function SettingsPage(props: { session: Session; onLogout: () => void }) {
  const { showToast } = useToast();
  const [wheelMultiplier, setWheelMultiplier] = useState(() => getReadWheelMultiplier());
  const [imageScale, setImageScale] = useState(() => getReadImageScale());
  const [socksProxy, setSocksProxy] = useState("");
  const [proxyLoading, setProxyLoading] = useState(false);
  const [proxyMsg, setProxyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [apiBase, setApiBase] = useState("");
  const [apiBaseList, setApiBaseList] = useState<string[]>([]);
  const [cacheStats, setCacheStats] = useState<{
    totalBytes: number;
    totalFiles: number;
    totalComics: number;
    updatedAt: number;
    elapsedMs?: number;
  } | null>(null);
  const [appVersion, setAppVersion] = useState<string>("");
  const [cacheError, setCacheError] = useState("");
  const [cacheRefreshing, setCacheRefreshing] = useState(false);
  const [cacheCleaning, setCacheCleaning] = useState(false);
  const [cacheTipOpen, setCacheTipOpen] = useState(false);
  const cacheTipRef = useRef<HTMLDivElement | null>(null);

  const formatBytes = (bytes: number) => {
    if (!Number.isFinite(bytes)) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let v = Math.max(0, bytes);
    let idx = 0;
    while (v >= 1024 && idx < units.length - 1) {
      v /= 1024;
      idx += 1;
    }
    return `${v.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
  };

  useEffect(() => {
    return subscribeSettings(() => {
      setWheelMultiplier(getReadWheelMultiplier());
      setImageScale(getReadImageScale());
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        setProxyLoading(true);
        const { invoke } = await import("@tauri-apps/api/core");
        const cfg = await invoke<{ socksProxy?: string | null }>("api_config_get");
        if (cancelled) return;
        setSocksProxy(typeof cfg?.socksProxy === "string" ? cfg.socksProxy : "");
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setProxyMsg({ ok: false, text: `读取代理配置失败：${msg}` });
      } finally {
        if (!cancelled) setProxyLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const current = await invoke<string>("api_api_base_current");
        const list = await invoke<string[]>("api_api_base_list");
        if (cancelled) return;
        setApiBase(current);
        setApiBaseList(Array.isArray(list) ? list : []);
      } catch {
        if (!cancelled) {
          setApiBase("");
          setApiBaseList([]);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        const v = await getVersion();
        if (!cancelled) setAppVersion(v);
      } catch {
        if (!cancelled) setAppVersion("");
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!cacheTipOpen) return;
    const onDown = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null;
      if (!target) return;
      if (cacheTipRef.current?.contains(target)) return;
      setCacheTipOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [cacheTipOpen]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const stats = await invoke<{
          totalBytes: number;
          totalFiles: number;
          totalComics: number;
          updatedAt: number;
        }>("api_read_cache_stats");
        if (cancelled) return;
        setCacheStats(stats);
        setCacheError("");
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setCacheError(msg);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshCacheStats = async () => {
    setCacheRefreshing(true);
    setCacheError("");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("api_read_cache_refresh");
      const stats = await invoke<{
        totalBytes: number;
        totalFiles: number;
        totalComics: number;
        updatedAt: number;
        elapsedMs?: number;
      }>("api_read_cache_stats");
      setCacheStats(stats);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCacheError(msg);
    } finally {
      setCacheRefreshing(false);
    }
  };

  const cleanupCache = async () => {
    setCacheCleaning(true);
    setCacheError("");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const stats = await invoke<{
        totalBytes: number;
        totalFiles: number;
        totalComics: number;
        updatedAt: number;
        elapsedMs?: number;
      }>("api_read_cache_cleanup", { maxBytes: 2 * 1024 * 1024 * 1024 });
      setCacheStats(stats);
      showToast({ ok: true, text: "清理完成" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCacheError(msg);
      showToast({ ok: false, text: `清理失败：${msg}` });
    } finally {
      setCacheCleaning(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-600 shadow-sm">
        设置
      </div>

      <div className="hidden rounded-lg border border-zinc-200 bg-white p-4 shadow-sm md:block">
        <div className="mb-3 text-sm font-medium text-zinc-900">账号</div>
        <div className="mb-3 space-y-1 text-sm text-zinc-700">
          <div>用户名：{props.session.user.username}</div>
          <div>UID：{String(props.session.user.uid)}</div>
          <div>
            等级：LV{props.session.user.level}
            {props.session.user.level_name ? ` · ${props.session.user.level_name}` : ""}
          </div>
          <div>金币：{props.session.user.coin}</div>
        </div>
        <button
          type="button"
          className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
          onClick={props.onLogout}
        >
          退出登录
        </button>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="mb-3 text-sm font-medium text-zinc-900">缓存状态</div>
        <div className="mb-2 flex items-center gap-2">
          <button
            type="button"
            className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-sm hover:bg-zinc-50 disabled:opacity-60"
            onClick={() => void refreshCacheStats()}
            disabled={cacheRefreshing || cacheCleaning}
          >
            手动刷新
          </button>
          <div className="relative flex items-center gap-1" ref={cacheTipRef}>
            <button
              type="button"
              className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-sm text-red-600 hover:bg-zinc-50 disabled:opacity-60"
              onClick={() => void cleanupCache()}
              disabled={cacheRefreshing || cacheCleaning}
            >
              清除缓存
            </button>
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-600 hover:bg-zinc-50"
              onClick={() => setCacheTipOpen((v) => !v)}
              aria-label="查看缓存清理策略"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
            {cacheTipOpen ? (
              <div className="absolute left-0 top-9 z-10 w-64 max-w-[75vw] rounded-md border border-zinc-200 bg-white p-2 text-xs text-zinc-700 shadow-md md:left-auto md:right-0">
                超过 2GB 时，从最久未访问的漫画开始清理；每次清理仅删除阅读缓存目录下的内容。
              </div>
            ) : null}
          </div>
          {cacheRefreshing ? <div className="text-xs text-zinc-500">正在计算...</div> : null}
          {cacheCleaning ? <div className="text-xs text-zinc-500">正在清理...</div> : null}
        </div>
        {cacheError ? (
          <div className="text-sm text-red-600">读取失败：{cacheError}</div>
        ) : cacheStats ? (
          <div className="space-y-1 text-sm text-zinc-700">
            <div>阅读缓存：{formatBytes(cacheStats.totalBytes)}</div>
            <div>
              文件数：{cacheStats.totalFiles} · 漫画数：{cacheStats.totalComics}
            </div>
            <div>计算耗时：{cacheStats.elapsedMs ? `${cacheStats.elapsedMs} ms` : "—"}</div>
            <div className="text-xs text-zinc-500">
              更新于：{cacheStats.updatedAt ? new Date(cacheStats.updatedAt).toLocaleString() : "—"}
            </div>
          </div>
        ) : (
          <div className="text-sm text-zinc-500">加载中…</div>
        )}
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="mb-3 text-sm font-medium text-zinc-900">阅读滚动</div>

        <div className="space-y-3">
          <div className="text-sm text-zinc-700">
            鼠标滚轮滚动倍率：<span className="font-medium text-zinc-900">{wheelMultiplier.toFixed(1)}x</span>
          </div>
          <input
            type="range"
            min={MIN_WHEEL_MULTIPLIER}
            max={MAX_WHEEL_MULTIPLIER}
            step={0.1}
            value={wheelMultiplier}
            onChange={(e) => {
              const v = Number(e.currentTarget.value);
              setWheelMultiplier(v);
              setReadWheelMultiplier(v);
            }}
            className="w-full"
          />
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <div>{MIN_WHEEL_MULTIPLIER.toFixed(1)}x</div>
            <div>{MAX_WHEEL_MULTIPLIER.toFixed(1)}x</div>
          </div>
          <div className="text-xs text-zinc-500">
            仅对“鼠标滚轮”增幅，触控板/平滑滚动不受影响。
          </div>
          <button
            type="button"
            className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-50"
            onClick={() => {
              setWheelMultiplier(DEFAULT_WHEEL_MULTIPLIER);
              setReadWheelMultiplier(DEFAULT_WHEEL_MULTIPLIER);
            }}
          >
            恢复默认（{DEFAULT_WHEEL_MULTIPLIER.toFixed(1)}x）
          </button>

          <div className="pt-3 text-sm text-zinc-700">
            阅读图片大小：<span className="font-medium text-zinc-900">{Math.round(imageScale * 100)}%</span>
          </div>
          <input
            type="range"
            min={Math.round(MIN_READ_IMG_SCALE * 100)}
            max={Math.round(MAX_READ_IMG_SCALE * 100)}
            step={5}
            value={Math.round(imageScale * 100)}
            onChange={(e) => {
              const v = Number(e.currentTarget.value) / 100;
              setImageScale(v);
              setReadImageScale(v);
            }}
            className="w-full"
          />
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <div>{Math.round(MIN_READ_IMG_SCALE * 100)}%</div>
            <div>{Math.round(MAX_READ_IMG_SCALE * 100)}%</div>
          </div>
          <button
            type="button"
            className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-50"
            onClick={() => {
              setImageScale(DEFAULT_READ_IMG_SCALE);
              setReadImageScale(DEFAULT_READ_IMG_SCALE);
            }}
          >
            恢复默认（{Math.round(DEFAULT_READ_IMG_SCALE * 100)}%）
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="mb-3 text-sm font-medium text-zinc-900">网络代理</div>
        <div className="space-y-3">
          <div className="text-xs text-zinc-500">
            SOCKS 代理（示例：<span className="font-mono">socks5://127.0.0.1:1080</span>），留空表示不使用代理。
          </div>
          <input
            className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm"
            placeholder="socks5://127.0.0.1:1080"
            value={socksProxy}
            onChange={(e) => setSocksProxy(e.currentTarget.value)}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-50 disabled:opacity-60"
              disabled={proxyLoading}
              onClick={() => {
                void (async () => {
                  try {
                    setProxyLoading(true);
                    setProxyMsg(null);
                    const { invoke } = await import("@tauri-apps/api/core");
                    const v = socksProxy.trim();
                    await invoke("api_config_set_socks_proxy", { proxy: v ? v : null });
                    setProxyMsg({ ok: true, text: "已保存（下次请求生效）" });
                    window.setTimeout(() => setProxyMsg(null), 1500);
                  } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    setProxyMsg({ ok: false, text: `保存失败：${msg}` });
                    window.setTimeout(() => setProxyMsg(null), 2500);
                  } finally {
                    setProxyLoading(false);
                  }
                })();
              }}
            >
              保存
            </button>
            <button
              type="button"
              className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-50 disabled:opacity-60"
              disabled={proxyLoading}
              onClick={() => setSocksProxy("")}
            >
              清空
            </button>
          </div>
          {proxyMsg ? (
            <div
              className={`rounded-md border bg-white p-2 text-sm ${
                proxyMsg.ok ? "border-emerald-200 text-emerald-700" : "border-red-200 text-red-600"
              }`}
            >
              {proxyMsg.text}
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="mb-3 text-sm font-medium text-zinc-900">API 域名</div>
        {apiBaseList.length ? (
          <div className="flex flex-col gap-2 text-sm">
            {apiBaseList.map((base) => {
              const active = apiBase && base === apiBase;
              return (
                <div key={base} className="flex items-center gap-2">
                  <div
                    className={`flex-1 px-2 py-1 text-xs ${
                      active ? "text-emerald-600" : "text-zinc-700"
                    }`}
                  >
                    {base}
                  </div>
                  {active ? (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                      <Check className="h-3 w-3" />
                      当前
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-xs text-zinc-500">暂无可用域名</div>
        )}
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="mb-3 text-sm font-medium text-zinc-900">阅读进度数据库</div>
        <div className="space-y-2 text-xs text-zinc-600">
          <div>导出/导入的是 read-progress.sled 目录的压缩包。</div>
          <div>导入后建议重启应用生效。</div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-50"
            onClick={() => {
              void (async () => {
                try {
                  const { invoke } = await import("@tauri-apps/api/core");
                  const res = await invoke<{ path: string }>("api_read_progress_export", {
                    path: null,
                  });
                  showToast({ ok: true, text: `已导出：${res.path}` });
                } catch (e) {
                  const msg = e instanceof Error ? e.message : String(e);
                  showToast({ ok: false, text: `导出失败：${msg}` });
                }
              })();
            }}
          >
            导出
          </button>
          <button
            type="button"
            className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-50"
            onClick={() => {
              void (async () => {
                try {
                  const { invoke } = await import("@tauri-apps/api/core");
                  const path = window.prompt("导入路径（zip 包）");
                  if (!path || !path.trim()) {
                    showToast({ ok: false, text: "导入路径不能为空" });
                    return;
                  }
                  await invoke("api_read_progress_import", {
                    path: path.trim(),
                  });
                  showToast({ ok: true, text: "已导入，请重启应用生效" });
                } catch (e) {
                  const msg = e instanceof Error ? e.message : String(e);
                  showToast({ ok: false, text: `导入失败：${msg}` });
                }
              })();
            }}
          >
            导入
          </button>
        </div>
      </div>

      {appVersion ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="mb-3 text-sm font-medium text-zinc-900">关于</div>
          <div className="text-sm text-zinc-700">版本：{appVersion}</div>
        </div>
      ) : null}
    </div>
  );
}
