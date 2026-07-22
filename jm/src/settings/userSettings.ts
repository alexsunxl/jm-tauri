const KEY_WHEEL_MULTIPLIER = "jm_read_wheel_multiplier";
const KEY_READ_IMG_SCALE = "jm_read_image_scale";
const KEY_READ_MAX_CONCURRENCY = "jm_read_max_concurrency";
const KEY_CONTINUOUS_READING = "jm_continuous_reading";

export const DEFAULT_WHEEL_MULTIPLIER = 2.2;
export const MIN_WHEEL_MULTIPLIER = 1;
export const MAX_WHEEL_MULTIPLIER = 6;

export const DEFAULT_READ_IMG_SCALE = 1;
export const MIN_READ_IMG_SCALE = 0.3;
export const MAX_READ_IMG_SCALE = 1;

export const DEFAULT_READ_MAX_CONCURRENCY = 4;
export const MIN_READ_MAX_CONCURRENCY = 1;
export const MAX_READ_MAX_CONCURRENCY = 8;

export const DEFAULT_CONTINUOUS_READING = false;

export function getReadWheelMultiplier(): number {
  try {
    const raw = localStorage.getItem(KEY_WHEEL_MULTIPLIER);
    if (!raw) return DEFAULT_WHEEL_MULTIPLIER;
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_WHEEL_MULTIPLIER;
    return Math.min(MAX_WHEEL_MULTIPLIER, Math.max(MIN_WHEEL_MULTIPLIER, n));
  } catch {
    return DEFAULT_WHEEL_MULTIPLIER;
  }
}

export function getReadImageScale(): number {
  try {
    const raw = localStorage.getItem(KEY_READ_IMG_SCALE);
    if (!raw) return DEFAULT_READ_IMG_SCALE;
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_READ_IMG_SCALE;
    return Math.min(MAX_READ_IMG_SCALE, Math.max(MIN_READ_IMG_SCALE, n));
  } catch {
    return DEFAULT_READ_IMG_SCALE;
  }
}

export function getReadMaxConcurrency(): number {
  try {
    const raw = localStorage.getItem(KEY_READ_MAX_CONCURRENCY);
    if (!raw) return DEFAULT_READ_MAX_CONCURRENCY;
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_READ_MAX_CONCURRENCY;
    return Math.min(MAX_READ_MAX_CONCURRENCY, Math.max(MIN_READ_MAX_CONCURRENCY, Math.round(n)));
  } catch {
    return DEFAULT_READ_MAX_CONCURRENCY;
  }
}

export function getContinuousReading(): boolean {
  try {
    return localStorage.getItem(KEY_CONTINUOUS_READING) === "1";
  } catch {
    return DEFAULT_CONTINUOUS_READING;
  }
}

export function setReadWheelMultiplier(v: number) {
  const n = Math.min(MAX_WHEEL_MULTIPLIER, Math.max(MIN_WHEEL_MULTIPLIER, v));
  try {
    localStorage.setItem(KEY_WHEEL_MULTIPLIER, String(n));
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event("jm:settings"));
}

export function setReadImageScale(v: number) {
  const n = Math.min(MAX_READ_IMG_SCALE, Math.max(MIN_READ_IMG_SCALE, v));
  try {
    localStorage.setItem(KEY_READ_IMG_SCALE, String(n));
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event("jm:settings"));
}

export function setReadMaxConcurrency(v: number) {
  const n = Math.min(MAX_READ_MAX_CONCURRENCY, Math.max(MIN_READ_MAX_CONCURRENCY, Math.round(v)));
  try {
    localStorage.setItem(KEY_READ_MAX_CONCURRENCY, String(n));
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event("jm:settings"));
}

export function setContinuousReading(enabled: boolean) {
  try {
    localStorage.setItem(KEY_CONTINUOUS_READING, enabled ? "1" : "0");
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event("jm:settings"));
}

export function subscribeSettings(cb: () => void) {
  const handler = () => cb();
  window.addEventListener("jm:settings", handler);
  return () => window.removeEventListener("jm:settings", handler);
}
