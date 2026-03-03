#  jm-tauri 客户端 🧭

- 🧩 Tauri + React 客户端支持 Windows / macOS / Linux / Android(apk)
- 🛠️ 技术栈：TypeScript、React、Vite、Tailwind CSS、Tauri (Rust)
- ⚠️ 仅供技术研究，请勿用于其他用途
- 💬 如有问题欢迎提 ISSUE
- ✅ 欢迎下载体验：[release](https://github.com/alexsunxl/jm-tauri/releases/latest)

## 功能概览 ✨
- 登录/搜索/详情/阅读
- 详情页评论（列表/回复/安全渲染）
- 在线收藏 / 本地收藏 / 浏览记录
- 分类与排行
- 阅读进度记录、继续阅读
- 代理设置与 API 域名管理（含测速）
- 缓存管理与状态显示
- 下载与本地缓存（按平台写入可写目录）

## why jm-tauri（亮点） 📌
### 性能和体验
- 基于rust和webview，性能好到爆炸
- 阅读图片调度支持“可视区优先 + 慢启动爬升（先低并发快速出首屏的图片，再逐步加速到并发上限）”：先保首屏/可视内容，再自动拉满到并发上限，弱网和高速网络下都更稳更快
### 阅读进度
- 自动记录到章节/页
- 列表内可直接继续阅读
- 支持本地收藏与历史记录的进度联动

## 开发文档 📚
- 图片超分TODO：`doc/sr.md`
- APK/JDK 说明：`doc/android-apk.md`
- 本地运行与构建：`doc/dev.md`

## 参考项目 🔗
- JMComic-Crawler-Python：`https://github.com/hect0x7/JMComic-Crawler-Python`
- JMComic-Api-Java：`https://github.com/JUKOMU/JMComic-Api-Java`
- JMComic-qt：`https://github.com/tonquer/JMComic-qt`
