import { useEffect, useState } from "react";

type CoverImageProps = {
  src?: string;
  alt?: string;
  className?: string;
};

const coverCache = new Map<string, string>();
const coverFetches = new Map<string, Promise<string>>();

function immediateCover(src: string): string | null {
  if (!src) return null;
  const cached = coverCache.get(src);
  if (cached) return cached;
  return /^https?:\/\//.test(src) ? null : src;
}

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
  const source = props.src?.trim() ?? "";
  const [resolved, setResolved] = useState<{ source: string; url: string | null }>(() => ({
    source,
    url: immediateCover(source),
  }));

  useEffect(() => {
    let cancelled = false;
    const immediate = immediateCover(source);
    if (!source || immediate) {
      setResolved({ source, url: immediate });
      return;
    }
    setResolved({ source, url: null });
    void (async () => {
      try {
        const url = await fetchCover(source);
        if (!cancelled) setResolved({ source, url });
      } catch {
        if (!cancelled) setResolved({ source, url: source });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source]);

  const src = resolved.source === source ? resolved.url : immediateCover(source);
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
