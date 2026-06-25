const IMG_BASE_DEFAULT = "https://cdn-msp.jmapinodeudzn.net";

export function getImgBase(): string {
  try {
    const v = localStorage.getItem("jm_img_base");
    if (v && /^https?:\/\//.test(v)) return v.replace(/\/+$/, "");
  } catch {
    // ignore
  }
  return IMG_BASE_DEFAULT;
}
