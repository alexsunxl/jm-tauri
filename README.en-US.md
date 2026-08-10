

#  jm-tauri Client 🧭

- 🧩 Tauri + React client supporting Windows / macOS / Linux / Android (apk)
- 🛠️ Tech Stack: TypeScript, React, Vite, Tailwind CSS, Tauri (Rust)
- ⚠️ For technical research only. Please do not use it for other purposes.
- 💬 Feel free to open an ISSUE if you have any questions.
- ✅ Download and try it out: [release](https://github.com/alexsunxl/jm-tauri/releases/latest)

## Feature Overview ✨
- Login / Search / Details / Reading
- Detail page comments (list / reply / safe rendering)
- Online favorites / Local favorites / Browsing history (supplemented with local reading history)
- Categories and Rankings
- Reading progress tracking, continue reading, and progress synchronization across lists
- Offline reading cache: Automatically caches images during browsing. One-click caching for covers, detail/chapter data, and images on the detail page. Cached details can be opened and reading can continue when offline or when the login session expires.
- Cache management: Statistics for total size / file count / manga count; view and delete by manga; threshold-based cleanup (cleans both images and offline detail data simultaneously).
- Proxy settings and API domain management (including speed testing)
- Download and local cache (writes to platform-specific writable directories)

## Why jm-tauri (Highlights) 📌
### Performance & Experience
- Built on Rust and WebView, delivering blazing performance.
- Image loading scheduler supports "viewport priority + slow-start ramp-up (starts with low concurrency to quickly render the first screen, then gradually accelerates to the concurrency limit)": prioritizes above-the-fold/visible content first, then automatically ramps up to the maximum concurrency. Provides more stable and faster loading under both weak and high-speed networks.
### Reading Progress
- Automatically saves progress to chapter/page.
- Supports continue reading directly from the list.
- Progress synchronization supported for local favorites and browsing history.

## Development Documentation 📚
- Image Super-Resolution TODO: `doc/sr.md`
- APK/JDK Instructions: `doc/android-apk.md`
- Local Run & Build: `doc/dev.md`

## Reference Projects 🔗
- JMComic-Crawler-Python: `https://github.com/hect0x7/JMComic-Crawler-Python`
- JMComic-Api-Java: `https://github.com/JUKOMU/JMComic-Api-Java`
- JMComic-qt: `https://github.com/tonquer/JMComic-qt`
