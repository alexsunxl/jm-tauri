export type ApiUserInfo = {
  uid: unknown;
  username: string;
  level_name: string;
  level: number;
  coin: number;
  gender?: string;
  favorites: number;
  can_favorites: number;
  exp?: number;
  next_level_exp?: number;
};

export type LoginResult = {
  user: ApiUserInfo;
  cookies: Record<string, string>;
};

export type Session = LoginResult & {
  savedAt: number;
};

const SESSION_KEY = "jm_session_v1";

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

