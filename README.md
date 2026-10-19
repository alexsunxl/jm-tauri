# jm-tauri 客户端 🧭

[简体中文](README.md) | [English](README.en-US.md)

- 🧩 Tauri + React 客户端支持 Windows / macOS / Linux / Android(apk)
- 🛠️ 技术栈：TypeScript、React、Vite、Tailwind CSS、Tauri (Rust)
- ⚠️ 仅供技术研究，请勿用于其他用途
- 💬 如有问题欢迎提 ISSUE
- ✅ 欢迎下载体验：[release](https://github.com/alexsunxl/jm-tauri/releases/latest)

## 功能概览 ✨

- 登录/搜索/详情/阅读
- 详情页评论（列表/回复/安全渲染）
- 在线收藏 / 本地收藏（支持标签聚合与筛选）/ 浏览记录（含本地阅读记录补充）
- 分类与排行
- 阅读进度记录、继续阅读、列表进度联动
- 多话连续阅读（默认关闭，可在设置页或阅读菜单开启）
- 离线阅读缓存：浏览自动缓存图片，详情页一键缓存封面、详情/章节数据与图片，断网或登录态失效时可打开已缓存详情并继续阅读
- 缓存管理：总量/文件数/漫画数统计、按漫画查看与删除、阈值清理（图片与离线详情数据一并清理）
- 代理设置与 API 域名管理（含测速）
- 下载与本地缓存（按平台写入可写目录）

## why jm-tauri（亮点） 📌

### 性能和体验

- 基于 Rust 与系统 WebView，使用 Tauri 构建跨平台客户端
- 多话连读：开启后可跨话连续滚动；首次进入先定位当前话，首张可见图片就绪后即预加载下一话
- 图片加载支持“可视区优先 + 网速自适应慢启动”：先单张加载，网速足够快时逐步提高并发；弱网回到串行，恢复和降速采用不同阈值，避免反复切换
- 连续阅读的各话共用并发上限，优先加载当前话；缓存命中和图片处理耗时不参与网速判断

### 本地收藏标签分类

- 在“单话 / 多话”下方显示紧凑的标签分类，每个标签附带漫画数量，同一本中的重复标签只计一次
- 点击标签过滤列表或卡片，可与文字搜索组合使用；点击“全部”或末尾“×”清空标签筛选
- 自动从详情补取并缓存标签，复用已浏览或离线详情；后台异步整理，不阻塞收藏列表，数据完整后才显示分类，获取失败可通过“刷新”重试

### 阅读进度

- 自动记录到章节/页
- 列表内可直接继续阅读
- 支持本地收藏与历史记录的进度联动

## 开发文档 📚

- [本地运行与构建、标签缓存和加载策略](doc/dev.md)
- [连续阅读设计与当前实现](doc/continuous-reading.md)
- [APK/JDK 说明](doc/android-apk.md)
- [图片超分 TODO](doc/sr.md)

## 参考项目 🔗

- [JMComic-Crawler-Python](https://github.com/hect0x7/JMComic-Crawler-Python)
- [JMComic-Api-Java](https://github.com/JUKOMU/JMComic-Api-Java)
- [JMComic-qt](https://github.com/tonquer/JMComic-qt)
