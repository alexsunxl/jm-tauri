export type ReadProgress = {
  aid: string;
  updatedAt: number;
  title?: string;
  coverUrl?: string;
  chapterId?: string;
  chapterSort?: string;
  chapterName?: string;
  pageIndex?: number;
};

const KEY = "jm_read_progress_v1";

function loadAll(): Record<string, ReadProgress> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, ReadProgress>;
  } catch {
    return {};
  }
}

function saveAll(all: Record<string, ReadProgress>): void {
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function getReadProgress(aid: string): ReadProgress | null {
  const all = loadAll();
  return all[aid] ?? null;
}

export function coalesceReadProgress(
  canonicalAid: string,
  aliases: string[],
  metadata: Pick<ReadProgress, "title" | "coverUrl">,
): { progress: ReadProgress | null; removedAids: string[] } {
  const all = loadAll();
  const keys = [...new Set([canonicalAid, ...aliases].map((aid) => aid.trim()).filter(Boolean))];
  const existing = keys
    .map((aid) => all[aid])
    .filter((entry): entry is ReadProgress => Boolean(entry))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
  if (!existing) return { progress: null, removedAids: [] };

  const normalized: ReadProgress = {
    ...existing,
    aid: canonicalAid,
    title: metadata.title || existing.title,
    coverUrl: metadata.coverUrl || existing.coverUrl,
  };
  const removedAids = keys.filter((aid) => aid !== canonicalAid && Boolean(all[aid]));
  for (const aid of removedAids) delete all[aid];
  all[canonicalAid] = normalized;
  saveAll(all);
  return { progress: normalized, removedAids };
}

export function getAllReadProgress(): ReadProgress[] {
  return Object.values(loadAll()).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export function upsertReadProgress(entry: ReadProgress): void {
  const all = loadAll();
  all[entry.aid] = entry;
  saveAll(all);
}

export function clearReadProgress(aid: string): void {
  const all = loadAll();
  delete all[aid];
  saveAll(all);
}

export function clearReadProgressAliases(aids: string[]): void {
  const all = loadAll();
  for (const aid of new Set(aids.map((value) => value.trim()).filter(Boolean))) {
    delete all[aid];
  }
  saveAll(all);
}
