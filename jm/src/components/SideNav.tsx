import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import {
  BookOpen,
  Clock,
  FolderHeart,
  Heart,
  Home,
  Search,
  Settings,
  Tags,
} from "lucide-react";


function Section(props: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="mb-3 text-sm font-medium text-zinc-900">{props.title}</div>
      {props.children}
    </div>
  );
}

export default function SideNav(props: {
  variant?: "sidebar" | "bottom";
  user?: { username: string; uid: unknown; level?: number; levelName?: string };
}) {
  const variant = props.variant ?? "sidebar";
  const iconClass = "h-4 w-4 text-zinc-600";
  const bottomIconClass = "h-5 w-5";
  const [readMenuOpen, setReadMenuOpen] = useState(false);
  const readMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!readMenuOpen) return;
    const onDown = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null;
      if (!target) return;
      if (readMenuRef.current?.contains(target)) return;
      setReadMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [readMenuOpen]);

  if (variant === "bottom") {
    const bottomItems = [
      { key: "home" as const, label: "首页", Icon: Home, to: "/home/home" },
      { key: "read" as const, label: "阅读", Icon: BookOpen },
      { key: "category_rank" as const, label: "排行", Icon: Tags, to: "/home/category_rank" },
      { key: "search" as const, label: "搜索", Icon: Search, to: "/home/search" },
      { key: "settings" as const, label: "设置", Icon: Settings, to: "/home/settings" },
    ];
    return (
      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-zinc-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[900px] items-stretch">
          {bottomItems.map(({ key, label, Icon, to }) =>
            key === "read" ? (
              <div className="relative flex flex-1 items-center justify-center" ref={readMenuRef} key={key}>
                {readMenuOpen ? (
                  <div className="absolute bottom-16 left-1/2 w-40 -translate-x-1/2">
                    <div className="relative rounded-lg border border-zinc-200 bg-white p-2 shadow-lg">
                      <NavLink
                        to="/home/favorites"
                        className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
                        onClick={() => setReadMenuOpen(false)}
                      >
                        <Heart className="h-4 w-4" />
                        在线收藏
                      </NavLink>
                      <NavLink
                        to="/home/local_favorites"
                        className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
                        onClick={() => setReadMenuOpen(false)}
                      >
                        <FolderHeart className="h-4 w-4" />
                        本地收藏
                      </NavLink>
                      <NavLink
                        to="/home/history"
                        className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
                        onClick={() => setReadMenuOpen(false)}
                      >
                        <Clock className="h-4 w-4" />
                        浏览记录
                      </NavLink>
                      <div className="pointer-events-none absolute -bottom-2 left-1/2 -translate-x-1/2">
                        <div className="h-0 w-0 border-x-[12px] border-x-transparent border-t-[12px] border-t-white" />
                      </div>
                    </div>
                  </div>
                ) : null}
                <button
                  type="button"
                  className="flex flex-1 flex-col items-center justify-center gap-1 px-2 py-2 text-[11px] text-zinc-600"
                  onClick={() => setReadMenuOpen((v) => !v)}
                >
                  <BookOpen className={bottomIconClass} />
                  <span>{label}</span>
                </button>
              </div>
            ) : (
            <NavLink
              key={key}
              to={to}
              className={({ isActive }) =>
                [
                  "flex flex-1 flex-col items-center justify-center gap-1 px-2 py-2 text-[11px]",
                  isActive ? "text-zinc-900" : "text-zinc-600",
                ].join(" ")
              }
            >
              <Icon className={bottomIconClass} />
              <span>{label}</span>
            </NavLink>
            ),
          )}
        </div>
      </div>
    );
  }

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    [
      "flex h-10 items-center rounded-md border border-zinc-200 px-3 text-left",
      isActive ? "bg-zinc-50" : "bg-white hover:bg-zinc-50",
    ].join(" ");

  return (
    <div className="flex flex-col gap-3">
      <Section title="导航">
        <div className="flex flex-col gap-2 text-sm">
          <NavLink to="/home/home" end className={navLinkClass}>
            <span className="flex items-center gap-2 leading-none">
              <Home className={iconClass} />
              首页
            </span>
          </NavLink>
          <NavLink to="/home/favorites" className={navLinkClass}>
            <span className="flex items-center gap-2 leading-none">
              <Heart className={iconClass} />
              收藏(在线)
            </span>
          </NavLink>
          <NavLink to="/home/local_favorites" className={navLinkClass}>
            <span className="flex items-center gap-2 leading-none">
              <FolderHeart className={iconClass} />
              收藏(本地)
            </span>
          </NavLink>
          <NavLink to="/home/category_rank" className={navLinkClass}>
            <span className="flex items-center gap-2 leading-none">
              <Tags className={iconClass} />
              分类与排行
            </span>
          </NavLink>
          <NavLink to="/home/history" className={navLinkClass}>
            <span className="flex items-center gap-2 leading-none">
              <Clock className={iconClass} />
              浏览记录
            </span>
          </NavLink>
          <NavLink to="/home/search" className={navLinkClass}>
            <span className="flex items-center gap-2 leading-none">
              <Search className={iconClass} />
              搜索
            </span>
          </NavLink>
          <NavLink to="/home/settings" className={navLinkClass}>
            <span className="flex items-center gap-2 leading-none">
              <Settings className={iconClass} />
              设置
            </span>
          </NavLink>
        </div>
      </Section>

      {props.user ? (
        <Section title="登录信息">
          <div className="space-y-1 text-sm text-zinc-700">
            <div>{props.user.username}</div>
            <div>UID：{String(props.user.uid)}</div>
            {props.user.level != null ? <div>等级：LV{props.user.level}</div> : null}
            {props.user.levelName ? <div>称号：{props.user.levelName}</div> : null}
          </div>
        </Section>
      ) : null}
    </div>
  );
}
