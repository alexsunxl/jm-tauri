# 图片超分方案（CLI 方案）

目标：在 Rust 侧直接调用成熟的超分命令行工具（ncnn-vulkan 系列），不在 Rust 内实现模型推理。

## 建议工具（任选其一）
- `waifu2x-ncnn-vulkan`：适合二次元线稿、漫画
- `realesrgan-ncnn-vulkan`：更通用，放大效果稳定

## 实现思路
1) Rust 侧准备输入文件（原图或已解码图），调用 CLI：
   - `std::process::Command` 拼接参数：模型、倍率、降噪、输入、输出
   - 输出文件写入 `jmcomic-cache/sr/`，命名可用 hash（url + 参数）
2) 读取输出路径并回传前端，前端优先展示超分图，否则回退原图
3) 结果进入缓存（按现有缓存策略复用），避免重复计算

## 配置项建议
- 模型名（例如 `model=anime_style_art_rgb` / `realesrgan-x4plus-anime`）
- 放大倍率（2x / 3x / 4x）
- 降噪等级（-1~3）
- 是否启用 GPU（vulkan 可选）
- 最大并发（避免卡顿）

## 打包注意
- 各平台分别打包对应二进制与模型文件
- 运行时按平台选择可执行文件路径
- 模型文件较大，建议按需放在 `resources` 并在首次运行解压
