# jm-tauri Client 🧭

[简体中文](README.md) | [English](README.en-US.md)

- 🧩 Tauri + React client supporting Windows / macOS / Linux / Android (apk)
- 🛠️ Tech Stack: TypeScript, React, Vite, Tailwind CSS, Tauri (Rust)
- ⚠️ For technical research only. Please do not use it for other purposes.
- 💬 Feel free to open an ISSUE if you have any questions.
- ✅ Download and try it out: [release](https://github.com/alexsunxl/jm-tauri/releases/latest)

## Feature Overview ✨

- Login / Search / Details / Reading
- Detail page comments (list / reply / safe rendering)
- Online favorites / Local favorites with tag filters / Browsing history (supplemented with local reading history)
- Categories and Rankings
- Reading progress tracking, continue reading, and progress synchronization across lists
- Continuous reading across chapters (off by default; enable it in Settings or the reading menu)
- Offline reading cache: Automatically caches images during browsing. One-click caching for covers, detail/chapter data, and images on the detail page. Cached details can be opened and reading can continue when offline or when the login session expires.
- Cache management: Statistics for total size / file count / manga count; view and delete by manga; threshold-based cleanup (cleans both images and offline detail data simultaneously).
- Proxy settings and API domain management (including speed testing)
- Download and local cache (writes to platform-specific writable directories)

## Why jm-tauri (Highlights) 📌

### Performance & Experience

- Built with Tauri, Rust, and the system WebView for a cross-platform client.
- Continuous reading: scroll between chapters without returning to the chapter list. On entry, the reader restores the current position, then preloads the next chapter once the first visible image is ready.
- Image loading combines viewport priority with adaptive slow start: begins with one image at a time, increases concurrency when the connection is fast enough, and returns to serial loading on slow connections. Separate recovery and slowdown thresholds prevent frequent switching.
- Chapters share a concurrency limit, with the current chapter taking priority. Cache hits and image processing time are excluded from bandwidth measurements.

### Local Favorite Tag Filters

- Compact tag buttons appear below the Single / Multi chapter tabs. Each tag shows its manga count; duplicate tags within one manga count only once.
- Select a tag to filter either list or card view, alongside text search. Select All or the trailing × button to clear the tag filter.
- Tags are fetched from manga details and cached, reusing previously viewed or offline details. Aggregation runs in the background without blocking the favorites list. Filters appear only when the data is complete; use Refresh to retry failed requests.

### Reading Progress

- Automatically saves progress to chapter/page.
- Supports continue reading directly from the list.
- Progress synchronization supported for local favorites and browsing history.

## Development Documentation 📚

- [Local Run & Build, Tag Caching, and Loading Policy](doc/dev.md)
- [Continuous Reading Design and Current Implementation](doc/continuous-reading.md)
- [APK/JDK Instructions](doc/android-apk.md)
- [Image Super-Resolution TODO](doc/sr.md)

## Reference Projects 🔗

- [JMComic-Crawler-Python](https://github.com/hect0x7/JMComic-Crawler-Python)
- [JMComic-Api-Java](https://github.com/JUKOMU/JMComic-Api-Java)
- [JMComic-qt](https://github.com/tonquer/JMComic-qt)
