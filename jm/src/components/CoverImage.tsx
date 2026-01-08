import { useEffect, useState } from "react";

type CoverImageProps = {
  src?: string;
  alt?: string;
  className?: string;
};

const coverCache = new Map<string, string>();
const coverFetches = new Map<string, Promise<string>>();

async function fetchCover(src: string): Promise<string> {
  const cached = coverCache.get(src);
  if (cached) return cached;

  const inflight = coverFetches.get(src);
  if (inflight) return inflight;

  const task = (async () => {
    const { invoke, convertFileSrc } = await import("@tauri-apps/api/core");
    const path = await invoke<string>("api_cover_cache", { url: src });
    const url = convertFileSrc(path, "jmcache");
    coverCache.set(src, url);
    return url;
  })();

  coverFetches.set(src, task);
  try {
    return await task;
  } finally {
    coverFetches.delete(src);
  }
}

export default function CoverImage(props: CoverImageProps) {
  const [resolved, setResolved] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const src = props.src?.trim();
    if (!src) {
      setResolved(null);
      return;
    }
    const cached = coverCache.get(src);
    if (cached) {
      setResolved(cached);
      return;
    }
    if (!/^https?:\/\//.test(src)) {
      setResolved(src);
      return;
    }
    void (async () => {
      try {
        const url = await fetchCover(src);
        if (!cancelled) setResolved(url);
      } catch {
        if (!cancelled) setResolved(src);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.src]);

  const src = resolved ?? props.src;
  if (!src) {
    return <div className={props.className} />;
  }

  return (
    <img
      src={src}
      alt={props.alt ?? ""}
      className={props.className}
      loading="lazy"
      decoding="async"
    />
  );
}
