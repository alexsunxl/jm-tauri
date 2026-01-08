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
