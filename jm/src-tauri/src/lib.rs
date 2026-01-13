// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use std::collections::HashMap;
use std::io::Cursor;
use std::io::Write as _;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::sync::{OnceLock, atomic::AtomicUsize};
use std::time::{Duration, Instant};

use aes::Aes256;
use base64::Engine as _;
use cipher::{block_padding::NoPadding, BlockDecryptMut, KeyInit};
use image::ImageFormat;
use serde::de::Deserializer;
use serde::{Deserialize, Serialize};
use tauri::Manager;

static LOG_WRITER: OnceLock<Mutex<std::io::BufWriter<std::fs::File>>> = OnceLock::new();
static LOG_LINE_COUNT: AtomicUsize = AtomicUsize::new(0);
static APP_CONFIG: OnceLock<Mutex<AppConfig>> = OnceLock::new();
static COVER_SEMAPHORE: OnceLock<tokio::sync::Semaphore> = OnceLock::new();
static REGISTER_COOKIE_JAR: OnceLock<Arc<reqwest::cookie::Jar>> = OnceLock::new();
static JM_API_BASES: OnceLock<Mutex<Vec<String>>> = OnceLock::new();
static JM_API_BASE_INDEX: AtomicUsize = AtomicUsize::new(0);
static READ_PROGRESS_DB: OnceLock<Result<sled::Db, String>> = OnceLock::new();

const JM_HEADER_VER: &str = "1.7.5";
const JM_APP_VERSION: &str = "2.0.6";
// const JM_API_BASE_DEFAULT: &str = "https://www.jmapiproxyxxx.vip";
const JM_API_BASE_DEFAULT: &str = "https://www.cdnhth.club";
const JM_API_BASE_LIST_DEFAULT: &[&str] = &[
            "www.cdngwc.cc",
];
const JM_API_DOMAIN_SERVER_LIST: &[&str] = &[
    "https://rup4a04-c01.tos-ap-southeast-1.bytepluses.com/newsvr-2025.txt",
    "https://rup4a04-c02.tos-cn-hongkong.bytepluses.com/newsvr-2025.txt",
];
const JM_WEB_BASE_DEFAULT: &str = "https://18-comicblade.art";
const JM_APP_DATA_SECRET_DEFAULT: &str = "185Hcomic3PAPP7R";
const JM_APP_TOKEN_SECRET_DEFAULT: &str = "18comicAPP";
const JM_APP_TOKEN_SECRET_2_DEFAULT: &str = "18comicAPPContent";
const JM_API_DOMAIN_SERVER_SECRET: &str = "diosfjckwpqpdfjkvnqQjsik";

macro_rules! logl {
    () => {
        log_line(file!(), line!(), format_args!(""));
    };
    ($($arg:tt)+) => {
        log_line(file!(), line!(), format_args!($($arg)+));
    };
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AppConfig {
    #[serde(default)]
    socks_proxy: Option<String>,
    #[serde(default)]
    api_base_list: Vec<String>,
    #[serde(default)]
    session_cookies: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalFavoriteItem {
    aid: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    author: String,
    #[serde(default)]
    cover_url: String,
    added_at: i64,
    updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ReadCacheStats {
  total_bytes: u64,
  total_files: u64,
  total_comics: u64,
  updated_at: i64,
  elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ReadCacheComicStats {
    aid: String,
    files: u64,
    bytes: u64,
    updated_at: i64,
}

#[derive(Debug, Clone)]
struct ReadCacheDirStats {
    aid: String,
    bytes: u64,
    newest_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadProgressEntry {
    aid: String,
    updated_at: i64,
    #[serde(default)]
    chapter_id: Option<String>,
    #[serde(default)]
    chapter_sort: Option<String>,
    #[serde(default)]
    chapter_name: Option<String>,
    #[serde(default)]
    page_index: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FollowStateEntry {
    aid: String,
    last_known_chapter_id: String,
    last_known_chapter_sort: Option<String>,
    updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FollowUpdateEntry {
    aid: String,
    latest_chapter_id: String,
    latest_chapter_sort: Option<String>,
    updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalFavoriteView {
    aid: String,
    title: String,
    author: String,
    cover_url: String,
    added_at: i64,
    updated_at: i64,
    latest_chapter_sort: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LatestChapterEntry {
    aid: String,
    latest_chapter_id: String,
    latest_chapter_sort: Option<String>,
    updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LatestScanEntry {
    aid: String,
    scanned_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ComicExtraEntry {
    id: String,
    #[serde(default)]
    page_count: u64,
    #[serde(default)]
    updated_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportResult {
    path: String,
}

struct LocalFavoritesStore {
    tree: Option<sled::Tree>,
    init_error: Option<String>,
}

impl LocalFavoritesStore {
    fn open() -> Self {
        let base_dir = match resolve_data_dir() {
            Ok(p) => p,
            Err(e) => {
                logl!("[tauri][localfav] resolve data dir failed: {e}");
                return Self {
                    tree: None,
                    init_error: Some(e),
                };
            }
        };

        let db_dir = base_dir.join("local-favorites.sled");
        match sled::open(&db_dir)
            .and_then(|db| db.open_tree("local_favorites").map(|t| (db, t)))
        {
            Ok((_db, tree)) => {
                logl!("[tauri][localfav] sled opened at {:?}", db_dir);
                Self {
                    tree: Some(tree),
                    init_error: None,
                }
            }
            Err(e) => {
                let msg = format!("open sled failed at {:?}: {e}", db_dir);
                logl!("[tauri][localfav] {msg}");
                Self {
                    tree: None,
                    init_error: Some(msg),
                }
            }
        }
    }

    fn tree(&self) -> Result<&sled::Tree, String> {
        self.tree
            .as_ref()
            .ok_or_else(|| self.init_error.clone().unwrap_or_else(|| "local favorites store unavailable".into()))
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiLoginResponse {
    code: i64,
    #[serde(default)]
    error_msg: String,
    #[serde(default)]
    message: String,
    data: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiEnvelope {
    code: i64,
    #[serde(default)]
    error_msg: String,
    #[serde(default)]
    message: String,
    data: serde_json::Value,
}

#[derive(Debug, Deserialize, Serialize)]
struct ApiUserInfo {
    uid: serde_json::Value,
    username: String,
    #[serde(rename = "level_name")]
    level_name: String,
    #[serde(deserialize_with = "de_i64")]
    level: i64,
    #[serde(deserialize_with = "de_i64")]
    coin: i64,
    #[serde(default)]
    gender: String,
    #[serde(rename = "album_favorites")]
    #[serde(deserialize_with = "de_i64")]
    favorites: i64,
    #[serde(rename = "album_favorites_max")]
    #[serde(deserialize_with = "de_i64")]
    can_favorites: i64,
    #[serde(default, deserialize_with = "de_i64_default")]
    exp: i64,
    #[serde(rename = "nextLevelExp", default, deserialize_with = "de_i64_default")]
    next_level_exp: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LoginResult {
    user: ApiUserInfo,
    cookies: HashMap<String, String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImagePayload {
    mime: String,
    data_b64: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiBaseLatency {
    base: String,
    ms: i64,
    ok: bool,
    status: Option<u16>,
}

#[derive(Default)]
struct CancelRegistry {
    map: Mutex<HashMap<String, (Arc<AtomicBool>, i64)>>,
}

impl CancelRegistry {
    fn cleanup_locked(map: &mut HashMap<String, (Arc<AtomicBool>, i64)>, now: i64) {
        // Keep memory bounded: drop tokens not touched for ~10 minutes.
        const TTL_SECS: i64 = 10 * 60;
        map.retain(|_, (_, ts)| now.saturating_sub(*ts) <= TTL_SECS);

        // Hard cap as a safety net.
        const MAX: usize = 512;
        if map.len() <= MAX {
            return;
        }
        // Remove oldest entries first.
        let mut keys: Vec<(String, i64)> = map.iter().map(|(k, (_, ts))| (k.clone(), *ts)).collect();
        keys.sort_by_key(|(_, ts)| *ts);
        for (k, _) in keys.into_iter().take(map.len().saturating_sub(MAX)) {
            map.remove(&k);
        }
    }

    fn token_for(&self, key: &str) -> Arc<AtomicBool> {
        let mut map = self.map.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        Self::cleanup_locked(&mut map, now);
        map.entry(key.to_string())
            .and_modify(|(_, ts)| *ts = now)
            .or_insert_with(|| (Arc::new(AtomicBool::new(false)), now))
            .0
            .clone()
    }

    fn cancel(&self, key: &str) {
        let mut map = self.map.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        Self::cleanup_locked(&mut map, now);
        let token = map
            .entry(key.to_string())
            .and_modify(|(t, ts)| {
                t.store(true, Ordering::Relaxed);
                *ts = now;
            })
            .or_insert_with(|| {
                let t = Arc::new(AtomicBool::new(true));
                (t, now)
            })
            .0
            .clone();
        token.store(true, Ordering::Relaxed);
    }
}

fn log_file_path() -> std::path::PathBuf {
    if let Ok(dir) = std::env::var("JM_LOG_DIR") {
        return std::path::PathBuf::from(dir).join("jm.log");
    }

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|x| x.to_path_buf()));

    let primary = exe_dir
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(".")))
        .join("jmcomic-logs")
        .join("jm.log");

    primary
}

fn get_log_writer() -> Option<&'static Mutex<std::io::BufWriter<std::fs::File>>> {
    LOG_WRITER.get_or_init(|| {
        let primary = log_file_path();

        let try_open = |path: &std::path::Path| -> std::io::Result<std::io::BufWriter<std::fs::File>> {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let file = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(path)?;
            Ok(std::io::BufWriter::new(file))
        };

        let writer = try_open(&primary).or_else(|_| {
            let fallback = std::env::temp_dir().join("jmcomic-logs").join("jm.log");
            try_open(&fallback)
        });

        Mutex::new(writer.unwrap_or_else(|_| {
            // Last resort: /dev/null style sink, so logging doesn't panic.
            let file = if cfg!(windows) {
                std::fs::OpenOptions::new()
                    .write(true)
                    .open("NUL")
                    .unwrap_or_else(|_| std::fs::File::create(std::env::temp_dir().join("jm.log")).unwrap())
            } else {
                std::fs::OpenOptions::new()
                    .write(true)
                    .open("/dev/null")
                    .unwrap_or_else(|_| std::fs::File::create(std::env::temp_dir().join("jm.log")).unwrap())
            };
            std::io::BufWriter::new(file)
        }))
    });
    Some(LOG_WRITER.get().expect("just initialized"))
}

fn config_path() -> Result<std::path::PathBuf, String> {
    Ok(resolve_data_dir()?.join("config.json"))
}

fn api_domain_cache_path() -> Result<std::path::PathBuf, String> {
    Ok(resolve_data_dir()?.join("api-domain-list.json"))
}

fn load_api_domain_cache() -> Vec<String> {
    let path = match api_domain_cache_path() {
        Ok(p) => p,
        Err(_) => return Vec::new(),
    };
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(_) => return Vec::new(),
    };
    let raw: Vec<String> = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let mut out = Vec::new();
    for item in raw {
        if let Some(v) = normalize_api_base_root(&item) {
            if !out.contains(&v) {
                out.push(v);
            }
        }
    }
    out
}

fn save_api_domain_cache(list: &[String]) -> Result<(), String> {
    let path = api_domain_cache_path()?;
    let tmp = path.with_extension("json.tmp");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir failed: {e}"))?;
    }
    let bytes =
        serde_json::to_vec_pretty(list).map_err(|e| format!("serialize api domain cache failed: {e}"))?;
    std::fs::write(&tmp, &bytes).map_err(|e| format!("write api domain cache tmp failed: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("commit api domain cache failed: {e}"))?;
    Ok(())
}

fn read_progress_db() -> Result<sled::Db, String> {
    let res = READ_PROGRESS_DB.get_or_init(|| {
        let data_dir = resolve_data_dir()?;
        let path = data_dir.join("read-progress.sled");
        let import_dir = data_dir.join("read-progress.import");
        if import_dir.exists() {
            let ts = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let backup = data_dir.join(format!("read-progress.sled.backup.{ts}"));
            if path.exists() {
                let _ = std::fs::rename(&path, &backup);
            }
            if let Err(e) = std::fs::rename(&import_dir, &path) {
                return Err(format!("apply read progress import failed: {e}"));
            }
            logl!("[tauri][read] applied imported read progress db");
        }
        match sled::open(&path) {
            Ok(db) => Ok(db),
            Err(e) => {
                let msg = e.to_string();
                let lower = msg.to_ascii_lowercase();
                let should_repair = lower.contains("corrupt")
                    || lower.contains("checksum")
                    || lower.contains("invalid")
                    || lower.contains("incompatible");
                if !should_repair {
                    return Err(format!("open read progress db failed: {e}"));
                }

                let ts = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                let backup = data_dir.join(format!("read-progress.sled.broken.{ts}"));
                if let Err(rename_err) = std::fs::rename(&path, &backup) {
                    return Err(format!(
                        "open read progress db failed: {e}; rename failed: {rename_err}"
                    ));
                }
                logl!(
                    "[tauri][read] read progress db corrupted, moved to {:?}",
                    backup
                );
                sled::open(&path)
                    .map_err(|e| format!("open read progress db failed after repair: {e}"))
            }
        }
    });
    match res {
        Ok(db) => Ok(db.clone()),
        Err(e) => Err(e.clone()),
    }
}

fn read_progress_tree() -> Result<sled::Tree, String> {
    read_progress_db()?
        .open_tree("read_progress")
        .map_err(|e| format!("open read progress tree failed: {e}"))
}

fn read_follow_tree() -> Result<sled::Tree, String> {
    read_progress_db()?
        .open_tree("read_follow_state")
        .map_err(|e| format!("open read follow tree failed: {e}"))
}

fn read_update_tree() -> Result<sled::Tree, String> {
    read_progress_db()?
        .open_tree("read_updates")
        .map_err(|e| format!("open read updates tree failed: {e}"))
}

fn read_latest_tree() -> Result<sled::Tree, String> {
    read_progress_db()?
        .open_tree("read_latest")
        .map_err(|e| format!("open read latest tree failed: {e}"))
}

fn read_latest_seen_tree() -> Result<sled::Tree, String> {
    read_progress_db()?
        .open_tree("read_latest_seen")
        .map_err(|e| format!("open read latest seen tree failed: {e}"))
}

fn read_comic_extra_tree() -> Result<sled::Tree, String> {
    read_progress_db()?
        .open_tree("comic_extra")
        .map_err(|e| format!("open comic extra tree failed: {e}"))
}

fn export_read_progress_zip(path: &std::path::Path) -> Result<(), String> {
    let data_dir = resolve_data_dir()?;
    let db_dir = data_dir.join("read-progress.sled");
    if !db_dir.exists() {
        return Err("read progress db not found".to_string());
    }

    if let Some(Ok(db)) = READ_PROGRESS_DB.get() {
        let _ = db.flush();
    }

    let file = std::fs::File::create(path).map_err(|e| format!("create export file failed: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Stored);

    let mut stack = vec![db_dir.clone()];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).map_err(|e| format!("read dir failed: {e}"))? {
            let entry = entry.map_err(|e| format!("read dir entry failed: {e}"))?;
            let path = entry.path();
            let rel = path.strip_prefix(&data_dir).unwrap_or(&path);
            let name = rel.to_string_lossy().replace('\\', "/");
            if path.is_dir() {
                zip.add_directory(format!("{name}/"), options)
                    .map_err(|e| format!("zip add dir failed: {e}"))?;
                stack.push(path);
            } else {
                zip.start_file(name, options)
                    .map_err(|e| format!("zip start file failed: {e}"))?;
                let mut f = std::fs::File::open(&path)
                    .map_err(|e| format!("zip open file failed: {e}"))?;
                std::io::copy(&mut f, &mut zip)
                    .map_err(|e| format!("zip write file failed: {e}"))?;
            }
        }
    }

    zip.finish().map_err(|e| format!("zip finish failed: {e}"))?;
    Ok(())
}

fn import_read_progress_zip(path: &std::path::Path) -> Result<(), String> {
    let data_dir = resolve_data_dir()?;
    let import_dir = data_dir.join("read-progress.import");
    if import_dir.exists() {
        std::fs::remove_dir_all(&import_dir)
            .map_err(|e| format!("remove old import dir failed: {e}"))?;
    }
    std::fs::create_dir_all(&import_dir).map_err(|e| format!("mkdir failed: {e}"))?;

    let file = std::fs::File::open(path).map_err(|e| format!("open import file failed: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("open zip failed: {e}"))?;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| format!("zip entry failed: {e}"))?;
        let name = file.name().to_string();
        if name.is_empty() {
            continue;
        }
        let out_path = import_dir.join(name);
        if file.name().ends_with('/') {
            std::fs::create_dir_all(&out_path)
                .map_err(|e| format!("mkdir failed: {e}"))?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("mkdir failed: {e}"))?;
            }
            let mut out = std::fs::File::create(&out_path)
                .map_err(|e| format!("create file failed: {e}"))?;
            std::io::copy(&mut file, &mut out)
                .map_err(|e| format!("write file failed: {e}"))?;
        }
    }
    Ok(())
}

fn load_config_from_disk() -> AppConfig {
    let path = match config_path() {
        Ok(p) => p,
        Err(_) => return AppConfig::default(),
    };
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(_) => return AppConfig::default(),
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

fn config_state() -> &'static Mutex<AppConfig> {
    APP_CONFIG.get_or_init(|| Mutex::new(load_config_from_disk()))
}

fn save_config_to_disk(cfg: &AppConfig) -> Result<(), String> {
    let path = config_path()?;
    let tmp = path.with_extension("json.tmp");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir failed: {e}"))?;
    }
    let bytes = serde_json::to_vec_pretty(cfg).map_err(|e| format!("serialize config failed: {e}"))?;
    std::fs::write(&tmp, &bytes).map_err(|e| format!("write config tmp failed: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("commit config failed: {e}"))?;
    Ok(())
}

fn current_socks_proxy() -> Option<String> {
    config_state().lock().ok().and_then(|c| c.socks_proxy.clone())
}

fn http_client() -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder();
    if let Some(p) = current_socks_proxy() {
        if !p.trim().is_empty() {
            builder = builder
                .proxy(reqwest::Proxy::all(&p).map_err(|e| format!("invalid proxy url: {e}"))?);
        }
    }
    builder.build().map_err(|e| format!("create http client failed: {e}"))
}

fn register_cookie_jar() -> Arc<reqwest::cookie::Jar> {
    REGISTER_COOKIE_JAR
        .get_or_init(|| Arc::new(reqwest::cookie::Jar::default()))
        .clone()
}

fn register_client() -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder().cookie_provider(register_cookie_jar());
    if let Some(p) = current_socks_proxy() {
        if !p.trim().is_empty() {
            builder = builder
                .proxy(reqwest::Proxy::all(&p).map_err(|e| format!("invalid proxy url: {e}"))?);
        }
    }
    builder.build().map_err(|e| format!("create http client failed: {e}"))
}

fn web_base_from_opt(web_base: Option<String>) -> String {
    if let Some(raw) = web_base {
        let trimmed = raw.trim();
        if !trimmed.is_empty() && (trimmed.starts_with("http://") || trimmed.starts_with("https://"))
        {
            return trimmed.trim_end_matches('/').to_string();
        }
    }
    std::env::var("JM_WEB_BASE").unwrap_or_else(|_| JM_WEB_BASE_DEFAULT.to_string())
}

fn parse_toastr_message(html: &str) -> (bool, String) {
    let find_msg = |needle: &str| -> Option<String> {
        let start = html.find(needle)? + needle.len();
        let tail = &html[start..];
        let end = tail.find("\")")?;
        Some(tail[..end].to_string())
    };

    if let Some(msg) = find_msg("toastr['success'](\"") {
        return (true, msg);
    }
    if let Some(msg) = find_msg("toastr['error'](\"") {
        return (false, msg);
    }
    (false, String::new())
}

fn scan_dir_bytes(path: &std::path::Path) -> (u64, u64) {
    let mut files = 0u64;
    let mut bytes = 0u64;
    let mut stack = vec![path.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(v) => v,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if let Ok(meta) = entry.metadata() {
                if meta.is_dir() {
                    stack.push(p);
                } else if meta.is_file() {
                    files += 1;
                    bytes += meta.len();
                }
            }
        }
    }
    (files, bytes)
}

fn scan_read_cache_dirs(read_dir: &std::path::Path) -> Vec<ReadCacheDirStats> {
    let mut out = Vec::new();
    let entries = match std::fs::read_dir(read_dir) {
        Ok(v) => v,
        Err(_) => return out,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let aid = entry.file_name().to_string_lossy().to_string();
        let mut bytes = 0u64;
        let mut newest_ms = 0i64;
        let mut stack = vec![path];
        while let Some(dir) = stack.pop() {
            let sub_entries = match std::fs::read_dir(&dir) {
                Ok(v) => v,
                Err(_) => continue,
            };
            for sub in sub_entries.flatten() {
                let p = sub.path();
                if let Ok(meta) = sub.metadata() {
                    if meta.is_dir() {
                        stack.push(p);
                    } else if meta.is_file() {
                        bytes += meta.len();
                        if let Ok(modified) = meta.modified() {
                            if let Ok(ms) = modified.duration_since(std::time::UNIX_EPOCH) {
                                let ms = ms.as_millis() as i64;
                                if ms > newest_ms {
                                    newest_ms = ms;
                                }
                            }
                        }
                    }
                }
            }
        }

        out.push(ReadCacheDirStats { aid, bytes, newest_ms });
    }
    out
}

fn update_read_cache_stats(app: tauri::AppHandle) -> Result<(), String> {
    let started = Instant::now();
    let base = resolve_read_cache_dir(&app)?;
    let read_dir = base.join("read");
    if !read_dir.exists() {
        return Ok(());
    }

    let mut total_files = 0u64;
    let mut total_bytes = 0u64;
    let mut total_comics = 0u64;
    let updated_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("system time error: {e}"))?
        .as_millis() as i64;

    let mut per_comic: Vec<ReadCacheComicStats> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&read_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let aid = entry.file_name().to_string_lossy().to_string();
            let (files, bytes) = scan_dir_bytes(&path);
            if files == 0 {
                continue;
            }
            total_comics += 1;
            total_files += files;
            total_bytes += bytes;
            per_comic.push(ReadCacheComicStats {
                aid,
                files,
                bytes,
                updated_at,
            });
        }
    }

    let summary = ReadCacheStats {
        total_bytes,
        total_files,
        total_comics,
        updated_at,
        elapsed_ms: started.elapsed().as_millis() as u64,
    };

    let data_dir = resolve_data_dir()?;
    let db = sled::open(data_dir.join("cache-stats.sled"))
        .map_err(|e| format!("open cache stats db failed: {e}"))?;
    let summary_tree = db
        .open_tree("read_cache_summary")
        .map_err(|e| format!("open cache summary tree failed: {e}"))?;
    let comics_tree = db
        .open_tree("read_cache_comics")
        .map_err(|e| format!("open cache comics tree failed: {e}"))?;

    summary_tree
        .insert("summary", serde_json::to_vec(&summary).map_err(|e| format!("encode summary failed: {e}"))?)
        .map_err(|e| format!("write summary failed: {e}"))?;

    for item in per_comic {
        let key = item.aid.as_bytes();
        let val = serde_json::to_vec(&item).map_err(|e| format!("encode comic stat failed: {e}"))?;
        let _ = comics_tree.insert(key, val);
    }

    let _ = summary_tree.flush();
    let _ = comics_tree.flush();
    Ok(())
}

fn normalize_verify_url(input: &str, base_override: Option<String>) -> String {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let base = web_base_from_opt(base_override);
    let base_host = base
        .split("://")
        .nth(1)
        .and_then(|s| s.split('/').next())
        .unwrap_or("");
    if base_host.is_empty() {
        return trimmed.to_string();
    }

    if let Some(host) = trimmed
        .split("://")
        .nth(1)
        .and_then(|s| s.split('/').next())
    {
        if !host.is_empty() && host != base_host {
            return trimmed.replace(host, base_host);
        }
    }
    trimmed.to_string()
}

fn log_line(file: &str, line: u32, msg: std::fmt::Arguments<'_>) {
    // dev: print to console
    if cfg!(debug_assertions) || std::env::var("JM_LOG_STDERR").ok().as_deref() == Some("1") {
        eprintln!("{file}:{line} {msg}");
    }

    // release: always write to file (best-effort)
    if cfg!(debug_assertions) {
        return;
    }

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);

    if let Some(m) = get_log_writer() {
        if let Ok(mut w) = m.lock() {
            let _ = writeln!(w, "{now_ms} {file}:{line} {msg}");
            // Reduce overhead: flush every 50 lines.
            let n = LOG_LINE_COUNT.fetch_add(1, Ordering::Relaxed) + 1;
            if n % 50 == 0 {
                let _ = w.flush();
            }
        }
    }
}

#[tauri::command]
async fn api_config_get() -> Result<AppConfig, String> {
    Ok(config_state()
        .lock()
        .map_err(|_| "config lock poisoned".to_string())?
        .clone())
}

#[tauri::command]
async fn api_config_set_socks_proxy(proxy: Option<String>) -> Result<(), String> {
    let proxy = proxy
        .and_then(|s| {
            let t = s.trim().to_string();
            if t.is_empty() { None } else { Some(t) }
        });

    if let Some(p) = &proxy {
        reqwest::Proxy::all(p).map_err(|e| format!("invalid proxy url: {e}"))?;
    }

    let mut cfg = config_state()
        .lock()
        .map_err(|_| "config lock poisoned".to_string())?;
    cfg.socks_proxy = proxy;
    save_config_to_disk(&cfg)?;
    Ok(())
}

#[tauri::command]
async fn api_read_progress_upsert(entry: ReadProgressEntry) -> Result<(), String> {
    let tree = read_progress_tree()?;
    let key = entry.aid.as_bytes();
    let val =
        serde_json::to_vec(&entry).map_err(|e| format!("encode read progress failed: {e}"))?;
    tree.insert(key, val)
        .map_err(|e| format!("write read progress failed: {e}"))?;
    let _ = tree.flush();
    Ok(())
}

#[tauri::command]
async fn api_read_progress_clear(aid: String) -> Result<(), String> {
    let tree = read_progress_tree()?;
    tree.remove(aid.as_bytes())
        .map_err(|e| format!("delete read progress failed: {e}"))?;
    let _ = tree.flush();
    Ok(())
}

#[tauri::command]
async fn api_read_progress_export(path: Option<String>) -> Result<ExportResult, String> {
    let data_dir = resolve_data_dir()?;
    let export_path = if let Some(p) = path {
        let trimmed = p.trim();
        if trimmed.is_empty() {
            data_dir.join(format!(
                "read-progress-export-{}.zip",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0)
            ))
        } else {
            std::path::PathBuf::from(trimmed)
        }
    } else {
        data_dir.join(format!(
            "read-progress-export-{}.zip",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0)
        ))
    };
    if let Some(parent) = export_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir failed: {e}"))?;
    }
    export_read_progress_zip(&export_path)?;
    Ok(ExportResult {
        path: export_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
async fn api_read_progress_import(path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("导入路径不能为空".to_string());
    }
    let p = std::path::PathBuf::from(trimmed);
    import_read_progress_zip(&p)?;
    Ok(())
}

#[tauri::command]
async fn api_follow_state_list() -> Result<Vec<FollowStateEntry>, String> {
    let tree = read_follow_tree()?;
    let mut out = Vec::new();
    for item in tree.iter() {
        let (_, val) = item.map_err(|e| format!("sled iter failed: {e}"))?;
        if let Ok(entry) = serde_json::from_slice::<FollowStateEntry>(&val) {
            out.push(entry);
        }
    }
    Ok(out)
}

#[tauri::command]
async fn api_proxy_check(proxy: Option<String>) -> Result<String, String> {
    let proxy = proxy
        .and_then(|s| {
            let t = s.trim().to_string();
            if t.is_empty() { None } else { Some(t) }
        })
        .or_else(current_socks_proxy);

    let Some(proxy) = proxy else {
        return Err("未配置SOCKS代理".to_string());
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .proxy(reqwest::Proxy::all(&proxy).map_err(|e| format!("invalid proxy url: {e}"))?)
        .build()
        .map_err(|e| format!("create http client failed: {e}"))?;

    let resp = client
        .get(JM_API_BASE_DEFAULT)
        .send()
        .await
        .map_err(|e| format!("proxy request failed: {e}"))?;

    let status = resp.status();
    if status.is_success() || status.is_redirection() {
        Ok(format!("代理连接成功（HTTP {}）", status.as_u16()))
    } else {
        Err(format!("代理连接失败（HTTP {}）", status.as_u16()))
    }
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

fn md5_hex(input: &str) -> String {
    format!("{:x}", md5::compute(input.as_bytes()))
}

fn de_i64<'de, D>(deserializer: D) -> Result<i64, D::Error>
where
    D: Deserializer<'de>,
{
    let v = serde_json::Value::deserialize(deserializer)?;
    match v {
        serde_json::Value::Number(n) => n
            .as_i64()
            .ok_or_else(|| serde::de::Error::custom("number out of range for i64")),
        serde_json::Value::String(s) => s
            .parse::<i64>()
            .map_err(|_| serde::de::Error::custom("invalid i64 string")),
        serde_json::Value::Null => Err(serde::de::Error::custom("null where i64 expected")),
        other => Err(serde::de::Error::custom(format!(
            "invalid type for i64: {other}"
        ))),
    }
}

fn de_i64_default<'de, D>(deserializer: D) -> Result<i64, D::Error>
where
    D: Deserializer<'de>,
{
    let v = serde_json::Value::deserialize(deserializer)?;
    match v {
        serde_json::Value::Null => Ok(0),
        serde_json::Value::Number(n) => n
            .as_i64()
            .ok_or_else(|| serde::de::Error::custom("number out of range for i64")),
        serde_json::Value::String(s) => s
            .parse::<i64>()
            .map_err(|_| serde::de::Error::custom("invalid i64 string")),
        other => Err(serde::de::Error::custom(format!(
            "invalid type for i64: {other}"
        ))),
    }
}

fn unpad_like_python(mut data: Vec<u8>) -> Vec<u8> {
    if data.is_empty() {
        return data;
    }
    let pad = *data.last().unwrap() as usize;
    let new_len = data.len().saturating_sub(pad);
    data.truncate(new_len);
    data
}

fn preview_bytes_hex(bytes: &[u8], limit: usize) -> String {
    let mut out = String::new();
    let n = bytes.len().min(limit);
    for (i, b) in bytes[..n].iter().enumerate() {
        if i > 0 {
            out.push(' ');
        }
        out.push_str(&format!("{b:02x}"));
    }
    out
}

fn looks_like_json_utf8(s: &str) -> bool {
    let trimmed = s.trim_start_matches(['\u{0000}', ' ', '\n', '\r', '\t']);
    trimmed.starts_with('{') || trimmed.starts_with('[')
}

fn decode_resp_data(data_b64: &str, ts: i64) -> Result<String, String> {
    let debug = std::env::var("JM_DEBUG_LOGIN").ok().as_deref() == Some("1");

    let secret =
        std::env::var("JM_APP_DATA_SECRET").unwrap_or_else(|_| JM_APP_DATA_SECRET_DEFAULT.into());

    let key = md5_hex(&format!("{ts}{secret}")).into_bytes(); // jmcomic: md5hex(...).encode('utf-8')

    let mut ciphertext = base64::engine::general_purpose::STANDARD
        .decode(data_b64)
        .map_err(|e| format!("base64 decode failed: {e}"))?;

    type Aes256EcbDec = ecb::Decryptor<Aes256>;
    let cipher =
        Aes256EcbDec::new_from_slice(&key).map_err(|e| format!("cipher init failed: {e}"))?;

    let decrypted_padded = cipher
        .decrypt_padded_mut::<NoPadding>(&mut ciphertext)
        .map_err(|e| format!("decrypt failed: {e}"))?
        .to_vec();

    let decrypted = unpad_like_python(decrypted_padded);
    if debug {
        logl!(
            "[tauri][login][decrypt] secret={:?} key_len={} decrypted_len={} hex_preview={}",
            secret,
            key.len(),
            decrypted.len(),
            preview_bytes_hex(&decrypted, 32)
        );
    }

    let s = String::from_utf8(decrypted).map_err(|e| format!("utf8 decode failed: {e}"))?;
    if !looks_like_json_utf8(&s) {
        return Err("decoded text is not json-like".into());
    }
    Ok(s)
}

fn cookie_header(cookies: &HashMap<String, String>) -> String {
    cookies
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("; ")
}

fn normalize_api_base(input: &str) -> Option<String> {
    let raw = input.trim();
    if raw.is_empty() {
        return None;
    }
    let with_scheme = if raw.starts_with("http://") || raw.starts_with("https://") {
        raw.to_string()
    } else {
        format!("https://{raw}")
    };
    Some(with_scheme.trim_end_matches('/').to_string())
}

fn normalize_api_base_root(input: &str) -> Option<String> {
    let normalized = normalize_api_base(input)?;
    if let Some(pos) = normalized.find("://") {
        let rest = &normalized[(pos + 3)..];
        if let Some(slash) = rest.find('/') {
            let prefix = &normalized[..pos];
            let host = &rest[..slash];
            return Some(format!("{prefix}://{host}"));
        }
    }
    Some(normalized)
}

fn parse_api_domain_list(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for line in text.lines() {
        for token in line.split(|c: char| c == ',' || c.is_whitespace()) {
            if let Some(v) = normalize_api_base_root(token) {
                if !out.contains(&v) {
                    out.push(v);
                }
            }
        }
    }
    out
}

fn parse_api_domain_payload(payload: &str) -> Vec<String> {
    let value: serde_json::Value = match serde_json::from_str(payload) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let Some(server) = value.get("Server") else {
        return Vec::new();
    };
    if let Some(list) = server.as_array() {
        let mut out = Vec::new();
        for item in list {
            if let Some(s) = item.as_str() {
                if let Some(v) = normalize_api_base_root(s) {
                    if !out.contains(&v) {
                        out.push(v);
                    }
                }
            }
        }
        return out;
    }
    if let Some(s) = server.as_str() {
        return parse_api_domain_list(s);
    }
    Vec::new()
}

fn strip_leading_non_ascii(text: &str) -> &str {
    for (pos, ch) in text.char_indices() {
        if ch.is_ascii() {
            return &text[pos..];
        }
    }
    text
}

fn decode_domain_server_payload(data_b64: &str) -> Result<String, String> {
    let key = md5_hex(JM_API_DOMAIN_SERVER_SECRET).into_bytes();
    let mut trimmed = data_b64.trim().to_string();
    let pad = trimmed.len() % 4;
    if pad != 0 {
        trimmed.push_str(&"=".repeat(4 - pad));
    }
    let mut ciphertext = base64::engine::general_purpose::STANDARD
        .decode(trimmed.as_bytes())
        .or_else(|_| base64::engine::general_purpose::URL_SAFE.decode(trimmed.as_bytes()))
        .map_err(|e| format!("base64 decode failed: {e}"))?;

    type Aes256EcbDec = ecb::Decryptor<Aes256>;
    let cipher =
        Aes256EcbDec::new_from_slice(&key).map_err(|e| format!("cipher init failed: {e}"))?;

    let decrypted_padded = cipher
        .decrypt_padded_mut::<NoPadding>(&mut ciphertext)
        .map_err(|e| format!("decrypt failed: {e}"))?
        .to_vec();

    let decrypted = unpad_like_python(decrypted_padded);
    String::from_utf8(decrypted).map_err(|e| format!("utf8 decode failed: {e}"))
}

fn load_api_base_list() -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let add = |out: &mut Vec<String>, s: &str| {
        if let Some(v) = normalize_api_base_root(s) {
            if !out.contains(&v) {
                out.push(v);
            }
        }
    };

    for item in load_api_domain_cache() {
        add(&mut out, &item);
    }

    if let Ok(cfg) = config_state().lock() {
        for item in &cfg.api_base_list {
            add(&mut out, item);
        }
    }

    if let Ok(list) = std::env::var("JM_API_BASE_LIST") {
        for item in list.split(|c: char| c == ',' || c.is_whitespace()) {
            add(&mut out, item);
        }
    }

    if out.is_empty() {
        if let Ok(single) = std::env::var("JM_API_BASE") {
            add(&mut out, &single);
        }
    }

    if out.is_empty() {
        for item in JM_API_BASE_LIST_DEFAULT {
            add(&mut out, item);
        }
    }

    if out.is_empty() {
        add(&mut out, JM_API_BASE_DEFAULT);
    }

    out
}

fn api_bases_state() -> &'static Mutex<Vec<String>> {
    JM_API_BASES.get_or_init(|| Mutex::new(load_api_base_list()))
}

fn get_api_bases() -> Vec<String> {
    api_bases_state()
        .lock()
        .map(|v| v.clone())
        .unwrap_or_default()
}

fn set_api_bases(list: Vec<String>) {
    if list.is_empty() {
        return;
    }
    if let Ok(mut bases) = api_bases_state().lock() {
        *bases = list;
        JM_API_BASE_INDEX.store(0, Ordering::Relaxed);
    }
}

#[allow(dead_code)]
fn update_api_base_list(list: Vec<String>) -> Result<(), String> {
    if list.is_empty() {
        return Ok(());
    }
    {
        let mut cfg = config_state()
            .lock()
            .map_err(|_| "config lock poisoned".to_string())?;
        cfg.api_base_list = list.clone();
        save_config_to_disk(&cfg)?;
    }
    set_api_bases(list);
    Ok(())
}

fn update_api_domain_cache(list: Vec<String>) -> Result<(), String> {
    if list.is_empty() {
        return Ok(());
    }
    save_api_domain_cache(&list)?;
    set_api_bases(list);
    Ok(())
}

fn api_base_candidates() -> Vec<(usize, String)> {
    let bases = get_api_bases();
    if bases.is_empty() {
        return Vec::new();
    }
    let start = JM_API_BASE_INDEX.load(Ordering::Relaxed) % bases.len();
    let mut out = Vec::with_capacity(bases.len());
    for (offset, _base) in bases.iter().enumerate() {
        let idx = (start + offset) % bases.len();
        out.push((idx, bases[idx].clone()));
    }
    out
}

fn current_api_base() -> Option<String> {
    let bases = get_api_bases();
    if bases.is_empty() {
        return None;
    }
    let idx = JM_API_BASE_INDEX.load(Ordering::Relaxed) % bases.len();
    let base = bases.get(idx).cloned();
    if let Some(b) = &base {
        logl!("[tauri][api] current api base: {}", b);
    }
    base
}

fn should_retry_status(status: reqwest::StatusCode) -> bool {
    let code = status.as_u16();
    matches!(code, 403 | 500 | 502 | 503 | 504 | 520 | 524) || status.is_server_error()
}

fn should_retry_error(err: &reqwest::Error) -> bool {
    err.is_timeout() || err.is_connect()
}

fn should_retry_body(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.contains("404 not found")
        || lower.contains("apache server")
        || lower.contains("cloudflare")
}

#[tauri::command]
fn api_api_base_current() -> Result<String, String> {
    current_api_base().ok_or_else(|| "api base unavailable".to_string())
}

#[tauri::command]
fn api_api_base_list() -> Result<Vec<String>, String> {
    Ok(get_api_bases())
}

#[tauri::command]
async fn api_api_base_latency() -> Result<Vec<ApiBaseLatency>, String> {
    let bases = get_api_bases();
    let client = http_client()?;
    let mut out = Vec::with_capacity(bases.len());
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("system time error: {e}"))?
        .as_secs() as i64;
    let token_secret =
        std::env::var("JM_APP_TOKEN_SECRET").unwrap_or_else(|_| JM_APP_TOKEN_SECRET_DEFAULT.into());
    let token = md5_hex(&format!("{ts}{token_secret}"));
    let tokenparam = format!("{ts},{JM_HEADER_VER}");
    for base in bases {
        let url = format!("{}/latest/?page=0", base.trim_end_matches('/'));
        let started = Instant::now();
        let resp = tokio::time::timeout(
            Duration::from_secs(5),
            client
                .get(&url)
                .header("tokenparam", tokenparam.clone())
                .header("token", token.clone())
                .header(
                    "user-agent",
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 Edg/114.0.1823.43",
                )
                .header("accept-encoding", "identity")
                .header("version", JM_APP_VERSION)
                .send(),
        )
        .await;
        let mut ok = false;
        let mut status = None;
        match resp {
            Ok(Ok(r)) => {
                status = Some(r.status().as_u16());
                ok = r.status().is_success();
            }
            Ok(Err(_)) => {}
            Err(_) => {}
        }
        out.push(ApiBaseLatency {
            base,
            ms: started.elapsed().as_millis() as i64,
            ok,
            status,
        });
    }
    Ok(out)
}

fn parse_series_latest(series: &[serde_json::Value]) -> Option<(String, Option<String>)> {
    let mut items: Vec<(usize, Option<f64>, String, Option<String>)> = Vec::new();
    for (idx, item) in series.iter().enumerate() {
        let id = item
            .get("id")
            .map(|v| v.to_string().trim_matches('"').to_string())
            .unwrap_or_default();
        if id.is_empty() {
            continue;
        }
        let sort_raw = item.get("sort");
        let sort_str = sort_raw
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .or_else(|| sort_raw.and_then(|v| v.as_i64().map(|n| n.to_string())))
            .or_else(|| sort_raw.and_then(|v| v.as_f64().map(|n| n.to_string())));
        let sort_num = sort_raw
            .and_then(|v| v.as_f64())
            .or_else(|| sort_raw.and_then(|v| v.as_i64().map(|n| n as f64)))
            .or_else(|| sort_raw.and_then(|v| v.as_str().and_then(|s| s.parse::<f64>().ok())));
        items.push((idx, sort_num, id, sort_str));
    }
    if items.len() <= 1 {
        return None;
    }
    items.sort_by(|a, b| {
        match (a.1, b.1) {
            (Some(sa), Some(sb)) => sa
                .partial_cmp(&sb)
                .unwrap_or(std::cmp::Ordering::Equal),
            (Some(_), None) => std::cmp::Ordering::Greater,
            (None, Some(_)) => std::cmp::Ordering::Less,
            (None, None) => a.0.cmp(&b.0),
        }
    });
    let last = items.pop()?;
    Some((last.2, last.3))
}

async fn scan_latest_chapters(app: tauri::AppHandle) -> Result<(), String> {
    let store = app.state::<LocalFavoritesStore>();
    let tree = store.tree()?.clone();
    let latest_tree = read_latest_tree()?;
    let seen_tree = read_latest_seen_tree()?;

    for item in tree.iter() {
        let (_, val) = item.map_err(|e| format!("sled iter failed: {e}"))?;
        let fav: LocalFavoriteItem =
            bincode::deserialize(&val).map_err(|e| format!("decode favorite failed: {e}"))?;
        let aid = fav.aid.clone();

        if seen_tree
            .get(aid.as_bytes())
            .map_err(|e| format!("read latest seen failed: {e}"))?
            .is_some()
        {
            continue;
        }

        let album = match api_album(aid.clone(), HashMap::new()).await {
            Ok(v) => v,
            Err(e) => {
                logl!("[tauri][latest] album fetch failed aid={} err={}", aid, e);
                continue;
            }
        };
        let series = album
            .get("series")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        if let Some((latest_id, latest_sort)) = parse_series_latest(&series) {
            let latest_entry = LatestChapterEntry {
                aid: aid.clone(),
                latest_chapter_id: latest_id,
                latest_chapter_sort: latest_sort,
                updated_at: now,
            };
            latest_tree
                .insert(
                    aid.as_bytes(),
                    serde_json::to_vec(&latest_entry)
                        .map_err(|e| format!("encode latest failed: {e}"))?,
                )
                .map_err(|e| format!("write latest failed: {e}"))?;
            let _ = latest_tree.flush();
        } else {
            let _ = latest_tree.remove(aid.as_bytes());
            let _ = latest_tree.flush();
        }

        let seen_entry = LatestScanEntry {
            aid: aid.clone(),
            scanned_at: now,
        };
        seen_tree
            .insert(
                aid.as_bytes(),
                serde_json::to_vec(&seen_entry).map_err(|e| format!("encode seen failed: {e}"))?,
            )
            .map_err(|e| format!("write seen failed: {e}"))?;
        let _ = seen_tree.flush();
    }

    Ok(())
}

async fn scan_follow_updates(app: tauri::AppHandle) -> Result<(), String> {
    let store = app.state::<LocalFavoritesStore>();
    let tree = store.tree()?.clone();
    let progress_tree = read_progress_tree()?;
    let follow_tree = read_follow_tree()?;
    let updates_tree = read_update_tree()?;
    let latest_tree = read_latest_tree()?;

    for item in tree.iter() {
        let (_, val) = item.map_err(|e| format!("sled iter failed: {e}"))?;
        let fav: LocalFavoriteItem =
            bincode::deserialize(&val).map_err(|e| format!("decode favorite failed: {e}"))?;
        let aid = fav.aid.clone();
        let Some(progress_bytes) = progress_tree
            .get(aid.as_bytes())
            .map_err(|e| format!("read progress failed: {e}"))?
        else {
            continue;
        };
        let progress: ReadProgressEntry = serde_json::from_slice(&progress_bytes)
            .map_err(|e| format!("decode read progress failed: {e}"))?;
        let Some(progress_chapter_id) = progress.chapter_id.clone() else {
            continue;
        };

        let latest_entry = latest_tree
            .get(aid.as_bytes())
            .map_err(|e| format!("read latest failed: {e}"))?
            .and_then(|bytes| serde_json::from_slice::<LatestChapterEntry>(&bytes).ok());
        let Some(latest_entry) = latest_entry else {
            continue;
        };
        let latest_id = latest_entry.latest_chapter_id.clone();
        let latest_sort = latest_entry.latest_chapter_sort.clone();

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        let prev_state = follow_tree
            .get(aid.as_bytes())
            .map_err(|e| format!("read follow state failed: {e}"))?
            .and_then(|bytes| serde_json::from_slice::<FollowStateEntry>(&bytes).ok());

        if let Some(state) = prev_state {
            if state.last_known_chapter_id != latest_id {
                let update = FollowUpdateEntry {
                    aid: aid.clone(),
                    latest_chapter_id: latest_id.clone(),
                    latest_chapter_sort: latest_sort.clone(),
                    updated_at: now,
                };
                updates_tree
                    .insert(
                        aid.as_bytes(),
                        serde_json::to_vec(&update)
                            .map_err(|e| format!("encode update failed: {e}"))?,
                    )
                    .map_err(|e| format!("write update failed: {e}"))?;
                let _ = updates_tree.flush();
                logl!(
                    "[tauri][follow] update found aid={} latest={}",
                    aid,
                    latest_id
                );
            }
        }

        if progress_chapter_id == latest_id {
            let state = FollowStateEntry {
                aid: aid.clone(),
                last_known_chapter_id: latest_id.clone(),
                last_known_chapter_sort: latest_sort.clone(),
                updated_at: now,
            };
            follow_tree
                .insert(
                    aid.as_bytes(),
                    serde_json::to_vec(&state).map_err(|e| format!("encode follow failed: {e}"))?,
                )
                .map_err(|e| format!("write follow failed: {e}"))?;
            let _ = follow_tree.flush();
        } else {
            let _ = follow_tree.remove(aid.as_bytes());
            let _ = follow_tree.flush();
        }
    }

    Ok(())
}

async fn fetch_api_domain_list() -> Result<Vec<String>, String> {
    let client = http_client()?;
    let mut last_err: Option<String> = None;
    for url in JM_API_DOMAIN_SERVER_LIST {
        logl!("[tauri][api] domain fetch start url={}", url);
        let resp = match client.get(*url).send().await {
            Ok(r) => r,
            Err(e) => {
                last_err = Some(format!("fetch failed: {e}"));
                logl!("[tauri][api] domain fetch error url={} err={}", url, e);
                continue;
            }
        };
        if !resp.status().is_success() {
            last_err = Some(format!("http status {} from {}", resp.status(), url));
            logl!(
                "[tauri][api] domain fetch status url={} status={}",
                url,
                resp.status()
            );
            continue;
        }
        let body = resp
            .text()
            .await
            .map_err(|e| format!("read response body failed: {e}"))?;
        let cleaned = strip_leading_non_ascii(&body);
        let mut list = Vec::new();
        match decode_domain_server_payload(cleaned) {
            Ok(decoded) => {
                list = parse_api_domain_payload(&decoded);
                if list.is_empty() {
                    let preview = decoded.chars().take(200).collect::<String>();
                    logl!(
                        "[tauri][api] domain decode payload empty: {}",
                        preview
                    );
                }
            }
            Err(e) => {
                let preview = cleaned.chars().take(200).collect::<String>();
                logl!(
                    "[tauri][api] domain decode failed: {} raw_preview={}",
                    e,
                    preview
                );
            }
        }
        if list.is_empty() {
            list = parse_api_domain_list(cleaned);
        }
        if !list.is_empty() {
            logl!(
                "[tauri][api] domain fetch success url={} count={}",
                url,
                list.len()
            );
            logl!("[tauri][api] domain fetch list: {}", list.join(", "));
            return Ok(list);
        }
        last_err = Some(format!("empty domain list from {}", url));
        logl!(
            "[tauri][api] domain fetch empty url={}",
            url
        );
    }
    Err(last_err.unwrap_or_else(|| "api domain list unavailable".to_string()))
}

#[tauri::command]
async fn api_api_domain_fetch() -> Result<Vec<String>, String> {
    let list = fetch_api_domain_list().await?;
    update_api_domain_cache(list.clone())?;
    Ok(list)
}

fn api_error(status: reqwest::StatusCode, api_code: i64, msg: impl AsRef<str>) -> String {
    format!(
        "HTTP_STATUS={};API_CODE={};{}",
        status.as_u16(),
        api_code,
        msg.as_ref()
    )
}

async fn api_get_encrypted(
    path: &str,
    page: String,
    cookies: HashMap<String, String>,
) -> Result<serde_json::Value, String> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("system time error: {e}"))?
        .as_secs() as i64;

    let token_secret =
        std::env::var("JM_APP_TOKEN_SECRET").unwrap_or_else(|_| JM_APP_TOKEN_SECRET_DEFAULT.into());
    let token = md5_hex(&format!("{ts}{token_secret}"));
    let tokenparam = format!("{ts},{JM_HEADER_VER}");

    let client = http_client()?;
    let candidates = api_base_candidates();
    let mut last_err = None;

    for (pos, (idx, base)) in candidates.iter().enumerate() {
        let url = format!(
            "{}/{}/?page={}",
            base.trim_end_matches('/'),
            path.trim_start_matches('/'),
            page
        );
        let resp = match client
            .get(&url)
            .header("tokenparam", tokenparam.clone())
            .header("token", token.clone())
            .header(
                "user-agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 Edg/114.0.1823.43",
            )
            .header("accept-encoding", "identity")
            .header("version", JM_APP_VERSION)
            .header(reqwest::header::COOKIE, cookie_header(&cookies))
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                let msg = format!("request failed: {e}");
                last_err = Some(msg.clone());
                if should_retry_error(&e) && pos + 1 < candidates.len() {
                    logl!("[tauri][api] retry base={} err={:?}", base, msg);
                    continue;
                }
                return Err(msg);
            }
        };

        let status = resp.status();
        if !status.is_success() && should_retry_status(status) && pos + 1 < candidates.len() {
            let msg = format!("http status {status}");
            last_err = Some(msg.clone());
            logl!("[tauri][api] retry base={} status={}", base, status);
            continue;
        }

        let body_bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("failed reading response body: {e}"))?;

        let body_preview = String::from_utf8_lossy(&body_bytes)
            .chars()
            .take(300)
            .collect::<String>();
        if should_retry_body(&body_preview) && pos + 1 < candidates.len() {
            let msg = "body indicates invalid domain".to_string();
            last_err = Some(msg.clone());
            logl!("[tauri][api] retry base={} body_hint", base);
            continue;
        }

        let env: ApiEnvelope = serde_json::from_slice(&body_bytes).map_err(|e| {
            format!(
                "invalid json response: status={status}, err={e}, body_preview={:?}",
                body_preview
            )
        })?;

        if env.code != 200 {
            let msg = if !env.error_msg.is_empty() {
                env.error_msg
            } else if !env.message.is_empty() {
                env.message
            } else {
                format!("request failed, code={}, http_status={}", env.code, status)
            };
            logl!(
                "[tauri][api] error path={} http_status={} api_code={} base={:?} msg={:?}",
                path, status, env.code, base, msg
            );
            return Err(api_error(status, env.code, msg));
        }

        let encrypted = env
            .data
            .as_str()
            .ok_or_else(|| format!("unexpected data type: {}", env.data))?;
        let decrypted = decode_resp_data(encrypted, ts)?;
        JM_API_BASE_INDEX.store(*idx, Ordering::Relaxed);
        return serde_json::from_str(&decrypted)
            .map_err(|e| format!("parse decrypted json failed: {e}"));
    }

    Err(last_err.unwrap_or_else(|| "request failed".to_string()))
}

async fn api_get_encrypted_with_query(
    path: &str,
    query: Option<String>,
    cookies: HashMap<String, String>,
) -> Result<serde_json::Value, String> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("system time error: {e}"))?
        .as_secs() as i64;

    let token_secret =
        std::env::var("JM_APP_TOKEN_SECRET").unwrap_or_else(|_| JM_APP_TOKEN_SECRET_DEFAULT.into());
    let token = md5_hex(&format!("{ts}{token_secret}"));
    let tokenparam = format!("{ts},{JM_HEADER_VER}");

    let client = http_client()?;
    let candidates = api_base_candidates();
    let mut last_err = None;

    for (pos, (idx, base)) in candidates.iter().enumerate() {
        let mut url = format!(
            "{}/{}",
            base.trim_end_matches('/'),
            path.trim_start_matches('/')
        );

        if let Some(q) = query.clone() {
            if !q.is_empty() {
                if !url.ends_with('/') {
                    url.push('/');
                }
                url.push('?');
                url.push_str(&q);
            }
        }

        let resp = match client
            .get(&url)
            .header("tokenparam", tokenparam.clone())
            .header("token", token.clone())
            .header(
                "user-agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 Edg/114.0.1823.43",
            )
            .header("accept-encoding", "identity")
            .header("version", JM_APP_VERSION)
            .header(reqwest::header::COOKIE, cookie_header(&cookies))
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                let msg = format!("request failed: {e}");
                last_err = Some(msg.clone());
                if should_retry_error(&e) && pos + 1 < candidates.len() {
                    logl!("[tauri][api] retry base={} err={:?}", base, msg);
                    continue;
                }
                return Err(msg);
            }
        };

        let status = resp.status();
        if !status.is_success() && should_retry_status(status) && pos + 1 < candidates.len() {
            let msg = format!("http status {status}");
            last_err = Some(msg.clone());
            logl!("[tauri][api] retry base={} status={}", base, status);
            continue;
        }

        let body_bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("failed reading response body: {e}"))?;

        let body_preview = String::from_utf8_lossy(&body_bytes)
            .chars()
            .take(300)
            .collect::<String>();
        if should_retry_body(&body_preview) && pos + 1 < candidates.len() {
            let msg = "body indicates invalid domain".to_string();
            last_err = Some(msg.clone());
            logl!("[tauri][api] retry base={} body_hint", base);
            continue;
        }

        let env: ApiEnvelope = serde_json::from_slice(&body_bytes).map_err(|e| {
            format!(
                "invalid json response: status={status}, err={e}, body_preview={:?}",
                body_preview
            )
        })?;

        if env.code != 200 {
            let msg = if !env.error_msg.is_empty() {
                env.error_msg
            } else if !env.message.is_empty() {
                env.message
            } else {
                format!("request failed, code={}, http_status={}", env.code, status)
            };
            logl!(
                "[tauri][api] error path={} http_status={} api_code={} base={:?} msg={:?}",
                path, status, env.code, base, msg
            );
            return Err(api_error(status, env.code, msg));
        }

        let encrypted = env
            .data
            .as_str()
            .ok_or_else(|| format!("unexpected data type: {}", env.data))?;
        let decrypted = decode_resp_data(encrypted, ts)?;
        JM_API_BASE_INDEX.store(*idx, Ordering::Relaxed);
        return serde_json::from_str(&decrypted)
            .map_err(|e| format!("parse decrypted json failed: {e}"));
    }

    Err(last_err.unwrap_or_else(|| "request failed".to_string()))
}

async fn api_post_encrypted(
    path: &str,
    form: &[(&str, &str)],
    cookies: HashMap<String, String>,
) -> Result<serde_json::Value, String> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("system time error: {e}"))?
        .as_secs() as i64;

    let token_secret =
        std::env::var("JM_APP_TOKEN_SECRET").unwrap_or_else(|_| JM_APP_TOKEN_SECRET_DEFAULT.into());
    let token = md5_hex(&format!("{ts}{token_secret}"));
    let tokenparam = format!("{ts},{JM_HEADER_VER}");

    let client = http_client()?;
    let candidates = api_base_candidates();
    let mut last_err = None;

    for (pos, (idx, base)) in candidates.iter().enumerate() {
        let url = format!(
            "{}/{}",
            base.trim_end_matches('/'),
            path.trim_start_matches('/')
        );

        let resp = match client
            .post(&url)
            .header("tokenparam", tokenparam.clone())
            .header("token", token.clone())
            .header(
                "user-agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 Edg/114.0.1823.43",
            )
            .header("accept-encoding", "identity")
            .header("version", JM_APP_VERSION)
            .header(reqwest::header::COOKIE, cookie_header(&cookies))
            .form(form)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                let msg = format!("request failed: {e}");
                last_err = Some(msg.clone());
                if should_retry_error(&e) && pos + 1 < candidates.len() {
                    logl!("[tauri][api] retry base={} err={:?}", base, msg);
                    continue;
                }
                return Err(msg);
            }
        };

        let status = resp.status();
        if !status.is_success() && should_retry_status(status) && pos + 1 < candidates.len() {
            let msg = format!("http status {status}");
            last_err = Some(msg.clone());
            logl!("[tauri][api] retry base={} status={}", base, status);
            continue;
        }

        let body_bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("failed reading response body: {e}"))?;

        let body_preview = String::from_utf8_lossy(&body_bytes)
            .chars()
            .take(300)
            .collect::<String>();
        if should_retry_body(&body_preview) && pos + 1 < candidates.len() {
            let msg = "body indicates invalid domain".to_string();
            last_err = Some(msg.clone());
            logl!("[tauri][api] retry base={} body_hint", base);
            continue;
        }

        let env: ApiEnvelope = serde_json::from_slice(&body_bytes).map_err(|e| {
            format!(
                "invalid json response: status={status}, err={e}, body_preview={:?}",
                body_preview
            )
        })?;

        if env.code != 200 {
            let msg = if !env.error_msg.is_empty() {
                env.error_msg
            } else if !env.message.is_empty() {
                env.message
            } else {
                format!("request failed, code={}, http_status={}", env.code, status)
            };
            logl!(
                "[tauri][api] error path={} http_status={} api_code={} base={:?} msg={:?}",
                path, status, env.code, base, msg
            );
            return Err(api_error(status, env.code, msg));
        }

        let encrypted = env
            .data
            .as_str()
            .ok_or_else(|| format!("unexpected data type: {}", env.data))?;
        let decrypted = decode_resp_data(encrypted, ts)?;
        JM_API_BASE_INDEX.store(*idx, Ordering::Relaxed);
        return serde_json::from_str(&decrypted)
            .map_err(|e| format!("parse decrypted json failed: {e}"));
    }

    Err(last_err.unwrap_or_else(|| "request failed".to_string()))
}

#[tauri::command]
async fn login(username: String, password: String) -> Result<LoginResult, String> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("system time error: {e}"))?
        .as_secs() as i64;

    let token_secret =
        std::env::var("JM_APP_TOKEN_SECRET").unwrap_or_else(|_| JM_APP_TOKEN_SECRET_DEFAULT.into());
    let token = md5_hex(&format!("{ts}{token_secret}"));
    let tokenparam = format!("{ts},{JM_HEADER_VER}");

    let client = http_client()?;
    let candidates = api_base_candidates();
    let mut last_err = None;

    for (pos, (idx, base)) in candidates.iter().enumerate() {
        let url = format!("{}/login", base.trim_end_matches('/'));

        let resp = match client
            .post(&url)
            .header("tokenparam", tokenparam.clone())
            .header("token", token.clone())
            .header("user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 Edg/114.0.1823.43")
            .header("accept-encoding", "identity")
            .header("version", JM_APP_VERSION)
            .form(&[("username", username.as_str()), ("password", password.as_str())])
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                let msg = format!("request failed: {e}");
                last_err = Some(msg.clone());
                if should_retry_error(&e) && pos + 1 < candidates.len() {
                    logl!("[tauri][login] retry base={} err={:?}", base, msg);
                    continue;
                }
                return Err(msg);
            }
        };

        let status = resp.status();
        let headers = resp.headers().clone();

        let mut cookies = HashMap::new();
        for c in resp.cookies() {
            cookies.insert(c.name().to_string(), c.value().to_string());
        }

        let body_bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("failed reading response body: {e}"))?;

        let body_preview = String::from_utf8_lossy(&body_bytes)
            .chars()
            .take(500)
            .collect::<String>();

        logl!(
            "[tauri][login] status={} url={} content-type={:?} content-encoding={:?} body_len={} body_preview={:?}",
            status,
            url,
            headers.get(reqwest::header::CONTENT_TYPE),
            headers.get(reqwest::header::CONTENT_ENCODING),
            body_bytes.len(),
            body_preview
        );

        if !status.is_success() && should_retry_status(status) && pos + 1 < candidates.len() {
            let msg = format!("http status {status}");
            last_err = Some(msg.clone());
            logl!("[tauri][login] retry base={} status={}", base, status);
            continue;
        }
        if should_retry_body(&body_preview) && pos + 1 < candidates.len() {
            let msg = "body indicates invalid domain".to_string();
            last_err = Some(msg.clone());
            logl!("[tauri][login] retry base={} body_hint", base);
            continue;
        }

        let body: ApiLoginResponse = serde_json::from_slice(&body_bytes).map_err(|e| {
            format!(
                "invalid json response: status={status}, err={e}, body_preview={:?}",
                body_preview
            )
        })?;

        if body.code != 200 {
            let msg = if !body.error_msg.is_empty() {
                body.error_msg
            } else if !body.message.is_empty() {
                body.message
            } else {
                format!("login failed, code={}", body.code)
            };
            return Err(msg);
        }

        let data_b64 = body
            .data
            .ok_or_else(|| "missing response data".to_string())?;
        let decrypted = decode_resp_data(&data_b64, ts)?;
        let user: ApiUserInfo =
            serde_json::from_str(&decrypted).map_err(|e| format!("parse user data failed: {e}"))?;

        JM_API_BASE_INDEX.store(*idx, Ordering::Relaxed);
        if let Ok(mut cfg) = config_state().lock() {
            cfg.session_cookies = cookies.clone();
            if let Err(e) = save_config_to_disk(&cfg) {
                logl!("[tauri][login] save cookies failed: {e}");
            }
        }
        return Ok(LoginResult { user, cookies });
    }

    Err(last_err.unwrap_or_else(|| "login failed".to_string()))
}

#[tauri::command]
async fn api_latest(
    page: String,
    cookies: HashMap<String, String>,
) -> Result<serde_json::Value, String> {
    api_get_encrypted("/latest", page, cookies).await
}

#[tauri::command]
async fn api_promote(
    page: String,
    cookies: HashMap<String, String>,
) -> Result<serde_json::Value, String> {
    api_get_encrypted("/promote", page, cookies).await
}

#[tauri::command]
async fn api_history(page: String, cookies: HashMap<String, String>) -> Result<serde_json::Value, String> {
    api_get_encrypted("/watch_list", page, cookies).await
}

#[tauri::command]
async fn api_daily(user_id: String, cookies: HashMap<String, String>) -> Result<serde_json::Value, String> {
    let query = format!("user_id={}", user_id);
    api_get_encrypted_with_query("/daily", Some(query), cookies).await
}

#[tauri::command]
async fn api_daily_check(
    user_id: String,
    daily_id: String,
    cookies: HashMap<String, String>,
) -> Result<serde_json::Value, String> {
    api_post_encrypted(
        "/daily_chk",
        &[("user_id", user_id.as_str()), ("daily_id", daily_id.as_str())],
        cookies,
    )
    .await
}

#[tauri::command]
async fn api_categories(cookies: HashMap<String, String>) -> Result<serde_json::Value, String> {
    api_get_encrypted_with_query("/categories", None, cookies).await
}

#[tauri::command]
fn api_read_cache_stats() -> Result<ReadCacheStats, String> {
    let data_dir = resolve_data_dir()?;
    let db = sled::open(data_dir.join("cache-stats.sled"))
        .map_err(|e| format!("open cache stats db failed: {e}"))?;
    let summary_tree = db
        .open_tree("read_cache_summary")
        .map_err(|e| format!("open cache summary tree failed: {e}"))?;
    if let Some(val) = summary_tree.get("summary").map_err(|e| format!("read summary failed: {e}"))? {
        let stats: ReadCacheStats =
            serde_json::from_slice(&val).map_err(|e| format!("decode summary failed: {e}"))?;
        return Ok(stats);
    }
    Ok(ReadCacheStats::default())
}

#[tauri::command]
fn api_read_cache_refresh(app: tauri::AppHandle) -> Result<(), String> {
    update_read_cache_stats(app)
}

#[tauri::command]
fn api_read_cache_cleanup(app: tauri::AppHandle, max_bytes: u64) -> Result<ReadCacheStats, String> {
    let base = resolve_read_cache_dir(&app)?;
    let read_dir = base.join("read");
    if !read_dir.exists() {
        return Ok(ReadCacheStats::default());
    }

    let mut entries = scan_read_cache_dirs(&read_dir);
    let mut total: u64 = entries.iter().map(|e| e.bytes).sum();

    if total > max_bytes {
        entries.sort_by(|a, b| a.newest_ms.cmp(&b.newest_ms));
        for entry in entries {
            if total <= max_bytes {
                break;
            }
            let dir = read_dir.join(sanitize_path_component(&entry.aid));
            if let Err(e) = std::fs::remove_dir_all(&dir) {
                logl!("[tauri][cache] remove {:?} failed: {}", dir, e);
                continue;
            }
            total = total.saturating_sub(entry.bytes);
        }
    }

    update_read_cache_stats(app.clone())?;
    api_read_cache_stats()
}

#[tauri::command]
async fn api_register_captcha(web_base: Option<String>) -> Result<String, String> {
    let base = web_base_from_opt(web_base);
    let url = format!("{}/captcha", base.trim_end_matches('/'));
    let referer = format!("{}/signup", base.trim_end_matches('/'));

    let client = register_client()?;
    let resp = client
        .get(&url)
        .header("user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 Edg/114.0.1823.43")
        .header("accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7")
        .header("accept-language", "zh-CN,zh;q=0.9")
        .header("accept-encoding", "identity")
        .header(reqwest::header::REFERER, referer)
        .send()
        .await
        .map_err(|e| format!("captcha request failed: {e}"))?;

    let status = resp.status();
    let bytes = resp.bytes().await.map_err(|e| format!("read captcha failed: {e}"))?;
    if !status.is_success() {
        return Err(format!("captcha http status {}", status.as_u16()));
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
async fn api_register(
    username: String,
    email: String,
    password: String,
    verification: String,
    gender: String,
    web_base: Option<String>,
) -> Result<serde_json::Value, String> {
    let base = web_base_from_opt(web_base);
    let url = format!("{}/signup", base.trim_end_matches('/'));

    let gender = if gender.eq_ignore_ascii_case("female") {
        "Female"
    } else {
        "Male"
    };

    let client = register_client()?;
    let resp = client
        .post(&url)
        .header("user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 Edg/114.0.1823.43")
        .header("accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7")
        .header("accept-language", "zh-CN,zh;q=0.9")
        .header("accept-encoding", "identity")
        .form(&[
            ("username", username.as_str()),
            ("password", password.as_str()),
            ("email", email.as_str()),
            ("verification", verification.as_str()),
            ("password_confirm", password.as_str()),
            ("gender", gender),
            ("age", "on"),
            ("terms", "on"),
            ("submit_signup", ""),
        ])
        .send()
        .await
        .map_err(|e| format!("register request failed: {e}"))?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("read register response failed: {e}"))?;
    let (ok, msg) = parse_toastr_message(&text);

    if ok {
        return Ok(serde_json::json!({ "ok": true, "message": msg }));
    }

    if status.is_redirection() && msg.is_empty() {
        return Ok(serde_json::json!({ "ok": true, "message": "" }));
    }

    if status != reqwest::StatusCode::OK && msg.is_empty() {
        return Err(format!("register http status {}", status.as_u16()));
    }

    Ok(serde_json::json!({ "ok": false, "message": msg }))
}

#[tauri::command]
async fn api_register_verify(email: String, web_base: Option<String>) -> Result<serde_json::Value, String> {
    let base = web_base_from_opt(web_base);
    let url = format!("{}/confirm", base.trim_end_matches('/'));

    let client = register_client()?;
    let resp = client
        .post(&url)
        .header("user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 Edg/114.0.1823.43")
        .header("accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7")
        .header("accept-language", "zh-CN,zh;q=0.9")
        .header("accept-encoding", "identity")
        .form(&[("email", email.as_str()), ("submit_confirm", "發送EMAIL")])
        .send()
        .await
        .map_err(|e| format!("verify mail request failed: {e}"))?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("read verify mail response failed: {e}"))?;
    let (ok, msg) = parse_toastr_message(&text);

    if ok {
        return Ok(serde_json::json!({ "ok": true, "message": msg }));
    }
    if status.is_redirection() && msg.is_empty() {
        return Ok(serde_json::json!({ "ok": true, "message": "" }));
    }
    if status != reqwest::StatusCode::OK && msg.is_empty() {
        return Err(format!("verify mail http status {}", status.as_u16()));
    }
    Ok(serde_json::json!({ "ok": false, "message": msg }))
}

#[tauri::command]
async fn api_reset_password(email: String, web_base: Option<String>) -> Result<serde_json::Value, String> {
    let base = web_base_from_opt(web_base);
    let url = format!("{}/lost", base.trim_end_matches('/'));

    let client = register_client()?;
    let resp = client
        .post(&url)
        .header("user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 Edg/114.0.1823.43")
        .header("accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7")
        .header("accept-language", "zh-CN,zh;q=0.9")
        .header("accept-encoding", "identity")
        .form(&[("email", email.as_str()), ("submit_lost", "恢復密碼")])
        .send()
        .await
        .map_err(|e| format!("reset password request failed: {e}"))?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("read reset response failed: {e}"))?;
    let (ok, msg) = parse_toastr_message(&text);

    if ok {
        return Ok(serde_json::json!({ "ok": true, "message": msg }));
    }
    if status.is_redirection() && msg.is_empty() {
        return Ok(serde_json::json!({ "ok": true, "message": "" }));
    }
    if status != reqwest::StatusCode::OK && msg.is_empty() {
        return Err(format!("reset password http status {}", status.as_u16()));
    }
    Ok(serde_json::json!({ "ok": false, "message": msg }))
}

#[tauri::command]
async fn api_verify_mail(url: String, web_base: Option<String>) -> Result<serde_json::Value, String> {
    let url = normalize_verify_url(&url, web_base);
    if url.is_empty() {
        return Err("empty verify url".to_string());
    }

    let client = register_client()?;
    let resp = client
        .get(&url)
        .header("user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 Edg/114.0.1823.43")
        .header("accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7")
        .header("accept-language", "zh-CN,zh;q=0.9")
        .header("accept-encoding", "identity")
        .send()
        .await
        .map_err(|e| format!("verify url request failed: {e}"))?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("read verify url response failed: {e}"))?;
    let (ok, msg) = parse_toastr_message(&text);

    if ok {
        return Ok(serde_json::json!({ "ok": true, "message": msg }));
    }
    if status.is_redirection() && msg.is_empty() {
        return Ok(serde_json::json!({ "ok": true, "message": "" }));
    }
    if status != reqwest::StatusCode::OK && msg.is_empty() {
        return Err(format!("verify url http status {}", status.as_u16()));
    }
    Ok(serde_json::json!({ "ok": false, "message": msg }))
}

#[tauri::command]
async fn api_category_search(
    category: String,
    page: String,
    sort: String,
    cookies: HashMap<String, String>,
) -> Result<serde_json::Value, String> {
    let mut params: Vec<(String, String)> = Vec::new();
    if let Ok(p) = page.parse::<i64>() {
        if p > 1 {
            params.push(("page".to_string(), p.to_string()));
        }
    }
    if !sort.trim().is_empty() {
        params.push(("o".to_string(), sort));
    }
    if !category.trim().is_empty() {
        params.push(("c".to_string(), category));
    }

    let query = if params.is_empty() {
        None
    } else {
        Some(
            params
                .into_iter()
                .map(|(k, v)| format!("{k}={v}"))
                .collect::<Vec<_>>()
                .join("&"),
        )
    };

    api_get_encrypted_with_query("/categories/filter", query, cookies).await
}

#[tauri::command]
async fn api_cover_cache(url: String, app: tauri::AppHandle) -> Result<String, String> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err("empty url".to_string());
    }

    let _permit = cover_semaphore()
        .acquire()
        .await
        .map_err(|_| "cover cache queue closed".to_string())?;

    let base = resolve_read_cache_dir(&app)?;
    let cover_dir = base.join("cover");
    std::fs::create_dir_all(&cover_dir).map_err(|e| format!("mkdir failed: {e}"))?;

    let clean_url = url.split('#').next().unwrap_or(&url);
    let clean_url = clean_url.split('?').next().unwrap_or(clean_url);
    let ext = std::path::Path::new(clean_url)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| sanitize_path_component(s))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "jpg".to_string());
    let hash = md5_hex(&url);
    let file_name = format!("{hash}.{ext}");
    let out_path = cover_dir.join(file_name);

    if out_path.exists() {
        return Ok(out_path.to_string_lossy().to_string());
    }

    let client = http_client()?;
    let mut last_err = None::<String>;
    for attempt in 0..3 {
        let resp = client
            .get(&url)
            .timeout(Duration::from_secs(10))
            .send()
            .await;
        match resp {
            Ok(resp) => {
                let status = resp.status();
                if !status.is_success() {
                    last_err = Some(format!("http status {}", status.as_u16()));
                } else {
                    let bytes = resp
                        .bytes()
                        .await
                        .map_err(|e| format!("read body failed: {e}"))?;
                    std::fs::write(&out_path, &bytes).map_err(|e| format!("write cache failed: {e}"))?;
                    return Ok(out_path.to_string_lossy().to_string());
                }
            }
            Err(e) => {
                last_err = Some(format!("request failed: {e}"));
            }
        }
        if attempt < 2 {
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
    }

    Err(last_err.unwrap_or_else(|| "request failed".to_string()))
}

#[tauri::command]
async fn api_search(
    search_query: String,
    sort: String,
    page: String,
    cookies: HashMap<String, String>,
) -> Result<serde_json::Value, String> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("system time error: {e}"))?
        .as_secs() as i64;

    let token_secret =
        std::env::var("JM_APP_TOKEN_SECRET").unwrap_or_else(|_| JM_APP_TOKEN_SECRET_DEFAULT.into());
    let token = md5_hex(&format!("{ts}{token_secret}"));
    let tokenparam = format!("{ts},{JM_HEADER_VER}");

    let client = http_client()?;
    let candidates = api_base_candidates();
    let mut last_err = None;

    for (pos, (idx, base)) in candidates.iter().enumerate() {
        let mut url = format!(
            "{}/search/?search_query={}&o={}",
            base.trim_end_matches('/'),
            urlencoding::encode(&search_query),
            urlencoding::encode(&sort)
        );
        if page.trim() != "1" && !page.trim().is_empty() {
            url.push_str(&format!("&page={}", urlencoding::encode(page.trim())));
        }

        let resp = match client
            .get(&url)
            .header("tokenparam", tokenparam.clone())
            .header("token", token.clone())
            .header(
                "user-agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 Edg/114.0.1823.43",
            )
            .header("accept-encoding", "identity")
            .header("version", JM_APP_VERSION)
            .header(reqwest::header::COOKIE, cookie_header(&cookies))
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                let msg = format!("request failed: {e}");
                last_err = Some(msg.clone());
                if should_retry_error(&e) && pos + 1 < candidates.len() {
                    logl!("[tauri][search] retry base={} err={:?}", base, msg);
                    continue;
                }
                return Err(msg);
            }
        };

        let status = resp.status();
        if !status.is_success() && should_retry_status(status) && pos + 1 < candidates.len() {
            let msg = format!("http status {status}");
            last_err = Some(msg.clone());
            logl!("[tauri][search] retry base={} status={}", base, status);
            continue;
        }

        let body_bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("failed reading response body: {e}"))?;

        let body_preview = String::from_utf8_lossy(&body_bytes)
            .chars()
            .take(300)
            .collect::<String>();
        if should_retry_body(&body_preview) && pos + 1 < candidates.len() {
            let msg = "body indicates invalid domain".to_string();
            last_err = Some(msg.clone());
            logl!("[tauri][search] retry base={} body_hint", base);
            continue;
        }

        let env: ApiEnvelope = serde_json::from_slice(&body_bytes).map_err(|e| {
            format!(
                "invalid json response: status={status}, err={e}, body_preview={:?}",
                body_preview
            )
        })?;

        if env.code != 200 {
            let msg = if !env.error_msg.is_empty() {
                env.error_msg
            } else if !env.message.is_empty() {
                env.message
            } else {
                format!("request failed, code={}, http_status={}", env.code, status)
            };
            logl!(
                "[tauri][search] error http_status={} api_code={} base={:?} msg={:?}",
                status, env.code, base, msg
            );
            return Err(api_error(status, env.code, msg));
        }

        let encrypted = env
            .data
            .as_str()
            .ok_or_else(|| format!("unexpected data type: {}", env.data))?;
        let decrypted = decode_resp_data(encrypted, ts)?;
        JM_API_BASE_INDEX.store(*idx, Ordering::Relaxed);
        return serde_json::from_str(&decrypted)
            .map_err(|e| format!("parse decrypted json failed: {e}"));
    }

    Err(last_err.unwrap_or_else(|| "request failed".to_string()))
}

#[tauri::command]
async fn api_album(
    id: String,
    cookies: HashMap<String, String>,
) -> Result<serde_json::Value, String> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("system time error: {e}"))?
        .as_secs() as i64;

    let token_secret =
        std::env::var("JM_APP_TOKEN_SECRET").unwrap_or_else(|_| JM_APP_TOKEN_SECRET_DEFAULT.into());
    let token = md5_hex(&format!("{ts}{token_secret}"));
    let tokenparam = format!("{ts},{JM_HEADER_VER}");

    let client = http_client()?;
    let candidates = api_base_candidates();
    let mut last_err = None;

    for (pos, (idx, base)) in candidates.iter().enumerate() {
        let url = format!(
            "{}/album/?comicName=&id={}",
            base.trim_end_matches('/'),
            id
        );

        let resp = match client
            .get(&url)
            .header("tokenparam", tokenparam.clone())
            .header("token", token.clone())
            .header(
                "user-agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 Edg/114.0.1823.43",
            )
            .header("accept-encoding", "identity")
            .header("version", JM_APP_VERSION)
            .header(reqwest::header::COOKIE, cookie_header(&cookies))
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                let msg = format!("request failed: {e}");
                last_err = Some(msg.clone());
                if should_retry_error(&e) && pos + 1 < candidates.len() {
                    logl!("[tauri][album] retry base={} err={:?}", base, msg);
                    continue;
                }
                return Err(msg);
            }
        };

        let status = resp.status();
        if !status.is_success() && should_retry_status(status) && pos + 1 < candidates.len() {
            let msg = format!("http status {status}");
            last_err = Some(msg.clone());
            logl!("[tauri][album] retry base={} status={}", base, status);
            continue;
        }

        let body_bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("failed reading response body: {e}"))?;

        let body_preview = String::from_utf8_lossy(&body_bytes)
            .chars()
            .take(300)
            .collect::<String>();
        if should_retry_body(&body_preview) && pos + 1 < candidates.len() {
            let msg = "body indicates invalid domain".to_string();
            last_err = Some(msg.clone());
            logl!("[tauri][album] retry base={} body_hint", base);
            continue;
        }

        let env: ApiEnvelope = serde_json::from_slice(&body_bytes).map_err(|e| {
            format!(
                "invalid json response: status={status}, err={e}, body_preview={:?}",
                body_preview
            )
        })?;

        if env.code != 200 {
            let msg = if !env.error_msg.is_empty() {
                env.error_msg
            } else if !env.message.is_empty() {
                env.message
            } else {
                format!("request failed, code={}, http_status={}", env.code, status)
            };
            return Err(msg);
        }

        let encrypted = env
            .data
            .as_str()
            .ok_or_else(|| format!("unexpected data type: {}", env.data))?;
        let decrypted = decode_resp_data(encrypted, ts)?;
        JM_API_BASE_INDEX.store(*idx, Ordering::Relaxed);
        return serde_json::from_str(&decrypted)
            .map_err(|e| format!("parse decrypted json failed: {e}"));
    }

    Err(last_err.unwrap_or_else(|| "request failed".to_string()))
}

#[tauri::command]
async fn api_chapter(
    id: String,
    cookies: HashMap<String, String>,
) -> Result<serde_json::Value, String> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("system time error: {e}"))?
        .as_secs() as i64;

    let token_secret =
        std::env::var("JM_APP_TOKEN_SECRET").unwrap_or_else(|_| JM_APP_TOKEN_SECRET_DEFAULT.into());
    let token = md5_hex(&format!("{ts}{token_secret}"));
    let tokenparam = format!("{ts},{JM_HEADER_VER}");

    let client = http_client()?;
    let candidates = api_base_candidates();
    let mut last_err = None;

    for (pos, (idx, base)) in candidates.iter().enumerate() {
        let url = format!(
            "{}/chapter/?comicName=&skip=&id={}",
            base.trim_end_matches('/'),
            id
        );

        let resp = match client
            .get(&url)
            .header("tokenparam", tokenparam.clone())
            .header("token", token.clone())
            .header(
                "user-agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 Edg/114.0.1823.43",
            )
            .header("accept-encoding", "identity")
            .header("version", JM_APP_VERSION)
            .header(reqwest::header::COOKIE, cookie_header(&cookies))
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                let msg = format!("request failed: {e}");
                last_err = Some(msg.clone());
                if should_retry_error(&e) && pos + 1 < candidates.len() {
                    logl!("[tauri][chapter] retry base={} err={:?}", base, msg);
                    continue;
                }
                return Err(msg);
            }
        };

        let status = resp.status();
        if !status.is_success() && should_retry_status(status) && pos + 1 < candidates.len() {
            let msg = format!("http status {status}");
            last_err = Some(msg.clone());
            logl!("[tauri][chapter] retry base={} status={}", base, status);
            continue;
        }

        let body_bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("failed reading response body: {e}"))?;

        let body_preview = String::from_utf8_lossy(&body_bytes)
            .chars()
            .take(300)
            .collect::<String>();
        if should_retry_body(&body_preview) && pos + 1 < candidates.len() {
            let msg = "body indicates invalid domain".to_string();
            last_err = Some(msg.clone());
            logl!("[tauri][chapter] retry base={} body_hint", base);
            continue;
        }

        let env: ApiEnvelope = serde_json::from_slice(&body_bytes).map_err(|e| {
            format!(
                "invalid json response: status={status}, err={e}, body_preview={:?}",
                body_preview
            )
        })?;

        if env.code != 200 {
            let msg = if !env.error_msg.is_empty() {
                env.error_msg
            } else if !env.message.is_empty() {
                env.message
            } else {
                format!("request failed, code={}, http_status={}", env.code, status)
            };
            return Err(msg);
        }

        let encrypted = env
            .data
            .as_str()
            .ok_or_else(|| format!("unexpected data type: {}", env.data))?;
        let decrypted = decode_resp_data(encrypted, ts)?;
        JM_API_BASE_INDEX.store(*idx, Ordering::Relaxed);
        return serde_json::from_str(&decrypted)
            .map_err(|e| format!("parse decrypted json failed: {e}"));
    }

    Err(last_err.unwrap_or_else(|| "request failed".to_string()))
}

#[tauri::command]
async fn api_comic_page_count(
    id: String,
    chapter_id: Option<String>,
    cookies: HashMap<String, String>,
) -> Result<u64, String> {
    let fetch_id = chapter_id.unwrap_or_else(|| id.clone());
    let chapter = api_chapter(fetch_id, cookies).await?;
    let page_count = chapter
        .get("images")
        .and_then(|v| v.as_array())
        .map(|arr| arr.len() as u64)
        .unwrap_or(0);

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("system time error: {e}"))?
        .as_secs() as i64;

    let entry = ComicExtraEntry {
        id,
        page_count,
        updated_at: now,
    };
    let tree = read_comic_extra_tree()?;
    let val =
        serde_json::to_vec(&entry).map_err(|e| format!("encode comic extra failed: {e}"))?;
    tree.insert(entry.id.as_bytes(), val)
        .map_err(|e| format!("write comic extra failed: {e}"))?;
    let _ = tree.flush();

    Ok(page_count)
}

#[tauri::command]
async fn api_comic_extra_get(id: String) -> Result<Option<ComicExtraEntry>, String> {
    let tree = read_comic_extra_tree()?;
    let Some(bytes) = tree
        .get(id.as_bytes())
        .map_err(|e| format!("read comic extra failed: {e}"))?
    else {
        return Ok(None);
    };
    let entry: ComicExtraEntry =
        serde_json::from_slice(&bytes).map_err(|e| format!("decode comic extra failed: {e}"))?;
    Ok(Some(entry))
}

fn parse_scramble_id(text: &str) -> Option<i64> {
    let needle = "var scramble_id = ";
    let start = text.find(needle)? + needle.len();
    let tail = &text[start..];
    let mut end = 0usize;
    for (i, ch) in tail.char_indices() {
        if !ch.is_ascii_digit() {
            break;
        }
        end = i + ch.len_utf8();
    }
    if end == 0 {
        return None;
    }
    tail[..end].parse::<i64>().ok()
}

#[tauri::command]
async fn api_chapter_scramble_id(id: String) -> Result<i64, String> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("system time error: {e}"))?
        .as_secs() as i64;

    let token_secret = std::env::var("JM_APP_TOKEN_SECRET_2")
        .unwrap_or_else(|_| JM_APP_TOKEN_SECRET_2_DEFAULT.into());
    let token = md5_hex(&format!("{ts}{token_secret}"));
    let tokenparam = format!("{ts},{JM_HEADER_VER}");

    let client = http_client()?;
    let candidates = api_base_candidates();
    let mut last_err = None;

    for (pos, (idx, base)) in candidates.iter().enumerate() {
        let url = format!(
            "{}/chapter_view_template/?id={}&mode=vertical&page=0&app_img_shunt=NaN",
            base.trim_end_matches('/'),
            id
        );

        let resp = match client
            .get(&url)
            .header("tokenparam", tokenparam.clone())
            .header("token", token.clone())
            .header(
                "user-agent",
                "Mozilla/5.0 (Linux; Android 7.1.2; DT1901A Build/N2G47O; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/86.0.4240.198 Mobile Safari/537.36",
            )
            .header("accept-encoding", "identity")
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                let msg = format!("request failed: {e}");
                last_err = Some(msg.clone());
                if should_retry_error(&e) && pos + 1 < candidates.len() {
                    logl!("[tauri][chapter_scramble] retry base={} err={:?}", base, msg);
                    continue;
                }
                return Err(msg);
            }
        };

        let status = resp.status();
        if !status.is_success() && should_retry_status(status) && pos + 1 < candidates.len() {
            let msg = format!("http status {status}");
            last_err = Some(msg.clone());
            logl!("[tauri][chapter_scramble] retry base={} status={}", base, status);
            continue;
        }

        let text = resp
            .text()
            .await
            .map_err(|e| format!("failed reading response text: {e}"))?;

        if !status.is_success() {
            return Err(format!(
                "http error: {}, body_preview={:?}",
                status,
                &text.chars().take(200).collect::<String>()
            ));
        }

        if let Some(v) = parse_scramble_id(&text) {
            JM_API_BASE_INDEX.store(*idx, Ordering::Relaxed);
            return Ok(v);
        }

        logl!(
            "[tauri][chapter_scramble] failed parse scramble_id base={:?} body_preview={:?}",
            base,
            text.chars().take(300).collect::<String>()
        );
        JM_API_BASE_INDEX.store(*idx, Ordering::Relaxed);
        return Ok(220980);
    }

    Err(last_err.unwrap_or_else(|| "request failed".to_string()))
}

fn get_segmentation_num(eps_id: i64, scramble_id: i64, picture_name: &str) -> i64 {
    if eps_id < scramble_id {
        return 0;
    }
    if eps_id < 268_850 {
        return 10;
    }

    let digest = md5_hex(&format!("{eps_id}{picture_name}"));
    let last = digest.as_bytes().last().copied().unwrap_or(b'0') as i64; // ord(hex[-1])

    if eps_id > 421_926 {
        let mut num = last % 8;
        num = num * 2 + 2;
        num
    } else {
        let mut num = last % 10;
        num = num * 2 + 2;
        num
    }
}

#[tauri::command]
async fn api_segmentation_nums(
    eps_id: String,
    scramble_id: i64,
    picture_names: Vec<String>,
) -> Result<Vec<i64>, String> {
    let eps = eps_id
        .parse::<i64>()
        .map_err(|_| "invalid eps_id".to_string())?;
    Ok(picture_names
        .iter()
        .map(|name| get_segmentation_num(eps, scramble_id, name))
        .collect())
}

fn mime_from_format(fmt: ImageFormat) -> &'static str {
    match fmt {
        ImageFormat::Jpeg => "image/jpeg",
        ImageFormat::Png => "image/png",
        ImageFormat::WebP => "image/webp",
        _ => "application/octet-stream",
    }
}

fn descramble_image_bytes(bytes: &[u8], num: i64) -> Result<(Vec<u8>, ImageFormat), String> {
    descramble_image_bytes_with_cancel(bytes, num, None)
}

fn descramble_image_bytes_with_cancel(
    bytes: &[u8],
    num: i64,
    cancel: Option<&AtomicBool>,
) -> Result<(Vec<u8>, ImageFormat), String> {
    let started = Instant::now();
    if num <= 1 {
        let fmt = image::guess_format(bytes).unwrap_or(ImageFormat::Jpeg);
        return Ok((bytes.to_vec(), fmt));
    }

    let fmt_in = image::guess_format(bytes).unwrap_or(ImageFormat::Jpeg);
    let img = image::load_from_memory(bytes).map_err(|e| format!("decode image failed: {e}"))?;

    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let num_u32 = num as u32;
    if num_u32 <= 1 || h == 0 || w == 0 {
        return Ok((bytes.to_vec(), fmt_in));
    }

    let rem = h % num_u32;
    let copy_height = h / num_u32;

    let mut blocks: Vec<(u32, u32)> = Vec::with_capacity(num_u32 as usize);
    let mut total_h = 0u32;
    for i in 0..num_u32 {
        let mut end = copy_height * (i + 1);
        if i == num_u32 - 1 {
            end += rem;
        }
        blocks.push((total_h, end));
        total_h = end;
    }

    let src = rgba.as_raw();
    let mut dst = vec![0u8; src.len()];
    let row_bytes = (w * 4) as usize;

    let mut y = 0u32;
    for (start, end) in blocks.into_iter().rev() {
        if cancel.is_some_and(|c| c.load(Ordering::Relaxed)) {
            return Err("cancelled".to_string());
        }
        let seg_h = end.saturating_sub(start);
        for dy in 0..seg_h {
            if dy % 64 == 0 && cancel.is_some_and(|c| c.load(Ordering::Relaxed)) {
                return Err("cancelled".to_string());
            }
            let src_y = start + dy;
            let dst_y = y + dy;
            let src_off = (src_y as usize) * row_bytes;
            let dst_off = (dst_y as usize) * row_bytes;
            dst[dst_off..dst_off + row_bytes].copy_from_slice(&src[src_off..src_off + row_bytes]);
        }
        y += seg_h;
    }

    let out_rgba = image::RgbaImage::from_raw(w, h, dst).ok_or("image buffer create failed")?;

    let fmt_out = if fmt_in == ImageFormat::Jpeg {
        ImageFormat::Jpeg
    } else {
        ImageFormat::Png
    };

    if cancel.is_some_and(|c| c.load(Ordering::Relaxed)) {
        return Err("cancelled".to_string());
    }

    let mut out_bytes = Vec::new();
    if fmt_out == ImageFormat::Jpeg {
        let rgb = image::DynamicImage::ImageRgba8(out_rgba).to_rgb8();
        image::DynamicImage::ImageRgb8(rgb)
            .write_to(&mut Cursor::new(&mut out_bytes), fmt_out)
            .map_err(|e| format!("encode image failed: {e}"))?;
    } else {
        image::DynamicImage::ImageRgba8(out_rgba)
            .write_to(&mut Cursor::new(&mut out_bytes), fmt_out)
            .map_err(|e| format!("encode image failed: {e}"))?;
    }

    logl!(
        "[tauri][img] descramble done num={} fmt_in={:?} fmt_out={:?} in={}B out={}B cost_ms={}",
        num,
        fmt_in,
        fmt_out,
        bytes.len(),
        out_bytes.len(),
        started.elapsed().as_millis()
    );

    Ok((out_bytes, fmt_out))
}

fn sanitize_path_component(s: &str) -> String {
    let filtered: String = s
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_' || *c == '.')
        .collect();
    if filtered.is_empty() {
        "unknown".to_string()
    } else {
        filtered
    }
}

fn resolve_read_cache_dir<R: tauri::Runtime>(_app: &tauri::AppHandle<R>) -> Result<std::path::PathBuf, String> {
    // Always store cache alongside the executable (cross-platform, easy for user to locate).
    // Env override for debugging/testing.
    if let Ok(dir) = std::env::var("JM_CACHE_DIR") {
        let base = std::path::PathBuf::from(dir);
        let p = base.join("jmcomic-cache");
        std::fs::create_dir_all(&p).map_err(|e| format!("mkdir failed: {e}"))?;
        return Ok(p);
    }

    let exe_dir = std::env::current_exe()
        .map_err(|e| format!("current exe error: {e}"))?
        .parent()
        .ok_or_else(|| "current exe has no parent dir".to_string())?
        .to_path_buf();

    let p = exe_dir.join("jmcomic-cache");
    std::fs::create_dir_all(&p).map_err(|e| format!("mkdir failed: {e}"))?;
    Ok(p)
}

fn cover_semaphore() -> &'static tokio::sync::Semaphore {
    COVER_SEMAPHORE.get_or_init(|| tokio::sync::Semaphore::new(4))
}

fn resolve_data_dir() -> Result<std::path::PathBuf, String> {
    if let Ok(dir) = std::env::var("JM_DATA_DIR") {
        let p = std::path::PathBuf::from(dir);
        std::fs::create_dir_all(&p).map_err(|e| format!("mkdir failed: {e}"))?;
        return Ok(p);
    }

    let exe_dir = std::env::current_exe()
        .map_err(|e| format!("current exe error: {e}"))?
        .parent()
        .ok_or_else(|| "current exe has no parent dir".to_string())?
        .to_path_buf();

    let p = exe_dir.join("data");
    std::fs::create_dir_all(&p).map_err(|e| format!("mkdir failed: {e}"))?;
    Ok(p)
}

fn mime_from_path(path: &std::path::Path) -> &'static str {
    match path.extension().and_then(|x| x.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    }
}

fn jmcache_protocol<R: tauri::Runtime>(
    ctx: tauri::UriSchemeContext<'_, R>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    use tauri::http::{Response, StatusCode};

    let app = ctx.app_handle();
    let uri = request.uri().to_string();
    let path_part = uri
        .split("://")
        .nth(1)
        .and_then(|s| s.splitn(2, '/').nth(1))
        .unwrap_or("");
    let path_part = path_part.strip_prefix('/').unwrap_or(path_part);

    let decoded = match urlencoding::decode(path_part) {
        Ok(s) => s.into_owned(),
        Err(_) => {
            return Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(b"bad path encoding".to_vec())
                .unwrap_or_else(|_| Response::new(Vec::new()));
        }
    };

    let requested = std::path::PathBuf::from(decoded);
    let base = match resolve_read_cache_dir(app) {
        Ok(p) => p,
        Err(e) => {
            logl!("[tauri][jmcache] resolve cache dir failed: {e}");
            return Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(b"cache dir error".to_vec())
                .unwrap_or_else(|_| Response::new(Vec::new()));
        }
    };

    let (requested_canon, base_canon) = match (std::fs::canonicalize(&requested), std::fs::canonicalize(&base)) {
        (Ok(r), Ok(b)) => (r, b),
        _ => {
            return Response::builder()
                .status(StatusCode::NOT_FOUND)
                .body(b"not found".to_vec())
                .unwrap_or_else(|_| Response::new(Vec::new()));
        }
    };

    if !requested_canon.starts_with(&base_canon) {
        logl!(
            "[tauri][jmcache] forbidden path requested={:?} base={:?}",
            requested_canon,
            base_canon
        );
        return Response::builder()
            .status(StatusCode::FORBIDDEN)
            .body(b"forbidden".to_vec())
            .unwrap_or_else(|_| Response::new(Vec::new()));
    }

    let bytes = match std::fs::read(&requested_canon) {
        Ok(b) => b,
        Err(_) => {
            return Response::builder()
                .status(StatusCode::NOT_FOUND)
                .body(b"not found".to_vec())
                .unwrap_or_else(|_| Response::new(Vec::new()));
        }
    };

    let mime = mime_from_path(&requested_canon);
    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", mime)
        .body(bytes)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

#[tauri::command]
async fn api_local_favorites_list(
    store: tauri::State<'_, LocalFavoritesStore>,
) -> Result<Vec<LocalFavoriteView>, String> {
    let tree = store.tree()?;
    let latest_tree = read_latest_tree()?;

    let mut latest_map = HashMap::new();
    for res in latest_tree.iter() {
        let (k, v) = res.map_err(|e| format!("sled iter failed: {e}"))?;
        if let Ok(entry) = serde_json::from_slice::<LatestChapterEntry>(&v) {
            latest_map.insert(k.to_vec(), entry);
        }
    }

    let mut items = Vec::new();
    for res in tree.iter() {
        let (_, v) = res.map_err(|e| format!("sled iter failed: {e}"))?;
        let it: LocalFavoriteItem =
            bincode::deserialize(&v).map_err(|e| format!("decode local favorite failed: {e}"))?;
        let latest = latest_map
            .get(it.aid.as_bytes())
            .and_then(|entry| entry.latest_chapter_sort.clone());
        items.push(LocalFavoriteView {
            aid: it.aid,
            title: it.title,
            author: it.author,
            cover_url: it.cover_url,
            added_at: it.added_at,
            updated_at: it.updated_at,
            latest_chapter_sort: latest,
        });
    }
    items.sort_by_key(|x| -x.updated_at);
    Ok(items)
}

#[tauri::command]
async fn api_local_favorite_has(
    aid: String,
    store: tauri::State<'_, LocalFavoritesStore>,
) -> Result<bool, String> {
    let tree = store.tree()?;
    Ok(tree.get(aid.as_bytes()).map_err(|e| format!("sled get failed: {e}"))?.is_some())
}

#[tauri::command]
async fn api_local_favorite_toggle(
    aid: String,
    title: Option<String>,
    author: Option<String>,
    cover_url: Option<String>,
    store: tauri::State<'_, LocalFavoritesStore>,
    app: tauri::AppHandle,
) -> Result<bool, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("system time error: {e}"))?
        .as_secs() as i64;

    let tree = store.tree()?;

    if tree
        .get(aid.as_bytes())
        .map_err(|e| format!("sled get failed: {e}"))?
        .is_some()
    {
        tree.remove(aid.as_bytes())
            .map_err(|e| format!("sled remove failed: {e}"))?;
        let _ = tree.flush();
        logl!("[tauri][localfav] removed aid={}", aid);
        let _ = read_latest_tree().and_then(|t| {
            let _ = t.remove(aid.as_bytes());
            let _ = t.flush();
            Ok(())
        });
        let _ = read_latest_seen_tree().and_then(|t| {
            let _ = t.remove(aid.as_bytes());
            let _ = t.flush();
            Ok(())
        });
        let _ = read_follow_tree().and_then(|t| {
            let _ = t.remove(aid.as_bytes());
            let _ = t.flush();
            Ok(())
        });
        return Ok(false);
    }

    let title_log = title.clone();
    let item = LocalFavoriteItem {
        aid: aid.clone(),
        title: title.unwrap_or_default(),
        author: author.unwrap_or_default(),
        cover_url: cover_url.unwrap_or_default(),
        added_at: now,
        updated_at: now,
    };
    let val = bincode::serialize(&item).map_err(|e| format!("encode local favorite failed: {e}"))?;
    tree.insert(aid.as_bytes(), val)
        .map_err(|e| format!("sled insert failed: {e}"))?;
    let _ = tree.flush();
    logl!("[tauri][localfav] added aid={} title={:?}", aid, title_log);
    let handle = app.clone();
    std::thread::spawn(move || {
        tauri::async_runtime::block_on(async {
            if let Err(e) = scan_latest_chapters(handle).await {
                logl!("[tauri][latest] scan failed: {e}");
            }
        });
    });
    Ok(true)
}

#[tauri::command]
async fn api_read_cancel(
    read_key: String,
    registry: tauri::State<'_, CancelRegistry>,
) -> Result<(), String> {
    logl!("[tauri][cancel] read_key={:?} set=true", read_key);
    registry.cancel(&read_key);
    Ok(())
}

#[tauri::command]
async fn api_image_descramble(url: String, num: i64) -> Result<ImagePayload, String> {
    let started = Instant::now();
    logl!("[tauri][img] start url={:?} num={}", url, num);

    let client = http_client()?;
    let resp = client
        .get(&url)
        .header("accept-encoding", "identity")
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        logl!(
            "[tauri][img] http_error status={} url={:?} cost_ms={}",
            status,
            url,
            started.elapsed().as_millis()
        );
        return Err(format!("image http error: {status}"));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("read image failed: {e}"))?;

    let (out, fmt) = descramble_image_bytes(&bytes, num)?;
    let mime = mime_from_format(fmt).to_string();
    let data_b64 = base64::engine::general_purpose::STANDARD.encode(out);

    logl!(
        "[tauri][img] ok url={:?} num={} mime={} b64_len={} cost_ms={}",
        url,
        num,
        mime,
        data_b64.len(),
        started.elapsed().as_millis()
    );
    Ok(ImagePayload { mime, data_b64 })
}

#[tauri::command]
async fn api_image_descramble_file(
    app: tauri::AppHandle,
    url: String,
    num: i64,
    aid: Option<String>,
    read_key: Option<String>,
    registry: tauri::State<'_, CancelRegistry>,
) -> Result<String, String> {
    let started = Instant::now();
    logl!(
        "[tauri][imgfile] start url={:?} num={} read_key={:?}",
        url, num, read_key
    );

    if num <= 1 {
        return Ok(url);
    }

    let token = read_key.as_deref().map(|k| registry.token_for(k));
    if let Some(t) = &token {
        if t.load(Ordering::Relaxed) {
            logl!(
                "[tauri][imgfile] cancelled(before) url={:?} num={} read_key={:?} cost_ms={}",
                url,
                num,
                read_key,
                started.elapsed().as_millis()
            );
            return Err("cancelled".to_string());
        }
    }

    let base_dir = resolve_read_cache_dir(&app)?;
    let out_dir = match aid.as_deref() {
        Some(a) => base_dir.join("read").join(sanitize_path_component(a)),
        None => base_dir.join("read").join("unknown"),
    };
    std::fs::create_dir_all(&out_dir).map_err(|e| format!("mkdir failed: {e}"))?;

    let key = md5_hex(&format!("{url}|{num}"));
    let cached_png = out_dir.join(format!("{key}.png"));
    if cached_png.exists() {
        logl!(
            "[tauri][imgfile] hit num={} out={:?} read_key={:?} cost_ms={}",
            num,
            cached_png,
            read_key,
            started.elapsed().as_millis()
        );
        return Ok(cached_png.to_string_lossy().to_string());
    }
    let cached_jpg = out_dir.join(format!("{key}.jpg"));
    if cached_jpg.exists() {
        logl!(
            "[tauri][imgfile] hit num={} out={:?} read_key={:?} cost_ms={}",
            num,
            cached_jpg,
            read_key,
            started.elapsed().as_millis()
        );
        return Ok(cached_jpg.to_string_lossy().to_string());
    }

    let client = http_client()?;
    let resp = client
        .get(&url)
        .header("accept-encoding", "identity")
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    if let Some(t) = &token {
        if t.load(Ordering::Relaxed) {
            logl!(
                "[tauri][imgfile] cancelled(after_http) url={:?} num={} read_key={:?} cost_ms={}",
                url,
                num,
                read_key,
                started.elapsed().as_millis()
            );
            return Err("cancelled".to_string());
        }
    }

    let status = resp.status();
    if !status.is_success() {
        logl!(
            "[tauri][imgfile] http_error status={} url={:?} cost_ms={}",
            status,
            url,
            started.elapsed().as_millis()
        );
        return Err(format!("image http error: {status}"));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("read image failed: {e}"))?;

    if let Some(t) = &token {
        if t.load(Ordering::Relaxed) {
            logl!(
                "[tauri][imgfile] cancelled(after_body) url={:?} num={} read_key={:?} cost_ms={}",
                url,
                num,
                read_key,
                started.elapsed().as_millis()
            );
            return Err("cancelled".to_string());
        }
    }

    let (out, fmt) = match descramble_image_bytes_with_cancel(&bytes, num, token.as_deref()) {
        Ok(v) => v,
        Err(e) if e == "cancelled" => {
            logl!(
                "[tauri][imgfile] cancelled(descramble) url={:?} num={} read_key={:?} cost_ms={}",
                url,
                num,
                read_key,
                started.elapsed().as_millis()
            );
            return Err("cancelled".to_string());
        }
        Err(e) => return Err(e),
    };
    let ext = match fmt {
        ImageFormat::Jpeg => "jpg",
        ImageFormat::Png => "png",
        _ => "bin",
    };

    let out_path = out_dir.join(format!("{key}.{ext}"));
    if !out_path.exists() {
        std::fs::write(&out_path, &out).map_err(|e| format!("write file failed: {e}"))?;
    }

    logl!(
        "[tauri][imgfile] ok num={} out={:?} out_bytes={} read_key={:?} cost_ms={}",
        num,
        out_path,
        out.len(),
        read_key,
        started.elapsed().as_millis()
    );

    Ok(out_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn api_favorites(
    page: String,
    sort: String,
    folder_id: String,
    cookies: HashMap<String, String>,
) -> Result<serde_json::Value, String> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("system time error: {e}"))?
        .as_secs() as i64;

    let token_secret =
        std::env::var("JM_APP_TOKEN_SECRET").unwrap_or_else(|_| JM_APP_TOKEN_SECRET_DEFAULT.into());
    let token = md5_hex(&format!("{ts}{token_secret}"));
    let tokenparam = format!("{ts},{JM_HEADER_VER}");

    let api_base = std::env::var("JM_API_BASE").unwrap_or_else(|_| JM_API_BASE_DEFAULT.to_string());
    let url = format!(
        "{}/favorite/?page={}&folder_id={}&o={}",
        api_base.trim_end_matches('/'),
        page,
        folder_id,
        sort
    );

    let client = http_client()?;
    let resp = client
        .get(&url)
        .header("tokenparam", tokenparam)
        .header("token", token)
        .header(
            "user-agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 Edg/114.0.1823.43",
        )
        .header("accept-encoding", "identity")
        .header("version", JM_APP_VERSION)
        .header(reqwest::header::COOKIE, cookie_header(&cookies))
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    let status = resp.status();
    let body_bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("failed reading response body: {e}"))?;

    let body_preview = String::from_utf8_lossy(&body_bytes)
        .chars()
        .take(300)
        .collect::<String>();

    let env: ApiEnvelope = serde_json::from_slice(&body_bytes).map_err(|e| {
        format!(
            "invalid json response: status={status}, err={e}, body_preview={:?}",
            body_preview
        )
    })?;

    if env.code != 200 {
        let msg = if !env.error_msg.is_empty() {
            env.error_msg
        } else if !env.message.is_empty() {
            env.message
        } else {
            format!("request failed, code={}, http_status={}", env.code, status)
        };
        logl!(
            "[tauri][fav] error http_status={} api_code={} url={:?} msg={:?}",
            status, env.code, url, msg
        );
        return Err(api_error(status, env.code, msg));
    }

    let encrypted = env
        .data
        .as_str()
        .ok_or_else(|| format!("unexpected data type: {}", env.data))?;
    let decrypted = decode_resp_data(encrypted, ts)?;
    serde_json::from_str(&decrypted).map_err(|e| format!("parse decrypted json failed: {e}"))
}

#[tauri::command]
async fn api_favorite_toggle(
    aid: String,
    cookies: HashMap<String, String>,
) -> Result<serde_json::Value, String> {
    api_post_encrypted("/favorite", &[("aid", aid.as_str())], cookies).await
}

#[tauri::command]
async fn api_favorite_folder_add(
    name: String,
    cookies: HashMap<String, String>,
) -> Result<serde_json::Value, String> {
    api_post_encrypted(
        "/favorite_folder",
        &[("folder_name", name.as_str()), ("type", "add")],
        cookies,
    )
    .await
}

#[tauri::command]
async fn api_favorite_folder_del(
    folder_id: String,
    cookies: HashMap<String, String>,
) -> Result<serde_json::Value, String> {
    api_post_encrypted(
        "/favorite_folder",
        &[("folder_id", folder_id.as_str()), ("type", "del")],
        cookies,
    )
    .await
}

#[tauri::command]
async fn api_favorite_folder_move(
    aid: String,
    folder_id: String,
    cookies: HashMap<String, String>,
) -> Result<serde_json::Value, String> {
    api_post_encrypted(
        "/favorite_folder",
        &[
            ("folder_id", folder_id.as_str()),
            ("type", "move"),
            ("aid", aid.as_str()),
        ],
        cookies,
    )
    .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(CancelRegistry::default())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if cfg!(target_os = "android") {
                if let Ok(base) = app.path().app_data_dir() {
                    let _ = std::fs::create_dir_all(&base);
                    let _ = std::fs::create_dir_all(base.join("jmcomic-logs"));
                    let _ = std::fs::create_dir_all(base.join("data"));
                    std::env::set_var("JM_CACHE_DIR", base.to_string_lossy().as_ref());
                    std::env::set_var(
                        "JM_LOG_DIR",
                        base.join("jmcomic-logs").to_string_lossy().as_ref(),
                    );
                    std::env::set_var("JM_DATA_DIR", base.join("data").to_string_lossy().as_ref());
                }
            }
            app.manage(LocalFavoritesStore::open());
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                if let Err(e) = update_read_cache_stats(handle.clone()) {
                    logl!("[tauri][cache] scan failed: {e}");
                }
                std::thread::sleep(Duration::from_secs(600));
            });
            let follow_handle = app.handle().clone();
            std::thread::spawn(move || loop {
                let h = follow_handle.clone();
                tauri::async_runtime::block_on(async {
                    if let Err(e) = scan_latest_chapters(h.clone()).await {
                        logl!("[tauri][latest] scan failed: {e}");
                    }
                    if let Err(e) = scan_follow_updates(h).await {
                        logl!("[tauri][follow] scan failed: {e}");
                    }
                });
                std::thread::sleep(Duration::from_secs(600));
            });
            tauri::async_runtime::spawn(async {
                match fetch_api_domain_list().await {
                    Ok(list) => {
                        let count = list.len();
                        if let Err(e) = update_api_domain_cache(list) {
                            logl!("[tauri][api] update api domain cache failed: {e}");
                        } else {
                            logl!("[tauri][api] api domain cache updated: {count}");
                        }
                    }
                    Err(e) => {
                        logl!("[tauri][api] fetch api domain list failed: {e}");
                    }
                }
            });
            Ok(())
        })
        .register_uri_scheme_protocol("jmcache", |ctx, request| jmcache_protocol(ctx, request))
        .invoke_handler(tauri::generate_handler![
            greet,
            api_config_get,
            api_config_set_socks_proxy,
            api_read_progress_upsert,
            api_read_progress_clear,
            api_read_progress_export,
            api_read_progress_import,
            api_follow_state_list,
            api_proxy_check,
            login,
            api_latest,
            api_promote,
            api_history,
            api_daily,
            api_daily_check,
            api_categories,
            api_read_cache_stats,
            api_read_cache_refresh,
            api_read_cache_cleanup,
            api_register_captcha,
            api_register,
            api_register_verify,
            api_reset_password,
            api_verify_mail,
            api_api_base_current,
            api_api_base_list,
            api_api_base_latency,
            api_api_domain_fetch,
            api_category_search,
            api_cover_cache,
            api_search,
            api_local_favorites_list,
            api_local_favorite_has,
            api_local_favorite_toggle,
            api_album,
            api_chapter,
            api_comic_page_count,
            api_comic_extra_get,
            api_chapter_scramble_id,
            api_segmentation_nums,
            api_image_descramble,
            api_image_descramble_file,
            api_read_cancel,
            api_favorites,
            api_favorite_toggle,
            api_favorite_folder_add,
            api_favorite_folder_del,
            api_favorite_folder_move
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
