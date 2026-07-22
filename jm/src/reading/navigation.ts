export type ChapterNavItem = {
  id: string | number;
  sort?: string | number;
  name?: string;
};

export type ReadingWorkKind = "single" | "multi";

export type ReadingWork = {
  workId: string;
  requestedAid: string;
  albumId?: string;
  seriesId?: string;
  title?: string;
  tags: string[];
  kind: ReadingWorkKind;
  chapters: ChapterNavItem[];
  aliases: string[];
};

export type ReadingTarget = {
  work: ReadingWork;
  chapterId: string;
  chapterTitle: string;
};

type AlbumNavigationData = {
  id?: unknown;
  series_id?: unknown;
  name?: unknown;
  tags?: unknown;
  series?: unknown;
};

type RawChapter = {
  id?: unknown;
  sort?: unknown;
  name?: unknown;
};

export function toNavigationId(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function chapterSortValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const direct = Number(value);
  if (Number.isFinite(direct)) return direct;
  const match = value.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeChapters(value: unknown, fallbackId = ""): ChapterNavItem[] {
  const raw = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const chapters = raw.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const chapter = item as RawChapter;
    const id = toNavigationId(chapter.id);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const sort =
      typeof chapter.sort === "string" || typeof chapter.sort === "number"
        ? chapter.sort
        : index + 1;
    const name = typeof chapter.name === "string" ? chapter.name.trim() : "";
    return [{ id, sort, name, sourceIndex: index }];
  });

  chapters.sort((a, b) => {
    const left = chapterSortValue(a.sort);
    const right = chapterSortValue(b.sort);
    if (left != null && right != null && left !== right) return left - right;
    if (left != null && right == null) return -1;
    if (left == null && right != null) return 1;
    return a.sourceIndex - b.sourceIndex;
  });

  if (chapters.length === 0 && fallbackId) {
    return [{ id: fallbackId, sort: 1, name: "" }];
  }
  return chapters.map(({ sourceIndex: _sourceIndex, ...chapter }) => chapter);
}

export function createReadingWork(
  album: AlbumNavigationData | null | undefined,
  requestedAid: string,
): ReadingWork {
  const requested = toNavigationId(requestedAid);
  const albumId = toNavigationId(album?.id);
  const seriesId = toNavigationId(album?.series_id);
  const title = typeof album?.name === "string" ? album.name.trim() : "";
  const tags = Array.isArray(album?.tags)
    ? [
        ...new Set(
          album.tags
            .filter((tag): tag is string => typeof tag === "string")
            .map((tag) => tag.trim())
            .filter(Boolean),
        ),
      ]
    : [];
  const fallbackId = albumId || requested;
  const chapters = normalizeChapters(album?.series, fallbackId);
  const kind: ReadingWorkKind = chapters.length > 1 ? "multi" : "single";
  const firstChapterId = toNavigationId(chapters[0]?.id);
  const workId =
    kind === "multi"
      ? seriesId || firstChapterId || albumId || requested
      : albumId || firstChapterId || requested;
  const aliases = [
    ...new Set([
      workId,
      requested,
      albumId,
      seriesId,
      ...chapters.map((chapter) => toNavigationId(chapter.id)),
    ]),
  ].filter(Boolean);

  return {
    workId,
    requestedAid: requested || workId,
    albumId: albumId || undefined,
    seriesId: seriesId || undefined,
    title: title || undefined,
    tags,
    kind,
    chapters,
    aliases,
  };
}

export function createReadingWorkFromChapters(
  workId: string,
  chapters: ChapterNavItem[],
): ReadingWork {
  const canonicalId = toNavigationId(workId);
  return createReadingWork(
    {
      id: canonicalId,
      series_id: canonicalId,
      series: chapters,
    },
    canonicalId,
  );
}

export function normalizeReadingWork(
  value: unknown,
  fallbackAid: string,
  fallbackChapters: ChapterNavItem[],
): ReadingWork {
  if (!value || typeof value !== "object") {
    return createReadingWorkFromChapters(fallbackAid, fallbackChapters);
  }
  const raw = value as Partial<ReadingWork>;
  const requestedAid = toNavigationId(raw.requestedAid) || fallbackAid;
  const workId = toNavigationId(raw.workId) || fallbackAid;
  return createReadingWork(
    {
      id: toNavigationId(raw.albumId) || workId,
      series_id: toNavigationId(raw.seriesId) || workId,
      name: typeof raw.title === "string" ? raw.title : undefined,
      tags: Array.isArray(raw.tags) ? raw.tags : [],
      series: Array.isArray(raw.chapters) ? raw.chapters : fallbackChapters,
    },
    requestedAid,
  );
}

export function formatChapterTitle(chapter: ChapterNavItem): string {
  return `第${chapter.sort ?? "?"}话${chapter.name ? `：${chapter.name}` : ""}`;
}

export function createReadingTarget(
  work: ReadingWork,
  chapter: ChapterNavItem,
): ReadingTarget | null {
  const chapterId = toNavigationId(chapter.id);
  if (!chapterId) return null;
  return {
    work,
    chapterId,
    chapterTitle: formatChapterTitle(chapter),
  };
}
