#  jm-tauri 客户端 🧭

- 🧩 Tauri + React 客户端支持 Windows / macOS / Linux / Android(apk)
- 🛠️ 技术栈：TypeScript、React、Vite、Tailwind CSS、Tauri (Rust)
- ⚠️ 仅供技术研究，请勿用于其他用途
- 💬 如有问题欢迎提 ISSUE
- ✅ 欢迎下载体验：[release](https://github.com/alexsunxl/jm-tauri/releases/latest)

## 功能概览 ✨
- 登录/搜索/详情/阅读
- 详情页评论（列表/回复/安全渲染）
- 在线收藏 / 本地收藏 / 浏览记录（含本地阅读记录补充）
- 分类与排行
- 阅读进度记录、继续阅读、列表进度联动
- 离线阅读缓存：浏览自动缓存图片，详情页一键缓存封面、详情/章节数据与图片，断网或登录态失效时可打开已缓存详情并继续阅读
- 缓存管理：总量/文件数/漫画数统计、按漫画查看与删除、阈值清理（图片与离线详情数据一并清理）
- 代理设置与 API 域名管理（含测速）
- 下载与本地缓存（按平台写入可写目录）

## why jm-tauri（亮点） 📌
### 性能和体验
- 基于rust和webview，性能好到爆炸
- 多话连读：读到章节末尾后上拉即可进入下一话，无需返回目录切换章节
- 阅读图片调度支持“可视区优先 + 网速自适应慢启动”：先单张加载，网速稳定后逐步提高并发；弱网自动回到串行，恢复阈值与降速阈值分开设置，避免反复切换
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
