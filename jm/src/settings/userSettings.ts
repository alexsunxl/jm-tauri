const KEY_WHEEL_MULTIPLIER = "jm_read_wheel_multiplier";
const KEY_READ_IMG_SCALE = "jm_read_image_scale";

export const DEFAULT_WHEEL_MULTIPLIER = 2.2;
export const MIN_WHEEL_MULTIPLIER = 1;
export const MAX_WHEEL_MULTIPLIER = 6;

export const DEFAULT_READ_IMG_SCALE = 1;
export const MIN_READ_IMG_SCALE = 0.3;
export const MAX_READ_IMG_SCALE = 1;

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

export function subscribeSettings(cb: () => void) {
  const handler = () => cb();
  window.addEventListener("jm:settings", handler);
  return () => window.removeEventListener("jm:settings", handler);
}
