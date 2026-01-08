import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  HashRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";

import type { Session } from "./auth/session";
import { clearSession, loadSession, saveSession } from "./auth/session";
import ComicDetailPage from "./pages/ComicDetailPage";
import ReadingPage from "./pages/ReadingPage";
import LoginPage from "./pages/LoginPage";
import SideNav from "./components/SideNav";
import { ToastProvider, useToast } from "./components/Toast";
import HomePage from "./pages/HomePage";
import FavoritesPage from "./pages/FavoritesPage";
import LocalFavoritesPage from "./pages/LocalFavoritesPage";
import CategoryRankPage from "./pages/CategoryRankPage";
import HistoryPage from "./pages/HistoryPage";
import SearchPage from "./pages/SearchPage";
import SettingsPage from "./pages/SettingsPage";

type ChapterNavItem = { id: string | number; sort?: string | number; name?: string };

type HomeSub =
  | "home"
  | "favorites"
  | "local_favorites"
  | "category_rank"
  | "history"
  | "search"
  | "settings";

type ReadingState = {
  chapterTitle?: string;
  chapters?: ChapterNavItem[];
  startPage?: number;
  homeSub?: HomeSub;
  fromPath?: string;
};

function buildReadingPath(aid: string, chapterId: string, chapterTitle?: string) {
  const params = new URLSearchParams();
  if (chapterTitle) params.set("ct", chapterTitle);
  const qs = params.toString();
  return qs ? `/reading/${aid}/${chapterId}?${qs}` : `/reading/${aid}/${chapterId}`;
}

function isSignedToday(record: unknown): boolean {
  const today = new Date().getDate();
  if (!Array.isArray(record)) return false;
  for (const row of record) {
    if (!Array.isArray(row)) continue;
    for (const item of row) {
      const date = Number((item as { date?: unknown }).date);
      const signed = Boolean((item as { signed?: unknown }).signed);
      if (!Number.isNaN(date) && date === today) return signed;
    }
  }
  return false;
}

function extractDailyId(data: any): string {
  const raw = data?.daily_id ?? data?.dailyId ?? data?.dailyID ?? data?.dailyId;
  if (raw == null) return "";
  return String(raw);
}

function normalizeHomeSub(value?: string): HomeSub {
  switch (value) {
    case "favorites":
    case "local_favorites":
    case "category_rank":
    case "history":
    case "search":
    case "settings":
    case "home":
      return value;
    default:
      return "home";
  }
}

function decodeUtf8Base64(s: string): string {
  return decodeURIComponent(escape(window.atob(s)));
}

function homeTitle(sub: HomeSub) {
  switch (sub) {
    case "favorites":
      return "收藏(在线)";
    case "local_favorites":
      return "收藏(本地)";
    case "category_rank":
      return "分类与排行";
    case "history":
      return "浏览记录";
    case "search":
      return "搜索";
    case "settings":
      return "设置";
    default:
      return "首页";
  }
}

function RequireSession(props: { session: Session | null; children: React.ReactElement }) {
  const location = useLocation();
  if (!props.session) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return props.children;
}

function LoginRoute(props: { session: Session | null; onLoggedIn: (s: Session) => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  if (props.session) return <Navigate to="/home/home" replace />;

  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
  const target = from || "/home/home";

  return (
    <LoginPage
      onLoggedIn={(s) => {
        props.onLoggedIn(s);
        navigate(target, { replace: true });
      }}
    />
  );
}

function HomeLayout(props: {
  session: Session;
  onLogout: () => void;
  onAuthExpired: () => void;
}) {
  const location = useLocation();
  const activeSub = normalizeHomeSub(location.pathname.split("/")[2]);
  const user = props.session.user;

  return (
    <div className="min-h-screen bg-zinc-100 p-4 pb-20 text-zinc-900 sm:p-6 md:pb-6">
      <div className="mx-auto flex w-full min-w-0 max-w-[900px] flex-col gap-4">
        <div className="hidden md:flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm">
          <div className="flex flex-col">
            <div className="text-base font-semibold text-zinc-900">{homeTitle(activeSub)}</div>
            <div className="text-sm text-zinc-600">
              {user.username} · LV{user.level} · coin {user.coin}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-[220px_1fr]">
          <div className="hidden md:block">
            <SideNav
              variant="sidebar"
              user={{
                username: user.username,
                uid: user.uid,
                level: user.level,
                levelName: user.level_name,
              }}
            />
          </div>

          <div>
            <Routes>
              <Route
                path="home"
                element={<HomePage session={props.session} onAuthExpired={props.onAuthExpired} />}
              />
              <Route
                path="favorites"
                element={<FavoritesRoute session={props.session} onAuthExpired={props.onAuthExpired} />}
              />
              <Route
                path="local_favorites"
                element={<LocalFavoritesRoute session={props.session} />}
              />
              <Route
                path="category_rank"
                element={<CategoryRankRoute session={props.session} onAuthExpired={props.onAuthExpired} />}
              />
              <Route
                path="history"
                element={<HistoryRoute session={props.session} onAuthExpired={props.onAuthExpired} />}
              />
              <Route
                path="search"
                element={<SearchRoute session={props.session} onAuthExpired={props.onAuthExpired} />}
              />
              <Route
                path="settings"
                element={<SettingsPage session={props.session} onLogout={props.onLogout} />}
              />
              <Route path="" element={<Navigate to="home" replace />} />
            </Routes>
          </div>
        </div>
      </div>

      <div className="md:hidden">
        <SideNav variant="bottom" />
      </div>
    </div>
  );
}

function FavoritesRoute(props: { session: Session; onAuthExpired: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const fromPath = `${location.pathname}${location.search}`;
  const openComic = useCallback((aid: string) => navigate(`/detail/${aid}`), [navigate]);
  const openReader = useCallback(
    (aid: string, chapterId: string, chapterTitle: string, chapters: ChapterNavItem[], startPage?: number) =>
      navigate(buildReadingPath(aid, chapterId, chapterTitle), {
        state: {
          chapterTitle,
          chapters,
          startPage,
          homeSub: "favorites",
          fromPath,
        } satisfies ReadingState,
      }),
    [fromPath, navigate],
  );

  return (
    <FavoritesPage
      session={props.session}
      onAuthExpired={props.onAuthExpired}
      onOpenComic={openComic}
      onOpenReader={openReader}
    />
  );
}

function LocalFavoritesRoute(props: { session: Session }) {
  const navigate = useNavigate();
  const location = useLocation();
  const fromPath = `${location.pathname}${location.search}`;
  const openComic = useCallback((aid: string) => navigate(`/detail/${aid}`), [navigate]);
  const openReader = useCallback(
    (aid: string, chapterId: string, chapterTitle: string, chapters: ChapterNavItem[], startPage?: number) =>
      navigate(buildReadingPath(aid, chapterId, chapterTitle), {
        state: {
          chapterTitle,
          chapters,
          startPage,
          homeSub: "local_favorites",
          fromPath,
        } satisfies ReadingState,
      }),
    [fromPath, navigate],
  );

  return <LocalFavoritesPage session={props.session} onOpenComic={openComic} onOpenReader={openReader} />;
}

function CategoryRankRoute(props: { session: Session; onAuthExpired: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const fromPath = `${location.pathname}${location.search}`;
  const openComic = useCallback(
    (aid: string) => navigate(`/detail/${aid}`, { state: { fromPath } }),
    [fromPath, navigate],
  );

  return (
    <CategoryRankPage
      session={props.session}
      onAuthExpired={props.onAuthExpired}
      onOpenComic={openComic}
      onOpenSearch={(query) => {
        try {
          localStorage.setItem("jm_search_prefill", query);
        } catch {
          // ignore
        }
        navigate("/home/search");
      }}
    />
  );
}

function HistoryRoute(props: { session: Session; onAuthExpired: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const fromPath = `${location.pathname}${location.search}`;
  const openComic = useCallback((aid: string) => navigate(`/detail/${aid}`), [navigate]);
  const openReader = useCallback(
    (aid: string, chapterId: string, chapterTitle: string, chapters: ChapterNavItem[], startPage?: number) =>
      navigate(buildReadingPath(aid, chapterId, chapterTitle), {
        state: {
          chapterTitle,
          chapters,
          startPage,
          homeSub: "history",
          fromPath,
        } satisfies ReadingState,
      }),
    [fromPath, navigate],
  );

  return (
    <HistoryPage
      session={props.session}
      onAuthExpired={props.onAuthExpired}
      onOpenComic={openComic}
      onOpenReader={openReader}
    />
  );
}

function SearchRoute(props: { session: Session; onAuthExpired: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const fromPath = `${location.pathname}${location.search}`;
  const openComic = useCallback(
    (aid: string) => navigate(`/detail/${aid}`, { state: { fromPath } }),
    [fromPath, navigate],
  );

  return <SearchPage session={props.session} onAuthExpired={props.onAuthExpired} onOpenComic={openComic} />;
}

function DetailRoute(props: { session: Session; onAuthExpired: () => void }) {
  const { aid } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const fromPath = (location.state as { fromPath?: string } | null)?.fromPath;
  if (!aid) return <Navigate to="/home/home" replace />;

  return (
    <ComicDetailPage
      session={props.session}
      aid={aid}
      onBack={() => {
        if (fromPath) navigate(fromPath);
        else navigate(-1);
      }}
      onAuthExpired={props.onAuthExpired}
      onOpenSearch={(query) => {
        try {
          localStorage.setItem("jm_search_prefill", query);
        } catch {
          // ignore
        }
        navigate("/home/search");
      }}
      onOpenReader={(chapterId, chapterTitle, chapters, startPage) =>
        navigate(buildReadingPath(aid, chapterId, chapterTitle), {
          state: {
            chapterTitle,
            chapters,
            startPage,
            fromPath: fromPath ?? `/detail/${aid}`,
          } satisfies ReadingState,
        })
      }
    />
  );
}

function ReadingRoute(props: { session: Session }) {
  const { aid, chapterId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as ReadingState;
  const searchParams = new URLSearchParams(location.search);

  if (!aid || !chapterId) return <Navigate to="/home/home" replace />;

  const chapters = Array.isArray(state.chapters) ? state.chapters : [];
  const chapterTitle = state.chapterTitle ?? searchParams.get("ct") ?? "";
  const startPage = typeof state.startPage === "number" ? state.startPage : undefined;
  const homeSub = normalizeHomeSub(state.homeSub);
  const fromPath = state.fromPath ?? `/detail/${aid}`;

  return (
    <ReadingPage
      session={props.session}
      aid={aid}
      chapterId={chapterId}
      chapterTitle={chapterTitle}
      chapters={chapters}
      startPage={startPage}
      onBack={() => navigate(fromPath)}
      onGoHome={() => navigate(`/home/${homeSub}`)}
      onOpenChapter={(nextId, nextTitle) =>
        navigate(buildReadingPath(aid, nextId, nextTitle), {
          replace: true,
          state: {
            chapterTitle: nextTitle,
            chapters,
            homeSub,
          } satisfies ReadingState,
        })
      }
    />
  );
}

function AppRoutes() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const { showToast } = useToast();
  const autoSignRef = useRef<string | null>(null);
  const autoSignPendingRef = useRef(false);
  const autoLoginAttemptedRef = useRef(false);

  const onLoggedIn = useCallback((s: Session) => {
    setSession(s);
    autoSignPendingRef.current = true;
  }, []);

  const onLogout = useCallback(() => {
    clearSession();
    setSession(null);
  }, []);

  const onAuthExpired = useCallback(() => {
    clearSession();
    setSession(null);
  }, []);

  useEffect(() => {
    if (session) return;
    if (autoLoginAttemptedRef.current) return;
    autoLoginAttemptedRef.current = true;

    let autoLoginEnabled = false;
    let username = "";
    let password = "";
    let savePassword = false;
    try {
      autoLoginEnabled = localStorage.getItem("jm_auto_login") === "1";
      savePassword = localStorage.getItem("jm_save_password") === "1";
      username = localStorage.getItem("jm_login_username") ?? "";
      const raw = localStorage.getItem("jm_login_password_b64") ?? "";
      if (raw) password = decodeUtf8Base64(raw);
    } catch {
      autoLoginEnabled = false;
    }
    if (!autoLoginEnabled || !savePassword || !username.trim() || !password) return;

    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const result = await invoke<Session>("login", { username, password });
        const nextSession: Session = { ...result, savedAt: Date.now() };
        saveSession(nextSession);
        setSession(nextSession);
        showToast({ ok: true, text: `自动登录成功：${nextSession.user.username}` });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        showToast({ ok: false, text: `自动登录失败：${msg}` });
        try {
          localStorage.setItem("jm_auto_login", "0");
        } catch {
          // ignore
        }
      }
    })();
  }, [session, showToast]);

  useEffect(() => {
    if (!session) return;
    let enabled = false;
    try {
      enabled = localStorage.getItem("jm_auto_sign") === "1";
    } catch {
      enabled = false;
    }
    if (!enabled) {
      autoSignPendingRef.current = false;
      return;
    }

    const uid = String(session.user?.uid ?? "").trim();
    if (!uid || autoSignRef.current === uid || !autoSignPendingRef.current) return;
    autoSignRef.current = uid;
    autoSignPendingRef.current = false;

    let cancelled = false;
    const run = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const daily = await invoke<any>("api_daily", {
          userId: uid,
          cookies: session.cookies,
        });
        if (cancelled) return;
        const data = daily?.data ?? daily;
        const record = data?.record ?? data?.records ?? [];
        if (isSignedToday(record)) {
          showToast({ ok: true, text: "今日已打卡" });
          return;
        }
        const dailyId = extractDailyId(data);
        if (!dailyId) return;
        await invoke("api_daily_check", {
          userId: uid,
          dailyId,
          cookies: session.cookies,
        });
        showToast({ ok: true, text: "自动打卡成功" });
      } catch {
        // ignore auto sign errors
        showToast({ ok: false, text: "自动打卡失败" });
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [session, showToast]);

  const homeLayout = useMemo(
    () => (session ? <HomeLayout session={session} onLogout={onLogout} onAuthExpired={onAuthExpired} /> : null),
    [onAuthExpired, onLogout, session],
  );

  return (
    <Routes>
      <Route path="/login" element={<LoginRoute session={session} onLoggedIn={onLoggedIn} />} />
      <Route
        path="/home/*"
        element={<RequireSession session={session}>{homeLayout as React.ReactElement}</RequireSession>}
      />
      <Route
        path="/detail/:aid"
        element={
          <RequireSession session={session}>
            <DetailRoute session={session!} onAuthExpired={onAuthExpired} />
          </RequireSession>
        }
      />
      <Route
        path="/reading/:aid/:chapterId"
        element={
          <RequireSession session={session}>
            <ReadingRoute session={session!} />
          </RequireSession>
        }
      />
      <Route path="*" element={<Navigate to={session ? "/home/home" : "/login"} replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <HashRouter>
      <ToastProvider>
        <AppRoutes />
      </ToastProvider>
    </HashRouter>
  );
}
