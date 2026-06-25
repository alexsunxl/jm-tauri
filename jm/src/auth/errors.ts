export function isAuthExpiredError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/HTTP_STATUS=(\d{3})/);
  if (m) {
    const status = Number(m[1]);
    if (status === 401 || status === 403) return true;
  }
  const apiCode = msg.match(/API_CODE=(\d+)/);
  if (apiCode) {
    const code = Number(apiCode[1]);
    if (code === 401 || code === 403) return true;
  }
  const lower = msg.toLowerCase();
  if (
    lower.includes("login") &&
    (lower.includes("required") ||
      lower.includes("invalid") ||
      lower.includes("expired") ||
      lower.includes("please"))
  ) {
    return true;
  }
  if (lower.includes("token") && (lower.includes("invalid") || lower.includes("expired"))) {
    return true;
  }
  const compact = msg.replace(/\s+/g, "");
  const hasLoginWord = compact.includes("登录") || compact.includes("登入") || compact.includes("登錄");
  if (
    hasLoginWord &&
    (compact.includes("请先") ||
      compact.includes("請先") ||
      compact.includes("未") ||
      compact.includes("无效") ||
      compact.includes("無效") ||
      compact.includes("失效") ||
      compact.includes("过期") ||
      compact.includes("過期"))
  ) {
    return true;
  }
  return false;
}
