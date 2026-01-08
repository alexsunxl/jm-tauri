# Rust 后端域名切换策略

## 目标
- 监控请求超时/连接失败/服务端错误，自动切换 API 域名。
- 降低单域名不可用时的失败率。

## 当前行为
- API 请求会从域名池中轮询。
- 遇到超时/连接失败/服务端错误（403/5xx/520/524）会自动尝试下一个域名。
- 请求成功后会记住当前可用域名，作为下一次的优先项。

## 域名来源（优先级）
1) 缓存文件 `data/api-domain-list.json`（由后端拉取更新）
2) 配置文件 `data/config.json`（`apiBaseList`）
3) 环境变量 `JM_API_BASE_LIST`（逗号或空白分隔）
4) 环境变量 `JM_API_BASE`
5) 内置默认列表（见 `jm/src-tauri/src/lib.rs`）

## 域名拉取策略（fetch domain）
- 启动时自动触发：在 `tauri::Builder::setup` 中异步调用域名拉取逻辑。
- 拉取源：`JM_API_DOMAIN_SERVER_LIST`（bytepluses 的 `newsvr-2025.txt` 地址）。
- 解码流程：
  1) 先移除返回文本开头的非 ASCII 字符。
  2) 使用 `API_DOMAIN_SERVER_SECRET` 进行 AES-256-ECB 解密（Python 的 `JmCryptoTool.decode_resp_data` 逻辑）。
  3) 解析 JSON 的 `Server` 字段（支持数组或字符串），得到域名列表。
  4) 解码失败时回退为直接解析原始文本。
- 成功后：写入 `data/api-domain-list.json`，并更新内存中的域名池与当前索引。

## 相关日志
- `[tauri][api] domain fetch start|success|error|empty`
- `[tauri][api] domain fetch list: ...`
- `[tauri][api] api domain cache updated: N`

## 相关代码位置
- `jm/src-tauri/src/lib.rs`
  - `load_api_base_list`
  - `fetch_api_domain_list`
  - `api_base_candidates`
  - `should_retry_status`
  - `should_retry_error`

## 可选控制
- 仅使用单域名：设置 `JM_API_BASE` 或只提供一个 `JM_API_BASE_LIST` 项。
