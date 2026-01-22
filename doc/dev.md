# 本地运行与构建

## 前端开发
```
pnpm install
pnpm dev
```

## Tauri 桌面端
```
pnpm build
cargo tauri dev
```

## Android APK
```
pnpm apk:dev
```
需要正式构建时：
```
cargo tauri android build
```

## 阅读页图片处理阶段与日志建议
阅读页图片处理包含两步：请求/下载图片 + 切割重组（descramble）。相关代码位置：
- 前端队列/调度：`jm/src/pages/ReadingPage.tsx`（`wanted` 队列、`pump` 并发处理、`api_image_descramble_file` 调用）
- 前端解码状态：`ProcessedImage` 组件（直连图像加载、错误/重试）
- 后端解码：`jm/src-tauri/src/lib.rs`（`api_image_descramble_file` → `descramble_image_bytes_with_cancel`）

是否在 UI 拆分显示两个阶段，建议按耗时判断：
- 总耗时 < 300ms：合并为“处理中”，不拆分
- 300–800ms：默认合并，调试/高级信息中展示细节
- > 800ms 或明显卡顿：UI 可拆成“下载中 / 重组中”

为后续日志分析与导出准备的数据建议（每张图片）：
- 队列进入时间、请求开始/结束时间、重组开始/结束时间、总耗时
- 是否来自缓存（若可判断）、图片索引、章节/aid、分割参数 num
- 失败类型、错误码/错误消息、重试次数

汇总与导出建议：
- 按章节/设备/网络类型聚合：P50/P95/P99、失败率、重试次数分布
- 重点关注“重组阶段耗时占比”和“失败类型聚类”，便于定位瓶颈
