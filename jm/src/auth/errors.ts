export function isAuthExpiredError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/HTTP_STATUS=(\d{3})/);
  if (m) {
    const status = Number(m[1]);
    if (status === 401 || status === 403) return true;
  }
  return false;
}

