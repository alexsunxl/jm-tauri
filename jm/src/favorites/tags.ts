import { useEffect, useMemo, useState } from "react";

type TaggedFavorite = { aid: string; tags?: string[] | null };

export function normalizeTags(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((tag) => typeof tag === "string")) return null;
  return [...new Set(value.map((tag: string) => tag.trim()).filter(Boolean))];
}

export function aggregateTags(items: TaggedFavorite[], tagsByAid: ReadonlyMap<string, string[]>) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const tags = normalizeTags(item.tags) ?? tagsByAid.get(item.aid);
    if (!tags) return null;
    for (const tag of new Set(tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts].sort(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b, "zh-CN"));
}

/** List rendering never awaits the detail requests; stop queued work on navigation. */
export function useFavoriteTags(items: TaggedFavorite[], cookies: Record<string, string>) {
  const [resolved, setResolved] = useState<{ items: TaggedFavorite[]; tags: Map<string, string[]> }>(() => ({
    items, tags: new Map(),
  }));
  useEffect(() => {
    let cancelled = false;
    const tags = new Map<string, string[]>();
    const missing = items.filter((item) => {
      const known = normalizeTags(item.tags);
      if (known) tags.set(item.aid, known);
      return known == null;
    });
    setResolved({ items, tags: new Map(tags) });
    let cursor = 0;
    const run = async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const worker = async () => {
        while (!cancelled && cursor < missing.length) {
          const item = missing[cursor++];
          try {
            const result = normalizeTags(await invoke<unknown>("api_local_favorite_tags", { aid: item.aid, cookies }));
            if (cancelled) return;
            if (result) {
              tags.set(item.aid, result);
            }
          } catch {
            // Unknown tags stay unknown. Refresh retries them without hiding the books.
          }
        }
      };
      await Promise.all([worker(), worker()]);
      if (!cancelled) setResolved({ items, tags: new Map(tags) });
    };
    if (missing.length) void run().catch(() => { /* Keep the list usable if IPC is unavailable. */ });
    return () => { cancelled = true; };
  }, [cookies, items]);
  return useMemo(() => {
    if (resolved.items === items) return resolved.tags;
    return new Map(items.flatMap((item) => {
      const tags = normalizeTags(item.tags);
      return tags ? [[item.aid, tags] as const] : [];
    }));
  }, [items, resolved]);
}
